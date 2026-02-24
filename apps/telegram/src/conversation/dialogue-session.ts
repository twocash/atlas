/**
 * Dialogue Session State — Telegram Surface
 *
 * @deprecated SESSION-STATE-FOUNDATION: This module is being superseded by
 * conversation-state.ts (unified state manager). Session store functions
 * still work but are mirrored to unified state. Will be fully removed
 * after unified state is verified in production.
 *
 * Maps chatId -> pending dialogue session state.
 * When assessment classifies a request as "rough" terrain, this module
 * stores the dialogue state. When Jim replies, handler.ts retrieves
 * the state for continueDialogue().
 *
 * Mirrors socratic-session.ts pattern.
 * TTL: 10 minutes (dialogue is longer than Socratic 5-min).
 *
 * Sprint: STAB-002 (Activate the Cognitive Loop)
 */

import { logger } from '../logger';
import type { DialogueState } from '../../../../packages/agents/src/dialogue/types';
import type { RequestAssessment, AssessmentContext } from '../../../../packages/agents/src/assessment/types';

/**
 * A pending dialogue session awaiting Jim's reply
 */
export interface PendingDialogueSession {
  /** Chat where the dialogue is happening */
  chatId: number;
  /** User who triggered the dialogue */
  userId: number;
  /** Message ID of the last dialogue message (for context) */
  questionMessageId: number;
  /** Current dialogue state (from dialogue engine) */
  dialogueState: DialogueState;
  /** Original assessment that triggered dialogue */
  assessment: RequestAssessment;
  /** Assessment context for continuing dialogue */
  assessmentContext: AssessmentContext;
  /** Original message that triggered the dialogue */
  originalMessage: string;
  /** Timestamp for TTL expiry */
  createdAt: number;
}

/** Session TTL: 10 minutes */
const SESSION_TTL_MS = 10 * 60 * 1000;

/**
 * In-memory store: chatId -> pending session
 * Only one pending session per chat (latest wins).
 */
const pendingSessions = new Map<number, PendingDialogueSession>();

/**
 * Store a pending dialogue session
 */
export function storeDialogueSession(session: PendingDialogueSession): void {
  // Clean expired sessions on store (same pattern as socratic-session)
  const now = Date.now();
  for (const [chatId, existing] of pendingSessions) {
    if (now - existing.createdAt > SESSION_TTL_MS) {
      pendingSessions.delete(chatId);
    }
  }

  pendingSessions.set(session.chatId, session);

  logger.debug('Stored dialogue session', {
    chatId: session.chatId,
    userId: session.userId,
    terrain: session.dialogueState.terrain,
    turnCount: session.dialogueState.turnCount,
    threadCount: session.dialogueState.threads.length,
  });
}

/**
 * Get a pending dialogue session by chat ID
 */
export function getDialogueSession(chatId: number): PendingDialogueSession | undefined {
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
 * Get a pending dialogue session by user ID (searches all sessions)
 */
export function getDialogueSessionByUserId(userId: number): PendingDialogueSession | undefined {
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
 * Check if a user has a pending dialogue session
 */
export function hasDialogueSessionForUser(userId: number): boolean {
  return getDialogueSessionByUserId(userId) !== undefined;
}

/**
 * Remove a pending dialogue session
 */
export function removeDialogueSession(chatId: number): boolean {
  return pendingSessions.delete(chatId);
}

/**
 * Get count of active sessions (for monitoring)
 */
export function getDialogueSessionCount(): number {
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
export function clearAllDialogueSessions(): void {
  pendingSessions.clear();
}
