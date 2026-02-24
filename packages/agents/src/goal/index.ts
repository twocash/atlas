/**
 * Goal Module — Public API
 *
 * Sprint: GOAL-FIRST-CAPTURE (ATLAS-GOAL-FIRST-001)
 */

// ─── Types ───────────────────────────────────────────────
export type {
  GoalContext,
  GoalEndState,
  GoalRequirement,
  GoalParseResult,
  HaikuGoalExtraction,
  ContentAnalysis,
  DepthSignal,
  GoalTelemetry,
} from './types';

// ─── Parser ──────────────────────────────────────────────
export { parseGoalFromResponse, detectSimpleIntent } from './parser';

// ─── Clarifier ───────────────────────────────────────────
export {
  generateClarificationQuestion,
  incorporateClarification,
  resolveAfterClarification,
  MAX_CLARIFICATIONS,
} from './clarifier';

// ─── Completeness ────────────────────────────────────────
export {
  scoreCompleteness,
  isGoalComplete,
  COMPLETENESS_REQUIREMENTS,
} from './completeness';

// ─── Telemetry ──────────────────────────────────────────
export {
  startGoalTracker,
  recordClarification,
  finalizeGoalTelemetry,
  buildImmediateTelemetry,
  goalTelemetryToKeywords,
  goalTelemetryToMetadata,
  type GoalTracker,
} from './telemetry';
