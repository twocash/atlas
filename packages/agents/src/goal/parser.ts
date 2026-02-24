/**
 * Goal Parser
 *
 * Extracts structured GoalContext from a user's natural language response.
 * Fast path for simple intents ("save it", "bookmark"). Haiku extraction
 * for rich goal statements with embedded signals.
 *
 * Sprint: GOAL-FIRST-CAPTURE
 * ADR: ADR-002 (Intent-First), ADR-008 (Fail Fast)
 */

import Anthropic from '@anthropic-ai/sdk';
import { scoreCompleteness } from './completeness';
import { buildExtractionPrompt } from './prompts';
import { generateClarificationQuestion } from './clarifier';
import type {
  GoalContext,
  GoalEndState,
  GoalParseResult,
  HaikuGoalExtraction,
  ContentAnalysis,
  DepthSignal,
} from './types';

// ─── Simple Intent Detection (No LLM) ────────────────────

const BOOKMARK_SIGNALS = ['save', 'bookmark', 'capture', 'keep', 'store', 'later', 'file it', 'stash'];
const SUMMARIZE_SIGNALS = ['summarize', 'summary', 'tldr', 'tl;dr', 'quick take', 'cliff notes', 'gist'];

/**
 * Detect simple intents that need no LLM parsing and no clarification.
 * Returns null if the message is too complex for simple detection.
 */
export function detectSimpleIntent(message: string): GoalEndState | null {
  const lower = message.toLowerCase().trim();

  // Only match short messages — long messages likely have rich context
  if (lower.length > 60) return null;

  if (BOOKMARK_SIGNALS.some(s => lower.includes(s))) {
    return 'bookmark';
  }

  if (SUMMARIZE_SIGNALS.some(s => lower.includes(s))) {
    return 'summarize';
  }

  return null;
}

// ─── Haiku Goal Extraction ────────────────────────────────

const HAIKU_MODEL = 'claude-haiku-4-5-20251001';

/**
 * Call Haiku to extract structured goal from user's response.
 * Returns raw extraction (before completeness scoring).
 */
async function extractGoalWithHaiku(
  userMessage: string,
  contentContext: ContentAnalysis,
): Promise<HaikuGoalExtraction> {
  const prompt = buildExtractionPrompt({
    contentTitle: contentContext.title ?? 'Unknown',
    contentSummary: contentContext.summary ?? 'No summary available',
    sourceType: contentContext.sourceType ?? 'unknown',
    userMessage,
  });

  const client = new Anthropic();
  const response = await client.messages.create({
    model: HAIKU_MODEL,
    max_tokens: 512,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0]?.type === 'text' ? response.content[0].text : '';

  try {
    // Extract JSON from response (handle markdown code blocks)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in Haiku response');
    }

    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;

    return {
      endState: validateEndState(parsed.endState as string) ?? 'custom',
      endStateRaw: typeof parsed.endStateRaw === 'string' ? parsed.endStateRaw : undefined,
      thesisHook: nullableString(parsed.thesisHook),
      audience: nullableString(parsed.audience),
      format: nullableString(parsed.format),
      depthSignal: validateDepthSignal(parsed.depthSignal as string),
      emotionalTone: nullableString(parsed.emotionalTone),
      personalRelevance: nullableString(parsed.personalRelevance),
    };
  } catch (err) {
    // ADR-008: Fail fast — log the error, return conservative extraction
    console.error('[GoalParser] Haiku extraction failed, falling back to conservative parse', {
      error: err instanceof Error ? err.message : String(err),
      rawResponse: text.slice(0, 200),
    });
    return fallbackExtraction(userMessage);
  }
}

// ─── Main Entry Point ─────────────────────────────────────

/**
 * Parse a user's goal from their response to "What do you want to accomplish?"
 *
 * Flow:
 * 1. Check for simple intents (bookmark, summarize) — no LLM needed
 * 2. Call Haiku for rich goal extraction
 * 3. Score completeness
 * 4. If complete (>= 70) → immediate execution
 * 5. If incomplete → generate clarification question
 */
