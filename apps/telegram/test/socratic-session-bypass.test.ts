/**
 * Socratic Session Bypass — Regression Tests
 *
 * Verifies that pending Socratic sessions only intercept actual answers,
 * not unrelated messages like new URL shares or content from other flows.
 *
 * Bug: Prior to this fix, ANY text message from a user with a pending
 * Socratic session was routed to handleSocraticAnswer(), even if the
 * message was a completely unrelated URL share or new spark.
 *
 * Fix: Socratic interception now:
 *   1. Runs outside the CONTENT_CONFIRM_ENABLED gate
 *   2. Bypasses when message contains a URL (new content share)
 *   3. Cancels stale sessions when new content is detected
 *
 * STATE-PERSIST-TEARDOWN: Migrated from legacy socratic-session.ts to
 * unified ConversationState (conversation-state.ts).
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import {
  enterSocraticPhase,
  getState,
  getStateByUserId,
  hasActiveSession,
  isInPhase,
  returnToIdle,
  clearAllStates,
  type SocraticSessionState,
} from '@atlas/agents/src/conversation/conversation-state';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const CHAT_ID = 12345;
const USER_ID = 67890;

function createTestSocratic(overrides: Partial<SocraticSessionState> = {}): SocraticSessionState {
  return {
    sessionId: 'test-session-001',
    questionMessageId: 999,
    questions: [{ text: "What's the play?", key: 'intent', options: [] }],
    currentQuestionIndex: 0,
    content: 'https://example.com/article',
    contentType: 'url',
    title: 'Test Article',
    signals: { contentSignals: { topic: 'Test', title: 'Test', hasUrl: true, contentLength: 30 } },
    ...overrides,
  };
}

/**
 * URL bypass detection — mirrors the regex in handler.ts
 */
function messageContainsUrl(text: string): boolean {
  return /https?:\/\/\S+/i.test(text);
}

// ─── Session state management (unified ConversationState) ─────────────────────

describe('Socratic session state (unified)', () => {
  beforeEach(() => {
    clearAllStates();
  });

  it('stores and retrieves a session by chatId', () => {
    const socratic = createTestSocratic();
    enterSocraticPhase(CHAT_ID, USER_ID, socratic);
    expect(isInPhase(USER_ID, 'socratic')).toBe(true);
    expect(getState(CHAT_ID)?.socratic).toBeTruthy();
  });

  it('retrieves session by userId', () => {
    const socratic = createTestSocratic();
    enterSocraticPhase(CHAT_ID, USER_ID, socratic);
    expect(hasActiveSession(USER_ID)).toBe(true);
    const state = getStateByUserId(USER_ID);
    expect(state?.socratic).toBeTruthy();
  });

  it('removes session via returnToIdle', () => {
    const socratic = createTestSocratic();
    enterSocraticPhase(CHAT_ID, USER_ID, socratic);
    expect(isInPhase(USER_ID, 'socratic')).toBe(true);

    returnToIdle(CHAT_ID);
    expect(isInPhase(USER_ID, 'socratic')).toBe(false);
    expect(getState(CHAT_ID)?.socratic).toBeUndefined();
  });

  it('replaces session when new one is stored for same chatId', () => {
    enterSocraticPhase(CHAT_ID, USER_ID, createTestSocratic({ sessionId: 'session-001' }));
    expect(getState(CHAT_ID)?.socratic?.sessionId).toBe('session-001');

    enterSocraticPhase(CHAT_ID, USER_ID, createTestSocratic({ sessionId: 'session-002' }));
    expect(getState(CHAT_ID)?.socratic?.sessionId).toBe('session-002');
  });
});

// ─── URL bypass heuristic ────────────────────────────────────────────────────

describe('URL bypass heuristic', () => {
  it('detects plain URL', () => {
    expect(messageContainsUrl('https://example.com/article')).toBe(true);
  });

  it('detects URL with surrounding text', () => {
    expect(messageContainsUrl('check this out https://example.com/article pretty cool')).toBe(true);
  });

  it('detects http URL', () => {
    expect(messageContainsUrl('http://localhost:3000/test')).toBe(true);
  });

  it('does NOT detect plain text as URL', () => {
    expect(messageContainsUrl('research it deeply')).toBe(false);
  });

  it('does NOT detect "http" without ://', () => {
    expect(messageContainsUrl('the http protocol is old')).toBe(false);
  });

  it('does NOT detect email addresses as URLs', () => {
    expect(messageContainsUrl('send to jim@example.com')).toBe(false);
  });

  it('does NOT detect markdown-style references', () => {
    expect(messageContainsUrl('see the docs at docs.example')).toBe(false);
  });
});

// ─── Bypass scenarios (session cancellation) ────────────────────────────────

