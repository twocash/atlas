/**
 * Socratic Session State — Telegram Surface
 *
 * Maps chatId → pending Socratic interview state.
 * When the engine asks a question, this module stores the session context.
 * When Jim replies, this module retrieves the context for engine.answer().
 *
 * TTL: 5 minutes (matches engine session TTL).
 */

import { logger } from '../logger';
import type { SocraticQuestion, ContextSignals } from '../../../../packages/agents/src/socratic';
import type { TriageResult } from '../cognitive/triage-skill';

/**
 * A pending Socratic interview awaiting Jim's reply
 */
export interface PendingSocraticSession {
  /** Engine session ID (for engine.answer()) */
  sessionId: string;
  /** Chat where the question was asked */
  chatId: number;
  /** User who triggered the interview */
  userId: number;
  /** Message ID of the question message (for reply detection) */
  questionMessageId: number;
  /** The question(s) the engine asked */
  questions: SocraticQuestion[];
  /** Which question index we're on (0-based) */
  currentQuestionIndex: number;
  /** Original content that triggered the flow */
  content: string;
  /** Content type: url, text, media */
  contentType: 'url' | 'text' | 'media';
  /** Title for the content */
  title: string;
  /** Original triage result (if available) */
  triageResult?: TriageResult;
  /** Original context signals passed to the engine */
  signals: ContextSignals;
  /** Timestamp for TTL expiry */
  createdAt: number;
  /** Request ID for pending content (links to pending-content store) */
  requestId?: string;
}

/** Session TTL: 5 minutes */
const SESSION_TTL_MS = 5 * 60 * 1000;

/**
 * In-memory store: chatId → pending session
 * Only one pending session per chat (latest wins).
 */
const pendingSessions = new Map<number, PendingSocraticSession>();

/**
 * Store a pending Socratic session
 */
export function storeSocraticSession(session: PendingSocraticSession): void {
  pendingSessions.set(session.chatId, session);

  // Schedule auto-cleanup
  setTimeout(() => {
    const current = pendingSessions.get(session.chatId);
    if (current && current.sessionId === session.sessionId) {
      pendingSessions.delete(session.chatId);
      logger.debug('Expired Socratic session', {
        sessionId: session.sessionId,
        chatId: session.chatId,
      });
    }
  }, SESSION_TTL_MS);

  logger.debug('Stored Socratic session', {
    sessionId: session.sessionId,
    chatId: session.chatId,
    questionCount: session.questions.length,
  });
}

/**
 * Check if a chat has a pending Socratic session
 */
export function hasPendingSocraticSession(chatId: number): boolean {
  const session = pendingSessions.get(chatId);
  if (!session) return false;

  // Check TTL
  if (Date.now() - session.createdAt > SESSION_TTL_MS) {
    pendingSessions.delete(chatId);
    return false;
  }

  return true;
}

/**
 * Get a pending Socratic session by chat ID
 */
export function getSocraticSession(chatId: number): PendingSocraticSession | undefined {
  const session = pendingSessions.get(chatId);
  if (!session) return undefined;

  // Check TTL
  if (Date.now() - session.createdAt > SESSION_TTL_MS) {
    pendingSessions.delete(chatId);
    return undefined;
  }

  return session;
}

/**
 * Get a pending Socratic session by user ID (searches all sessions)
 */
export function getSocraticSessionByUserId(userId: number): PendingSocraticSession | undefined {
  for (const session of pendingSessions.values()) {
    if (session.userId === userId) {
      // Check TTL
      if (Date.now() - session.createdAt > SESSION_TTL_MS) {
        pendingSessions.delete(session.chatId);
        continue;
      }
      return session;
    }
  }
  return undefined;
}

/**
 * Check if a user has a pending Socratic session
 */
export function hasPendingSocraticSessionForUser(userId: number): boolean {
  return getSocraticSessionByUserId(userId) !== undefined;
}

/**
 * Remove a pending Socratic session
 */
export function removeSocraticSession(chatId: number): boolean {
  return pendingSessions.delete(chatId);
}

/**
 * Get count of active sessions (for monitoring)
 */
export function getSocraticSessionCount(): number {
  // Clean expired first
  const now = Date.now();
  for (const [chatId, session] of pendingSessions) {
    if (now - session.createdAt > SESSION_TTL_MS) {
      pendingSessions.delete(chatId);
    }
  }
  return pendingSessions.size;
}

/**
 * Clear all sessions (for testing)
 */
export function clearAllSocraticSessions(): void {
  pendingSessions.clear();
}
