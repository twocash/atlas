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
  type ComponentStatus,
  sanitizeNotionId,
} from './prompt-manager';

// Degraded Context Warnings (ADR-008: Fail Loud)
export {
  degradedWarning,
  logDegradedFallback,
} from './degraded-context';

// Prompt Composition Service (V3 Active Capture)
export {
  // Main composition
  composePrompt,
  composePromptFromState,

  // ID resolution
  buildPromptIds,
  buildPromptIdsFromContext,
  resolveDrafterId,
  resolveVoiceId,
  resolveDefaultDrafterId,

  // Validation
  validateSelection,
  validateContext,

  // Registry
  getAvailableActions,
  getAvailableVoices,
  getPillarSlug,
  getPillarFromSlug,
  pillarSupportsAction,
  pillarHasVoice,

  // Constants
  PILLAR_OPTIONS,
  PILLAR_SLUGS,
  SLUG_TO_PILLAR,
  ACTION_OPTIONS,
  ACTION_LABELS,
  ACTION_EMOJIS,
  PILLAR_ACTIONS,
  PILLAR_VOICES,
  ACTION_VOICE_PREFERENCES,

  // Types
  type Pillar as CompositionPillar,
  type PillarSlug,
  type ActionType,
  type PromptSelectionState,
  type PromptCompositionIds,
  type CompositionContext,
  type PromptCompositionResult,
  type VoiceOption,
  type ActionOption,
  type PillarOption,
  type ValidationError,
} from './prompt-composition';
