/**
 * Goal Telemetry — Observation Layer
 *
 * Builds GoalTelemetry objects from goal parsing events.
 * Feeds into Feed 2.0 keywords + analysisContent.metadata
 * so Sprint 4 pattern detector can observe goal patterns.
 *
 * Rule: TELEMETRY BY DEFAULT — no execution without observation.
 *
 * Sprint: GOAL-FIRST-CAPTURE (ATLAS-GOAL-FIRST-001)
 */

import type { GoalContext, GoalTelemetry } from './types';

// ─── Tracker ─────────────────────────────────────────────

/**
 * Mutable tracker that accumulates telemetry across goal lifecycle.
 * Created at first parse, updated on each clarification, finalized on execution.
 */
export interface GoalTracker {
  /** Timestamp when goal parsing started */
  startedAt: number;
  /** Completeness score on first parse */
  initialCompleteness: number;
  /** Which fields were already filled on first parse */
  fieldsInferredFromContext: string[];
  /** Which fields needed clarification */
  fieldsClarified: string[];
  /** Number of clarification rounds */
  clarificationCount: number;
}

/**
 * Start tracking a goal from its initial parse.
 * Call this right after parseGoalFromResponse() returns.
 */
export function startGoalTracker(goal: GoalContext): GoalTracker {
  return {
    startedAt: Date.now(),
    initialCompleteness: goal.completeness,
    fieldsInferredFromContext: getFilledFields(goal),
    fieldsClarified: [],
    clarificationCount: 0,
  };
}

/**
 * Record a clarification round on the tracker.
 * Call this when a clarification answer is incorporated.
 */
export function recordClarification(tracker: GoalTracker, fieldClarified: string): void {
  tracker.clarificationCount++;
  if (!tracker.fieldsClarified.includes(fieldClarified)) {
    tracker.fieldsClarified.push(fieldClarified);
  }
}

// ─── Finalization ────────────────────────────────────────

/**
 * Build the final GoalTelemetry from a tracker + resolved goal.
 * Call this right before createAuditTrail().
 */
export function finalizeGoalTelemetry(
  tracker: GoalTracker,
  finalGoal: GoalContext,
): GoalTelemetry {
  return {
    initialCompleteness: tracker.initialCompleteness,
    clarificationCount: tracker.clarificationCount,
    finalCompleteness: finalGoal.completeness,
    goalEndState: finalGoal.endState,
    goalAudience: finalGoal.audience,
    goalFormat: finalGoal.format,
    hadThesisHook: !!finalGoal.thesisHook,
    fieldsInferredFromContext: tracker.fieldsInferredFromContext,
    fieldsClarified: tracker.fieldsClarified,
    timeToGoalResolutionMs: Date.now() - tracker.startedAt,
  };
}

/**
 * Build GoalTelemetry for a single-pass goal (no clarifications needed).
 * Convenience for the common case where goal resolves immediately.
 */
export function buildImmediateTelemetry(
  goal: GoalContext,
  parseStartMs: number,
): GoalTelemetry {
  return {
    initialCompleteness: goal.completeness,
    clarificationCount: 0,
    finalCompleteness: goal.completeness,
    goalEndState: goal.endState,
    goalAudience: goal.audience,
    goalFormat: goal.format,
    hadThesisHook: !!goal.thesisHook,
    fieldsInferredFromContext: getFilledFields(goal),
    fieldsClarified: [],
    timeToGoalResolutionMs: Date.now() - parseStartMs,
  };
}

// ─── Feed 2.0 Integration ────────────────────────────────

/**
 * Convert GoalTelemetry into Feed 2.0 keywords.
 * These appear as multi_select tags on the Feed entry,
 * visible to Sprint 4 pattern detector.
 *
 * Format: goal/<field> for categorical, goal-metric for numeric signals.
 */
export function goalTelemetryToKeywords(telemetry: GoalTelemetry): string[] {
  const keywords: string[] = [];

  // Core intent signal — most important for pattern detection
  keywords.push(`goal/${telemetry.goalEndState}`);

  // Audience and format — routing signals
  if (telemetry.goalAudience) {
    keywords.push(`audience/${telemetry.goalAudience}`);
  }
  if (telemetry.goalFormat) {
    keywords.push(`format/${telemetry.goalFormat}`);
  }

  // Thesis presence — richness signal
  if (telemetry.hadThesisHook) {
    keywords.push('has-thesis');
  }

  // Clarification signal — how much hand-holding was needed
  if (telemetry.clarificationCount === 0) {
    keywords.push('goal-immediate');
  } else {
    keywords.push(`goal-clarified-${telemetry.clarificationCount}`);
  }

  return keywords;
}

/**
 * Convert GoalTelemetry into analysisContent.metadata entries.
 * These appear in the Feed page body under "Source Info".
 */
export function goalTelemetryToMetadata(telemetry: GoalTelemetry): Record<string, string> {
  const meta: Record<string, string> = {
    'Goal End State': telemetry.goalEndState,
    'Initial Completeness': `${telemetry.initialCompleteness}%`,
    'Final Completeness': `${telemetry.finalCompleteness}%`,
    'Clarification Rounds': String(telemetry.clarificationCount),
    'Time to Goal Resolution': `${telemetry.timeToGoalResolutionMs}ms`,
    'Had Thesis Hook': telemetry.hadThesisHook ? 'Yes' : 'No',
  };

  if (telemetry.goalAudience) {
    meta['Goal Audience'] = telemetry.goalAudience;
  }
  if (telemetry.goalFormat) {
    meta['Goal Format'] = telemetry.goalFormat;
  }
  if (telemetry.fieldsInferredFromContext.length > 0) {
    meta['Fields Inferred'] = telemetry.fieldsInferredFromContext.join(', ');
  }
  if (telemetry.fieldsClarified.length > 0) {
    meta['Fields Clarified'] = telemetry.fieldsClarified.join(', ');
  }

  return meta;
}

// ─── Internal ────────────────────────────────────────────

/** Extract which optional fields were filled on a goal. */
function getFilledFields(goal: GoalContext): string[] {
  const fields: string[] = [];
  if (goal.endState) fields.push('endState');
  if (goal.thesisHook) fields.push('thesisHook');
  if (goal.audience) fields.push('audience');
  if (goal.format) fields.push('format');
  if (goal.depthSignal) fields.push('depthSignal');
  if (goal.emotionalTone) fields.push('emotionalTone');
  if (goal.personalRelevance) fields.push('personalRelevance');
  return fields;
}