describe('Session cancellation on new content', () => {
  beforeEach(() => {
    clearAllStates();
  });

  it('cancels session when new URL is detected (simulated handler logic)', () => {
    // Setup: pending Socratic session exists
    enterSocraticPhase(CHAT_ID, USER_ID, createTestSocratic());
    expect(isInPhase(USER_ID, 'socratic')).toBe(true);

    // Simulate: new message contains a URL
    const newMessage = 'https://newsite.com/different-article';
    const containsUrl = messageContainsUrl(newMessage);
    expect(containsUrl).toBe(true);

    // Handler logic: bypass Socratic, cancel stale session
    if (containsUrl) {
      const staleState = getStateByUserId(USER_ID);
      if (staleState) {
        returnToIdle(staleState.chatId);
      }
    }

    // Verify: session is gone
    expect(isInPhase(USER_ID, 'socratic')).toBe(false);
    expect(getState(CHAT_ID)?.socratic).toBeUndefined();
  });

  it('preserves session for non-URL answer text', () => {
    // Setup: pending Socratic session exists
    enterSocraticPhase(CHAT_ID, USER_ID, createTestSocratic());

    // Simulate: non-URL answer message
    const answerMessage = 'research it deeply';
    const containsUrl = messageContainsUrl(answerMessage);
    expect(containsUrl).toBe(false);

    // Handler logic: would route to handleSocraticAnswer, NOT cancel session
    expect(isInPhase(USER_ID, 'socratic')).toBe(true);
  });

  it('cancels session when URL+context message arrives', () => {
    enterSocraticPhase(CHAT_ID, USER_ID, createTestSocratic());

    const newMessage = 'check this out https://example.com/new-thing pretty interesting';
    expect(messageContainsUrl(newMessage)).toBe(true);

    // Cancel stale session
    const staleState = getStateByUserId(USER_ID);
    if (staleState) {
      returnToIdle(staleState.chatId);
    }

    expect(isInPhase(USER_ID, 'socratic')).toBe(false);
  });
});

// ─── Answer routing scenarios ────────────────────────────────────────────────

describe('Socratic answer routing decision', () => {
  beforeEach(() => {
    clearAllStates();
  });

  /**
   * Simulates the handler's routing decision for a message
   * Returns: 'socratic' | 'bypass' | 'normal'
   */
  function routeDecision(messageText: string, hasPendingSession: boolean): 'socratic' | 'bypass' | 'normal' {
    if (!hasPendingSession) return 'normal';
    if (messageContainsUrl(messageText)) return 'bypass';
    return 'socratic';
  }

  // --- Messages that SHOULD route to Socratic answer handler ---

  it('routes short answer to Socratic', () => {
    expect(routeDecision('capture it', true)).toBe('socratic');
  });

  it('routes "research" keyword to Socratic', () => {
    expect(routeDecision('research', true)).toBe('socratic');
  });

  it('routes "The Grove" pillar answer to Socratic', () => {
    expect(routeDecision('The Grove', true)).toBe('socratic');
  });

  it('routes multi-word answer to Socratic', () => {
    expect(routeDecision('deep dive for a blog post about AI agents', true)).toBe('socratic');
  });

  it('routes "skip it" to Socratic', () => {
    expect(routeDecision('skip it', true)).toBe('socratic');
  });

  // --- Messages that SHOULD bypass Socratic ---

  it('bypasses URL share', () => {
    expect(routeDecision('https://newsite.com/article', true)).toBe('bypass');
  });

  it('bypasses URL with context', () => {
    expect(routeDecision('check this https://newsite.com/article', true)).toBe('bypass');
  });

  it('bypasses http URL', () => {
    expect(routeDecision('http://localhost:3000/debug', true)).toBe('bypass');
  });

  // --- Messages without pending session ---

  it('routes normally when no session pending', () => {
    expect(routeDecision('https://example.com', false)).toBe('normal');
  });

  it('routes normally for text when no session', () => {
    expect(routeDecision('what is the meaning of life', false)).toBe('normal');
  });
});

// ─── Edge cases ──────────────────────────────────────────────────────────────

describe('Edge cases', () => {
  beforeEach(() => {
    clearAllStates();
  });

  it('handles empty message text gracefully', () => {
    expect(messageContainsUrl('')).toBe(false);
  });

  it('handles message with only whitespace', () => {
    expect(messageContainsUrl('   ')).toBe(false);
  });

  it('session for different user does not interfere', () => {
    const otherUserId = 99999;
    enterSocraticPhase(CHAT_ID, otherUserId, createTestSocratic());

    // Our user has no pending session
    expect(isInPhase(USER_ID, 'socratic')).toBe(false);
    // Other user does
    expect(isInPhase(otherUserId, 'socratic')).toBe(true);
  });

  it('multiple sessions for different chats, same user — userId lookup finds one', () => {
    enterSocraticPhase(111, USER_ID, createTestSocratic({ sessionId: 's1' }));
    enterSocraticPhase(222, USER_ID, createTestSocratic({ sessionId: 's2' }));

    // Both exist
    expect(getState(111)?.socratic).toBeTruthy();
    expect(getState(222)?.socratic).toBeTruthy();

    // userId lookup returns one (iteration order)
    const found = getStateByUserId(USER_ID);
    expect(found?.socratic).toBeTruthy();
  });
});
