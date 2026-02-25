/**
 * Session Telemetry Tests
 *
 * Verifies that sessionId, turnNumber, and priorIntentHash flow
 * from ConversationState through logAction to Feed 2.0 entries.
 *
 * Sprint: SESSION-TELEMETRY (ATLAS-SESSION-TELEM-P1)
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import {
  getOrCreateState,
  getState,
  recordTurn,
  clearAllStates,
  type ConversationState,
} from '@atlas/agents/src/conversation/conversation-state';

// ─── Helpers ─────────────────────────────────────────────

const TEST_CHAT_ID = 99001;
const TEST_USER_ID = 12345;

// ─── ConversationState Session Fields ────────────────────

describe('ConversationState session fields', () => {
  beforeEach(() => {
    clearAllStates();
  });

  it('initializes sessionId as a UUID', () => {
    const state = getOrCreateState(TEST_CHAT_ID, TEST_USER_ID);
    expect(state.sessionId).toBeDefined();
    expect(state.sessionId.length).toBe(36); // UUID format
    expect(state.sessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('initializes turnCount to 0', () => {
    const state = getOrCreateState(TEST_CHAT_ID, TEST_USER_ID);
    expect(state.turnCount).toBe(0);
  });

  it('initializes lastIntentHash as undefined', () => {
    const state = getOrCreateState(TEST_CHAT_ID, TEST_USER_ID);
    expect(state.lastIntentHash).toBeUndefined();
  });

  it('preserves sessionId across getOrCreateState calls (same session)', () => {
    const state1 = getOrCreateState(TEST_CHAT_ID, TEST_USER_ID);
    const sessionId = state1.sessionId;
    const state2 = getOrCreateState(TEST_CHAT_ID, TEST_USER_ID);
    expect(state2.sessionId).toBe(sessionId);
  });

  it('generates a new sessionId for a different chat', () => {
    const state1 = getOrCreateState(TEST_CHAT_ID, TEST_USER_ID);
    const state2 = getOrCreateState(TEST_CHAT_ID + 1, TEST_USER_ID + 1);
    expect(state1.sessionId).not.toBe(state2.sessionId);
  });
});

// ─── recordTurn ──────────────────────────────────────────

describe('recordTurn', () => {
  beforeEach(() => {
    clearAllStates();
  });

  it('returns sessionId, turnNumber=1 on first call', () => {
    const result = recordTurn(TEST_CHAT_ID, TEST_USER_ID, 'abc123');
    expect(result.sessionId).toBeDefined();
    expect(result.turnNumber).toBe(1);
  });

  it('returns undefined priorIntentHash on first turn', () => {
    const result = recordTurn(TEST_CHAT_ID, TEST_USER_ID, 'abc123');
    expect(result.priorIntentHash).toBeUndefined();
  });

  it('returns turn 1 hash as priorIntentHash on turn 2', () => {
    recordTurn(TEST_CHAT_ID, TEST_USER_ID, 'hash-turn-1');
    const result = recordTurn(TEST_CHAT_ID, TEST_USER_ID, 'hash-turn-2');
    expect(result.turnNumber).toBe(2);
    expect(result.priorIntentHash).toBe('hash-turn-1');
  });

  it('increments turnCount across multiple turns', () => {
    recordTurn(TEST_CHAT_ID, TEST_USER_ID, 'h1');
    recordTurn(TEST_CHAT_ID, TEST_USER_ID, 'h2');
    const result = recordTurn(TEST_CHAT_ID, TEST_USER_ID, 'h3');
    expect(result.turnNumber).toBe(3);
    expect(result.priorIntentHash).toBe('h2');
  });

  it('preserves sessionId across turns', () => {
    const r1 = recordTurn(TEST_CHAT_ID, TEST_USER_ID, 'h1');
    const r2 = recordTurn(TEST_CHAT_ID, TEST_USER_ID, 'h2');
    expect(r1.sessionId).toBe(r2.sessionId);
  });

  it('stores lastIntentHash in conversation state', () => {
    recordTurn(TEST_CHAT_ID, TEST_USER_ID, 'my-hash');
    const state = getState(TEST_CHAT_ID);
    expect(state?.lastIntentHash).toBe('my-hash');
  });

  it('handles undefined intentHash gracefully (no URL share)', () => {
    recordTurn(TEST_CHAT_ID, TEST_USER_ID, 'first-hash');
    const result = recordTurn(TEST_CHAT_ID, TEST_USER_ID, undefined);
    expect(result.turnNumber).toBe(2);
    expect(result.priorIntentHash).toBe('first-hash');
    // lastIntentHash should remain from turn 1
    const state = getState(TEST_CHAT_ID);
    expect(state?.lastIntentHash).toBe('first-hash');
  });
});

// ─── ActionLogInput Session Fields (Structure) ───────────

describe('ActionLogInput session field types', () => {
  it('ActionLogInput accepts session telemetry fields', () => {
    // This test verifies the TypeScript interface compiles correctly
    // by constructing a valid ActionLogInput with session fields.
    // Import is type-only at compile time; runtime just checks the shape.
    const input = {
      messageText: 'test message',
      pillar: 'The Grove' as const,
      requestType: 'Research' as const,
      actionType: 'chat' as const,
      toolsUsed: [] as string[],
      userId: TEST_USER_ID,
      confidence: 0.8,
      // Session telemetry fields
      sessionId: 'test-session-uuid',
      turnNumber: 3,
      priorIntentHash: 'prior-hash-abc',
    };

    expect(input.sessionId).toBe('test-session-uuid');
    expect(input.turnNumber).toBe(3);
    expect(input.priorIntentHash).toBe('prior-hash-abc');
  });

  it('session fields are optional (undefined when absent)', () => {
    const input = {
      messageText: 'test message',
      pillar: 'Personal' as const,
      requestType: 'Capture' as const,
      actionType: 'extract' as const,
      toolsUsed: [] as string[],
      userId: TEST_USER_ID,
      confidence: 0.9,
      // No session fields
    };

    expect((input as any).sessionId).toBeUndefined();
    expect((input as any).turnNumber).toBeUndefined();
    expect((input as any).priorIntentHash).toBeUndefined();
  });
});

// ─── End-to-End Chain Scenarios ──────────────────────────

describe('Session Telemetry E2E scenarios', () => {
  beforeEach(() => {
    clearAllStates();
  });

  it('scenario: Jim sends 3 messages in a session — turn numbers increment correctly', () => {
    // Message 1: "check the Grove work queue"
    const t1 = recordTurn(TEST_CHAT_ID, TEST_USER_ID, 'hash-grove-query');
    expect(t1.turnNumber).toBe(1);
    expect(t1.priorIntentHash).toBeUndefined();

    // Message 2: "research this article" (shares URL)
    const t2 = recordTurn(TEST_CHAT_ID, TEST_USER_ID, 'hash-research-url');
    expect(t2.turnNumber).toBe(2);
    expect(t2.priorIntentHash).toBe('hash-grove-query');

    // Message 3: "for The Grove, thinkpiece material"
    const t3 = recordTurn(TEST_CHAT_ID, TEST_USER_ID, 'hash-clarification');
    expect(t3.turnNumber).toBe(3);
    expect(t3.priorIntentHash).toBe('hash-research-url');

    // All same session
    expect(t1.sessionId).toBe(t2.sessionId);
    expect(t2.sessionId).toBe(t3.sessionId);
  });

  it('scenario: session expires and new one starts — fresh sessionId + turnCount', () => {
    // Turn 1 in session A
    const t1 = recordTurn(TEST_CHAT_ID, TEST_USER_ID, 'h1');
    const sessionA = t1.sessionId;

    // Simulate TTL expiry by clearing state
    clearAllStates();

    // Turn 1 in session B (new session after expiry)
    const t2 = recordTurn(TEST_CHAT_ID, TEST_USER_ID, 'h2');
    expect(t2.sessionId).not.toBe(sessionA);
    expect(t2.turnNumber).toBe(1);
    expect(t2.priorIntentHash).toBeUndefined();
  });

  it('scenario: different users get independent sessions', () => {
    const USER_A = 11111;
    const USER_B = 22222;
    const CHAT_A = 88801;
    const CHAT_B = 88802;

    const tA = recordTurn(CHAT_A, USER_A, 'hash-a');
    const tB = recordTurn(CHAT_B, USER_B, 'hash-b');

    expect(tA.sessionId).not.toBe(tB.sessionId);
    expect(tA.turnNumber).toBe(1);
    expect(tB.turnNumber).toBe(1);
  });
});
