/**
 * Emergence Monitor (Step 5)
 *
 * Main orchestrator for skill emergence detection.
 * Queries Feed 2.0, runs both frequency and sequence detection,
 * generates EmergenceSignals, filters dismissed patterns, and
 * produces EmergenceProposals for Jim's review.
 *
 * Trigger: Feed write hook (called after new telemetry logged).
 * NOT a timer/cron — fires on activity, with debounce.
 *
 * Sprint 4: CONV-ARCH-004 (Skill Emergence)
 */

import { logger } from '../logger';
import { detectPatterns } from '../skills/pattern-detector';
import {
  querySessionActions,
  groupActionsBySession,
  detectSequencePatterns,
} from './session-detector';
import {
  generateProposal,
  generateSkillName,
} from './proposal-generator';
import type {
  EmergenceConfig,
  EmergenceSignal,
  EmergenceProposal,
  EmergenceCheckResult,
  DismissedPattern,
  EmergenceEvent,
} from './types';
import { DEFAULT_EMERGENCE_CONFIG } from './types';

// =============================================================================
// STATE
// =============================================================================

/** Dismissed patterns with cooldown tracking */
const dismissedPatterns = new Map<string, DismissedPattern>();

/** Today's proposal count (resets daily) */
let dailyProposalCount = 0;
let dailyResetDate = new Date().toDateString();

/** Debounce: minimum ms between checks */
const CHECK_DEBOUNCE_MS = 60_000; // 1 minute
let lastCheckTime = 0;

/** Event listeners for telemetry */
const eventListeners: Array<(event: EmergenceEvent) => void> = [];

// =============================================================================
// FEATURE FLAG
// =============================================================================

function isEmergenceEnabled(): boolean {
  return process.env.ATLAS_EMERGENCE_AWARENESS === 'true';
}

// =============================================================================
// MAIN CHECK
// =============================================================================

/**
 * Run a full emergence check.
 * Called as a Feed write hook after new session telemetry is logged.
 *
 * Returns signals and proposals found, respecting:
 * - Dismissed pattern cooldown
 * - Daily proposal rate limit
 * - Debounce interval
 */
export async function checkForEmergence(
  config: Partial<EmergenceConfig> = {}
): Promise<EmergenceCheckResult> {
  const mergedConfig = { ...DEFAULT_EMERGENCE_CONFIG, ...config };

  // Feature flag guard
  if (!isEmergenceEnabled()) {
    return emptyResult();
  }

  // Debounce: skip if checked recently
  const now = Date.now();
  if (now - lastCheckTime < CHECK_DEBOUNCE_MS) {
    logger.debug('Emergence check skipped (debounce)');
    return emptyResult();
  }
  lastCheckTime = now;

  // Reset daily counter if new day
  const today = new Date().toDateString();
  if (today !== dailyResetDate) {
    dailyProposalCount = 0;
    dailyResetDate = today;
  }

  logger.info('Running emergence check', {
    windowDays: mergedConfig.windowDays,
    minFrequency: mergedConfig.minFrequency,
  });

  const signals: EmergenceSignal[] = [];
  let frequencyPatternsFound = 0;
  let sequencePatternsFound = 0;
  let skippedDismissed = 0;

  // ─── 1. Frequency Detection (existing pattern-detector) ────
  try {
    const frequencyResult = await detectPatterns();
    frequencyPatternsFound = frequencyResult.patterns.length;

    for (const pattern of frequencyResult.patterns) {
      const signalId = `freq-${pattern.intentHash}`;

      // Check dismissed
      if (isDismissed(pattern.intentHash, mergedConfig.dismissCooldownDays)) {
        skippedDismissed++;
        continue;
      }

      const signal: EmergenceSignal = {
        id: signalId,
        source: 'frequency',
        frequencyPattern: pattern,
        frequency: pattern.frequency,
        lastOccurrence: pattern.lastSeen,
        avgTurns: 1, // Frequency patterns are single-action
        completionRate: 1.0,
        suggestedSkillName: '',
        description: '',
      };

      // Generate name after signal creation
      signal.suggestedSkillName = generateSkillName(signal);
      signal.description = `Frequency pattern: ${pattern.canonicalText.substring(0, 80)}`;

      signals.push(signal);
    }
  } catch (error) {
    logger.error('Frequency detection failed (non-fatal)', { error });
  }

  // ─── 2. Sequence Detection (new session-aware) ────────────
  try {
    const sessionActions = await querySessionActions(mergedConfig.windowDays);
    const sessionGroups = groupActionsBySession(sessionActions);
    const sequencePatterns = detectSequencePatterns(sessionGroups, mergedConfig);
    sequencePatternsFound = sequencePatterns.length;

    for (const pattern of sequencePatterns) {
      const signalId = `seq-${pattern.sequence.hash}`;

      // Check dismissed
      if (isDismissed(pattern.sequence.hash, mergedConfig.dismissCooldownDays)) {
        skippedDismissed++;
        continue;
      }

      const signal: EmergenceSignal = {
        id: signalId,
        source: 'sequence',
        sequencePattern: pattern,
        frequency: pattern.frequency,
        lastOccurrence: pattern.lastSeen,
        avgTurns: pattern.avgTurns,
        completionRate: pattern.completionRate,
        suggestedSkillName: '',
        description: '',
      };

      signal.suggestedSkillName = generateSkillName(signal);
      signal.description = `Sequence pattern: ${pattern.sequence.transitions.map(
        t => `${t.fromAction}→${t.toAction}`
      ).join(', ')}`;

      signals.push(signal);
    }
  } catch (error) {
    logger.error('Sequence detection failed (non-fatal)', { error });
  }

  // ─── 3. Generate Proposals (respecting daily limit) ────────

  const proposals: EmergenceProposal[] = [];
  let skippedRateLimit = 0;

  for (const signal of signals) {
    if (dailyProposalCount >= mergedConfig.maxProposalsPerDay) {
      skippedRateLimit++;
      continue;
    }

    const proposal = generateProposal(signal);
    proposals.push(proposal);
    dailyProposalCount++;

    emitEvent({
      type: 'proposal_generated',
      signalId: signal.id,
      proposalId: proposal.id,
      skillName: signal.suggestedSkillName,
      timestamp: new Date().toISOString(),
    });
  }

  // ─── 4. Emit check event ──────────────────────────────────

  emitEvent({
    type: 'emergence_check',
    metadata: {
      sessionsAnalyzed: 0, // Will be filled by caller if needed
      frequencyPatternsFound,
      sequencePatternsFound,
      proposalsGenerated: proposals.length,
    },
    timestamp: new Date().toISOString(),
  });

  const result: EmergenceCheckResult = {
    signals,
    proposals,
    stats: {
      sessionsAnalyzed: 0,
      sequencePatternsFound,
      frequencyPatternsFound,
      proposalsGenerated: proposals.length,
      skippedDismissed,
      skippedRateLimit,
    },
  };

  logger.info('Emergence check complete', result.stats);

  return result;
}

