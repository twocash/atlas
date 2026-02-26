/**
 * Emergence — Session-Aware Sequence Detection (Steps 2–4)
 *
 * Extends pattern-detector with session-grouped sequence analysis.
 * Queries Feed 2.0 for entries with Session ID populated, groups them
 * into sessions, extracts intent transition chains, and identifies
 * repeated workflow patterns crossing the emergence threshold.
 *
 * Sprint 4: CONV-ARCH-004 (Skill Emergence)
 */

import { Client } from '@notionhq/client';
import { NOTION_DB } from '@atlas/shared/config';
import { logger } from '../logger';
import { hasSameIntent } from '../skills/intent-hash';
import type { LoggedAction } from '../skills/pattern-detector';
import type { Pillar } from '../conversation/types';
import { createHash } from 'crypto';
import type {
  SessionAction,
  SessionGroup,
  IntentTransition,
  IntentSequence,
  SequencePattern,
  EmergenceConfig,
} from './types';

// Re-import the default config value (type-only import above doesn't get the value)
import { DEFAULT_EMERGENCE_CONFIG as defaultConfig } from './types';

// =============================================================================
// FEED 2.0 QUERY — Session-Enriched Actions
// =============================================================================

/**
 * Query Feed 2.0 for entries with Session ID populated.
 * Returns LoggedAction entries enriched with session telemetry fields.
 */
export async function querySessionActions(
  windowDays: number
): Promise<SessionAction[]> {
  try {
    const notion = new Client({ auth: process.env.NOTION_API_KEY });

    const windowStart = new Date();
    windowStart.setDate(windowStart.getDate() - windowDays);

    const response = await notion.databases.query({
      database_id: NOTION_DB.FEED,
      filter: {
        and: [
          {
            timestamp: 'created_time',
            created_time: {
              after: windowStart.toISOString(),
            },
          },
          {
            property: 'Session ID',
            rich_text: {
              is_not_empty: true,
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
          direction: 'ascending',
        },
      ],
      page_size: 100,
    });

    const actions: SessionAction[] = [];

    for (const page of response.results) {
      if (!('properties' in page)) continue;

      const props = page.properties as Record<string, any>;

      const sessionId = props['Session ID']?.rich_text?.[0]?.plain_text || '';
      const intentHash = props['Intent Hash']?.rich_text?.[0]?.plain_text || '';
      const turnNumber = props['Turn Number']?.number ?? 0;
      const priorIntentHash = props['Prior Intent Hash']?.rich_text?.[0]?.plain_text;
      const actionType = props['Action Type']?.select?.name || 'Process';
      const pillar = (props['Pillar']?.select?.name || 'Personal') as Pillar;
      const toolsUsedStr = props['Tools Used']?.rich_text?.[0]?.plain_text || '';
      const messageText = props['Entry']?.title?.[0]?.plain_text || '';
      const confirmed = props['Classification Confirmed']?.checkbox || false;
      const adjusted = props['Classification Adjusted']?.checkbox || false;
      const originalSuggestion = props['Original Suggestion']?.rich_text?.[0]?.plain_text;
      const executionTime = props['Execution Time']?.number;

      if (sessionId && intentHash) {
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
          sessionId,
          turnNumber,
          priorIntentHash,
        });
      }
    }

    logger.debug('Queried Feed 2.0 for session actions', {
      count: actions.length,
      windowDays,
    });
    return actions;
  } catch (error) {
    logger.error('Failed to query Feed 2.0 for session actions', { error });
    return [];
  }
}

// =============================================================================
// STEP 2: Group Actions By Session
// =============================================================================

/**
 * Group Feed 2.0 actions by sessionId, ordered by turnNumber within each group.
 * Computes session metadata: start/end time, turn count, unique intents.
 */
export function groupActionsBySession(actions: SessionAction[]): SessionGroup[] {
  const sessionMap = new Map<string, SessionAction[]>();

  for (const action of actions) {
    const group = sessionMap.get(action.sessionId) || [];
    group.push(action);
    sessionMap.set(action.sessionId, group);
  }

  const groups: SessionGroup[] = [];

  for (const [sessionId, sessionActions] of sessionMap) {
    // Sort by turn number (ascending)
    sessionActions.sort((a, b) => a.turnNumber - b.turnNumber);

    // Calculate timestamps
    const timestamps = sessionActions.map(a => new Date(a.timestamp).getTime());
    const startTime = new Date(Math.min(...timestamps)).toISOString();
    const endTime = new Date(Math.max(...timestamps)).toISOString();

    // Count unique intents (by intent hash similarity)
    const uniqueHashes = new Set<string>();
    for (const action of sessionActions) {
      // Check if this hash is similar to any existing unique hash
      let foundSimilar = false;
      for (const existing of uniqueHashes) {
        if (hasSameIntent(action.intentHash, existing)) {
          foundSimilar = true;
          break;
        }
      }
      if (!foundSimilar) {
        uniqueHashes.add(action.intentHash);
      }
    }

    groups.push({
      sessionId,
      actions: sessionActions,
      startTime,
      endTime,
      turnCount: sessionActions.length,
      uniqueIntents: uniqueHashes.size,
    });
  }

  // Sort by start time (newest first)
  groups.sort((a, b) =>
    new Date(b.startTime).getTime() - new Date(a.startTime).getTime()
  );

  return groups;
}

// =============================================================================
// STEP 3: Extract Intent Sequences
// =============================================================================

