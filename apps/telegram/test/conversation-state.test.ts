/**
 * Conversation State Manager — Unit Tests
 *
 * Validates unified state lifecycle, phase transitions,
 * content context preservation, and TTL behavior.
 *
 * Sprint: SESSION-STATE-FOUNDATION
 */

import { describe, it, expect, beforeEach } from 'bun:test';

import {
  getOrCreateState,
  getState,
  getStateByUserId,
  updateState,
  storeContentContext,
  getContentContext,
  storeTriage,
  storeAssessment,
  enterSocraticPhase,
  enterDialoguePhase,
  enterApprovalPhase,
  returnToIdle,
  hasActiveSession,
  isInPhase,
  clearState,
  pruneExpired,
  getStateCount,
  clearAllStates,
  type ConversationState,
  type ContentContext,
  type SocraticSessionState,
  type DialogueSessionState,
  type ApprovalState,
} from '@atlas/agents/src/conversation/conversation-state';

import type { RequestAssessment, AssessmentContext } from '../../../packages/agents/src/assessment/types';
import type { TriageResult } from '@atlas/agents/src/cognitive/triage-skill';

// ─── Fixtures ───────────────────────────────────────────

const CHAT_ID = 12345;
const USER_ID = 67890;

function mockAssessment(overrides?: Partial<RequestAssessment>): RequestAssessment {
  return {
    complexity: 'moderate',
    pillar: 'The Grove',
    domain: 'grove',
    audience: 'self',
    approach: {
      steps: [{ description: 'Step 1' }, { description: 'Step 2' }],
      timeEstimate: '~2 minutes',
      alternativeAngles: [],
    },
    capabilities: [],
    reasoning: 'Test assessment',
    signals: {
      multiStep: true,
      ambiguousGoal: false,
      contextDependent: false,
      timeSensitive: false,
      highStakes: false,
      novelPattern: false,
    },
    ...overrides,
  };
}

function mockAssessmentContext(): AssessmentContext {
  return {
    intent: 'research',
    pillar: 'The Grove',
    keywords: ['AI', 'research'],
    hasUrl: true,
  };
}

function mockTriageResult(): TriageResult {
  return {
    intent: 'capture',
    pillar: 'The Grove',
    confidence: 0.85,
    requestType: 'Research',
    keywords: ['AI', 'research'],
    source: 'haiku',
    title: 'AI Research Article',
    complexityTier: 'moderate',
  } as TriageResult;
}

function mockContentContext(): ContentContext {
  return {
    url: 'https://example.com/article',
    title: 'Test Article',
    preReadSummary: 'An article about AI research.',
    capturedAt: Date.now(),
  };
}

function mockSocraticState(): SocraticSessionState {
  return {
    sessionId: 'socratic-123',
    questionMessageId: 100,
    questions: [],
    currentQuestionIndex: 0,
    content: 'https://example.com/article',
    contentType: 'url',
    title: 'Test Article',
    signals: { hasUrl: true } as any,
  };
}

function mockDialogueState(): DialogueSessionState {
  return {
    questionMessageId: 200,
    dialogueState: {
      terrain: 'rough',
      turnCount: 1,
      threads: [],
      resolvedContext: {},
      openQuestions: ['What is the goal?'],
      currentQuestion: 'What is the goal?',
      resolved: false,
    },
    assessment: mockAssessment({ complexity: 'rough' }),
    assessmentContext: mockAssessmentContext(),
    originalMessage: 'Do something complex',
  };
}

function mockApprovalState(): ApprovalState {
  return {
    proposalMessageId: 300,
    proposal: {
      steps: [{ description: 'Step 1' }, { description: 'Step 2' }],
      timeEstimate: '~2 minutes',
      alternativeAngles: [],
      questionForJim: 'Sound right?',
    },
    originalMessage: 'Research AI trends',
    assessment: mockAssessment(),
    assessmentContext: mockAssessmentContext(),
  };
}

// ─── Tests ──────────────────────────────────────────────

