/**
 * Cross-Surface Resume — resume a conversation thread from any surface.
 *
 * Two entry points:
 *   resumeByNativeId(surface, nativeId) — derive thread_id, hydrate from Feed 2.0
 *   resumeByThreadId(threadId) — direct hydration when thread_id is already known
 *
 * Cold-start: when ConversationState has no record for this user/chat,
 * Feed 2.0 provides the persistent thread history. The user picks up
 * where they left off — even from a different surface.
 *
 * ADR-005: Surface-agnostic. Any surface calls resumeByNativeId with its
 * own identifier. The thread module handles the rest.
 * ADR-009: Thread history lives at the desk (Feed 2.0). Surfaces provide
 * the native ID; the desk provides the context.
 */

import { deriveThreadId, type Surface, type ThreadIdentity } from "./derive-thread-id"
import { hydrateThread, type HydrationResult } from "./thread-hydrator"
import { logger } from "../logger"

// ─── Types ───────────────────────────────────────────────

export interface ResumeResult {
  /** The resolved thread identity */
  thread: ThreadIdentity
  /** Hydration result from Feed 2.0 */
  hydration: HydrationResult
  /** Whether this is a cold start (no prior ConversationState) */
  coldStart: boolean
  /** Formatted context string for prompt injection (empty if no history) */
  contextBlock: string
}

// ─── Resume ──────────────────────────────────────────────

/**
 * Resume a thread by surface + native ID.
 *
 * Derives thread_id, hydrates from Feed 2.0, returns context block
 * ready for prompt injection.
 *
 * @param surface - The originating surface
 * @param nativeId - Surface-native identifier (chatId, sessionId, etc.)
 * @param coldStart - Whether ConversationState has no record for this user
 */
export async function resumeByNativeId(
  surface: Surface,
  nativeId: string | number,
  coldStart: boolean = false,
): Promise<ResumeResult> {
  const thread = deriveThreadId(surface, nativeId)
  return resumeByThreadId(thread.threadId, coldStart)
}

/**
 * Resume a thread by canonical thread_id.
 *
 * Direct hydration when thread_id is already known (e.g., Bridge
 * session passing thread_id from a previous surface).
 */
export async function resumeByThreadId(
  threadId: string,
  coldStart: boolean = false,
): Promise<ResumeResult> {
  const thread = { threadId, surface: threadId.split(":")[0] as Surface, surfaceNativeId: threadId.split(":").slice(1).join(":") }

  logger.info("[thread-resume] Resuming thread", {
    threadId,
    coldStart,
  })

  const hydration = await hydrateThread(threadId)

  const contextBlock = buildContextBlock(hydration, coldStart)

  logger.info("[thread-resume] Resume complete", {
    threadId,
    coldStart,
    turns: hydration.returned,
    status: hydration.status,
    contextLength: contextBlock.length,
  })

  return {
    thread,
    hydration,
    coldStart,
    contextBlock,
  }
}

// ─── Context Block Builder ──────────────────────────────

/**
 * Build a formatted context block from hydration result.
 *
 * Returns empty string if no history — callers can check contextBlock.length
 * to decide whether to inject. ADR-008: empty is explicit, not silent.
 */
function buildContextBlock(hydration: HydrationResult, coldStart: boolean): string {
  if (hydration.status === "empty" || hydration.turns.length === 0) {
    return ""
  }

  const header = coldStart
    ? "--- Conversation History (resumed from persistent storage) ---"
    : "--- Recent Thread History ---"

  const turnLines = hydration.turns
    .map((t) => {
      const parts = [`[${t.timestamp}]`]
      if (t.surface) parts.push(`(${t.surface})`)
      parts.push(t.entry)
      return parts.join(" ")
    })
    .join("\n")

  return `${header}\n${turnLines}`
}
