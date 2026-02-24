/**
 * Goal Telemetry Tests
 *
 * Verifies the observation layer for goal-first capture.
 * Sprint: GOAL-FIRST-CAPTURE (ATLAS-GOAL-FIRST-001)
 */

import { describe, it, expect } from 'bun:test';
import {
  startGoalTracker,
  recordClarification,
  finalizeGoalTelemetry,
  buildImmediateTelemetry,
  goalTelemetryToKeywords,
  goalTelemetryToMetadata,
  type GoalTracker,
} from '../../../packages/agents/src/goal';
import type { GoalContext, GoalTelemetry } from '../../../packages/agents/src/goal';

// ─── Helpers ─────────────────────────────────────────────

function makeGoal(overrides: Partial<GoalContext> = {}): GoalContext {
  return {
    endState: 'research',
    completeness: 70,
    missingFor: [],
    parsedFrom: 'test message',
    confidence: 0.8,
    ...overrides,
  };
}

// ─── startGoalTracker ────────────────────────────────────

describe('startGoalTracker', () => {
  it('captures initial completeness', () => {
    const goal = makeGoal({ completeness: 45 });
    const tracker = startGoalTracker(goal);
    expect(tracker.initialCompleteness).toBe(45);
  });

  it('records filled fields as inferred from context', () => {
    const goal = makeGoal({
      endState: 'research',
      thesisHook: 'revenge of the B students',
      audience: 'linkedin',
      format: 'thinkpiece',
    });
    const tracker = startGoalTracker(goal);
    expect(tracker.fieldsInferredFromContext).toContain('endState');
    expect(tracker.fieldsInferredFromContext).toContain('thesisHook');
    expect(tracker.fieldsInferredFromContext).toContain('audience');
    expect(tracker.fieldsInferredFromContext).toContain('format');
  });

  it('starts with zero clarifications', () => {
    const tracker = startGoalTracker(makeGoal());
    expect(tracker.clarificationCount).toBe(0);
    expect(tracker.fieldsClarified).toEqual([]);
  });

  it('sets startedAt timestamp', () => {
    const before = Date.now();
    const tracker = startGoalTracker(makeGoal());
    expect(tracker.startedAt).toBeGreaterThanOrEqual(before);
    expect(tracker.startedAt).toBeLessThanOrEqual(Date.now());
  });
});

// ─── recordClarification ─────────────────────────────────

describe('recordClarification', () => {
  it('increments clarification count', () => {
    const tracker = startGoalTracker(makeGoal());
    recordClarification(tracker, 'audience');
    expect(tracker.clarificationCount).toBe(1);
    recordClarification(tracker, 'format');
    expect(tracker.clarificationCount).toBe(2);
  });

  it('records unique fields clarified', () => {
    const tracker = startGoalTracker(makeGoal());
    recordClarification(tracker, 'audience');
    recordClarification(tracker, 'audience'); // duplicate
    expect(tracker.fieldsClarified).toEqual(['audience']);
  });

  it('records multiple distinct fields', () => {
    const tracker = startGoalTracker(makeGoal());
    recordClarification(tracker, 'audience');
    recordClarification(tracker, 'format');
    expect(tracker.fieldsClarified).toEqual(['audience', 'format']);
  });
});

// ─── finalizeGoalTelemetry ───────────────────────────────

