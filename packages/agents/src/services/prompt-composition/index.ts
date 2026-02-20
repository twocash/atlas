/**
 * Prompt Composition Service
 *
 * Public API for the shared prompt composition system.
 * Used by channel adapters (Telegram, Chrome extension) to compose prompts.
 *
 * @example
 * ```typescript
 * import {
 *   composePrompt,
 *   getAvailableActions,
 *   getAvailableVoices,
 *   PILLAR_OPTIONS,
 * } from '@atlas/agents/services/prompt-composition';
 *
 * // Get available options for UI
 * const actions = getAvailableActions('The Grove');
 * const voices = getAvailableVoices('The Grove', 'research');
 *
 * // Compose a prompt
 * const result = await composePrompt({
 *   pillar: 'The Grove',
 *   action: 'research',
 *   voice: 'grove-analytical',
 *   content: 'https://example.com/article',
 *   title: 'Interesting Article',
 * });
 *
 * console.log(result.prompt);
 * console.log(result.metadata.drafter); // 'drafter.the-grove.research'
 * ```
 */

// ==========================================
// Type Exports
// ==========================================

export type {
  // Core types
  Pillar,
  PillarSlug,
  ActionType,

  // Intent-First types (Phase 2)
  IntentType,
  DepthLevel,
  AudienceType,
  SourceType,
  FormatType,
  StructuredCompositionInput,

  // State types
  PromptSelectionState,

  // Composition types
  PromptCompositionIds,
  CompositionContext,
  PromptCompositionResult,

  // Registry types
  VoiceOption,
  ActionOption,
  PillarOption,

  // Validation
  ValidationError,
} from './types';

// ==========================================
// Composition Functions
// ==========================================

export {
  // Main composition
  composePrompt,
  composePromptFromState,
  composeFromStructuredContext,

  // ID resolution
  buildPromptIds,
  buildPromptIdsFromContext,
  resolveDrafterId,
  resolveVoiceId,
  resolveDefaultDrafterId,

  // Validation
  validateSelection,
  validateContext,
} from './composer';

// ==========================================
// Intent-First Mappers (Phase 2)
// ==========================================

export { mapIntentToAction, inferFormat } from './intent-mapper';
export { resolveAudienceVoice } from './audience-voice';
export { getDepthConfig, type DepthConfig } from './depth-config';

// ==========================================
// Registry Functions
// ==========================================

export {
  // Option getters
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
} from './registry';

// ==========================================
// Bridge Identity Composition
// ==========================================

export { composeBridgePrompt, type BridgePromptResult } from './bridge';
