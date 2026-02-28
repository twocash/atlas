/**
 * Emergence Module — Unit + Integration Tests
 *
 * Sprint 4: CONV-ARCH-004 (Skill Emergence)
 *
 * Tests:
 * 1. Session grouping (groupActionsBySession)
 * 2. Intent sequence extraction (extractIntentSequences)
 * 3. Sequence pattern detection (detectSequencePatterns)
 * 4. Proposal generation
 * 5. Monitor integration (checkForEmergence)
 * 6. Approval store
 * 7. Dismiss cooldown
 */

import { describe, it, expect, beforeEach, mock } from 'bun:test';

// Mock Notion client before imports
mock.module('@notionhq/client', () => ({
  Client: class {
    constructor() {}
    databases = {
      query: async () => ({ results: [] }),
    };
    pages = {
      create: async () => ({ id: 'mock-page' }),
      update: async () => ({}),
    };
  },
}));

// Mock pattern-detector (depends on Notion)
mock.module('../src/skills/pattern-detector', () => ({
  detectPatterns: async () => ({
    patterns: [],
    proposals: [],
    window: { start: '', end: '', days: 14 },
    stats: { actionsAnalyzed: 0, patternsFound: 0, proposalsGenerated: 0, skippedExisting: 0, skippedRejected: 0 },
  }),
}));

// Mock logger
mock.module('../src/logger', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}));

// Mock @atlas/shared (used by monitor.ts, feed-writer.ts, session-detector.ts)
mock.module('@atlas/shared/error-escalation', () => ({
  reportFailure: () => {},
}));

mock.module('@atlas/shared/config', () => ({
  NOTION_DB: { FEED: 'mock-feed-id' },
  ATLAS_NODE: 'test-node',
}));

import {
  groupActionsBySession,
  extractIntentSequences,
  extractAllSequences,
  detectSequencePatterns,
} from '../src/emergence/session-detector';

import {
  generateProposal,
  generateSkillName,
  formatProposalText,
} from '../src/emergence/proposal-generator';

import {
  checkForEmergence,
  dismissProposal,
  approveProposal,
  _resetForTesting,
  _setLastCheckTime,
} from '../src/emergence/monitor';

import {
  storeEmergenceProposal,
  hasPendingEmergenceProposal,
  getPendingEmergenceProposal,
  processEmergenceResponse,
  clearAllEmergenceProposals,
} from '../src/emergence/approval-store';

import { DEFAULT_EMERGENCE_CONFIG } from '../src/emergence/types';
import type { SessionAction, SessionGroup, EmergenceSignal, EmergenceProposal } from '../src/emergence/types';

// =============================================================================
// TEST FIXTURES
// =============================================================================

function makeSessionAction(overrides: Partial<SessionAction> = {}): SessionAction {
  return {
    id: `action-${Math.random().toString(36).slice(2, 8)}`,
    intentHash: 'abc12345',
    actionType: 'query',
    pillar: 'The Grove',
    toolsUsed: ['notion_query'],
    messageText: 'check the work queue',
    timestamp: new Date().toISOString(),
    sessionId: 'session-1',
    turnNumber: 1,
    ...overrides,
  };
}

function makeSessionGroup(sessionId: string, actions: SessionAction[]): SessionGroup {
  const timestamps = actions.map(a => new Date(a.timestamp).getTime());
  return {
    sessionId,
    actions,
    startTime: new Date(Math.min(...timestamps)).toISOString(),
    endTime: new Date(Math.max(...timestamps)).toISOString(),
    turnCount: actions.length,
    uniqueIntents: new Set(actions.map(a => a.intentHash)).size,
  };
}

function makeSignal(overrides: Partial<EmergenceSignal> = {}): EmergenceSignal {
  return {
    id: 'sig-test-1',
    source: 'sequence',
    frequency: 6,
    lastOccurrence: new Date().toISOString(),
    avgTurns: 3,
    completionRate: 0.9,
    suggestedSkillName: 'query-to-draft-workflow',
    description: 'Sequence pattern: query→draft',
    ...overrides,
  };
}

