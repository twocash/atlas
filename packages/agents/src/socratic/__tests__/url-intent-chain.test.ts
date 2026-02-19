/**
 * URL Intent Chain Tests — Socratic "What's the Play?" Flow
 *
 * Sprint: SOCRATIC-URL-INTENT
 *
 * Tests the COMPLETE chain for URL shares:
 *   signals → assessContext → analyzeGaps → generateQuestions → mapAnswer → resolved
 *
 * Uses real-world scenarios from actual Atlas usage:
 * - Threads post about Google Research paper
 * - Bring a Trailer vehicle listing
 * - ArXiv AI paper
 * - Generic blog post
 *
 * CRITICAL: These tests verify the NEW chain, not legacy behavior.
 * If these tests pass but legacy tests break, that's expected and correct.
 */

import { describe, test, expect } from 'bun:test';
import { assessContext } from '../context-assessor';
import { analyzeGaps } from '../gap-analyzer';
import { generateQuestions } from '../question-generator';
import { mapAnswer } from '../answer-mapper';
import { injectConfig } from '../notion-config';
import type { ContextSignals, SocraticConfig } from '../types';

// ==========================================
// Test Config (mimics Notion Socratic Config)
// ==========================================

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
      content: `You are assessing a spark that Jim shared via Telegram.
What's the play here?
A) Research this topic
B) Draft content about it
C) Just capture for reference`,
    },
  },
  contextRules: [],
  answerMaps: {},
  thresholds: [],
  fetchedAt: new Date().toISOString(),
};

// ==========================================
// Helper: Build URL share signals
// ==========================================

function buildUrlSignals(overrides: {
  fetchedTitle?: string;
  triagePillar?: string;
  triageConfidence?: number;
}): ContextSignals {
  return {
    contentSignals: {
      topic: overrides.fetchedTitle || 'Unknown content',
      title: overrides.fetchedTitle || 'Unknown content',
      hasUrl: true,
      url: 'https://example.com/article',
      contentLength: 500,
    },
    classification: {
      intent: 'capture',
      pillar: (overrides.triagePillar as any) || 'The Grove',
      confidence: overrides.triageConfidence ?? 0.7,
    },
    // No contactData — URL shares don't have contact context
    // No bridgeContext — URL shares don't have prior interaction context
    // No skillRequirements — no specific skill invoked
  };
}

// ==========================================
// CHAIN TEST 1: URLs Never Auto-Draft
// ==========================================

describe('URL Intent Chain — Confidence Ceiling', () => {
  test('URL shares NEVER reach auto_draft regime even with high signals', () => {
    // Scenario: Everything is high confidence — should still ask
    const signals = buildUrlSignals({
      fetchedTitle: 'OpenAI Announces GPT-5',
      triagePillar: 'The Grove',
      triageConfidence: 0.95,
    });

    const assessment = assessContext(signals);

    // CRITICAL: Must NOT be auto_draft. URLs always get asked.
    expect(assessment.regime).not.toBe('auto_draft');
    expect(assessment.overallConfidence).toBeLessThan(0.85);
  });

  test('URL shares enter ask_one regime (confidence 0.5-0.84)', () => {
    const signals = buildUrlSignals({
      fetchedTitle: 'Interesting Article About AI Safety',
      triagePillar: 'The Grove',
      triageConfidence: 0.8,
    });

    const assessment = assessContext(signals);

    expect(assessment.regime).toBe('ask_one');
  });
});

// ==========================================
// CHAIN TEST 2: Bridge Context Bypass
// ==========================================

