/**
 * Goal Completeness Scoring
 *
 * Determines whether a GoalContext has enough information to execute
 * or needs follow-up questions. Thresholds vary by endState —
 * bookmarks need nothing, research needs audience + depth.
 *
 * Sprint: GOAL-FIRST-CAPTURE
 */

import type { GoalContext, GoalEndState, GoalRequirement } from './types';

// ─── Completeness Requirements by EndState ────────────────

/**
 * Required fields for each endState.
 * Bookmark needs nothing. Research needs audience + depth.
 * Create needs audience + format. Etc.
 */
export const COMPLETENESS_REQUIREMENTS: Record<GoalEndState, string[]> = {
  bookmark: [],                            // Always complete
  research: ['audience', 'depthSignal'],   // Who it's for + how deep
  create: ['audience', 'format'],          // Who sees it + what shape
  analyze: ['audience'],                   // Who the analysis is for
  summarize: ['audience'],                 // Quick vs detailed depends on audience
  custom: ['endStateRaw'],                 // Need clarification of what they want
};

/**
 * Clarification question templates keyed by field name.
 * These are the default questions — can be overridden by Notion config.
 */
const FIELD_QUESTIONS: Record<string, { question: string; priority: number }> = {
  audience: {
    question: "Who's this for — just you, a client, or something public like LinkedIn?",
    priority: 1,
  },
  depthSignal: {
    question: 'How deep should I go — quick overview or thorough research with sources?',
    priority: 2,
  },
  format: {
    question: "What format — a post, a brief, a full thinkpiece, or something else?",
    priority: 2,
  },
  endStateRaw: {
    question: "I want to make sure I understand — what does \"done\" look like for this?",
    priority: 0,
  },
  thesisHook: {
    question: 'Got an angle in mind, or want me to find one?',
    priority: 3,
  },
};

// ─── Scoring ──────────────────────────────────────────────

export interface CompletenessResult {
  completeness: number;
  missingFor: GoalRequirement[];
}

/**
 * Score how complete a GoalContext is for execution.
 *
 * - 100 = ready to execute, all required fields present
 * - 70+ = execute with reasonable defaults
 * - <70 = needs clarification
 *
 * Bonus points for optional richness signals (thesis hook, tone, etc.)
 */
export function scoreCompleteness(goal: Partial<GoalContext>): CompletenessResult {
  const endState = goal.endState ?? 'custom';
  const requiredFields = COMPLETENESS_REQUIREMENTS[endState] ?? [];

  // If no requirements (bookmark), it's 100
  if (requiredFields.length === 0) {
    return { completeness: 100, missingFor: [] };
  }

  // Check which required fields are present
  const missingFor: GoalRequirement[] = [];
  let presentCount = 0;

  for (const field of requiredFields) {
    const value = (goal as Record<string, unknown>)[field];
    if (value !== undefined && value !== null && value !== '') {
      presentCount++;
    } else {
      const fieldInfo = FIELD_QUESTIONS[field];
      if (fieldInfo) {
        missingFor.push({
          field,
          question: fieldInfo.question,
          priority: fieldInfo.priority,
        });
      }
    }
  }

  // Base score: percentage of required fields present
  const baseScore = requiredFields.length > 0
    ? (presentCount / requiredFields.length) * 70
    : 70;

  // Bonus for richness signals (up to 30 points)
  let bonus = 0;
  if (goal.thesisHook) bonus += 10;
  if (goal.emotionalTone) bonus += 5;
  if (goal.personalRelevance) bonus += 5;
  if (goal.format && !requiredFields.includes('format')) bonus += 5;
  if (goal.audience && !requiredFields.includes('audience')) bonus += 5;
  bonus = Math.min(bonus, 30);

  const completeness = Math.min(Math.round(baseScore + bonus), 100);

  // Sort missing fields by priority (lowest = most important)
  missingFor.sort((a, b) => a.priority - b.priority);

  return { completeness, missingFor };
}

/**
 * Check if a goal is complete enough to execute (>= 70).
 */
export function isGoalComplete(goal: Partial<GoalContext>): boolean {
  return scoreCompleteness(goal).completeness >= 70;
}
