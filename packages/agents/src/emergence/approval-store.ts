/**
 * Emergence — Approval Store (Step 8)
 *
 * Stores pending emergence proposals awaiting Jim's approval/dismissal.
 * Reuses signal detection from STAB-003 (isApprovalSignal/isRejectionSignal).
 *
 * TTL: 30 minutes (emergence proposals are less urgent than approach approvals).
 *
 * Sprint 4: CONV-ARCH-004 (Skill Emergence)
 */

import { logger } from '../logger';
import {
  isApprovalSignal,
  isRejectionSignal,
} from '../conversation/approval-session';
import { approveProposal, dismissProposal } from './monitor';
import type { EmergenceProposal } from './types';

// =============================================================================
// STORE
// =============================================================================

/** TTL for emergence proposals: 30 minutes */
const PROPOSAL_TTL_MS = 30 * 60 * 1000;

/** Pending proposals by chat ID (latest wins per chat) */
const pendingProposals = new Map<number, {
  proposal: EmergenceProposal;
  chatId: number;
  messageId: number;
  createdAt: number;
}>();

// =============================================================================
// API
// =============================================================================

/**
 * Store a pending emergence proposal for a chat.
 */
export function storeEmergenceProposal(
  chatId: number,
  messageId: number,
  proposal: EmergenceProposal
): void {
  // Clean expired
  const now = Date.now();
  for (const [id, entry] of pendingProposals) {
    if (now - entry.createdAt > PROPOSAL_TTL_MS) {
      pendingProposals.delete(id);
    }
  }

  pendingProposals.set(chatId, {
    proposal,
    chatId,
    messageId,
    createdAt: now,
  });

  logger.debug('Stored emergence proposal', {
    chatId,
    proposalId: proposal.id,
    skillName: proposal.suggestedSkillName,
  });
}

/**
 * Check if a chat has a pending emergence proposal.
 */
export function hasPendingEmergenceProposal(chatId: number): boolean {
  const entry = pendingProposals.get(chatId);
  if (!entry) return false;
  if (Date.now() - entry.createdAt > PROPOSAL_TTL_MS) {
    pendingProposals.delete(chatId);
    return false;
  }
  return true;
}

/**
 * Get the pending emergence proposal for a chat.
 */
export function getPendingEmergenceProposal(chatId: number): EmergenceProposal | undefined {
  const entry = pendingProposals.get(chatId);
  if (!entry) return undefined;
  if (Date.now() - entry.createdAt > PROPOSAL_TTL_MS) {
    pendingProposals.delete(chatId);
    return undefined;
  }
  return entry.proposal;
}

/**
 * Process a user response to an emergence proposal.
 * Returns the action taken, or null if no pending proposal / unrecognized signal.
 */
export function processEmergenceResponse(
  chatId: number,
  text: string
): { action: 'approved' | 'dismissed'; proposal: EmergenceProposal } | null {
  const entry = pendingProposals.get(chatId);
  if (!entry) return null;

  // Check TTL
  if (Date.now() - entry.createdAt > PROPOSAL_TTL_MS) {
    pendingProposals.delete(chatId);
    return null;
  }

  const { proposal } = entry;

  if (isApprovalSignal(text)) {
    approveProposal(proposal);
    pendingProposals.delete(chatId);
    return { action: 'approved', proposal };
  }

  if (isRejectionSignal(text)) {
    dismissProposal(proposal, `User dismissed: ${text}`);
    pendingProposals.delete(chatId);
    return { action: 'dismissed', proposal };
  }

  // Not a clear signal — leave proposal pending
  return null;
}

/**
 * Clear all pending proposals (for testing).
 */
export function clearAllEmergenceProposals(): void {
  pendingProposals.clear();
}
