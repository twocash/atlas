/**
 * Emergence — Proposal Generator (Step 6)
 *
 * Converts EmergenceSignals into conversational EmergenceProposals
 * with natural-language descriptions suitable for Telegram delivery.
 *
 * Sprint 4: CONV-ARCH-004 (Skill Emergence)
 */

import { logger } from '../logger';
import type {
  EmergenceSignal,
  EmergenceProposal,
  SequencePattern,
} from './types';
import type { DetectedPattern } from '../skills/pattern-detector';

// =============================================================================
// PROPOSAL TEXT GENERATION
// =============================================================================

/**
 * Generate a conversational proposal description from a frequency pattern.
 */
function describeFrequencyPattern(pattern: DetectedPattern): string {
  const parts: string[] = [];

  parts.push(
    `I've noticed you do something like "${truncate(pattern.canonicalText, 60)}" ` +
    `about ${pattern.frequency} times in the last couple weeks.`
  );

  if (pattern.pillar) {
    parts.push(`It's always in the ${pattern.pillar} space.`);
  }

  if (pattern.toolsUsed.length > 0) {
    parts.push(`Each time I use: ${pattern.toolsUsed.join(', ')}.`);
  }

  if (pattern.avgExecutionTimeMs > 0) {
    const seconds = Math.round(pattern.avgExecutionTimeMs / 1000);
    parts.push(`Takes about ${seconds}s each time.`);
  }

  return parts.join(' ');
}

/**
 * Generate a conversational proposal description from a sequence pattern.
 */
function describeSequencePattern(pattern: SequencePattern): string {
  const parts: string[] = [];

  const transitions = pattern.sequence.transitions;
  const flowDescription = transitions
    .map(t => `${t.fromAction} → ${t.toAction}`)
    .join(', then ');

  parts.push(
    `I've spotted a workflow you repeat: ${flowDescription}. ` +
    `This sequence has happened ${pattern.frequency} times.`
  );

  if (pattern.commonPillar) {
    parts.push(`Usually in ${pattern.commonPillar}.`);
  }

  parts.push(
    `Average session length: ${Math.round(pattern.avgTurns)} turns, ` +
    `${Math.round(pattern.completionRate * 100)}% completion rate.`
  );

  if (pattern.commonTools.length > 0) {
    parts.push(`Tools involved: ${pattern.commonTools.slice(0, 5).join(', ')}.`);
  }

  return parts.join(' ');
}

/**
 * Generate the full proposal text with the ask.
 */
function generateProposalText(signal: EmergenceSignal): string {
  const lines: string[] = [];

  // Pattern description
  if (signal.source === 'frequency' && signal.frequencyPattern) {
    lines.push(describeFrequencyPattern(signal.frequencyPattern));
  } else if (signal.source === 'sequence' && signal.sequencePattern) {
    lines.push(describeSequencePattern(signal.sequencePattern));
  }

  lines.push('');
  lines.push(`Want me to turn this into a skill called "${signal.suggestedSkillName}"?`);
  lines.push('I can automate the routine parts so you just confirm and go.');

  return lines.join('\n');
}

// =============================================================================
// SKILL NAME GENERATION
// =============================================================================

/**
 * Generate a human-readable skill name from an emergence signal.
 */
export function generateSkillName(signal: EmergenceSignal): string {
  if (signal.source === 'frequency' && signal.frequencyPattern) {
    const pattern = signal.frequencyPattern;
    const parts: string[] = [];

    if (pattern.actionType) {
      parts.push(pattern.actionType);
    }

    // Extract 2 key words from canonical text
    const keywords = pattern.canonicalText
      .toLowerCase()
      .split(/\s+/)
      .filter(w => w.length > 4 && !['about', 'their', 'would', 'could', 'should'].includes(w))
      .slice(0, 2);

    if (keywords.length > 0) {
      parts.push(...keywords);
    }

    if (parts.length > 0) {
      return parts.join('-');
    }
  }

  if (signal.source === 'sequence' && signal.sequencePattern) {
    const transitions = signal.sequencePattern.sequence.transitions;
    if (transitions.length > 0) {
      const first = transitions[0].fromAction;
      const last = transitions[transitions.length - 1].toAction;
      return `${first}-to-${last}-workflow`;
    }
  }

  return `auto-skill-${signal.id.substring(0, 8)}`;
}

// =============================================================================
// MAIN GENERATOR
// =============================================================================

/**
 * Convert an EmergenceSignal into an EmergenceProposal for delivery to Jim.
 */
export function generateProposal(signal: EmergenceSignal): EmergenceProposal {
  const proposalText = generateProposalText(signal);

  const proposal: EmergenceProposal = {
    id: `ep-${Date.now()}-${signal.id.substring(0, 8)}`,
    signal,
    proposalText,
    suggestedSkillName: signal.suggestedSkillName,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };

  logger.info('Emergence proposal generated', {
    proposalId: proposal.id,
    signalId: signal.id,
    source: signal.source,
    skillName: signal.suggestedSkillName,
  });

  return proposal;
}

// =============================================================================
// PROPOSAL FORMATTING (surface-agnostic)
// =============================================================================

/**
 * Format an EmergenceProposal as plain text for delivery to any surface.
 */
export function formatProposalText(proposal: EmergenceProposal): string {
  const lines: string[] = [];

  lines.push('Pattern Detected');
  lines.push('');
  lines.push(proposal.proposalText);
  lines.push('');
  lines.push(`Suggested skill: ${proposal.suggestedSkillName}`);
  lines.push(`Seen ${proposal.signal.frequency}x, last: ${formatDate(proposal.signal.lastOccurrence)}`);

  return lines.join('\n');
}

// =============================================================================
// HELPERS
// =============================================================================

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.substring(0, maxLen - 3) + '...';
}

function formatDate(isoString: string): string {
  try {
    const d = new Date(isoString);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return isoString;
  }
}
