/**
 * Intent Interpreter Regression Tests — Autonomaton Loop 1
 *
 * Sprint: SESSION-TELEMETRY-QA
 *
 * These tests prove that the RatchetInterpreter's failure path is WIRED
 * to `reportFailure()` — the Haiku 404 bug can never happen again silently.
 *
 * Test matrix:
 *   1. RatchetInterpreter falls back to regex when primary throws
 *   2. reportFailure() is called with correct subsystem + context on primary failure
 *   3. degradedFrom field is set when fallback is used
 *   4. Consecutive failure counter increments across calls
 *   5. Regex fallback produces valid InterpretationResult structure
 *   6. Successful primary call resets consecutive failure counter
 *
 * The canonical failure: ATLAS_INTENT_MODEL pointed to a deprecated model.
 * Haiku returned 404. The regex fallback silently handled it. Jim didn't
 * know for DAYS that the LLM path was dead.
 */

import { describe, test, expect, beforeEach, mock } from 'bun:test';
import {
  RegexFallbackInterpreter,
  RatchetInterpreter,
} from '../src/socratic/intent-interpreter';
import type {
  IntentInterpreter,
  InterpretationContext,
  InterpretationResult,
} from '../src/socratic/types';

// ─── Mock reportFailure ──────────────────────────────────

const reportFailureCalls: Array<{
  subsystem: string;
  error: unknown;
  context: Record<string, unknown>;
}> = [];

// Mock the module BEFORE imports resolve
mock.module('@atlas/shared/error-escalation', () => ({
  reportFailure: (subsystem: string, error: unknown, context?: Record<string, unknown>) => {
    reportFailureCalls.push({ subsystem, error, context: context ?? {} });
  },
}));

// ─── Test fixtures ───────────────────────────────────────

const testContext: InterpretationContext = {
  title: 'Test Article About AI',
  sourceType: 'url',
  targetSlot: 'classification',
  questionText: "What's the play?",
};

/** A primary interpreter that always throws (simulates Haiku 404) */
class FailingInterpreter implements IntentInterpreter {
  readonly name = 'failing_haiku';
  async interpret(): Promise<InterpretationResult> {
    throw new Error('HTTP 404: model not found (claude-nonexistent-model)');
  }
}

/** A primary interpreter that always succeeds */
class SucceedingInterpreter implements IntentInterpreter {
  readonly name = 'mock_haiku';
  async interpret(answer: string): Promise<InterpretationResult> {
    return {
      interpreted: {
        intent: 'research',
        depth: 'standard',
        audience: 'self',
        confidence: 0.95,
        reasoning: 'Mock haiku interpreted this as research',
      },
      method: 'haiku',
      latencyMs: 42,
      rawResponse: '{"intent":"research"}',
    };
  }
}

// ─── Tests ───────────────────────────────────────────────

