/**
 * Approval Session State — Telegram Surface
 *
 * @deprecated SESSION-STATE-FOUNDATION: This module is being superseded by
 * conversation-state.ts (unified state manager). Session store functions
 * still work but are mirrored to unified state. Signal detection utilities
 * (isApprovalSignal, isRejectionSignal) and formatting (formatProposalMessage)
 * remain canonical — they are pure functions, not session state.
 *
 * Maps chatId -> pending approval session state.
 * When assessment classifies a request as moderate+ with a proposal,
 * this module stores the proposal. When Jim replies with an approval
 * or rejection signal, handler.ts retrieves the session.
 *
 * Mirrors dialogue-session.ts pattern.
 * TTL: 5 minutes (approval is a quick yes/no decision).
 *
 * Sprint: STAB-003 (Close the Cognitive Loop)
 */

import { logger } from '../logger';
import type { RequestAssessment, AssessmentContext } from '../../../../packages/agents/src/assessment/types';
import type { ApproachProposal } from '../../../../packages/agents/src/assessment/types';

// ─── Types ──────────────────────────────────────────────

/**
 * A pending approval session awaiting Jim's yes/no
 */
export interface PendingApprovalSession {
  /** Chat where the approval is pending */
  chatId: number;
  /** User who triggered the approval */
  userId: number;
  /** Message ID of the proposal message (for context) */
  proposalMessageId: number;
  /** The approach proposal awaiting approval */
  proposal: ApproachProposal;
  /** The refined request from dialogue (if dialogue preceded approval) */
  refinedRequest?: string;
  /** The original message text */
  originalMessage: string;
  /** Original assessment that generated the proposal */
  assessment: RequestAssessment;
  /** Assessment context for re-assessment on ambiguous reply */
  assessmentContext: AssessmentContext;
  /** Timestamp for TTL expiry */
  createdAt: number;
}

// ─── Approval Signal Patterns ───────────────────────────

/** Positive approval signals (case-insensitive) */
const APPROVAL_PATTERNS = [
  /^(?:yes|yeah|yep|yup|sure|ok|okay|go|go\s+ahead|do\s+it|sounds?\s+(?:good|right|great)|looks?\s+good|let'?s?\s+go|let'?s?\s+do\s+it|proceed|approved?|right|correct|exactly|perfect|absolutely|definitely|for\s+sure|works?\s+for\s+me|that\s+works?)[\s!.]*$/i,
  /^👍$/,
  /^✅$/,
];

/** Negative/rejection signals (case-insensitive) */
const REJECTION_PATTERNS = [
  /^(?:no|nah|nope|wait|stop|hold|pause|cancel|adjust|change|different|wrong|not\s+(?:quite|right|that))[\s!.]*$/i,
  /^👎$/,
  /^❌$/,
];

// ─── Signal Detection ───────────────────────────────────

/**
 * Check if a message is an approval signal.
 */
export function isApprovalSignal(text: string): boolean {
  const trimmed = text.trim();
  return APPROVAL_PATTERNS.some(p => p.test(trimmed));
}

/**
 * Check if a message is a rejection signal.
 */
export function isRejectionSignal(text: string): boolean {
  const trimmed = text.trim();
  return REJECTION_PATTERNS.some(p => p.test(trimmed));
}

// ─── Session Store ──────────────────────────────────────

/** Session TTL: 5 minutes */
const SESSION_TTL_MS = 5 * 60 * 1000;

/**
 * In-memory store: chatId -> pending session
 * Only one pending session per chat (latest wins).
 */
const pendingSessions = new Map<number, PendingApprovalSession>();

/**
 * Store a pending approval session
 */
export function storeApprovalSession(session: PendingApprovalSession): void {
  // Clean expired sessions on store (same pattern as dialogue-session)
  const now = Date.now();
  for (const [chatId, existing] of pendingSessions) {
    if (now - existing.createdAt > SESSION_TTL_MS) {
      pendingSessions.delete(chatId);
    }
  }

  pendingSessions.set(session.chatId, session);

  logger.debug('Stored approval session', {
    chatId: session.chatId,
    userId: session.userId,
    stepsCount: session.proposal.steps.length,
    hasRefinedRequest: !!session.refinedRequest,
  });
}

/**
 * Get a pending approval session by chat ID
 */
export function getApprovalSession(chatId: number): PendingApprovalSession | undefined {
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
 * Get a pending approval session by user ID (searches all sessions)
 */
export function getApprovalSessionByUserId(userId: number): PendingApprovalSession | undefined {
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
 * Check if a user has a pending approval session
 */
export function hasApprovalSessionForUser(userId: number): boolean {
  return getApprovalSessionByUserId(userId) !== undefined;
}

/**
 * Remove a pending approval session
 */
export function removeApprovalSession(chatId: number): boolean {
  return pendingSessions.delete(chatId);
}

/**
 * Get count of active sessions (for monitoring)
 */
export function getApprovalSessionCount(): number {
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
export function clearAllApprovalSessions(): void {
  pendingSessions.clear();
}

// ─── Proposal Formatting ────────────────────────────────

/**
 * Format an approach proposal for Telegram display.
 * Returns HTML-formatted message ready for parse_mode: 'HTML'.
 */
export function formatProposalMessage(proposal: ApproachProposal, complexity: string): string {
  const lines: string[] = [];

  lines.push(`<b>Here's my read on this (${complexity}):</b>`);
  lines.push('');

  for (let i = 0; i < proposal.steps.length; i++) {
    lines.push(`${i + 1}. ${proposal.steps[i].description}`);
  }

  if (proposal.timeEstimate) {
    lines.push('');
    lines.push(`<i>Estimated: ${proposal.timeEstimate}</i>`);
  }

  if (proposal.alternativeAngles && proposal.alternativeAngles.length > 0) {
    lines.push('');
    lines.push('<b>Alternative angles:</b>');
    for (const angle of proposal.alternativeAngles) {
      lines.push(`- ${angle}`);
    }
  }

  lines.push('');
  lines.push(proposal.questionForJim || 'Sound right, or different angle?');

  return lines.join('\n');
}
