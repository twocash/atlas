/**
 * Atlas Telegram Bot - Pending Research State
 *
 * Stores research requests awaiting voice selection via inline keyboard.
 * Requests auto-expire after 5 minutes.
 */

/**
 * A research request waiting for voice selection
 */
export interface PendingResearch {
  /** Telegram chat ID */
  chatId: number;
  /** User who initiated the request */
  userId: number;
  /** Research query */
  query: string;
  /** Research depth (light/standard/deep) */
  depth: "light" | "standard" | "deep";
  /** Optional focus area */
  focus?: string;
  /** When the request was created */
  timestamp: number;
}

/** TTL for pending requests (5 minutes) */
const TTL_MS = 5 * 60 * 1000;

/** Storage for pending requests, keyed by requestId */
const pending = new Map<string, PendingResearch>();

/**
 * Store a pending research request
 *
 * @param requestId - Unique ID for this request (used in callback data)
 * @param req - The pending research request details
 */
export function store(requestId: string, req: PendingResearch): void {
  pending.set(requestId, req);

  // Auto-expire after TTL
  setTimeout(() => {
    pending.delete(requestId);
  }, TTL_MS);
}

/**
 * Retrieve and consume a pending research request
 *
 * @param requestId - The request ID to retrieve
 * @returns The pending request, or undefined if expired/not found
 */
export function retrieve(requestId: string): PendingResearch | undefined {
  const req = pending.get(requestId);
  if (req) {
    pending.delete(requestId); // Consume once
  }
  return req;
}

/**
 * Check if a pending request exists (without consuming it)
 *
 * @param requestId - The request ID to check
 * @returns true if the request exists
 */
export function exists(requestId: string): boolean {
  return pending.has(requestId);
}

/**
 * Get count of pending requests (for debugging)
 */
export function pendingCount(): number {
  return pending.size;
}