describe('ConversationStateManager', () => {
  beforeEach(() => {
    clearAllStates();
  });

  // ── Lifecycle ──

  describe('getOrCreateState', () => {
    it('creates new state for unknown chat', () => {
      const state = getOrCreateState(CHAT_ID, USER_ID);
      expect(state.chatId).toBe(CHAT_ID);
      expect(state.userId).toBe(USER_ID);
      expect(state.phase).toBe('idle');
      expect(state.contentContext).toBeUndefined();
      expect(state.lastTriage).toBeUndefined();
      expect(state.lastAssessment).toBeUndefined();
    });

    it('returns existing state for known chat', () => {
      const first = getOrCreateState(CHAT_ID, USER_ID);
      first.contentContext = mockContentContext();
      const second = getOrCreateState(CHAT_ID, USER_ID);
      expect(second.contentContext).toBeDefined();
      expect(second.contentContext!.url).toBe('https://example.com/article');
    });
  });

  describe('getState', () => {
    it('returns undefined for unknown chat', () => {
      expect(getState(99999)).toBeUndefined();
    });

    it('returns state for known chat', () => {
      getOrCreateState(CHAT_ID, USER_ID);
      const state = getState(CHAT_ID);
      expect(state).toBeDefined();
      expect(state!.chatId).toBe(CHAT_ID);
    });
  });

  describe('getStateByUserId', () => {
    it('returns undefined for unknown user', () => {
      expect(getStateByUserId(99999)).toBeUndefined();
    });

    it('finds state by user ID', () => {
      getOrCreateState(CHAT_ID, USER_ID);
      const state = getStateByUserId(USER_ID);
      expect(state).toBeDefined();
      expect(state!.userId).toBe(USER_ID);
    });
  });

  describe('updateState', () => {
    it('merges partial updates', () => {
      getOrCreateState(CHAT_ID, USER_ID);
      const updated = updateState(CHAT_ID, { phase: 'approval' });
      expect(updated!.phase).toBe('approval');
    });

    it('returns undefined for unknown chat', () => {
      expect(updateState(99999, { phase: 'idle' })).toBeUndefined();
    });

    it('refreshes lastActivity on update', () => {
      const state = getOrCreateState(CHAT_ID, USER_ID);
      const before = state.lastActivity;
      // Small delay to ensure timestamp differs
      updateState(CHAT_ID, { phase: 'idle' });
      const after = getState(CHAT_ID)!.lastActivity;
      expect(after).toBeGreaterThanOrEqual(before);
    });
  });

  // ── Content Context (Bug #2) ──

  describe('content context preservation', () => {
    it('stores and retrieves content context', () => {
      const ctx = mockContentContext();
      storeContentContext(CHAT_ID, USER_ID, ctx);
      const retrieved = getContentContext(CHAT_ID);
      expect(retrieved).toBeDefined();
      expect(retrieved!.url).toBe('https://example.com/article');
      expect(retrieved!.title).toBe('Test Article');
      expect(retrieved!.preReadSummary).toBe('An article about AI research.');
    });

    it('content context survives phase transitions', () => {
      storeContentContext(CHAT_ID, USER_ID, mockContentContext());

      // Enter Socratic
      enterSocraticPhase(CHAT_ID, USER_ID, mockSocraticState());
      expect(getContentContext(CHAT_ID)!.url).toBe('https://example.com/article');

      // Enter dialogue
      enterDialoguePhase(CHAT_ID, USER_ID, mockDialogueState());
      expect(getContentContext(CHAT_ID)!.url).toBe('https://example.com/article');

      // Enter approval
      enterApprovalPhase(CHAT_ID, USER_ID, mockApprovalState());
      expect(getContentContext(CHAT_ID)!.url).toBe('https://example.com/article');

      // Return to idle
      returnToIdle(CHAT_ID);
      expect(getContentContext(CHAT_ID)!.url).toBe('https://example.com/article');
    });

    it('returns undefined for unknown chat', () => {
      expect(getContentContext(99999)).toBeUndefined();
    });
  });

  // ── Triage & Assessment Caching (Bug #1, #4, #5) ──

  describe('triage caching', () => {
    it('stores triage result', () => {
      getOrCreateState(CHAT_ID, USER_ID);
      storeTriage(CHAT_ID, mockTriageResult());
      const state = getState(CHAT_ID)!;
      expect(state.lastTriage).toBeDefined();
      expect(state.lastTriage!.pillar).toBe('The Grove');
    });

    it('triage survives phase transitions', () => {
      getOrCreateState(CHAT_ID, USER_ID);
      storeTriage(CHAT_ID, mockTriageResult());
      enterApprovalPhase(CHAT_ID, USER_ID, mockApprovalState());
      returnToIdle(CHAT_ID);
      const state = getState(CHAT_ID)!;
      expect(state.lastTriage).toBeDefined();
      expect(state.lastTriage!.pillar).toBe('The Grove');
    });
  });

  describe('assessment caching', () => {
    it('stores assessment and context', () => {
      getOrCreateState(CHAT_ID, USER_ID);
      storeAssessment(CHAT_ID, mockAssessment(), mockAssessmentContext());
      const state = getState(CHAT_ID)!;
      expect(state.lastAssessment).toBeDefined();
      expect(state.lastAssessment!.complexity).toBe('moderate');
      expect(state.lastAssessmentContext).toBeDefined();
      expect(state.lastAssessmentContext!.intent).toBe('research');
    });

    it('assessment survives approval phase (Bug #1)', () => {
      getOrCreateState(CHAT_ID, USER_ID);
      storeAssessment(CHAT_ID, mockAssessment(), mockAssessmentContext());
      enterApprovalPhase(CHAT_ID, USER_ID, mockApprovalState());

      // After approval, assessment should still be available
      const state = getState(CHAT_ID)!;
      expect(state.lastAssessment!.complexity).toBe('moderate');
    });
  });

  // ── Phase Transitions ──

  describe('phase transitions', () => {
    it('enters Socratic phase', () => {
      enterSocraticPhase(CHAT_ID, USER_ID, mockSocraticState());
      const state = getState(CHAT_ID)!;
      expect(state.phase).toBe('socratic');
      expect(state.socratic).toBeDefined();
      expect(state.socratic!.sessionId).toBe('socratic-123');
      expect(state.dialogue).toBeUndefined();
      expect(state.approval).toBeUndefined();
    });

    it('enters dialogue phase', () => {
      enterDialoguePhase(CHAT_ID, USER_ID, mockDialogueState());
      const state = getState(CHAT_ID)!;
      expect(state.phase).toBe('dialogue');
      expect(state.dialogue).toBeDefined();
      expect(state.socratic).toBeUndefined();
      expect(state.approval).toBeUndefined();
    });

    it('enters approval phase', () => {
      enterApprovalPhase(CHAT_ID, USER_ID, mockApprovalState());
      const state = getState(CHAT_ID)!;
      expect(state.phase).toBe('approval');
      expect(state.approval).toBeDefined();
      expect(state.socratic).toBeUndefined();
      expect(state.dialogue).toBeUndefined();
    });

    it('transitions clear previous phase state', () => {
      enterSocraticPhase(CHAT_ID, USER_ID, mockSocraticState());
      expect(getState(CHAT_ID)!.socratic).toBeDefined();

      enterDialoguePhase(CHAT_ID, USER_ID, mockDialogueState());
      expect(getState(CHAT_ID)!.socratic).toBeUndefined();
      expect(getState(CHAT_ID)!.dialogue).toBeDefined();

      enterApprovalPhase(CHAT_ID, USER_ID, mockApprovalState());
      expect(getState(CHAT_ID)!.dialogue).toBeUndefined();
      expect(getState(CHAT_ID)!.approval).toBeDefined();
    });

    it('returnToIdle clears phase state but preserves context', () => {
      storeContentContext(CHAT_ID, USER_ID, mockContentContext());
      enterApprovalPhase(CHAT_ID, USER_ID, mockApprovalState());
      getOrCreateState(CHAT_ID, USER_ID); // ensure assessment stored
      storeAssessment(CHAT_ID, mockAssessment(), mockAssessmentContext());

      returnToIdle(CHAT_ID);
      const state = getState(CHAT_ID)!;
      expect(state.phase).toBe('idle');
      expect(state.approval).toBeUndefined();
      expect(state.contentContext).toBeDefined(); // preserved
      expect(state.lastAssessment).toBeDefined(); // preserved
    });
  });

  // ── Queries ──

  describe('hasActiveSession', () => {
    it('returns false for unknown user', () => {
      expect(hasActiveSession(99999)).toBe(false);
    });

    it('returns false for idle user', () => {
      getOrCreateState(CHAT_ID, USER_ID);
      expect(hasActiveSession(USER_ID)).toBe(false);
    });

    it('returns true for active phase', () => {
      enterApprovalPhase(CHAT_ID, USER_ID, mockApprovalState());
      expect(hasActiveSession(USER_ID)).toBe(true);
    });
  });

  describe('isInPhase', () => {
    it('returns false for unknown user', () => {
      expect(isInPhase(99999, 'approval')).toBe(false);
    });

    it('returns true when in specified phase', () => {
      enterApprovalPhase(CHAT_ID, USER_ID, mockApprovalState());
      expect(isInPhase(USER_ID, 'approval')).toBe(true);
      expect(isInPhase(USER_ID, 'dialogue')).toBe(false);
    });
  });

  // ── Cleanup ──

  describe('clearState', () => {
    it('removes state for chat', () => {
      getOrCreateState(CHAT_ID, USER_ID);
      clearState(CHAT_ID);
      expect(getState(CHAT_ID)).toBeUndefined();
    });
  });

  describe('pruneExpired', () => {
    it('removes expired states', () => {
      const state = getOrCreateState(CHAT_ID, USER_ID);
      // Manually expire the state
      state.lastActivity = Date.now() - 16 * 60 * 1000; // 16 minutes ago
      const pruned = pruneExpired();
      expect(pruned).toBe(1);
      expect(getState(CHAT_ID)).toBeUndefined();
    });

    it('keeps non-expired states', () => {
      getOrCreateState(CHAT_ID, USER_ID);
      const pruned = pruneExpired();
      expect(pruned).toBe(0);
      expect(getState(CHAT_ID)).toBeDefined();
    });
  });

  describe('getStateCount', () => {
    it('returns 0 for empty store', () => {
      expect(getStateCount()).toBe(0);
    });

    it('counts active states', () => {
      getOrCreateState(CHAT_ID, USER_ID);
      getOrCreateState(CHAT_ID + 1, USER_ID + 1);
      expect(getStateCount()).toBe(2);
    });
  });

  // ── Bug Scenario Tests ──

  describe('Bug #1: Post-approval re-processing', () => {
    it('assessment is available after approval grant', () => {
      // Simulate: triage → assessment → approval gate → approval grant
      const state = getOrCreateState(CHAT_ID, USER_ID);
      storeTriage(CHAT_ID, mockTriageResult());
      storeAssessment(CHAT_ID, mockAssessment(), mockAssessmentContext());
      enterApprovalPhase(CHAT_ID, USER_ID, mockApprovalState());

      // Grant approval
      returnToIdle(CHAT_ID);

      // Assessment should still be available for pipeline skip
      const afterApproval = getState(CHAT_ID)!;
      expect(afterApproval.lastAssessment).toBeDefined();
      expect(afterApproval.lastAssessment!.complexity).toBe('moderate');
      expect(afterApproval.lastTriage).toBeDefined();
      expect(afterApproval.lastTriage!.pillar).toBe('The Grove');
    });
  });

  describe('Bug #2: URL context loss', () => {
    it('content context available during follow-up text reply', () => {
      // Simulate: URL share → Socratic question → Jim answers with text
      storeContentContext(CHAT_ID, USER_ID, {
        url: 'https://example.com/ai-article',
        title: 'AI Trends 2026',
        preReadSummary: 'An overview of AI trends for 2026.',
        capturedAt: Date.now(),
      });
      enterSocraticPhase(CHAT_ID, USER_ID, mockSocraticState());

      // Jim answers — state transitions to idle
      returnToIdle(CHAT_ID);

      // Content context should still be available for the triage prepend
      const ctx = getContentContext(CHAT_ID);
      expect(ctx).toBeDefined();
      expect(ctx!.url).toBe('https://example.com/ai-article');
      expect(ctx!.preReadSummary).toBe('An overview of AI trends for 2026.');
    });
  });

  describe('Bug #5: Pillar drift', () => {
    it('stored triage pillar not overwritten by re-triage', () => {
      // Simulate: URL triage → pillar = The Grove
      getOrCreateState(CHAT_ID, USER_ID);
      storeTriage(CHAT_ID, mockTriageResult()); // pillar = The Grove

      // On approval, we should use stored triage, not re-triage
      const state = getState(CHAT_ID)!;
      expect(state.lastTriage!.pillar).toBe('The Grove');
    });
  });
});
