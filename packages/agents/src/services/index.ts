/**
 * Atlas Agent Services
 *
 * Exported services for agent operations.
 */

export {
  PromptManager,
  getPromptManager,
  getPrompt,
  getPromptById,
  listUseCases,
  type PromptCapability,
  type PromptStage,
  type PromptPillar,
  type PromptRecord,
  type PromptLookup,
  type PromptVariables,
  type PromptComposition,
  type ComposedPrompt,
} from './prompt-manager';
