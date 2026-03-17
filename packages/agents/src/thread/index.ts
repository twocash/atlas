/**
 * Thread Identity — surface-agnostic thread tracking for Feed 2.0.
 *
 * ADR-009: Thread identity belongs at the desk (Feed 2.0), not on
 * the phone line (ConversationState).
 */

export {
  deriveThreadId,
  parseThreadId,
  VALID_SURFACES,
  type Surface,
  type ThreadIdentity,
} from "./derive-thread-id"

export {
  hydrateThread,
  type HydratedTurn,
  type HydrationResult,
} from "./thread-hydrator"
