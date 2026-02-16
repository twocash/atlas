/**
 * Context Module — assembles context slots for cognitive orchestration.
 */

export { assembleContext, type AssemblyResult } from "./assembler"
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
