/**
 * Goal Clarifier
 *
 * When a goal is incomplete, generates targeted follow-up questions
 * for missing fields. Incorporates clarification responses into
 * the existing GoalContext.
 *
 * Sprint: GOAL-FIRST-CAPTURE
 * Design: Max 2 follow-up questions, then best-guess execution.
 */

import Anthropic from '@anthropic-ai/sdk';
import { scoreCompleteness } from './completeness';
import { buildFieldExtractionPrompt } from './prompts';
import type {
  GoalContext,
  GoalRequirement,
  ContentAnalysis,
  GoalParseResult,
} from './types';

// ─── Max Clarification Rounds ─────────────────────────────

export const MAX_CLARIFICATIONS = 2;

// ─── Clarification Question Generation ────────────────────

/**
 * Context-aware clarification templates.
 * Falls back to the requirement's built-in question.
 */
const CONTEXTUAL_TEMPLATES: Record<string, (ctx: ContentAnalysis) => string> = {
  audience: () =>
    "Who's this for — just you, a client, or something public like LinkedIn?",

  depthSignal: () =>
    'How deep should I go — quick overview or thorough research with sources?',

  format: () =>
    "What format — a post, a brief, a full thinkpiece, or something else?",

  thesisHook: () =>
    'Got an angle in mind, or want me to find one?',

  endStateRaw: () =>
    'I want to make sure I understand — what does "done" look like for this?',
};

/**
 * Generate a clarification question for the highest-priority missing field.
 */
export function generateClarificationQuestion(
  requirement: GoalRequirement,
  contentContext: ContentAnalysis,
): string {
  const template = CONTEXTUAL_TEMPLATES[requirement.field];
  return template ? template(contentContext) : requirement.question;
}

// ─── Clarification Incorporation ──────────────────────────

const HAIKU_MODEL = 'claude-haiku-4-5-20251001';

/**
 * Incorporate a clarification response into the existing GoalContext.
 *
 * Uses Haiku for field extraction when the response is ambiguous,
 * falls back to simple keyword matching for common patterns.
 */
export async function incorporateClarification(
  existingGoal: GoalContext,
  clarificationResponse: string,
  targetField: string,
): Promise<GoalContext> {
  // Try simple extraction first
  const simpleValue = extractFieldSimple(clarificationResponse, targetField);

  let extractedValue: string | null = simpleValue;

  // If simple extraction fails, use Haiku
  if (!extractedValue) {
    extractedValue = await extractFieldWithHaiku(clarificationResponse, targetField);
  }

  if (!extractedValue) {
    // Couldn't extract — return unchanged goal
    return existingGoal;
  }

  // Merge into existing goal
  const updatedGoal = { ...existingGoal, [targetField]: extractedValue };

  // Rescore completeness
  const { completeness, missingFor } = scoreCompleteness(updatedGoal);

  return {
    ...updatedGoal,
    completeness,
    missingFor,
  };
}

/**
 * After incorporating a clarification, determine next action:
 * - If complete → execute
 * - If still incomplete AND under max clarifications → ask again
 * - If at max clarifications → best-guess execute
 */
export function resolveAfterClarification(
  updatedGoal: GoalContext,
  clarificationRound: number,
  contentContext: ContentAnalysis,
): GoalParseResult {
  const isComplete = updatedGoal.completeness >= 70;
  const atMaxClarifications = clarificationRound >= MAX_CLARIFICATIONS;

  if (isComplete || atMaxClarifications) {
    return {
      goal: updatedGoal,
      immediateExecution: true,
      clarificationNeeded: false,
    };
  }

  // Still incomplete, ask next question
  const nextQuestion = updatedGoal.missingFor.length > 0
    ? generateClarificationQuestion(updatedGoal.missingFor[0], contentContext)
    : undefined;

  return {
    goal: updatedGoal,
    immediateExecution: false,
    clarificationNeeded: true,
    nextQuestion,
  };
}

// ─── Field Extraction Helpers ─────────────────────────────

/**
 * Simple keyword-based field extraction for common patterns.
 * Avoids LLM call for obvious answers.
 */
function extractFieldSimple(response: string, field: string): string | null {
  const lower = response.toLowerCase().trim();

  switch (field) {
    case 'audience': {
      if (lower.includes('linkedin')) return 'linkedin';
      if (lower.includes('client')) return 'client';
      if (lower.includes('twitter') || lower.includes('x.com')) return 'twitter';
      if (lower.includes('public')) return 'public';
      if (lower.includes('team')) return 'team';
      if (lower.includes('me') || lower.includes('myself') || lower.includes('just me') || lower.includes('my own')) return 'self';
      return null;
    }

    case 'depthSignal': {
      if (lower.includes('quick') || lower.includes('overview') || lower.includes('brief') || lower.includes('fast')) return 'quick';
      if (lower.includes('deep') || lower.includes('thorough') || lower.includes('comprehensive') || lower.includes('full')) return 'deep';
      if (lower.includes('standard') || lower.includes('normal') || lower.includes('regular')) return 'standard';
      return null;
    }

    case 'format': {
      if (lower.includes('thinkpiece') || lower.includes('think piece')) return 'thinkpiece';
      if (lower.includes('post')) return 'post';
      if (lower.includes('brief')) return 'brief';
      if (lower.includes('deck')) return 'deck';
      if (lower.includes('memo')) return 'memo';
      if (lower.includes('thread')) return 'thread';
      return null;
    }

    default:
      return null;
  }
}

/**
 * Use Haiku to extract a specific field value from a response.
 * Only called when simple extraction fails.
 */
async function extractFieldWithHaiku(
  response: string,
  fieldName: string,
): Promise<string | null> {
  try {
    const prompt = buildFieldExtractionPrompt(fieldName, response);

    const client = new Anthropic();
    const result = await client.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 128,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = result.content[0]?.type === 'text' ? result.content[0].text : '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]) as { value: string | null };
    return parsed.value ?? null;
  } catch (err) {
    console.error('[GoalClarifier] Haiku field extraction failed', {
      field: fieldName,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