describe('URL Intent Chain — Bridge Context Bypass', () => {
  test('bridge_context scores 1.0 for URL shares (no gap generated)', () => {
    const signals = buildUrlSignals({
      fetchedTitle: 'Some Article',
    });

    const assessment = assessContext(signals);

    // Find bridge_context slot
    const bridgeSlot = assessment.slots.find(s => s.slot === 'bridge_context');
    expect(bridgeSlot).toBeDefined();
    expect(bridgeSlot!.completeness).toBe(1);
    expect(bridgeSlot!.gaps).toHaveLength(0);
  });

  test('contact_data also scores 1.0 for URL shares (existing behavior)', () => {
    const signals = buildUrlSignals({
      fetchedTitle: 'Some Article',
    });

    const assessment = assessContext(signals);

    const contactSlot = assessment.slots.find(s => s.slot === 'contact_data');
    expect(contactSlot).toBeDefined();
    expect(contactSlot!.completeness).toBe(1);
  });

  test('top gaps do NOT include bridge_context or contact_data for URLs', () => {
    const signals = buildUrlSignals({
      fetchedTitle: 'Some Article',
    });

    const assessment = assessContext(signals);

    const gapSlots = assessment.topGaps.map(g => g.slot);
    expect(gapSlots).not.toContain('bridge_context');
    expect(gapSlots).not.toContain('contact_data');
  });
});

// ==========================================
// CHAIN TEST 3: "What's the Play?" Question
// ==========================================

describe('URL Intent Chain — Question Generation', () => {
  test("URL share generates \"What's the play?\" question, not bridge context question", () => {
    injectConfig(TEST_CONFIG);

    const signals = buildUrlSignals({
      fetchedTitle: 'Google Research: Prompt Doubling Lifts Accuracy',
      triageConfidence: 0.7,
    });

    const assessment = assessContext(signals);
    const gaps = analyzeGaps(assessment, TEST_CONFIG, 'telegram');
    const questions = generateQuestions(gaps, signals);

    expect(questions.length).toBeGreaterThan(0);

    const q = questions[0];
    // Must NOT be the bridge_context default
    expect(q.text).not.toContain('recent context');
    expect(q.text).not.toContain('Recent conversation');

    // Should be the URL intent question
    expect(q.text).toContain("What's the play");

    // Target slot should be content_signals or classification, NOT bridge_context
    expect(['content_signals', 'classification']).toContain(q.targetSlot);
  });

  test('Non-URL text messages still get normal questions (no regression)', () => {
    injectConfig(TEST_CONFIG);

    const signals: ContextSignals = {
      contentSignals: {
        topic: 'random thought about AI',
        title: 'random thought about AI',
        hasUrl: false,
        contentLength: 30,
      },
      // No classification — low confidence scenario
    };

    const assessment = assessContext(signals);

    // Non-URL should NOT be capped
    // (it may or may not be auto_draft depending on scores — that's fine)
    // Just verify bridge_context is NOT bypassed for non-URLs
    const bridgeSlot = assessment.slots.find(s => s.slot === 'bridge_context');
    expect(bridgeSlot!.completeness).toBe(0); // No bridge data, not bypassed
  });
});

// ==========================================
// CHAIN TEST 4: Natural Language Answer Parsing
// ==========================================