export async function parseGoalFromResponse(
  userMessage: string,
  contentContext: ContentAnalysis,
): Promise<GoalParseResult> {
  // Fast path: simple intents
  const simpleIntent = detectSimpleIntent(userMessage);
  if (simpleIntent) {
    const goal: GoalContext = {
      endState: simpleIntent,
      completeness: 100,
      missingFor: [],
      parsedFrom: userMessage,
      confidence: 1.0,
    };
    return {
      goal,
      immediateExecution: true,
      clarificationNeeded: false,
    };
  }

  // Haiku extraction for rich goals
  const extraction = await extractGoalWithHaiku(userMessage, contentContext);

  // Build GoalContext from extraction
  const partialGoal: Partial<GoalContext> = {
    endState: extraction.endState,
    endStateRaw: extraction.endStateRaw ?? undefined,
    thesisHook: extraction.thesisHook ?? undefined,
    audience: extraction.audience ?? undefined,
    format: extraction.format ?? undefined,
    depthSignal: extraction.depthSignal ?? undefined,
    emotionalTone: extraction.emotionalTone ?? undefined,
    personalRelevance: extraction.personalRelevance ?? undefined,
  };

  // Score completeness
  const { completeness, missingFor } = scoreCompleteness(partialGoal);

  const goal: GoalContext = {
    ...partialGoal as GoalContext,
    completeness,
    missingFor,
    parsedFrom: userMessage,
    confidence: completeness >= 70 ? 0.9 : 0.6,
  };

  if (completeness >= 70) {
    return {
      goal,
      immediateExecution: true,
      clarificationNeeded: false,
    };
  }

  // Need clarification — pick highest priority missing field
  const nextQuestion = missingFor.length > 0
    ? generateClarificationQuestion(missingFor[0], contentContext)
    : undefined;

  return {
    goal,
    immediateExecution: false,
    clarificationNeeded: true,
    nextQuestion,
  };
}

// ─── Helpers ──────────────────────────────────────────────

function validateEndState(value: string | undefined | null): GoalEndState | null {
  const valid: GoalEndState[] = ['bookmark', 'research', 'create', 'analyze', 'summarize', 'custom'];
  if (value && valid.includes(value as GoalEndState)) {
    return value as GoalEndState;
  }
  return null;
}

function validateDepthSignal(value: string | undefined | null): DepthSignal | null {
  const valid: DepthSignal[] = ['quick', 'standard', 'deep'];
  if (value && valid.includes(value as DepthSignal)) {
    return value as DepthSignal;
  }
  return null;
}

function nullableString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }
  return null;
}

/**
 * Conservative fallback when Haiku extraction fails.
 * Uses simple keyword detection to guess endState.
 */
function fallbackExtraction(message: string): HaikuGoalExtraction {
  const lower = message.toLowerCase();

  let endState: GoalEndState = 'custom';
  if (lower.includes('research') || lower.includes('look into') || lower.includes('dig into')) {
    endState = 'research';
  } else if (lower.includes('write') || lower.includes('create') || lower.includes('draft') || lower.includes('think piece') || lower.includes('thinkpiece')) {
    endState = 'create';
  } else if (lower.includes('analyze') || lower.includes('break down') || lower.includes('breakdown')) {
    endState = 'analyze';
  } else if (lower.includes('summarize') || lower.includes('summary')) {
    endState = 'summarize';
  }

  // Try to detect audience from keywords
  let audience: string | null = null;
  if (lower.includes('linkedin')) audience = 'linkedin';
  else if (lower.includes('client')) audience = 'client';
  else if (lower.includes('twitter') || lower.includes('x.com')) audience = 'twitter';

  // Try to detect format
  let format: string | null = null;
  if (lower.includes('thinkpiece') || lower.includes('think piece')) format = 'thinkpiece';
  else if (lower.includes('post')) format = 'post';
  else if (lower.includes('brief')) format = 'brief';
  else if (lower.includes('deck')) format = 'deck';

  return {
    endState,
    audience,
    format,
    thesisHook: null,
    depthSignal: null,
    emotionalTone: null,
    personalRelevance: null,
  };
}