/**
 * Build IntentSequence chains from a session group.
 * Uses priorIntentHash to establish ordering, falls back to turn order.
 * Returns the sequence of intent transitions within that session.
 */
export function extractIntentSequences(group: SessionGroup): IntentSequence | null {
  const { actions } = group;

  if (actions.length < 2) return null;

  const transitions: IntentTransition[] = [];

  for (let i = 0; i < actions.length - 1; i++) {
    const current = actions[i];
    const next = actions[i + 1];

    // Skip if same intent (no transition)
    if (hasSameIntent(current.intentHash, next.intentHash)) continue;

    transitions.push({
      fromIntent: current.intentHash,
      toIntent: next.intentHash,
      fromAction: current.actionType,
      toAction: next.actionType,
    });
  }

  if (transitions.length === 0) return null;

  // Hash the transition sequence for grouping
  const transitionString = transitions
    .map(t => `${t.fromIntent}->${t.toIntent}`)
    .join('|');

  const hash = createHash('md5').update(transitionString).digest('hex').substring(0, 12);

  return {
    transitions,
    length: transitions.length,
    hash,
  };
}

/**
 * Extract sequences from multiple session groups.
 */
export function extractAllSequences(
  groups: SessionGroup[]
): Map<string, { sequence: IntentSequence; sessions: SessionGroup[] }> {
  const sequenceMap = new Map<string, { sequence: IntentSequence; sessions: SessionGroup[] }>();

  for (const group of groups) {
    const sequence = extractIntentSequences(group);
    if (!sequence) continue;

    // Check if this sequence hash matches an existing one
    const existing = sequenceMap.get(sequence.hash);
    if (existing) {
      existing.sessions.push(group);
    } else {
      sequenceMap.set(sequence.hash, { sequence, sessions: [group] });
    }
  }

  return sequenceMap;
}

// =============================================================================
// STEP 4: Detect Sequence Patterns
// =============================================================================

/**
 * Identify repeated workflow transitions that cross the emergence threshold.
 * Groups identical intent sequences across sessions and checks:
 * - Frequency >= config.minFrequency
 * - Sequence length >= config.minSequenceLength
 * - Completion rate >= config.minCompletionRate
 */
export function detectSequencePatterns(
  groups: SessionGroup[],
  config: Partial<EmergenceConfig> = {}
): SequencePattern[] {
  const mergedConfig = { ...defaultConfig, ...config };

  // Extract all sequences
  const sequenceMap = extractAllSequences(groups);

  const patterns: SequencePattern[] = [];

  for (const [hash, { sequence, sessions }] of sequenceMap) {
    // Check frequency threshold
    if (sessions.length < mergedConfig.minFrequency) continue;

    // Check sequence length
    if (sequence.length < mergedConfig.minSequenceLength) continue;

    // Calculate completion rate: sessions where all transitions happened
    // vs sessions that started the same sequence but didn't finish
    const completionRate = calculateCompletionRate(sequence, sessions, groups);
    if (completionRate < mergedConfig.minCompletionRate) continue;

    // Calculate average turns per session
    const avgTurns = sessions.reduce((sum, s) => sum + s.turnCount, 0) / sessions.length;

    // Find most common pillar
    const pillarCounts = new Map<Pillar, number>();
    for (const session of sessions) {
      for (const action of session.actions) {
        pillarCounts.set(action.pillar, (pillarCounts.get(action.pillar) || 0) + 1);
      }
    }
    const sortedPillars = [...pillarCounts.entries()].sort((a, b) => b[1] - a[1]);
    const commonPillar = sortedPillars[0]?.[0];

    // Collect all tools used across sessions
    const toolSet = new Set<string>();
    for (const session of sessions) {
      for (const action of session.actions) {
        for (const tool of action.toolsUsed) {
          toolSet.add(tool);
        }
      }
    }

    // Find first and last seen
    const allTimes = sessions.map(s => new Date(s.startTime).getTime());
    const firstSeen = new Date(Math.min(...allTimes)).toISOString();
    const lastSeen = new Date(Math.max(...allTimes)).toISOString();

    patterns.push({
      sequence,
      occurrences: sessions,
      frequency: sessions.length,
      avgTurns,
      commonPillar,
      commonTools: Array.from(toolSet),
      firstSeen,
      lastSeen,
      completionRate,
    });
  }

  // Sort by frequency descending
  patterns.sort((a, b) => b.frequency - a.frequency);

  logger.info('Sequence pattern detection complete', {
    groupsAnalyzed: groups.length,
    patternsFound: patterns.length,
  });

  return patterns;
}

/**
 * Calculate the completion rate for a sequence across sessions.
 * Looks at all sessions where the FIRST transition matches,
 * then checks how many completed all transitions.
 */
function calculateCompletionRate(
  sequence: IntentSequence,
  completeSessions: SessionGroup[],
  allGroups: SessionGroup[]
): number {
  if (sequence.transitions.length === 0) return 0;

  const firstTransition = sequence.transitions[0];

  // Count sessions that started with the same first transition
  let startedCount = 0;

  for (const group of allGroups) {
    const groupSequence = extractIntentSequences(group);
    if (!groupSequence || groupSequence.transitions.length === 0) continue;

    const firstGroupTransition = groupSequence.transitions[0];
    if (
      hasSameIntent(firstGroupTransition.fromIntent, firstTransition.fromIntent) &&
      hasSameIntent(firstGroupTransition.toIntent, firstTransition.toIntent)
    ) {
      startedCount++;
    }
  }

  if (startedCount === 0) return 0;

  return completeSessions.length / startedCount;
}