describe('URL Intent Chain — Answer Mapping', () => {
  test('parses "Research for the Grove, thinkpiece material" correctly', () => {
    injectConfig(TEST_CONFIG);

    const signals = buildUrlSignals({
      fetchedTitle: 'Google Research: Prompt Doubling',
      triageConfidence: 0.7,
    });

    const assessment = assessContext(signals);
    const gaps = analyzeGaps(assessment, TEST_CONFIG, 'telegram');
    const questions = generateQuestions(gaps, signals);

    const answer = 'Research for the Grove, thinkpiece material on prompt engineering';
    const mapped = mapAnswer(answer, questions[0], signals, TEST_CONFIG);

    expect(mapped.resolved.intent).toBe('research');
    expect(mapped.resolved.pillar).toBe('The Grove');
    expect(mapped.resolved.extraContext?.userDirection).toBe(answer);
  });

  test('parses "just save it" as capture intent', () => {
    injectConfig(TEST_CONFIG);

    const signals = buildUrlSignals({ fetchedTitle: 'Some Article' });
    const assessment = assessContext(signals);
    const gaps = analyzeGaps(assessment, TEST_CONFIG, 'telegram');
    const questions = generateQuestions(gaps, signals);

    const mapped = mapAnswer('just save it', questions[0], signals, TEST_CONFIG);

    expect(mapped.resolved.intent).toBe('capture');
  });

  test('parses "deep research for consulting" with depth + pillar', () => {
    injectConfig(TEST_CONFIG);

    const signals = buildUrlSignals({ fetchedTitle: 'Market Analysis Report' });
    const assessment = assessContext(signals);
    const gaps = analyzeGaps(assessment, TEST_CONFIG, 'telegram');
    const questions = generateQuestions(gaps, signals);

    const mapped = mapAnswer('deep research for consulting, client deliverable', questions[0], signals, TEST_CONFIG);

    expect(mapped.resolved.intent).toBe('research');
    expect(mapped.resolved.pillar).toBe('Consulting');
    expect(mapped.resolved.depth).toBe('deep');
  });

  test('tapping "Research this" button option still works', () => {
    injectConfig(TEST_CONFIG);

    const signals = buildUrlSignals({ fetchedTitle: 'Article' });
    const assessment = assessContext(signals);
    const gaps = analyzeGaps(assessment, TEST_CONFIG, 'telegram');
    const questions = generateQuestions(gaps, signals);

    // Simulate tapping the button (value from option)
    const mapped = mapAnswer('research', questions[0], signals, TEST_CONFIG);

    expect(mapped.resolved.intent).toBe('research');
  });

  test('handles vehicle content routed to Home/Garage', () => {
    injectConfig(TEST_CONFIG);

    const signals = buildUrlSignals({
      fetchedTitle: '1986 Mercedes-Benz 300E on Bring a Trailer',
      triagePillar: 'Home/Garage',
    });
    const assessment = assessContext(signals);
    const gaps = analyzeGaps(assessment, TEST_CONFIG, 'telegram');
    const questions = generateQuestions(gaps, signals);

    const mapped = mapAnswer('just save this, garage project research', questions[0], signals, TEST_CONFIG);

    expect(mapped.resolved.pillar).toBe('Home/Garage');
  });
});

// ==========================================
// CHAIN TEST 5: Full End-to-End Scenario
// ==========================================

describe('URL Intent Chain — Full Scenario', () => {
  test('Threads post about Google Research paper → correct research query ingredients', () => {
    injectConfig(TEST_CONFIG);

    // Step 1: Build signals (what socratic-adapter.ts produces after fetch)
    const signals = buildUrlSignals({
      fetchedTitle: 'Google Research: Prompt Doubling Lifts Accuracy from 21% to 97%',
      triagePillar: 'The Grove',
      triageConfidence: 0.75,
    });

    // Step 2: Assess → must be ask_one, not auto_draft
    const assessment = assessContext(signals);
    expect(assessment.regime).toBe('ask_one');

    // Step 3: Generate question → must be "What's the play?"
    const gaps = analyzeGaps(assessment, TEST_CONFIG, 'telegram');
    expect(gaps.questionCount).toBe(1);
    const questions = generateQuestions(gaps, signals);
    expect(questions[0].text).toContain("What's the play");

    // Step 4: Map Jim's answer
    const mapped = mapAnswer(
      'Research this for the Grove, could be a great thinkpiece on prompt engineering techniques',
      questions[0],
      signals,
      TEST_CONFIG,
    );

    // Step 5: Verify resolved context has everything downstream needs
    expect(mapped.resolved.intent).toBe('research');
    expect(mapped.resolved.pillar).toBe('The Grove');
    expect(mapped.resolved.extraContext?.userDirection).toContain('thinkpiece');
    expect(mapped.resolved.extraContext?.userDirection).toContain('prompt engineering');

    // Step 6: Verify new confidence resolves the session
    // (answer should boost confidence above 0.85 threshold in engine.ts)
    expect(mapped.newConfidence).toBeGreaterThanOrEqual(0.85);
  });
});
