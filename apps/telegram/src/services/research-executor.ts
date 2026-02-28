/**
 * Atlas Telegram Bot - Research Executor Service
 *
 * RPO-001: DEPRECATED — Re-exports from research-adapter.ts for backward compat.
 * All callers should migrate to importing from './research-adapter' directly.
 *
 * The old 419-line file has been replaced by:
 * - packages/agents/src/orchestration/research-orchestrator.ts (business logic)
 * - apps/telegram/src/services/research-adapter.ts (delivery, ≤150 LOC)
 */

export {
  registry,
  runResearchAgentWithNotifications,
  sendCompletionNotification,
} from "./research-adapter";