describe('Intent Interpreter Regression — Autonomaton Loop 1', () => {
  beforeEach(() => {
    reportFailureCalls.length = 0;
  });

  test('1. RatchetInterpreter falls back to regex when primary throws', async () => {
    const ratchet = new RatchetInterpreter(
      new FailingInterpreter(),
      new RegexFallbackInterpreter(),
    );

    const result = await ratchet.interpret('research this for me', testContext);

    // Should not throw — graceful fallback
    expect(result).toBeDefined();
    expect(result.method).toBe('regex_fallback');
    expect(result.interpreted.intent).toBe('research');
  });

  test('2. reportFailure() is called with correct subsystem and diagnostic context', async () => {
    const ratchet = new RatchetInterpreter(
      new FailingInterpreter(),
      new RegexFallbackInterpreter(),
    );

    await ratchet.interpret('check this out', testContext);

    // reportFailure MUST have fired
    expect(reportFailureCalls.length).toBeGreaterThanOrEqual(1);

    const call = reportFailureCalls[0];
    expect(call.subsystem).toBe('intent-interpreter');

    // Error object passed through
    expect(call.error).toBeInstanceOf(Error);
    expect((call.error as Error).message).toContain('404');

    // Context includes diagnostic breadcrumbs
    expect(call.context.model).toBeDefined();
    expect(call.context.consecutiveFailures).toBe(1);
    expect(call.context.primaryInterpreter).toBe('failing_haiku');
    expect(call.context.fallbackInterpreter).toBe('regex_fallback');
    expect(call.context.suggestedFix).toBeDefined();
    expect(typeof call.context.suggestedFix).toBe('string');
    expect((call.context.suggestedFix as string).length).toBeGreaterThan(10);
    expect(call.context.timestamp).toBeDefined();
  });

  test('3. degradedFrom field is set when fallback is used', async () => {
    const ratchet = new RatchetInterpreter(
      new FailingInterpreter(),
      new RegexFallbackInterpreter(),
    );

    const result = await ratchet.interpret('just save this', testContext);

    expect(result.degradedFrom).toBe('failing_haiku');
    expect(result.method).toBe('regex_fallback');
  });

  test('4. Consecutive failure counter increments across calls', async () => {
    const ratchet = new RatchetInterpreter(
      new FailingInterpreter(),
      new RegexFallbackInterpreter(),
    );

    // Three consecutive failures
    await ratchet.interpret('first call', testContext);
    await ratchet.interpret('second call', testContext);
    await ratchet.interpret('third call', testContext);

    expect(reportFailureCalls.length).toBe(3);
    expect(reportFailureCalls[0].context.consecutiveFailures).toBe(1);
    expect(reportFailureCalls[1].context.consecutiveFailures).toBe(2);
    expect(reportFailureCalls[2].context.consecutiveFailures).toBe(3);
  });

  test('5. Regex fallback produces valid InterpretationResult structure', async () => {
    const regex = new RegexFallbackInterpreter();
    const result = await regex.interpret('deep research for the grove', testContext);

    expect(result.interpreted).toBeDefined();
    expect(result.interpreted.intent).toBe('research');
    expect(result.interpreted.depth).toBe('deep');
    expect(result.interpreted.pillar).toBe('The Grove');
    expect(result.method).toBe('regex_fallback');
    expect(typeof result.latencyMs).toBe('number');
    expect(result.interpreted.confidence).toBeGreaterThan(0);
    expect(result.interpreted.confidence).toBeLessThanOrEqual(1);
  });

  test('6. Successful primary call resets consecutive failure counter', async () => {
    // Start with a failing primary, switch mid-test
    let shouldFail = true;
    const switchableInterpreter: IntentInterpreter = {
      name: 'switchable',
      async interpret(answer: string): Promise<InterpretationResult> {
        if (shouldFail) {
          throw new Error('Temporary failure');
        }
        return {
          interpreted: {
            intent: 'research',
            depth: 'standard',
            audience: 'self',
            confidence: 0.9,
            reasoning: 'Success',
          },
          method: 'haiku',
          latencyMs: 50,
        };
      },
    };

    const ratchet = new RatchetInterpreter(
      switchableInterpreter,
      new RegexFallbackInterpreter(),
    );

    // Fail twice
    await ratchet.interpret('first failure', testContext);
    await ratchet.interpret('second failure', testContext);
    expect(reportFailureCalls[1].context.consecutiveFailures).toBe(2);

    // Now succeed
    shouldFail = false;
    const successResult = await ratchet.interpret('now it works', testContext);
    expect(successResult.method).toBe('haiku');
    expect(successResult.degradedFrom).toBeUndefined();

    // Fail again — counter should be back to 1
    shouldFail = true;
    reportFailureCalls.length = 0;
    await ratchet.interpret('fails again', testContext);
    expect(reportFailureCalls[0].context.consecutiveFailures).toBe(1);
  });

  test('7. Message preview is truncated for safety (no full user messages in error context)', async () => {
    const ratchet = new RatchetInterpreter(
      new FailingInterpreter(),
      new RegexFallbackInterpreter(),
    );

    const longMessage = 'a'.repeat(500);
    await ratchet.interpret(longMessage, testContext);

    const preview = reportFailureCalls[0].context.messagePreview as string;
    expect(preview.length).toBeLessThanOrEqual(200);
  });
});
