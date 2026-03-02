/**
 * Approval Utilities — Pure Functions
 *
 * Signal detection (isApprovalSignal, isRejectionSignal) and formatting
 * (formatProposalMessage) extracted from approval-session.ts during
 * STATE-PERSIST-TEARDOWN. These are stateless pure functions, not session state.
 *
 * Session state now lives in conversation-state.ts (unified ConversationState).
 */

import type { ApproachProposal } from '../assessment/types';

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
