/**
 * Thread Identity — derives canonical thread_id from surface + native ID.
 *
 * A thread_id is a stable identifier for a conversation thread across
 * all Atlas surfaces. Feed 2.0 stores it; Compilation stage queries by it.
 *
 * Format: `{surface}:{native_id}`
 *   - telegram:8207593172      (chatId)
 *   - bridge:session-abc123    (Bridge session ID)
 *   - chrome:tab-12345         (Chrome extension tab/session)
 *   - api:req-xyz              (API request ID)
 *
 * The thread_id is deterministic — same surface + same native ID always
 * produces the same thread_id. No UUIDs, no timestamps, no randomness.
 *
 * ADR-009: Thread identity belongs at the desk (Feed 2.0), not on
 * the phone line (ConversationState). This function is the single
 * derivation point — all callers use it.
 */

export type Surface = "telegram" | "bridge" | "chrome" | "api"

export interface ThreadIdentity {
  /** Canonical thread ID: `{surface}:{native_id}` */
  threadId: string
  /** Which surface originated this thread */
  surface: Surface
  /** Surface-native identifier (chatId, sessionId, tabId, etc.) */
  surfaceNativeId: string
}

/**
 * Derive a canonical thread_id from surface and native identifier.
 *
 * @param surface - The originating surface
 * @param nativeId - The surface-native identifier (chatId, sessionId, etc.)
 * @returns ThreadIdentity with canonical threadId
 */
export function deriveThreadId(
  surface: Surface,
  nativeId: string | number,
): ThreadIdentity {
  const surfaceNativeId = String(nativeId)
  const threadId = `${surface}:${surfaceNativeId}`

  return {
    threadId,
    surface,
    surfaceNativeId,
  }
}

/**
 * Parse a thread_id back into surface + native ID.
 * Returns null if the format is invalid.
 */
export function parseThreadId(threadId: string): ThreadIdentity | null {
  const colonIdx = threadId.indexOf(":")
  if (colonIdx === -1) return null

  const surface = threadId.slice(0, colonIdx) as Surface
  const surfaceNativeId = threadId.slice(colonIdx + 1)

  if (!surfaceNativeId) return null
  if (!["telegram", "bridge", "chrome", "api"].includes(surface)) return null

  return { threadId, surface, surfaceNativeId }
}
