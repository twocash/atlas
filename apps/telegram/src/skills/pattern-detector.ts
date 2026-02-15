/**
 * Atlas Skill System - Pattern Detector
 *
 * Phase 3: Queries Feed 2.0 for action patterns, identifies candidates
 * for skill generation when 3+ similar actions occur in 14 days.
 *
 * Runs daily (scheduled) to detect patterns without per-action overhead.
 */

import { logger } from '../logger';
import { isFeatureEnabled, getDetectionConfig, getSafetyLimits } from '../config/features';
import { hasSameIntent } from './intent-hash';
import {
  type SkillDefinition,
  type SkillTrigger,
  type SkillProcess,
  type SkillTier,
  createDefaultMetrics,
} from './schema';
import { getSkillRegistry } from './registry';
import type { Pillar } from '../conversation/types';

// =============================================================================
// TYPES
// =============================================================================

/**
 * An action logged in Feed 2.0
 */
export interface LoggedAction {
  id: string;
  intentHash: string;
  actionType: string;
  pillar: Pillar;
  toolsUsed: string[];
  messageText: string;
  timestamp: string;
  confirmed?: boolean;
  adjusted?: boolean;
  originalSuggestion?: string;
  executionTimeMs?: number;
}

/**
 * A detected pattern of similar actions
 */
export interface DetectedPattern {
  /** Representative intent hash for this pattern */
  intentHash: string;

  /** Canonical text example */
  canonicalText: string;

  /** All actions in this pattern */
  actions: LoggedAction[];

  /** Common pillar (if consistent) */
  pillar?: Pillar;

  /** Common action type (if consistent) */
  actionType?: string;

  /** Common tools used */
  toolsUsed: string[];

  /** Frequency in detection window */
  frequency: number;

  /** First occurrence */
  firstSeen: string;

  /** Last occurrence */
  lastSeen: string;

  /** Average execution time */
  avgExecutionTimeMs: number;

  /** Proposed skill tier */
  proposedTier: SkillTier;
}

/**
 * A proposed skill generated from a pattern
 */
export interface SkillProposal {
  /** Unique ID for this proposal */
  id: string;

  /** Source pattern */
  pattern: DetectedPattern;

  /** Generated skill definition */
  skill: SkillDefinition;

  /** When proposal was created */
  createdAt: string;

  /** Proposal status */
  status: 'pending' | 'approved' | 'rejected' | 'expired';

  /** Rejection reason (if rejected) */
  rejectionReason?: string;

  /** When it was processed (approved/rejected) */
  processedAt?: string;
}

/**
 * Result of pattern detection run
 */
export interface PatternDetectionResult {
  /** Patterns found */
  patterns: DetectedPattern[];

  /** New proposals generated */
  proposals: SkillProposal[];

  /** Detection window */
  window: {
    start: string;
    end: string;
    days: number;
  };

  /** Stats */
  stats: {
    actionsAnalyzed: number;
    patternsFound: number;
    proposalsGenerated: number;
    skippedExisting: number;
    skippedRejected: number;
  };
}

// =============================================================================
// PATTERN DETECTION
// =============================================================================

/**
 * Group actions by intent hash similarity
 */
function groupActionsByIntent(actions: LoggedAction[]): Map<string, LoggedAction[]> {
  const groups = new Map<string, LoggedAction[]>();

  for (const action of actions) {
    // Find existing group with similar intent
    let foundGroup = false;
    for (const [groupHash, groupActions] of groups) {
      if (hasSameIntent(action.intentHash, groupHash)) {
        groupActions.push(action);
        foundGroup = true;
        break;
      }
    }

    // Create new group
    if (!foundGroup) {
      groups.set(action.intentHash, [action]);
    }
  }

  return groups;
}

/**
 * Analyze a group of actions to create a pattern
 */
