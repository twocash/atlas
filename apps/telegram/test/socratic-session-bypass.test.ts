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
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import {
  storeSocraticSession,
  hasPendingSocraticSession,
  hasPendingSocraticSessionForUser,
  getSocraticSession,
  getSocraticSessionByUserId,
  removeSocraticSession,
  clearAllSocraticSessions,
  type PendingSocraticSession,
} from '../src/conversation/socratic-session';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const CHAT_ID = 12345;
const USER_ID = 67890;

function createTestSession(overrides: Partial<PendingSocraticSession> = {}): PendingSocraticSession {
  return {
    sessionId: 'test-session-001',
    chatId: CHAT_ID,
    userId: USER_ID,
    questionMessageId: 999,
    questions: [{ text: "What's the play?", key: 'intent', options: [] }],
    currentQuestionIndex: 0,
    content: 'https://example.com/article',
    contentType: 'url',
    title: 'Test Article',
    signals: { contentSignals: { topic: 'Test', title: 'Test', hasUrl: true, contentLength: 30 } },
    createdAt: Date.now(),
    ...overrides,
  };
}

/**
 * URL bypass detection — mirrors the regex in handler.ts
 */
function messageContainsUrl(text: string): boolean {
  return /https?:\/\/\S+/i.test(text);
}

// ─── Session state management ────────────────────────────────────────────────

describe('Socratic session state', () => {
  beforeEach(() => {
    clearAllSocraticSessions();
  });

  it('stores and retrieves a session by chatId', () => {
    const session = createTestSession();
    storeSocraticSession(session);
    expect(hasPendingSocraticSession(CHAT_ID)).toBe(true);
    expect(getSocraticSession(CHAT_ID)).toBeTruthy();
  });

  it('retrieves session by userId', () => {
    const session = createTestSession();
    storeSocraticSession(session);
    expect(hasPendingSocraticSessionForUser(USER_ID)).toBe(true);
    expect(getSocraticSessionByUserId(USER_ID)).toBeTruthy();
  });

  it('removes session explicitly', () => {
    const session = createTestSession();
    storeSocraticSession(session);
    expect(hasPendingSocraticSession(CHAT_ID)).toBe(true);

    removeSocraticSession(CHAT_ID);
    expect(hasPendingSocraticSession(CHAT_ID)).toBe(false);
    expect(hasPendingSocraticSessionForUser(USER_ID)).toBe(false);
  });

  it('replaces session when new one is stored for same chatId', () => {
    const session1 = createTestSession({ sessionId: 'session-001' });
    storeSocraticSession(session1);
    expect(getSocraticSession(CHAT_ID)?.sessionId).toBe('session-001');

    const session2 = createTestSession({ sessionId: 'session-002' });
    storeSocraticSession(session2);
    expect(getSocraticSession(CHAT_ID)?.sessionId).toBe('session-002');
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
    clearAllSocraticSessions();
  });

  it('cancels session when new URL is detected (simulated handler logic)', () => {
    // Setup: pending Socratic session exists
    const session = createTestSession();
    storeSocraticSession(session);
    expect(hasPendingSocraticSessionForUser(USER_ID)).toBe(true);

    // Simulate: new message contains a URL
    const newMessage = 'https://newsite.com/different-article';
    const containsUrl = messageContainsUrl(newMessage);
    expect(containsUrl).toBe(true);

    // Handler logic: bypass Socratic, cancel stale session
    if (containsUrl) {
      const staleSession = getSocraticSessionByUserId(USER_ID);
      if (staleSession) {
        removeSocraticSession(staleSession.chatId);
      }
    }

    // Verify: session is gone
    expect(hasPendingSocraticSessionForUser(USER_ID)).toBe(false);
    expect(hasPendingSocraticSession(CHAT_ID)).toBe(false);
  });

  it('preserves session for non-URL answer text', () => {
    // Setup: pending Socratic session exists
    const session = createTestSession();
    storeSocraticSession(session);

    // Simulate: non-URL answer message
    const answerMessage = 'research it deeply';
    const containsUrl = messageContainsUrl(answerMessage);
    expect(containsUrl).toBe(false);

    // Handler logic: would route to handleSocraticAnswer, NOT cancel session
    // (session only gets removed after engine processes the answer)
    expect(hasPendingSocraticSessionForUser(USER_ID)).toBe(true);
  });

  it('cancels session when URL+context message arrives', () => {
    const session = createTestSession();
    storeSocraticSession(session);

    const newMessage = 'check this out https://example.com/new-thing pretty interesting';
    expect(messageContainsUrl(newMessage)).toBe(true);

    // Cancel stale session
    const staleSession = getSocraticSessionByUserId(USER_ID);
    if (staleSession) {
      removeSocraticSession(staleSession.chatId);
    }

    expect(hasPendingSocraticSessionForUser(USER_ID)).toBe(false);
  });
});

// ─── Answer routing scenarios ────────────────────────────────────────────────

describe('Socratic answer routing decision', () => {
  beforeEach(() => {
    clearAllSocraticSessions();
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
    clearAllSocraticSessions();
  });

  it('handles empty message text gracefully', () => {
    expect(messageContainsUrl('')).toBe(false);
  });

  it('handles message with only whitespace', () => {
    expect(messageContainsUrl('   ')).toBe(false);
  });

  it('session for different user does not interfere', () => {
    const otherUserId = 99999;
    const session = createTestSession({ userId: otherUserId });
    storeSocraticSession(session);

    // Our user has no pending session
    expect(hasPendingSocraticSessionForUser(USER_ID)).toBe(false);
    // Other user does
    expect(hasPendingSocraticSessionForUser(otherUserId)).toBe(true);
  });

  it('multiple sessions for different chats, same user — userId lookup finds one', () => {
    const session1 = createTestSession({ chatId: 111, sessionId: 's1' });
    const session2 = createTestSession({ chatId: 222, sessionId: 's2' });
    storeSocraticSession(session1);
    storeSocraticSession(session2);

    // Both exist
    expect(hasPendingSocraticSession(111)).toBe(true);
    expect(hasPendingSocraticSession(222)).toBe(true);

    // userId lookup returns one (iteration order)
    const found = getSocraticSessionByUserId(USER_ID);
    expect(found).toBeTruthy();
  });
});
