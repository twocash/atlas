/**
 * Goal Module — Type Definitions
 *
 * GoalContext is the structured representation of what "done" looks like
 * for a user's content share. Replaces hardcoded action menus with
 * parsed intent from natural language.
 *
 * Sprint: GOAL-FIRST-CAPTURE (ATLAS-GOAL-FIRST-001)
 * ADR: ADR-002 (Intent-First Routing)
 */

// ─── Core Types ───────────────────────────────────────────

export type GoalEndState = 'bookmark' | 'research' | 'create' | 'analyze' | 'summarize' | 'custom';
export type DepthSignal = 'quick' | 'standard' | 'deep';

export interface GoalContext {
  /** What "done" looks like */
  endState: GoalEndState;
  /** Original phrasing if endState is 'custom' */
  endStateRaw?: string;

  // ─── Richness signals (all optional) ──────────────────
  /** Thesis angle: "revenge of the B students" */
  thesisHook?: string;
  /** Target audience: "linkedin", "client", "self", "team" */
  audience?: string;
  /** Output format: "thinkpiece", "brief", "deck", "post" */
  format?: string;
  /** Depth: quick overview vs deep research */
  depthSignal?: DepthSignal;
  /** Emotional framing: "playful", "urgent", "analytical" */
  emotionalTone?: string;
  /** Connection to ongoing work: "theme I've been playing with" */
  personalRelevance?: string;

  // ─── Completeness ─────────────────────────────────────
  /** 0-100 completeness score */
  completeness: number;
  /** What's still needed */
  missingFor: GoalRequirement[];

  // ─── Source ───────────────────────────────────────────
  /** Original user message that was parsed */
  parsedFrom: string;
  /** Parser confidence 0-1 */
  confidence: number;
}

export interface GoalRequirement {
  /** Which GoalContext field is missing */
  field: string;
  /** Human-readable question to ask */
  question: string;
  /** Lower = ask first */
  priority: number;
}

// ─── Parser Types ─────────────────────────────────────────

export interface GoalParseResult {
  goal: GoalContext;
  /** True if goal is complete enough to execute */
  immediateExecution: boolean;
  /** True if we need to ask a follow-up */
  clarificationNeeded: boolean;
  /** The follow-up question to ask (if clarificationNeeded) */
  nextQuestion?: string;
}

/** Raw extraction from Haiku before completeness scoring */
export interface HaikuGoalExtraction {
  endState: GoalEndState;
  endStateRaw?: string;
  thesisHook?: string | null;
  audience?: string | null;
  format?: string | null;
  depthSignal?: DepthSignal | null;
  emotionalTone?: string | null;
  personalRelevance?: string | null;
}

// ─── Content Context (passed to parser) ───────────────────

export interface ContentAnalysis {
  /** URL or text of the content */
  content: string;
  /** Title from pre-read */
  title?: string;
  /** Summary from pre-read */
  summary?: string;
  /** Source type: article, social post, etc. */
  sourceType?: string;
}

// ─── Telemetry ────────────────────────────────────────────

export interface GoalTelemetry {
  /** 0-100 on first parse */
  initialCompleteness: number;
  /** 0, 1, or 2 */
  clarificationCount: number;
  /** After clarifications */
  finalCompleteness: number;

  /** 'research', 'create', 'bookmark', etc. */
  goalEndState: string;
  goalAudience?: string;
  goalFormat?: string;
  /** Did user provide an angle? */
  hadThesisHook: boolean;

  /** What Atlas figured out without asking */
  fieldsInferredFromContext: string[];
  /** What Atlas had to ask about */
  fieldsClarified: string[];
  /** Capture to clear goal (ms) */
  timeToGoalResolutionMs: number;
}