describe('finalizeGoalTelemetry', () => {
  it('builds complete telemetry from tracker + final goal', () => {
    const initial = makeGoal({ completeness: 40, endState: 'research' });
    const tracker = startGoalTracker(initial);
    recordClarification(tracker, 'audience');

    const final = makeGoal({
      completeness: 85,
      endState: 'research',
      audience: 'linkedin',
      thesisHook: 'test angle',
    });

    const telemetry = finalizeGoalTelemetry(tracker, final);
    expect(telemetry.initialCompleteness).toBe(40);
    expect(telemetry.finalCompleteness).toBe(85);
    expect(telemetry.clarificationCount).toBe(1);
    expect(telemetry.goalEndState).toBe('research');
    expect(telemetry.goalAudience).toBe('linkedin');
    expect(telemetry.hadThesisHook).toBe(true);
    expect(telemetry.fieldsClarified).toEqual(['audience']);
  });

  it('calculates time to resolution', () => {
    const goal = makeGoal();
    const tracker = startGoalTracker(goal);
    // Manually set startedAt to simulate elapsed time
    tracker.startedAt = Date.now() - 5000;

    const telemetry = finalizeGoalTelemetry(tracker, goal);
    expect(telemetry.timeToGoalResolutionMs).toBeGreaterThanOrEqual(4900);
    expect(telemetry.timeToGoalResolutionMs).toBeLessThanOrEqual(6000);
  });
});

// ─── buildImmediateTelemetry ─────────────────────────────

describe('buildImmediateTelemetry', () => {
  it('builds telemetry with zero clarifications', () => {
    const goal = makeGoal({
      completeness: 80,
      endState: 'create',
      audience: 'client',
      format: 'deck',
      thesisHook: 'AI transformation',
    });
    const startMs = Date.now() - 200;

    const telemetry = buildImmediateTelemetry(goal, startMs);
    expect(telemetry.clarificationCount).toBe(0);
    expect(telemetry.fieldsClarified).toEqual([]);
    expect(telemetry.initialCompleteness).toBe(80);
    expect(telemetry.finalCompleteness).toBe(80);
    expect(telemetry.goalEndState).toBe('create');
    expect(telemetry.hadThesisHook).toBe(true);
    expect(telemetry.timeToGoalResolutionMs).toBeGreaterThanOrEqual(100);
  });

  it('captures all inferred fields', () => {
    const goal = makeGoal({
      thesisHook: 'angle',
      audience: 'linkedin',
      format: 'post',
      depthSignal: 'deep',
      emotionalTone: 'playful',
      personalRelevance: 'ongoing theme',
    });

    const telemetry = buildImmediateTelemetry(goal, Date.now());
    expect(telemetry.fieldsInferredFromContext).toContain('thesisHook');
    expect(telemetry.fieldsInferredFromContext).toContain('audience');
    expect(telemetry.fieldsInferredFromContext).toContain('format');
    expect(telemetry.fieldsInferredFromContext).toContain('depthSignal');
    expect(telemetry.fieldsInferredFromContext).toContain('emotionalTone');
    expect(telemetry.fieldsInferredFromContext).toContain('personalRelevance');
  });

  it('reports no thesis hook when absent', () => {
    const goal = makeGoal({ endState: 'bookmark' });
    const telemetry = buildImmediateTelemetry(goal, Date.now());
    expect(telemetry.hadThesisHook).toBe(false);
  });
});

// ─── goalTelemetryToKeywords ─────────────────────────────

