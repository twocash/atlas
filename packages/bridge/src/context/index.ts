/**
 * Context Module — assembles context slots for cognitive orchestration.
 */

export { assembleContext, assembleSessionSlot, type AssemblyResult, type SessionSlotMetrics } from "./assembler"
export {
  constructPrompt,
  buildClaudeMessage,
  constructFromAssembly,
} from "./prompt-constructor"
export {
  createSlot,
  createEmptySlot,
  enforceTokenBudget,
  totalTokens,
  populatedSlotIds,
  estimateTokens,
  type CreateSlotOptions,
} from "./slots"
export { assembleDomainRagSlot } from "./domain-rag-slot"
export { assemblePovSlot } from "./pov-slot"
export { resolveWorkspace, normalizePillar, getWorkspaceMapping } from "./workspace-router"
export { queryWorkspace, healthCheck } from "./anythingllm-client"
export { fetchPovForPillar, type PovContent } from "./pov-fetcher"
export { registerSelfModelProvider, type SelfModelProvider } from "./self-model-slot"
