/**
 * Conversational Intent Resolution — Regression Tests
 *
 * Sprint: CONVERSATIONAL-INTENT-RESOLUTION
 *
 * These tests validate the CORE FIX: replacing brittle regex keyword matching
 * with LLM-based (Claude Haiku) intent interpretation via the IntentInterpreter
 * interface. The fallback regex interpreter is tested here as the deterministic
 * path (no API key in test environment).
 *
 * THE BUG:
 *   Jim says: "Any good market intel here? For grove, or just helping me keep up with trends"
 *   Old regex: matches "just" → capture (WRONG)
 *   New system: matches "intel" + "keep up with trends" → research (CORRECT)
 *
 * Test matrix (from sprint spec):
 *   1. "just helping me keep up" → research (THE FIX)
 *   2. "just save it" → capture (still correct)
 *   3. "research this for the Grove" → research + The Grove
 *   4. "deep research for consulting" → research + deep + Consulting
 *   5. "draft a thinkpiece" → draft + deep
 *   6. "quick summary" → research + quick
 *   7. "blog post about this" → draft + public audience
 *   8. "client deliverable" → research + client audience
 *   9. "save for the garage project" → capture + Home/Garage
 *  10. Button tap: "research" → research (deterministic)
 *  11. Button tap: "capture" → capture (deterministic)
 *  12. Ratchet fallback: HaikuInterpreter error → RegexFallbackInterpreter
 *  13. Training data: logTrainingEntry doesn't throw
 *  14. parseIntentJson: handles valid/invalid JSON gracefully
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import {
  RegexFallbackInterpreter,
  RatchetInterpreter,
  injectInterpreter,
} from '../intent-interpreter';
import { mapAnswer } from '../answer-mapper';
import { injectConfig } from '../notion-config';
import { logTrainingEntry, getTrainingCount } from '../training-collector';
import type {
  InterpretationContext,
  InterpretationResult,
  IntentInterpreter,
  SocraticConfig,
  SocraticQuestion,
  ContextSignals,
} from '../types';

// ==========================================
// Test Fixtures
// ==========================================

const TEST_CONTEXT: InterpretationContext = {
  title: 'Google Research: Prompt Doubling Lifts Accuracy',
  sourceType: 'url',
  targetSlot: 'classification',
  questionText: "What's the play here?",
  existingSignals: {
    intent: 'capture',
    pillar: 'The Grove',
    depth: 'standard',
  },
};

const TEST_CONFIG: SocraticConfig = {
  interviewPrompts: {
    'interview.telegram-spark': {
      id: 'test-spark',
      name: 'Telegram Spark Interview',
      slug: 'interview.telegram-spark',
      type: 'interview_prompt',
      surfaces: ['telegram'],
      active: true,
      priority: 10,
      conditions: "surface === 'telegram'",
      contextSlots: ['content_signals', 'classification'],
      confidenceFloor: 0.5,
      skill: '',
      content: "What's the play here?",
    },
  },
  contextRules: [],
  answerMaps: {},
  thresholds: [],
  fetchedAt: new Date().toISOString(),
};

const TEST_QUESTION: SocraticQuestion = {
  text: "What's the play here?",
  targetSlot: 'classification',
  options: [
    { label: 'Research this', value: 'research' },
    { label: 'Just capture', value: 'capture' },
    { label: 'Draft something', value: 'draft' },
  ],
};

const URL_SIGNALS: ContextSignals = {
  contentSignals: {
    topic: 'Google Research on Prompt Engineering',
    title: 'Google Research: Prompt Doubling Lifts Accuracy',
    hasUrl: true,
    url: 'https://threads.net/example',
    contentLength: 500,
  },
  classification: {
    intent: 'capture',
    pillar: 'The Grove',
    confidence: 0.7,
  },
};

// ==========================================
// Setup
// ==========================================

beforeEach(() => {
  injectConfig(TEST_CONFIG);
  injectInterpreter(null); // Reset to default per-test
});

// ==========================================
// TEST 1: The "just" keyword bug fix
// ==========================================

describe('Conversational Intent — The "just" Bug Fix', () => {
  test('TEST 1: "just helping me keep up with trends" → research, NOT capture', async () => {
    const interpreter = new RegexFallbackInterpreter();
    const result = await interpreter.interpret(
      'Any good market intel here? For grove, or just helping me keep up with trends',
      TEST_CONTEXT,
    );

    // THE FIX: "intel" + research patterns → research
    // Old code matched "just" → capture (WRONG)
    expect(result.interpreted.intent).toBe('research');
    expect(result.method).toBe('regex_fallback');
  });

  test('TEST 2: "just save it" → capture (still correct, via button alias)', async () => {
    const mapped = await mapAnswer('just save it', TEST_QUESTION, URL_SIGNALS, TEST_CONFIG);

    // "save" keyword → capture. The word "just" is no longer the trigger.
    expect(mapped.resolved.intent).toBe('capture');
  });

  test('"just" alone should NOT trigger capture', async () => {
    const interpreter = new RegexFallbackInterpreter();
    const result = await interpreter.interpret(
      'just something to think about for later',
      TEST_CONTEXT,
    );

    // "just" alone is NOT a signal — default capture is from absence of other signals
    // This is the default, not a "just"-triggered match
    expect(result.interpreted.confidence).toBe(0.5); // Default confidence, not matched
  });
});

// ==========================================
// TESTS 3-4: Research intent variants
// ==========================================

describe('Conversational Intent — Research Patterns', () => {
  test('TEST 3: "research this for the Grove" → research + The Grove', async () => {
    const interpreter = new RegexFallbackInterpreter();
    const result = await interpreter.interpret('research this for the Grove', TEST_CONTEXT);

    expect(result.interpreted.intent).toBe('research');
    expect(result.interpreted.pillar).toBe('The Grove');
  });

  test('TEST 4: "deep research for consulting, client deliverable" → research + deep + Consulting', async () => {
    const interpreter = new RegexFallbackInterpreter();
    const result = await interpreter.interpret(
      'deep research for consulting, client deliverable',
      TEST_CONTEXT,
    );

    expect(result.interpreted.intent).toBe('research');
    expect(result.interpreted.depth).toBe('deep');
    expect(result.interpreted.pillar).toBe('Consulting');
    expect(result.interpreted.audience).toBe('client');
  });

  test('TEST 6: "quick summary" → research + quick depth', async () => {
    const interpreter = new RegexFallbackInterpreter();
    const result = await interpreter.interpret('quick summary of this', TEST_CONTEXT);

    // "summary" is a research signal, "quick" sets depth
    expect(result.interpreted.intent).toBe('research');
    expect(result.interpreted.depth).toBe('quick');
  });

  test('TEST 8: "client deliverable" → client audience', async () => {
    const interpreter = new RegexFallbackInterpreter();
    const result = await interpreter.interpret('put together a client deliverable on this', TEST_CONTEXT);

    expect(result.interpreted.audience).toBe('client');
  });

  test('"look into this" → research', async () => {
    const interpreter = new RegexFallbackInterpreter();
    const result = await interpreter.interpret('look into this for me', TEST_CONTEXT);

    expect(result.interpreted.intent).toBe('research');
  });

  test('"dig into this, need analysis" → research', async () => {
    const interpreter = new RegexFallbackInterpreter();
    const result = await interpreter.interpret('dig into this, need some analysis', TEST_CONTEXT);

    expect(result.interpreted.intent).toBe('research');
  });
});

// ==========================================
// TEST 5, 7: Draft intent variants
// ==========================================

describe('Conversational Intent — Draft Patterns', () => {
  test('TEST 5: "draft a thinkpiece" → draft', async () => {
    const interpreter = new RegexFallbackInterpreter();
    const result = await interpreter.interpret('draft a thinkpiece about this', TEST_CONTEXT);

    expect(result.interpreted.intent).toBe('draft');
  });

  test('TEST 7: "blog post about this" → draft + public audience', async () => {
    const interpreter = new RegexFallbackInterpreter();
    const result = await interpreter.interpret('blog post about this topic', TEST_CONTEXT);

    expect(result.interpreted.intent).toBe('draft');
    expect(result.interpreted.audience).toBe('public');
  });

  test('"write a LinkedIn post" → draft + public', async () => {
    const interpreter = new RegexFallbackInterpreter();
    const result = await interpreter.interpret('write a LinkedIn post about this', TEST_CONTEXT);

    expect(result.interpreted.intent).toBe('draft');
    expect(result.interpreted.audience).toBe('public');
  });
});

// ==========================================
// TEST 9: Pillar detection
// ==========================================

describe('Conversational Intent — Pillar Detection', () => {
  test('TEST 9: "save for the garage project" → capture + Home/Garage', async () => {
    const interpreter = new RegexFallbackInterpreter();
    const result = await interpreter.interpret('save for the garage project', TEST_CONTEXT);

    expect(result.interpreted.intent).toBe('capture');
    expect(result.interpreted.pillar).toBe('Home/Garage');
  });

  test('"consulting analysis" → Consulting pillar', async () => {
    const interpreter = new RegexFallbackInterpreter();
    const result = await interpreter.interpret('consulting analysis on this topic', TEST_CONTEXT);

    expect(result.interpreted.pillar).toBe('Consulting');
  });

  test('"personal health research" → Personal pillar', async () => {
    const interpreter = new RegexFallbackInterpreter();
    const result = await interpreter.interpret('personal health research', TEST_CONTEXT);

    expect(result.interpreted.pillar).toBe('Personal');
  });

  test('"AI tech research" → The Grove pillar', async () => {
    const interpreter = new RegexFallbackInterpreter();
    const result = await interpreter.interpret('AI tech research for the future', TEST_CONTEXT);

    expect(result.interpreted.pillar).toBe('The Grove');
  });
});

// ==========================================
// TESTS 10-11: Button tap deterministic path
// ==========================================

describe('Conversational Intent — Button Tap Fast Path', () => {
  test('TEST 10: tapping "research" button → research via alias', async () => {
    const mapped = await mapAnswer('research', TEST_QUESTION, URL_SIGNALS, TEST_CONFIG);

    expect(mapped.resolved.intent).toBe('research');
  });

  test('TEST 11: tapping "capture" button → capture via alias', async () => {
    const mapped = await mapAnswer('capture', TEST_QUESTION, URL_SIGNALS, TEST_CONFIG);

    expect(mapped.resolved.intent).toBe('capture');
  });

  test('tapping "draft" / "thinkpiece" button → draft via alias', async () => {
    const mapped = await mapAnswer('thinkpiece', TEST_QUESTION, URL_SIGNALS, TEST_CONFIG);

    expect(mapped.resolved.intent).toBe('draft');
  });
});

// ==========================================
// TEST 12: Ratchet fallback chain
// ==========================================

describe('Conversational Intent — Ratchet Fallback', () => {
  test('TEST 12: RatchetInterpreter catches primary failure → falls back to regex', async () => {
    // Create a mock primary that always fails
    const failingPrimary: IntentInterpreter = {
      name: 'failing-mock',
      async interpret() {
        throw new Error('Simulated Haiku failure');
      },
    };
    const regexFallback = new RegexFallbackInterpreter();
    const ratchet = new RatchetInterpreter(failingPrimary, regexFallback);

    const result = await ratchet.interpret('research this topic deeply', TEST_CONTEXT);

    // Should have fallen back to regex and resolved correctly
    expect(result.method).toBe('regex_fallback');
    expect(result.interpreted.intent).toBe('research');
    expect(result.interpreted.depth).toBe('deep');
  });

  test('RatchetInterpreter returns primary result when it succeeds', async () => {
    // Create a mock primary that succeeds
    const successPrimary: IntentInterpreter = {
      name: 'success-mock',
      async interpret() {
        return {
          interpreted: {
            intent: 'research',
            depth: 'deep',
            audience: 'self',
            confidence: 0.95,
            reasoning: 'Mock success',
          },
          method: 'haiku' as const,
          latencyMs: 50,
        };
      },
    };
    const regexFallback = new RegexFallbackInterpreter();
    const ratchet = new RatchetInterpreter(successPrimary, regexFallback);

    const result = await ratchet.interpret('anything', TEST_CONTEXT);

    expect(result.method).toBe('haiku');
    expect(result.interpreted.confidence).toBe(0.95);
  });
});

// ==========================================
// TEST 13: Training data collection
// ==========================================

describe('Conversational Intent — Training Data', () => {
  test('TEST 13: logTrainingEntry does not throw', () => {
    const primaryResult: InterpretationResult = {
      interpreted: {
        intent: 'research',
        depth: 'standard',
        audience: 'self',
        confidence: 0.85,
        reasoning: 'Test',
      },
      method: 'haiku',
      latencyMs: 150,
    };
    const regexResult: InterpretationResult = {
      interpreted: {
        intent: 'capture',
        depth: 'standard',
        audience: 'self',
        confidence: 0.5,
        reasoning: 'Regex fallback',
      },
      method: 'regex_fallback',
      latencyMs: 1,
    };

    // Must not throw — training collection is non-critical
    expect(() => logTrainingEntry('test answer', TEST_CONTEXT, primaryResult, regexResult)).not.toThrow();
  });
});

// ==========================================
// Answer Mapper Integration
// ==========================================

describe('Conversational Intent — Answer Mapper Integration', () => {
  test('mapAnswer preserves userDirection in extraContext', async () => {
    const answer = 'Research this for the Grove, could be great thinkpiece material';
    const mapped = await mapAnswer(answer, TEST_QUESTION, URL_SIGNALS, TEST_CONFIG);

    expect(mapped.resolved.extraContext?.userDirection).toBe(answer);
  });

  test('mapAnswer includes interpretation method in extraContext', async () => {
    const mapped = await mapAnswer(
      'investigate this deeply',
      TEST_QUESTION,
      URL_SIGNALS,
      TEST_CONFIG,
    );

    // In test env (no ANTHROPIC_API_KEY), falls back to regex
    expect(mapped.resolved.extraContext?.interpretationMethod).toBeDefined();
  });

  test('mapAnswer computes updated confidence after answer', async () => {
    const mapped = await mapAnswer(
      'research for the Grove',
      TEST_QUESTION,
      URL_SIGNALS,
      TEST_CONFIG,
    );

    // Confidence should be a number between 0 and 1
    expect(mapped.newConfidence).toBeGreaterThan(0);
    expect(mapped.newConfidence).toBeLessThanOrEqual(1);
  });

  test('mapAnswer resolves pillar from natural language', async () => {
    const mapped = await mapAnswer(
      'deep research for consulting team',
      TEST_QUESTION,
      URL_SIGNALS,
      TEST_CONFIG,
    );

    expect(mapped.resolved.pillar).toBe('Consulting');
  });
});

// ==========================================
// Edge Cases
// ==========================================

describe('Conversational Intent — Edge Cases', () => {
  test('empty answer defaults to capture with low confidence', async () => {
    const interpreter = new RegexFallbackInterpreter();
    const result = await interpreter.interpret('', TEST_CONTEXT);

    expect(result.interpreted.intent).toBe('capture');
    expect(result.interpreted.confidence).toBe(0.5);
  });

  test('mixed signals: "research but keep it quick" → research + quick', async () => {
    const interpreter = new RegexFallbackInterpreter();
    const result = await interpreter.interpret('research but keep it quick', TEST_CONTEXT);

    expect(result.interpreted.intent).toBe('research');
    expect(result.interpreted.depth).toBe('quick');
  });

  test('mixed signals: "deep draft for consulting" → draft + deep + Consulting', async () => {
    const interpreter = new RegexFallbackInterpreter();
    const result = await interpreter.interpret('deep draft for consulting audience', TEST_CONTEXT);

    expect(result.interpreted.intent).toBe('draft');
    expect(result.interpreted.depth).toBe('deep');
    expect(result.interpreted.pillar).toBe('Consulting');
  });

  test('latencyMs is tracked', async () => {
    const interpreter = new RegexFallbackInterpreter();
    const result = await interpreter.interpret('research this', TEST_CONTEXT);

    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.latencyMs).toBeLessThan(100); // Regex should be sub-ms
  });
});