describe('goalTelemetryToKeywords', () => {
  it('includes goal endState as keyword', () => {
    const telemetry: GoalTelemetry = {
      initialCompleteness: 70,
      clarificationCount: 0,
      finalCompleteness: 70,
      goalEndState: 'research',
      hadThesisHook: false,
      fieldsInferredFromContext: ['endState'],
      fieldsClarified: [],
      timeToGoalResolutionMs: 100,
    };
    const keywords = goalTelemetryToKeywords(telemetry);
    expect(keywords).toContain('goal/research');
  });

  it('includes audience and format as keywords', () => {
    const telemetry: GoalTelemetry = {
      initialCompleteness: 80,
      clarificationCount: 0,
      finalCompleteness: 80,
      goalEndState: 'create',
      goalAudience: 'linkedin',
      goalFormat: 'thinkpiece',
      hadThesisHook: true,
      fieldsInferredFromContext: [],
      fieldsClarified: [],
      timeToGoalResolutionMs: 100,
    };
    const keywords = goalTelemetryToKeywords(telemetry);
    expect(keywords).toContain('audience/linkedin');
    expect(keywords).toContain('format/thinkpiece');
    expect(keywords).toContain('has-thesis');
  });

  it('marks immediate resolution', () => {
    const telemetry: GoalTelemetry = {
      initialCompleteness: 70,
      clarificationCount: 0,
      finalCompleteness: 70,
      goalEndState: 'bookmark',
      hadThesisHook: false,
      fieldsInferredFromContext: [],
      fieldsClarified: [],
      timeToGoalResolutionMs: 50,
    };
    const keywords = goalTelemetryToKeywords(telemetry);
    expect(keywords).toContain('goal-immediate');
    expect(keywords).not.toContain('goal-clarified-1');
  });

  it('marks clarification count', () => {
    const telemetry: GoalTelemetry = {
      initialCompleteness: 40,
      clarificationCount: 2,
      finalCompleteness: 85,
      goalEndState: 'research',
      hadThesisHook: false,
      fieldsInferredFromContext: [],
      fieldsClarified: ['audience', 'format'],
      timeToGoalResolutionMs: 30000,
    };
    const keywords = goalTelemetryToKeywords(telemetry);
    expect(keywords).toContain('goal-clarified-2');
    expect(keywords).not.toContain('goal-immediate');
  });

  it('omits audience/format when not present', () => {
    const telemetry: GoalTelemetry = {
      initialCompleteness: 70,
      clarificationCount: 0,
      finalCompleteness: 70,
      goalEndState: 'bookmark',
      hadThesisHook: false,
      fieldsInferredFromContext: [],
      fieldsClarified: [],
      timeToGoalResolutionMs: 50,
    };
    const keywords = goalTelemetryToKeywords(telemetry);
    const audienceKeywords = keywords.filter(k => k.startsWith('audience/'));
    const formatKeywords = keywords.filter(k => k.startsWith('format/'));
    expect(audienceKeywords).toHaveLength(0);
    expect(formatKeywords).toHaveLength(0);
  });
});

// ─── goalTelemetryToMetadata ─────────────────────────────

describe('goalTelemetryToMetadata', () => {
  it('includes core metrics', () => {
    const telemetry: GoalTelemetry = {
      initialCompleteness: 40,
      clarificationCount: 1,
      finalCompleteness: 85,
      goalEndState: 'research',
      goalAudience: 'team',
      goalFormat: 'brief',
      hadThesisHook: true,
      fieldsInferredFromContext: ['endState', 'thesisHook'],
      fieldsClarified: ['audience'],
      timeToGoalResolutionMs: 15000,
    };
    const meta = goalTelemetryToMetadata(telemetry);

    expect(meta['Goal End State']).toBe('research');
    expect(meta['Initial Completeness']).toBe('40%');
    expect(meta['Final Completeness']).toBe('85%');
    expect(meta['Clarification Rounds']).toBe('1');
    expect(meta['Time to Goal Resolution']).toBe('15000ms');
    expect(meta['Had Thesis Hook']).toBe('Yes');
    expect(meta['Goal Audience']).toBe('team');
    expect(meta['Goal Format']).toBe('brief');
    expect(meta['Fields Inferred']).toBe('endState, thesisHook');
    expect(meta['Fields Clarified']).toBe('audience');
  });

  it('omits optional fields when absent', () => {
    const telemetry: GoalTelemetry = {
      initialCompleteness: 70,
      clarificationCount: 0,
      finalCompleteness: 70,
      goalEndState: 'bookmark',
      hadThesisHook: false,
      fieldsInferredFromContext: [],
      fieldsClarified: [],
      timeToGoalResolutionMs: 50,
    };
    const meta = goalTelemetryToMetadata(telemetry);

    expect(meta['Goal Audience']).toBeUndefined();
    expect(meta['Goal Format']).toBeUndefined();
    expect(meta['Fields Inferred']).toBeUndefined();
    expect(meta['Fields Clarified']).toBeUndefined();
    expect(meta['Had Thesis Hook']).toBe('No');
  });
});

