/**
 * Prompt Composition Core
 *
 * Main composition logic that resolves drafter/voice IDs and assembles prompts.
 * This is the single source of truth for prompt composition.
 */

import type {
  Pillar,
  ActionType,
  CompositionContext,
  PromptCompositionIds,
  PromptCompositionResult,
  PromptSelectionState,
  ValidationError,
} from './types';

import { getPillarSlug, pillarSupportsAction, pillarHasVoice } from './registry';
import { getPromptManager, type PromptVariables } from '../prompt-manager';

// ==========================================
// Drafter/Voice ID Resolution
// ==========================================

/**
 * Build drafter ID from pillar and action
 * Pattern: drafter.{pillar-slug}.{action}
 *
 * @example
 * resolveDrafterId('The Grove', 'research') → 'drafter.the-grove.research'
 */
export function resolveDrafterId(pillar: Pillar, action: ActionType): string {
  const slug = getPillarSlug(pillar);
  return `drafter.${slug}.${action}`;
}

/**
 * Build voice ID from voice identifier
 * Pattern: voice.{voice-id}
 *
 * @example
 * resolveVoiceId('grove-analytical') → 'voice.grove-analytical'
 */
export function resolveVoiceId(voiceId: string): string {
  // If already prefixed, return as-is
  if (voiceId.startsWith('voice.')) {
    return voiceId;
  }
  return `voice.${voiceId}`;
}

/**
 * Build default drafter ID (fallback when pillar-specific not found)
 * Pattern: drafter.default.{action}
 */
export function resolveDefaultDrafterId(action: ActionType): string {
  return `drafter.default.${action}`;
}

// ==========================================
// Prompt ID Building
// ==========================================

/**
 * Build prompt composition IDs from selection state
 * Converts user selections into prompt IDs for PromptManager
 */
export function buildPromptIds(state: PromptSelectionState): PromptCompositionIds {
  const ids: PromptCompositionIds = {};

  if (state.pillar && state.action) {
    ids.drafter = resolveDrafterId(state.pillar, state.action);
  }

  if (state.voice) {
    ids.voice = resolveVoiceId(state.voice);
  }

  return ids;
}

/**
 * Build prompt composition IDs from context
 * Simpler version for direct composition calls
 */
export function buildPromptIdsFromContext(ctx: CompositionContext): PromptCompositionIds {
  return {
    drafter: resolveDrafterId(ctx.pillar, ctx.action),
    voice: ctx.voice ? resolveVoiceId(ctx.voice) : undefined,
  };
}

// ==========================================
// Validation
// ==========================================

/**
 * Validate selection state completeness
 * Returns array of validation errors (empty if valid)
 */
export function validateSelection(state: PromptSelectionState): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!state.content) {
    errors.push({ field: 'content', message: 'Content is required' });
  }

  if (!state.pillar) {
    errors.push({ field: 'pillar', message: 'Pillar selection is required' });
  }

  if (!state.action) {
    errors.push({ field: 'action', message: 'Action selection is required' });
  }

  // Validate pillar supports action
  if (state.pillar && state.action && !pillarSupportsAction(state.pillar, state.action)) {
    errors.push({
      field: 'action',
      message: `${state.pillar} does not support ${state.action} action`,
    });
  }

  // Validate pillar has voice (if voice selected)
  if (state.pillar && state.voice && !pillarHasVoice(state.pillar, state.voice)) {
    errors.push({
      field: 'voice',
      message: `${state.pillar} does not have voice ${state.voice}`,
    });
  }

  return errors;
}

/**
 * Validate composition context
 */
export function validateContext(ctx: CompositionContext): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!ctx.content) {
    errors.push({ field: 'content', message: 'Content is required' });
  }

  if (!ctx.pillar) {
    errors.push({ field: 'pillar', message: 'Pillar is required' });
  }

  if (!ctx.action) {
    errors.push({ field: 'action', message: 'Action is required' });
  }

  return errors;
}

// ==========================================
// Main Composition Function
// ==========================================

/**
 * Compose a prompt from context
 *
 * This is the main entry point for prompt composition.
 * It resolves drafter/voice IDs, fetches prompts from Notion,
 * and assembles the final prompt.
 *
 * @example
 * ```typescript
 * const result = await composePrompt({
 *   pillar: 'The Grove',
 *   action: 'research',
 *   voice: 'grove-analytical',
 *   content: 'https://example.com/article',
 *   title: 'Interesting Article',
 * });
 *
 * console.log(result.prompt); // The composed prompt
 * console.log(result.metadata.drafter); // 'drafter.the-grove.research'
 * ```
 */