function createPattern(intentHash: string, actions: LoggedAction[]): DetectedPattern {
  // Find most common pillar
  const pillarCounts = new Map<Pillar, number>();
  for (const action of actions) {
    pillarCounts.set(action.pillar, (pillarCounts.get(action.pillar) || 0) + 1);
  }
  const sortedPillars = [...pillarCounts.entries()].sort((a, b) => b[1] - a[1]);
  const consistentPillar = sortedPillars[0]?.[1] === actions.length ? sortedPillars[0][0] : undefined;

  // Find most common action type
  const typeCounts = new Map<string, number>();
  for (const action of actions) {
    typeCounts.set(action.actionType, (typeCounts.get(action.actionType) || 0) + 1);
  }
  const sortedTypes = [...typeCounts.entries()].sort((a, b) => b[1] - a[1]);
  const consistentType = sortedTypes[0]?.[1] === actions.length ? sortedTypes[0][0] : undefined;

  // Collect all tools used
  const toolSet = new Set<string>();
  for (const action of actions) {
    for (const tool of action.toolsUsed) {
      toolSet.add(tool);
    }
  }

  // Calculate average execution time
  const execTimes = actions.filter(a => a.executionTimeMs).map(a => a.executionTimeMs!);
  const avgExecTime = execTimes.length > 0
    ? execTimes.reduce((a, b) => a + b, 0) / execTimes.length
    : 0;

  // Sort by timestamp
  const sorted = [...actions].sort((a, b) =>
    new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  // Propose tier based on tools
  const toolsUsed = Array.from(toolSet);
  let proposedTier: SkillTier = 0;

  // Tier 0: Read-only (queries, status)
  const readOnlyTools = ['notion_query', 'notion_search', 'work_queue_list', 'feed_list', 'dev_pipeline_list'];
  const hasWriteTools = toolsUsed.some((t: string) => !readOnlyTools.includes(t));

  if (hasWriteTools) {
    proposedTier = 1; // Creates entries

    // Tier 2: External actions or complex
    const externalTools = ['send_email', 'post_social', 'pit_crew_dispatch'];
    const hasExternalTools = toolsUsed.some((t: string) => externalTools.some((e: string) => t.includes(e)));

    if (hasExternalTools || toolsUsed.length >= 3) {
      proposedTier = 2;
    }
  }

  return {
    intentHash,
    canonicalText: sorted[0].messageText,
    actions,
    pillar: consistentPillar,
    actionType: consistentType,
    toolsUsed,
    frequency: actions.length,
    firstSeen: sorted[0].timestamp,
    lastSeen: sorted[sorted.length - 1].timestamp,
    avgExecutionTimeMs: avgExecTime,
    proposedTier,
  };
}

/**
 * Generate a skill name from pattern
 */
function generateSkillName(pattern: DetectedPattern): string {
  // Use pillar + action type + first keyword
  const parts: string[] = [];

  if (pattern.pillar) {
    parts.push(pattern.pillar.toLowerCase().replace(/\s+/g, '-'));
  }

  if (pattern.actionType) {
    parts.push(pattern.actionType.toLowerCase());
  }

  // Extract key word from canonical text
  const words = pattern.canonicalText
    .toLowerCase()
    .split(/\s+/)
    .filter(w => w.length > 4)
    .slice(0, 2);
  if (words.length > 0) {
    parts.push(words.join('-'));
  }

  // Add suffix for uniqueness
  const suffix = pattern.intentHash.substring(0, 4);

  return parts.length > 0 ? `${parts.join('-')}-${suffix}` : `auto-skill-${suffix}`;
}

/**
 * Generate triggers from pattern
 */
function generateTriggers(pattern: DetectedPattern): SkillTrigger[] {
  const triggers: SkillTrigger[] = [];

  // Intent hash trigger (most specific)
  triggers.push({
    type: 'intentHash',
    value: pattern.intentHash,
  });

  // Pillar trigger (if consistent)
  if (pattern.pillar) {
    triggers.push({
      type: 'pillar',
      value: pattern.pillar,
    });
  }

  // Keyword trigger from canonical text
  const keywords = pattern.canonicalText
    .toLowerCase()
    .split(/\s+/)
    .filter(w => w.length > 3 && !['the', 'and', 'for', 'with', 'this', 'that'].includes(w))
    .slice(0, 5);

  if (keywords.length >= 2) {
    triggers.push({
      type: 'keyword',
      value: keywords.join('|'),
    });
  }

  return triggers;
}

/**
 * Generate a process from pattern
 */
function generateProcess(pattern: DetectedPattern): SkillProcess {
  // Generate tool sequence from commonly used tools
  const steps = pattern.toolsUsed.map((tool, index) => ({
    id: `step_${index + 1}`,
    tool,
    inputs: {}, // Will need context-specific inputs
    onError: 'fail' as const,
  }));

  if (steps.length === 0) {
    // Fallback to agent dispatch
    return {
      type: 'agent_dispatch' as const,
      steps: [{
        id: 'execute',
        agent: 'claude',
        task: `Process request similar to: ${pattern.canonicalText}`,
      }],
    };
  }

  return {
    type: 'tool_sequence' as const,
    steps,
  };
}

/**
 * Generate a skill proposal from a pattern
 */
function generateProposal(pattern: DetectedPattern): SkillProposal {
  const name = generateSkillName(pattern);
  const triggers = generateTriggers(pattern);
  const process = generateProcess(pattern);

  const skill: SkillDefinition = {
    name,
    version: '1.0.0',
    description: `Auto-generated skill from ${pattern.frequency} similar actions: "${pattern.canonicalText.substring(0, 50)}..."`,
    triggers,
    inputs: {},
    outputs: [],
    process,
    tier: pattern.proposedTier,
    enabled: false, // Disabled until approved
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    source: 'generated',
    metrics: createDefaultMetrics(),
    tags: ['auto-generated'],
    author: 'pattern-detector',
  };

  return {
    id: `p-${Date.now()}-${name.substring(0, 20)}`,
    pattern,
    skill,
    createdAt: new Date().toISOString(),
    status: 'pending',
  };
}

// =============================================================================
// NOTION QUERY (Feed 2.0)
// =============================================================================

/**
 * Query Feed 2.0 for logged actions in time window
 *
 * This uses the Notion SDK directly since we need specific fields
 */
async function queryLoggedActions(
  windowDays: number
): Promise<LoggedAction[]> {
  try {
    // Import Notion client
    const { Client } = await import('@notionhq/client');
    const notion = new Client({ auth: process.env.NOTION_API_KEY });

    // Calculate window start
    const windowStart = new Date();
    windowStart.setDate(windowStart.getDate() - windowDays);

    // Feed 2.0 database ID
    const FEED_DATABASE_ID = '90b2b33f-4b44-4b42-870f-8d62fb8cbf18';

    // Query Feed 2.0 for entries with intent hashes
    const response = await notion.databases.query({
      database_id: FEED_DATABASE_ID,
      filter: {
        and: [
          {
            timestamp: 'created_time',
            created_time: {
              after: windowStart.toISOString(),
            },
          },
          {
            property: 'Intent Hash',
            rich_text: {
              is_not_empty: true,
            },
          },
        ],
      },
      sorts: [
        {
          timestamp: 'created_time',
          direction: 'descending',
        },
      ],
      page_size: 100,
    });

    // Transform to LoggedAction
    const actions: LoggedAction[] = [];

    for (const page of response.results) {
      if (!('properties' in page)) continue;

      const props = page.properties as Record<string, any>;

      // Extract fields
      const intentHash = props['Intent Hash']?.rich_text?.[0]?.plain_text || '';
      const actionType = props['Action Type']?.select?.name || 'Process';
      const pillar = (props['Pillar']?.select?.name || 'Personal') as Pillar;
      const toolsUsedStr = props['Tools Used']?.rich_text?.[0]?.plain_text || '';
      const messageText = props['Entry']?.title?.[0]?.plain_text || '';
      const confirmed = props['Classification Confirmed']?.checkbox || false;
      const adjusted = props['Classification Adjusted']?.checkbox || false;
      const originalSuggestion = props['Original Suggestion']?.rich_text?.[0]?.plain_text;
      const executionTime = props['Execution Time']?.number;

      if (intentHash) {
        actions.push({
          id: page.id,
          intentHash,
          actionType,
          pillar,
          toolsUsed: toolsUsedStr.split(',').map((t: string) => t.trim()).filter(Boolean),
          messageText,
          timestamp: (page as any).created_time || new Date().toISOString(),
          confirmed,
          adjusted,
          originalSuggestion,
          executionTimeMs: executionTime,
        });
      }
    }

    logger.debug('Queried Feed 2.0 for actions', { count: actions.length, windowDays });
    return actions;
  } catch (error) {
    logger.error('Failed to query Feed 2.0 for pattern detection', { error });
    return [];
  }
}

// =============================================================================
// COOLDOWN TRACKING
// =============================================================================

// Track rejected patterns to avoid re-proposing
const rejectedPatterns = new Map<string, { rejectedAt: string; reason: string }>();

/**
 * Check if a pattern was recently rejected
 */
function isPatternRejected(intentHash: string, cooldownHours: number): boolean {
  const rejection = rejectedPatterns.get(intentHash);
  if (!rejection) return false;

  const rejectedAt = new Date(rejection.rejectedAt);
  const cooldownMs = cooldownHours * 60 * 60 * 1000;

  return Date.now() - rejectedAt.getTime() < cooldownMs;
}

/**
 * Mark a pattern as rejected
 */
export function markPatternRejected(intentHash: string, reason: string): void {
  rejectedPatterns.set(intentHash, {
    rejectedAt: new Date().toISOString(),
    reason,
  });
  logger.info('Pattern marked as rejected', { intentHash, reason });
}

// =============================================================================
// MAIN DETECTOR
// =============================================================================

/**
 * Run pattern detection
 *
 * Analyzes logged actions to find patterns worth converting to skills.
 * Returns proposals for review (Tier 0 may auto-deploy if configured).
 */
export async function detectPatterns(): Promise<PatternDetectionResult> {
  // Check if pattern detection is enabled
  if (!isFeatureEnabled('patternDetection')) {
    logger.debug('Pattern detection disabled');
    return {
      patterns: [],
      proposals: [],
      window: { start: '', end: '', days: 0 },
      stats: {
        actionsAnalyzed: 0,
        patternsFound: 0,
        proposalsGenerated: 0,
        skippedExisting: 0,
        skippedRejected: 0,
      },
    };
  }

  const config = getDetectionConfig();
  const limits = getSafetyLimits();

  const windowStart = new Date();
  windowStart.setDate(windowStart.getDate() - config.windowDays);
  const windowEnd = new Date();

  logger.info('Running pattern detection', {
    windowDays: config.windowDays,
    minFrequency: config.minFrequency,
  });

  // Query logged actions
  const actions = await queryLoggedActions(config.windowDays);

  if (actions.length === 0) {
    logger.info('No actions found for pattern detection');
    return {
      patterns: [],
      proposals: [],
      window: {
        start: windowStart.toISOString(),
        end: windowEnd.toISOString(),
        days: config.windowDays,
      },
      stats: {
        actionsAnalyzed: 0,
        patternsFound: 0,
        proposalsGenerated: 0,
        skippedExisting: 0,
        skippedRejected: 0,
      },
    };
  }

  // Group by intent hash similarity
  const groups = groupActionsByIntent(actions);

  // Find patterns meeting frequency threshold
  const patterns: DetectedPattern[] = [];
  let skippedExisting = 0;
  let skippedRejected = 0;

  const registry = getSkillRegistry();

  for (const [intentHash, groupActions] of groups) {
    if (groupActions.length >= config.minFrequency) {
      // Check if skill already exists for this intent
      const existingMatch = registry.findBestMatch(groupActions[0].messageText, {
        pillar: groupActions[0].pillar,
      });

      if (existingMatch && existingMatch.score >= 0.9) {
        skippedExisting++;
        logger.debug('Skipping pattern - skill already exists', {
          intentHash,
          existingSkill: existingMatch.skill.name,
        });
        continue;
      }

      // Check cooldown for rejected patterns
      if (isPatternRejected(intentHash, config.cooldownHours)) {
        skippedRejected++;
        logger.debug('Skipping pattern - recently rejected', { intentHash });
        continue;
      }

      const pattern = createPattern(intentHash, groupActions);
      patterns.push(pattern);
    }
  }

  // Generate proposals (respecting weekly limits)
  const proposals: SkillProposal[] = [];

  for (const pattern of patterns) {
    if (proposals.length >= limits.maxSkillsPerWeek) {
      logger.info('Weekly skill limit reached', { limit: limits.maxSkillsPerWeek });
      break;
    }

    // Check tier 2 limit
    if (pattern.proposedTier === 2) {
      const tier2Count = proposals.filter(p => p.skill.tier === 2).length;
      if (tier2Count >= limits.maxTier2PerWeek) {
        logger.info('Weekly tier 2 limit reached', { limit: limits.maxTier2PerWeek });
        continue;
      }
    }

    const proposal = generateProposal(pattern);
    proposals.push(proposal);

    logger.info('Pattern detected, proposal generated', {
      pattern: pattern.intentHash,
      frequency: pattern.frequency,
      proposedSkill: proposal.skill.name,
      tier: proposal.skill.tier,
    });
  }

  // Auto-deploy Tier 0 skills if configured
  if (isFeatureEnabled('autoDeployTier0')) {
    for (const proposal of proposals) {
      if (proposal.skill.tier === 0) {
        proposal.skill.enabled = true;
        proposal.status = 'approved';
        proposal.processedAt = new Date().toISOString();

        // Register immediately
        registry.register(proposal.skill);

        logger.info('Tier 0 skill auto-deployed', {
          skill: proposal.skill.name,
        });
      }
    }
  }

  const result: PatternDetectionResult = {
    patterns,
    proposals,
    window: {
      start: windowStart.toISOString(),
      end: windowEnd.toISOString(),
      days: config.windowDays,
    },
    stats: {
      actionsAnalyzed: actions.length,
      patternsFound: patterns.length,
      proposalsGenerated: proposals.length,
      skippedExisting,
      skippedRejected,
    },
  };

  logger.info('Pattern detection complete', result.stats);

  return result;
}

/**
 * Get pending proposals (for approval UI)
 */
export function getPendingProposals(proposals: SkillProposal[]): SkillProposal[] {
  return proposals.filter(p => p.status === 'pending');
}

/**
 * Approve a proposal
 */
export function approveProposal(proposal: SkillProposal): SkillDefinition {
  proposal.skill.enabled = true;
  proposal.status = 'approved';
  proposal.processedAt = new Date().toISOString();

  // Register with registry
  const registry = getSkillRegistry();
  registry.register(proposal.skill);

  logger.info('Skill proposal approved', {
    skill: proposal.skill.name,
    tier: proposal.skill.tier,
  });

  return proposal.skill;
}

/**
 * Reject a proposal
 */
export function rejectProposal(proposal: SkillProposal, reason: string): void {
  proposal.status = 'rejected';
  proposal.rejectionReason = reason;
  proposal.processedAt = new Date().toISOString();

  // Mark pattern as rejected for cooldown
  markPatternRejected(proposal.pattern.intentHash, reason);

  logger.info('Skill proposal rejected', {
    skill: proposal.skill.name,
    reason,
  });
}