// =============================================================================
// DISMISS / APPROVE
// =============================================================================

/**
 * Dismiss a proposal (pattern enters cooldown).
 */
export function dismissProposal(
  proposal: EmergenceProposal,
  reason?: string
): void {
  const patternHash = getPatternHash(proposal);

  dismissedPatterns.set(patternHash, {
    signalId: proposal.signal.id,
    patternHash,
    dismissedAt: new Date().toISOString(),
    cooldownUntil: getCooldownEnd(DEFAULT_EMERGENCE_CONFIG.dismissCooldownDays),
    reason,
  });

  proposal.status = 'dismissed';
  proposal.processedAt = new Date().toISOString();
  proposal.dismissReason = reason;

  emitEvent({
    type: 'proposal_dismissed',
    signalId: proposal.signal.id,
    proposalId: proposal.id,
    skillName: proposal.suggestedSkillName,
    metadata: { reason },
    timestamp: new Date().toISOString(),
  });

  logger.info('Emergence proposal dismissed', {
    proposalId: proposal.id,
    skillName: proposal.suggestedSkillName,
    reason,
  });
}

/**
 * Approve a proposal (skill creation triggered).
 */
export function approveProposal(proposal: EmergenceProposal): void {
  proposal.status = 'approved';
  proposal.processedAt = new Date().toISOString();

  emitEvent({
    type: 'proposal_approved',
    signalId: proposal.signal.id,
    proposalId: proposal.id,
    skillName: proposal.suggestedSkillName,
    timestamp: new Date().toISOString(),
  });

  logger.info('Emergence proposal approved', {
    proposalId: proposal.id,
    skillName: proposal.suggestedSkillName,
  });
}

// =============================================================================
// EVENT SYSTEM
// =============================================================================

/**
 * Subscribe to emergence events (for Feed 2.0 logging).
 */
export function onEmergenceEvent(listener: (event: EmergenceEvent) => void): void {
  eventListeners.push(listener);
}

/**
 * Remove an event listener.
 */
export function offEmergenceEvent(listener: (event: EmergenceEvent) => void): void {
  const index = eventListeners.indexOf(listener);
  if (index >= 0) eventListeners.splice(index, 1);
}

function emitEvent(event: EmergenceEvent): void {
  for (const listener of eventListeners) {
    try {
      listener(event);
    } catch (error) {
      logger.error('Emergence event listener error', { error, eventType: event.type });
    }
  }
}

// =============================================================================
// HELPERS
// =============================================================================

function isDismissed(hash: string, cooldownDays: number): boolean {
  const dismissed = dismissedPatterns.get(hash);
  if (!dismissed) return false;

  const cooldownEnd = new Date(dismissed.cooldownUntil).getTime();
  return Date.now() < cooldownEnd;
}

function getPatternHash(proposal: EmergenceProposal): string {
  if (proposal.signal.source === 'frequency' && proposal.signal.frequencyPattern) {
    return proposal.signal.frequencyPattern.intentHash;
  }
  if (proposal.signal.source === 'sequence' && proposal.signal.sequencePattern) {
    return proposal.signal.sequencePattern.sequence.hash;
  }
  return proposal.signal.id;
}

function getCooldownEnd(days: number): string {
  const end = new Date();
  end.setDate(end.getDate() + days);
  return end.toISOString();
}

function emptyResult(): EmergenceCheckResult {
  return {
    signals: [],
    proposals: [],
    stats: {
      sessionsAnalyzed: 0,
      sequencePatternsFound: 0,
      frequencyPatternsFound: 0,
      proposalsGenerated: 0,
      skippedDismissed: 0,
      skippedRateLimit: 0,
    },
  };
}

// =============================================================================
// TESTING SUPPORT
// =============================================================================

/** Reset internal state (for tests only) */
export function _resetForTesting(): void {
  dismissedPatterns.clear();
  dailyProposalCount = 0;
  dailyResetDate = new Date().toDateString();
  lastCheckTime = 0;
  eventListeners.length = 0;
}

/** Override debounce for testing */
export function _setLastCheckTime(time: number): void {
  lastCheckTime = time;
}