export async function composePrompt(
  ctx: CompositionContext
): Promise<PromptCompositionResult> {
  // Validate context
  const errors = validateContext(ctx);
  if (errors.length > 0) {
    throw new Error(`Invalid composition context: ${errors.map(e => e.message).join(', ')}`);
  }

  // Build prompt IDs
  const promptIds = buildPromptIdsFromContext(ctx);

  // Build variables for template hydration
  const variables: PromptVariables = {
    pillar: ctx.pillar,
    action: ctx.action,
    url: ctx.url || ctx.content,
    title: ctx.title || ctx.content,
    content: ctx.content,
  };

  // Get prompt manager
  const pm = getPromptManager();

  // Try to compose prompts
  // The composePrompts method handles fallback chain:
  // 1. drafter.{pillar-slug}.{action}
  // 2. drafter.default.{action}
  // 3. Hardcoded fallback
  let composedPrompt = await pm.composePrompts(promptIds, variables);

  // If pillar-specific drafter failed, try default drafter
  if (!composedPrompt && promptIds.drafter) {
    console.log(`[Composer] Pillar-specific drafter not found: ${promptIds.drafter}, trying default`);
    const defaultDrafter = resolveDefaultDrafterId(ctx.action);
    const fallbackIds = { ...promptIds, drafter: defaultDrafter };
    composedPrompt = await pm.composePrompts(fallbackIds, variables);
  }

  // If still no prompt, use hardcoded fallback
  if (!composedPrompt) {
    console.warn('[Composer] No prompt found, using hardcoded fallback');
    return {
      prompt: buildFallbackPrompt(ctx),
      temperature: 0.7,
      maxTokens: 4096,
      metadata: {
        drafter: 'fallback',
        voice: undefined,
      },
    };
  }

  return {
    prompt: composedPrompt.prompt,
    temperature: composedPrompt.temperature,
    maxTokens: composedPrompt.maxTokens,
    metadata: {
      drafter: promptIds.drafter || 'unknown',
      voice: promptIds.voice,
    },
  };
}

/**
 * Compose prompt from selection state (for Telegram adapter)
 * Convenience wrapper that converts PromptSelectionState to CompositionContext
 */
export async function composePromptFromState(
  state: PromptSelectionState
): Promise<PromptCompositionResult> {
  // Validate state
  const errors = validateSelection(state);
  if (errors.length > 0) {
    throw new Error(`Invalid selection state: ${errors.map(e => e.message).join(', ')}`);
  }

  return composePrompt({
    pillar: state.pillar!,
    action: state.action!,
    voice: state.voice,
    content: state.content,
    title: state.title,
    url: state.contentType === 'url' ? state.content : undefined,
  });
}

// ==========================================
// Fallback Prompts
// ==========================================

/**
 * Build a fallback prompt when no prompts found in Notion
 * This ensures the system always produces output even if prompts are missing
 */
function buildFallbackPrompt(ctx: CompositionContext): string {
  const actionInstructions: Record<ActionType, string> = {
    research: `Conduct thorough research on the following content. Analyze multiple perspectives,
identify key insights, and provide citations where applicable. Structure your response with:
- Executive Summary
- Key Findings
- Analysis
- Sources`,

    draft: `Create a polished draft based on the following content. The output should be
publication-ready with clear structure, engaging prose, and appropriate formatting for
the ${ctx.pillar} context.`,

    capture: `Extract and organize the key information from the following content.
Provide:
- Title/Topic
- TL;DR (2-3 sentences)
- Key Points (bulleted)
- Relevant Quotes
- Action Items (if any)`,

    analysis: `Provide strategic analysis of the following content with focus on:
- Current State Assessment
- Opportunities and Risks
- Recommendations
- Next Steps`,

    summarize: `Summarize the following content concisely:
- Main Topic
- Key Points (3-5 bullets)
- Conclusion/Takeaway`,
  };

  const instruction = actionInstructions[ctx.action];

  return `# ${ctx.action.charAt(0).toUpperCase() + ctx.action.slice(1)} Request

## Context
- Pillar: ${ctx.pillar}
- Content Type: ${ctx.url ? 'URL' : 'Text'}
${ctx.title ? `- Title: ${ctx.title}` : ''}

## Instructions
${instruction}

## Content
${ctx.url || ctx.content}`;
}