// ─── End-to-End Scenarios ────────────────────────────────

describe('Telemetry E2E scenarios', () => {
  it('scenario: Jim shares URL, says "research for The Grove" — immediate resolution', () => {
    const goal = makeGoal({
      endState: 'research',
      audience: undefined,
      thesisHook: undefined,
      completeness: 70,
    });
    const startMs = Date.now() - 300;

    const telemetry = buildImmediateTelemetry(goal, startMs);
    const keywords = goalTelemetryToKeywords(telemetry);
    const metadata = goalTelemetryToMetadata(telemetry);

    expect(keywords).toContain('goal/research');
    expect(keywords).toContain('goal-immediate');
    expect(metadata['Goal End State']).toBe('research');
    expect(metadata['Clarification Rounds']).toBe('0');
  });

  it('scenario: Jim shares URL, says "write about this" — clarification loop', () => {
    // Round 1: initial parse
    const initialGoal = makeGoal({
      endState: 'create',
      completeness: 40,
      missingFor: [
        { field: 'audience', question: 'Who is this for?', priority: 1 },
        { field: 'format', question: 'What format?', priority: 2 },
      ],
    });
    const tracker = startGoalTracker(initialGoal);

    // Round 1: Jim answers "for LinkedIn"
    recordClarification(tracker, 'audience');

    // Round 2: Jim answers "thinkpiece"
    recordClarification(tracker, 'format');

    // Final goal after clarification
    const finalGoal = makeGoal({
      endState: 'create',
      audience: 'linkedin',
      format: 'thinkpiece',
      completeness: 90,
    });

    const telemetry = finalizeGoalTelemetry(tracker, finalGoal);
    const keywords = goalTelemetryToKeywords(telemetry);
    const metadata = goalTelemetryToMetadata(telemetry);

    expect(telemetry.initialCompleteness).toBe(40);
    expect(telemetry.finalCompleteness).toBe(90);
    expect(telemetry.clarificationCount).toBe(2);
    expect(keywords).toContain('goal/create');
    expect(keywords).toContain('audience/linkedin');
    expect(keywords).toContain('format/thinkpiece');
    expect(keywords).toContain('goal-clarified-2');
    expect(metadata['Fields Clarified']).toBe('audience, format');
  });

  it('scenario: Jim says "save this" — bookmark, no clarification needed', () => {
    const goal = makeGoal({
      endState: 'bookmark',
      completeness: 90,
    });

    const telemetry = buildImmediateTelemetry(goal, Date.now());
    const keywords = goalTelemetryToKeywords(telemetry);

    expect(keywords).toContain('goal/bookmark');
    expect(keywords).toContain('goal-immediate');
    expect(telemetry.hadThesisHook).toBe(false);
    expect(telemetry.clarificationCount).toBe(0);
  });

  it('scenario: rich signal — "write a thinkpiece about revenge of the B students for LinkedIn"', () => {
    const goal = makeGoal({
      endState: 'create',
      thesisHook: 'revenge of the B students',
      audience: 'linkedin',
      format: 'thinkpiece',
      emotionalTone: 'playful',
      completeness: 95,
    });

    const telemetry = buildImmediateTelemetry(goal, Date.now());
    const keywords = goalTelemetryToKeywords(telemetry);

    expect(keywords).toContain('goal/create');
    expect(keywords).toContain('audience/linkedin');
    expect(keywords).toContain('format/thinkpiece');
    expect(keywords).toContain('has-thesis');
    expect(keywords).toContain('goal-immediate');
    expect(telemetry.fieldsInferredFromContext).toContain('thesisHook');
    expect(telemetry.fieldsInferredFromContext).toContain('emotionalTone');
  });
});
