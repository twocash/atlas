/**
 * Content Detection - Cognitive module for URL/content share detection
 *
 * Pure logic: detects whether a message is primarily a URL share,
 * tracks duplicate confirmations, and determines extraction needs.
 *
 * Surface-agnostic: no Grammy, no Telegram, no logger dependencies.
 * The spaSourcesProvider parameter allows surfaces to inject their
 * own SPA source list without coupling this module to any config path.
 *
 * Extracted from apps/telegram/src/conversation/content-flow.ts
 * as part of the Cognitive Pipeline Extraction (CPE Phase 4).
 */

import { extractUrlsFromText, detectContentSource } from './content-router';

// ==========================================
// Duplicate Confirmation Guard
// ==========================================

/**
 * Tracks message IDs that have already had confirmations sent.
 * Prevents duplicate confirmation keyboards from race conditions.
 * Entries auto-expire after TTL_MS.
 */
const confirmationsSent = new Map<number, number>(); // messageId -> timestamp
const CONFIRMATION_TTL_MS = 30_000; // 30 seconds

/**
 * Mark a message as having sent a confirmation.
 * Used to prevent duplicate keyboards when multiple paths detect the same content.
 */
export function markConfirmationSent(messageId: number): void {
  confirmationsSent.set(messageId, Date.now());

  // Cleanup expired entries (lazy cleanup on each mark)
  const now = Date.now();
  for (const [id, ts] of confirmationsSent) {
    if (now - ts > CONFIRMATION_TTL_MS) {
      confirmationsSent.delete(id);
    }
  }
}

/**
 * Check if a confirmation has already been sent for this message.
 * Returns true if a confirmation was sent within the TTL window.
 */
export function hasConfirmationSent(messageId: number): boolean {
  const ts = confirmationsSent.get(messageId);
  if (!ts) return false;

  // Check if within TTL
  if (Date.now() - ts > CONFIRMATION_TTL_MS) {
    confirmationsSent.delete(messageId);
    return false;
  }

  return true;
}

/**
 * Export tracker for testing/inspection
 */
export const confirmationTracker = {
  size: () => confirmationsSent.size,
  clear: () => confirmationsSent.clear(),
};

// ==========================================
// Content Detection Logic
// ==========================================

/**
 * Result of content detection
 */
export interface ContentDetectionResult {
  isContentShare: boolean;  // Is this primarily a content share?
  urls: string[];           // Extracted URLs
  primaryUrl?: string;      // Main URL to process
  needsBrowser: boolean;    // Does extraction require browser?
}

/**
 * Detect if a message is primarily a URL/content share
 *
 * A message is a "content share" if:
 * - It contains 1-2 URLs
 * - The non-URL text is minimal (< 50 chars of context)
 * - OR the message is JUST a URL
 *
 * The spaSourcesProvider parameter injects the list of content sources
 * that require browser-based extraction (SPAs). This keeps the cognitive
 * module decoupled from any surface-specific config path.
 */
export function detectContentShare(
  text: string,
  spaSourcesProvider: () => string[] = () => [],
): ContentDetectionResult {
  const urls = extractUrlsFromText(text);

  if (urls.length === 0) {
    return { isContentShare: false, urls: [], needsBrowser: false };
  }

  // Get the primary URL (first one)
  const primaryUrl = urls[0];

  // Remove URLs from text to check remaining context
  let remainingText = text;
  for (const url of urls) {
    remainingText = remainingText.replace(url, '').trim();
  }

  // Content share if:
  // 1. Just a URL (or URLs)
  // 2. URL with minimal context (< 50 chars)
  // 3. Looks like a "check this out" pattern
  const isContentShare =
    urls.length > 0 &&
    (remainingText.length < 50 ||
     /^(check|look|see|read|watch|this|here|fyi|interesting|cool|nice)/i.test(remainingText));

  // Determine if browser extraction is needed
  const source = detectContentSource(primaryUrl);
  const needsBrowser = spaSourcesProvider().includes(source);

  return {
    isContentShare,
    urls,
    primaryUrl,
    needsBrowser,
  };
}