function makeProposal(overrides: Partial<EmergenceProposal> = {}): EmergenceProposal {
  return {
    id: 'ep-test-1',
    signal: makeSignal(),
    proposalText: 'I noticed you do query→draft a lot. Want me to make a skill?',
    suggestedSkillName: 'query-to-draft-workflow',
    status: 'pending',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

// =============================================================================
// 1. Session Grouping
// =============================================================================

describe('groupActionsBySession', () => {
  it('groups actions by sessionId', () => {
    const actions = [
      makeSessionAction({ sessionId: 'sess-A', turnNumber: 1 }),
      makeSessionAction({ sessionId: 'sess-B', turnNumber: 1 }),
      makeSessionAction({ sessionId: 'sess-A', turnNumber: 2 }),
    ];

    const groups = groupActionsBySession(actions);

    expect(groups.length).toBe(2);
    const sessA = groups.find(g => g.sessionId === 'sess-A');
    const sessB = groups.find(g => g.sessionId === 'sess-B');
    expect(sessA!.actions.length).toBe(2);
    expect(sessB!.actions.length).toBe(1);
  });

  it('sorts actions within session by turnNumber', () => {
    const actions = [
      makeSessionAction({ sessionId: 'sess-A', turnNumber: 3 }),
      makeSessionAction({ sessionId: 'sess-A', turnNumber: 1 }),
      makeSessionAction({ sessionId: 'sess-A', turnNumber: 2 }),
    ];

    const groups = groupActionsBySession(actions);
    const turns = groups[0].actions.map(a => a.turnNumber);
    expect(turns).toEqual([1, 2, 3]);
  });

  it('calculates turnCount and uniqueIntents', () => {
    const actions = [
      makeSessionAction({ sessionId: 'sess-A', turnNumber: 1, intentHash: 'aaa' }),
      makeSessionAction({ sessionId: 'sess-A', turnNumber: 2, intentHash: 'bbb' }),
      makeSessionAction({ sessionId: 'sess-A', turnNumber: 3, intentHash: 'aaa' }),
    ];

    const groups = groupActionsBySession(actions);
    expect(groups[0].turnCount).toBe(3);
    expect(groups[0].uniqueIntents).toBe(2);
  });

  it('returns empty array for empty input', () => {
    expect(groupActionsBySession([])).toEqual([]);
  });
});

// =============================================================================
// 2. Intent Sequence Extraction
// =============================================================================

describe('extractIntentSequences', () => {
  it('extracts transitions between different intents', () => {
    const actions = [
      makeSessionAction({ turnNumber: 1, intentHash: 'query-hash-xxxx', actionType: 'query' }),
      makeSessionAction({ turnNumber: 2, intentHash: 'draft-hash-xxxx', actionType: 'create' }),
      makeSessionAction({ turnNumber: 3, intentHash: 'dispatch-hash-x', actionType: 'dispatch' }),
    ];

    const group = makeSessionGroup('sess-A', actions);
    const sequence = extractIntentSequences(group);

    expect(sequence).not.toBeNull();
    expect(sequence!.transitions.length).toBe(2);
    expect(sequence!.transitions[0].fromAction).toBe('query');
    expect(sequence!.transitions[0].toAction).toBe('create');
    expect(sequence!.transitions[1].fromAction).toBe('create');
    expect(sequence!.transitions[1].toAction).toBe('dispatch');
  });

  it('returns null for single-action sessions', () => {
    const actions = [makeSessionAction({ turnNumber: 1 })];
    const group = makeSessionGroup('sess-A', actions);
    expect(extractIntentSequences(group)).toBeNull();
  });

  it('returns null when all intents are the same', () => {
    const actions = [
      makeSessionAction({ turnNumber: 1, intentHash: 'same-hash' }),
      makeSessionAction({ turnNumber: 2, intentHash: 'same-hash' }),
      makeSessionAction({ turnNumber: 3, intentHash: 'same-hash' }),
    ];

    const group = makeSessionGroup('sess-A', actions);
    expect(extractIntentSequences(group)).toBeNull();
  });

  it('produces a stable hash for the same transition sequence', () => {
    const actions1 = [
      makeSessionAction({ turnNumber: 1, intentHash: 'aaa-unique-1', actionType: 'query' }),
      makeSessionAction({ turnNumber: 2, intentHash: 'bbb-unique-1', actionType: 'create' }),
    ];
    const actions2 = [
      makeSessionAction({ turnNumber: 1, intentHash: 'aaa-unique-1', actionType: 'query' }),
      makeSessionAction({ turnNumber: 2, intentHash: 'bbb-unique-1', actionType: 'create' }),
    ];

    const seq1 = extractIntentSequences(makeSessionGroup('s1', actions1));
    const seq2 = extractIntentSequences(makeSessionGroup('s2', actions2));

    expect(seq1!.hash).toBe(seq2!.hash);
  });
});

// =============================================================================
// 3. Sequence Pattern Detection
// =============================================================================

describe('detectSequencePatterns', () => {
  it('detects patterns meeting frequency threshold', () => {
    // Create 6 sessions with the same 2-transition pattern (meets minSequenceLength=2)
    const groups: SessionGroup[] = [];
    for (let i = 0; i < 6; i++) {
      const actions = [
        makeSessionAction({
          sessionId: `sess-${i}`,
          turnNumber: 1,
          intentHash: 'query-pattern-A1',
          actionType: 'query',
          timestamp: new Date(Date.now() - i * 86400000).toISOString(),
        }),
        makeSessionAction({
          sessionId: `sess-${i}`,
          turnNumber: 2,
          intentHash: 'create-pattern-B1',
          actionType: 'create',
          timestamp: new Date(Date.now() - i * 86400000 + 60000).toISOString(),
        }),
        makeSessionAction({
          sessionId: `sess-${i}`,
          turnNumber: 3,
          intentHash: 'dispatch-pat-C1x',
          actionType: 'dispatch',
          timestamp: new Date(Date.now() - i * 86400000 + 120000).toISOString(),
        }),
      ];
      groups.push(makeSessionGroup(`sess-${i}`, actions));
    }

    const patterns = detectSequencePatterns(groups, { minFrequency: 5 });
    expect(patterns.length).toBeGreaterThanOrEqual(1);
    expect(patterns[0].frequency).toBeGreaterThanOrEqual(5);
  });

  it('filters out patterns below frequency threshold', () => {
    const groups = [
      makeSessionGroup('s1', [
        makeSessionAction({ sessionId: 's1', turnNumber: 1, intentHash: 'rare-A', actionType: 'query' }),
        makeSessionAction({ sessionId: 's1', turnNumber: 2, intentHash: 'rare-B', actionType: 'create' }),
      ]),
      makeSessionGroup('s2', [
        makeSessionAction({ sessionId: 's2', turnNumber: 1, intentHash: 'rare-A', actionType: 'query' }),
        makeSessionAction({ sessionId: 's2', turnNumber: 2, intentHash: 'rare-B', actionType: 'create' }),
      ]),
    ];

    const patterns = detectSequencePatterns(groups, { minFrequency: 5 });
    expect(patterns.length).toBe(0);
  });

  it('returns empty for no groups', () => {
    expect(detectSequencePatterns([])).toEqual([]);
  });
});

// =============================================================================
// 4. Proposal Generation
// =============================================================================

describe('proposal generation', () => {
  it('generates a proposal from a signal', () => {
    const signal = makeSignal();
    const proposal = generateProposal(signal);

    expect(proposal.id).toStartWith('ep-');
    expect(proposal.status).toBe('pending');
    expect(proposal.suggestedSkillName).toBe(signal.suggestedSkillName);
    expect(proposal.proposalText.length).toBeGreaterThan(0);
  });

  it('generates readable skill names for frequency signals', () => {
    const signal = makeSignal({
      source: 'frequency',
      frequencyPattern: {
        intentHash: 'abc123',
        canonicalText: 'check the active work queue items for this week',
        actions: [],
        pillar: 'The Grove',
        actionType: 'query',
        toolsUsed: ['notion_query'],
        frequency: 7,
        firstSeen: new Date().toISOString(),
        lastSeen: new Date().toISOString(),
        avgExecutionTimeMs: 500,
        proposedTier: 0,
      },
    });

    const name = generateSkillName(signal);
    expect(name.length).toBeGreaterThan(0);
    expect(name).toContain('query');
  });

  it('formats proposal as plain text (no HTML)', () => {
    const proposal = makeProposal();
    const formatted = formatProposalText(proposal);

    expect(formatted).toContain('Pattern Detected');
    expect(formatted).toContain(proposal.suggestedSkillName);
    // Verify no Telegram HTML tags leak into cognitive layer output
    expect(formatted).not.toContain('<b>');
    expect(formatted).not.toContain('</b>');
    expect(formatted).not.toContain('<i>');
    expect(formatted).not.toContain('</i>');
  });
});

// =============================================================================
// 5. Monitor Integration
// =============================================================================

describe('EmergenceMonitor', () => {
  beforeEach(() => {
    _resetForTesting();
  });

  it('returns empty when feature flag is off', async () => {
    const orig = process.env.ATLAS_EMERGENCE_AWARENESS;
    delete process.env.ATLAS_EMERGENCE_AWARENESS;

    try {
      const result = await checkForEmergence();
      expect(result.signals.length).toBe(0);
      expect(result.proposals.length).toBe(0);
    } finally {
      if (orig) process.env.ATLAS_EMERGENCE_AWARENESS = orig;
    }
  });

  it('runs when feature flag is on', async () => {
    const orig = process.env.ATLAS_EMERGENCE_AWARENESS;
    process.env.ATLAS_EMERGENCE_AWARENESS = 'true';

    try {
      const result = await checkForEmergence();
      // Should complete without error (no data = no signals)
      expect(result.stats.proposalsGenerated).toBe(0);
    } finally {
      if (orig === undefined) delete process.env.ATLAS_EMERGENCE_AWARENESS;
      else process.env.ATLAS_EMERGENCE_AWARENESS = orig;
    }
  });

  it('respects debounce interval', async () => {
    const orig = process.env.ATLAS_EMERGENCE_AWARENESS;
    process.env.ATLAS_EMERGENCE_AWARENESS = 'true';

    try {
      // First check runs
      const result1 = await checkForEmergence();
      expect(result1).toBeDefined();

      // Immediate second check is debounced
      const result2 = await checkForEmergence();
      expect(result2.signals.length).toBe(0);
    } finally {
      if (orig === undefined) delete process.env.ATLAS_EMERGENCE_AWARENESS;
      else process.env.ATLAS_EMERGENCE_AWARENESS = orig;
    }
  });
});

// =============================================================================
// 6. Approval Store
// =============================================================================

describe('Emergence Approval Store', () => {
  beforeEach(() => {
    clearAllEmergenceProposals();
    _resetForTesting();
  });

  it('stores and retrieves proposals', () => {
    const proposal = makeProposal();
    storeEmergenceProposal(123, 456, proposal);

    expect(hasPendingEmergenceProposal(123)).toBe(true);
    expect(getPendingEmergenceProposal(123)?.id).toBe(proposal.id);
  });

  it('returns undefined for unknown chat', () => {
    expect(hasPendingEmergenceProposal(999)).toBe(false);
    expect(getPendingEmergenceProposal(999)).toBeUndefined();
  });

  it('processes approval signal', () => {
    const proposal = makeProposal();
    storeEmergenceProposal(123, 456, proposal);

    const result = processEmergenceResponse(123, 'yes');

    expect(result).not.toBeNull();
    expect(result!.action).toBe('approved');
    expect(result!.proposal.status).toBe('approved');
    expect(hasPendingEmergenceProposal(123)).toBe(false);
  });

  it('processes rejection signal', () => {
    const proposal = makeProposal();
    storeEmergenceProposal(123, 456, proposal);

    const result = processEmergenceResponse(123, 'no');

    expect(result).not.toBeNull();
    expect(result!.action).toBe('dismissed');
    expect(result!.proposal.status).toBe('dismissed');
  });

  it('returns null for unrecognized signal', () => {
    const proposal = makeProposal();
    storeEmergenceProposal(123, 456, proposal);

    const result = processEmergenceResponse(123, 'maybe later');
    expect(result).toBeNull();
    // Proposal still pending
    expect(hasPendingEmergenceProposal(123)).toBe(true);
  });
});

// =============================================================================
// 7. Config Defaults
// =============================================================================

describe('EmergenceConfig', () => {
  it('has sensible defaults', () => {
    expect(DEFAULT_EMERGENCE_CONFIG.minFrequency).toBe(5);
    expect(DEFAULT_EMERGENCE_CONFIG.windowDays).toBe(14);
    expect(DEFAULT_EMERGENCE_CONFIG.minCompletionRate).toBe(0.8);
    expect(DEFAULT_EMERGENCE_CONFIG.minSequenceLength).toBe(2);
    expect(DEFAULT_EMERGENCE_CONFIG.maxProposalsPerDay).toBe(3);
    expect(DEFAULT_EMERGENCE_CONFIG.dismissCooldownDays).toBe(7);
  });
});
