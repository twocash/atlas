/**
 * Pending Content State Management
 *
 * Extracted from content-confirm.ts — pure state management for pending
 * content awaiting classification/dispatch. No keyboard builders.
 *
 * Used by:
 * - content-flow.ts (store pending content during Socratic interview)
 * - content-callback.ts (retrieve/update/remove during processing)
 * - socratic-adapter.ts (store content alongside Socratic sessions)
 */

import { logger } from '../logger';
import type { PendingContent } from './content-confirm';

/**
 * In-memory store for pending confirmations
 * Key: requestId (unique per confirmation flow)
 */
const pendingContent = new Map<string, PendingContent>();

// Auto-expire pending content after 10 minutes
const EXPIRY_MS = 10 * 60 * 1000;

/**
 * Generate a unique request ID
 */
export function generateRequestId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
}

/**
 * Store pending content for confirmation
 */
export function storePendingContent(content: PendingContent): void {
  pendingContent.set(content.requestId, content);

  // Schedule auto-cleanup
  setTimeout(() => {
    if (pendingContent.has(content.requestId)) {
      pendingContent.delete(content.requestId);
      logger.debug('Expired pending content', { requestId: content.requestId });
    }
  }, EXPIRY_MS);

  logger.debug('Stored pending content', {
    requestId: content.requestId,
    pillar: content.pillar,
    requestType: content.requestType,
  });
}

/**
 * Retrieve pending content by request ID
 */
export function getPendingContent(requestId: string): PendingContent | undefined {
  return pendingContent.get(requestId);
}

/**
 * Update pending content (after keyboard selection or Socratic answer)
 */
export function updatePendingContent(requestId: string, updates: Partial<PendingContent>): boolean {
  const existing = pendingContent.get(requestId);
  if (!existing) return false;

  pendingContent.set(requestId, { ...existing, ...updates });
  return true;
}

/**
 * Remove pending content (after confirm/skip)
 */
export function removePendingContent(requestId: string): boolean {
  return pendingContent.delete(requestId);
}

/**
 * Get count of pending confirmations (for debugging)
 */
export function getPendingCount(): number {
  return pendingContent.size;
}

/**
 * Clear all pending content (for testing/reset)
 */
export function clearAllPending(): void {
  pendingContent.clear();
}
