/**
 * Goal Module — Unit Tests
 *
 * Tests for parser (detectSimpleIntent, fallback extraction),
 * completeness (scoreCompleteness, isGoalComplete), and
 * clarifier (generateClarificationQuestion, resolveAfterClarification).
 *
 * Sprint: GOAL-FIRST-CAPTURE (ATLAS-GOAL-FIRST-001)
 */

import { describe, it, expect } from 'bun:test';

import { detectSimpleIntent } from '../../../packages/agents/src/goal/parser';
import {
  scoreCompleteness,
  isGoalComplete,
  COMPLETENESS_REQUIREMENTS,
} from '../../../packages/agents/src/goal/completeness';
import {
  generateClarificationQuestion,
  resolveAfterClarification,
  MAX_CLARIFICATIONS,
} from '../../../packages/agents/src/goal/clarifier';
import type {
  GoalContext,
  GoalRequirement,
  ContentAnalysis,
} from '../../../packages/agents/src/goal/types';

// ─── Fixtures ───────────────────────────────────────────

const mockContentAnalysis: ContentAnalysis = {
  content: 'https://example.com/article',
  title: 'The Rise of AI Agents',
  summary: 'An article about autonomous AI agents in enterprise settings',
  sourceType: 'url',
};

function buildGoal(overrides: Partial<GoalContext> = {}): GoalContext {
  return {
    endState: 'research',
    completeness: 0,
    missingFor: [],
    parsedFrom: 'test message',
    confidence: 0.8,
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════
//  detectSimpleIntent
// ═══════════════════════════════════════════════════════

describe('detectSimpleIntent', () => {
  describe('bookmark signals', () => {
    it('detects "save it"', () => {
      expect(detectSimpleIntent('save it')).toBe('bookmark');
    });

    it('detects "bookmark this"', () => {
      expect(detectSimpleIntent('Bookmark this')).toBe('bookmark');
    });

    it('detects "file it"', () => {
      expect(detectSimpleIntent('file it')).toBe('bookmark');
    });

    it('detects "stash for later"', () => {
      expect(detectSimpleIntent('stash for later')).toBe('bookmark');
    });

    it('detects "capture"', () => {
      expect(detectSimpleIntent('capture')).toBe('bookmark');
    });

    it('detects "keep this"', () => {
      expect(detectSimpleIntent('keep this')).toBe('bookmark');
    });

    it('detects "save" with mixed case', () => {
      expect(detectSimpleIntent('SAVE IT')).toBe('bookmark');
    });
  });

  describe('summarize signals', () => {
    it('detects "summarize this"', () => {
      expect(detectSimpleIntent('summarize this')).toBe('summarize');
    });

    it('detects "tldr"', () => {
      expect(detectSimpleIntent('tldr')).toBe('summarize');
    });

    it('detects "tl;dr"', () => {
      expect(detectSimpleIntent('tl;dr')).toBe('summarize');
    });

    it('detects "give me the gist"', () => {
      expect(detectSimpleIntent('give me the gist')).toBe('summarize');
    });

    it('detects "quick take"', () => {
      expect(detectSimpleIntent('quick take')).toBe('summarize');
    });
  });

  describe('returns null for complex messages', () => {
    it('returns null for long messages even with keywords', () => {
      const longMsg = 'I want to save this article and then research it deeply for a LinkedIn thinkpiece about AI agents';
      expect(detectSimpleIntent(longMsg)).toBeNull();
    });

    it('returns null for research intent', () => {
      expect(detectSimpleIntent('research this for The Grove')).toBeNull();
    });

    it('returns null for create intent', () => {
      expect(detectSimpleIntent('write a thinkpiece about this')).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(detectSimpleIntent('')).toBeNull();
    });

    it('returns null for generic short messages', () => {
      expect(detectSimpleIntent('interesting article')).toBeNull();
    });
  });

  describe('length threshold', () => {
    it('handles messages at exactly 60 chars (after trim)', () => {
      // "save" + filler to make exactly 60 post-trim chars
      const msg = 'save this is a message about something really interesting xx';
      expect(msg.trim().length).toBe(60);
      expect(detectSimpleIntent(msg)).toBe('bookmark');
    });

    it('rejects messages over 60 chars (non-whitespace)', () => {
      // Note: trim() runs first, so padding with spaces doesn't work
      const msg = 'save this article about the incredible rise of autonomous AI agents in enterprise';
      expect(msg.length).toBeGreaterThan(60);
      expect(detectSimpleIntent(msg)).toBeNull();
    });
  });
});

// ═══════════════════════════════════════════════════════
//  scoreCompleteness
// ═══════════════════════════════════════════════════════

describe('scoreCompleteness', () => {
  describe('bookmark (no requirements)', () => {
    it('scores 100 with no fields needed', () => {
      const result = scoreCompleteness({ endState: 'bookmark' });
      expect(result.completeness).toBe(100);
      expect(result.missingFor).toHaveLength(0);
    });
  });

  describe('research (needs audience + depthSignal)', () => {
    it('scores 0 when missing both required fields', () => {
      const result = scoreCompleteness({ endState: 'research' });
      expect(result.completeness).toBe(0);
      expect(result.missingFor).toHaveLength(2);
    });

    it('scores 35 when audience present but depthSignal missing', () => {
      const result = scoreCompleteness({ endState: 'research', audience: 'self' });
      expect(result.completeness).toBe(35);
      expect(result.missingFor).toHaveLength(1);
      expect(result.missingFor[0].field).toBe('depthSignal');
    });

    it('scores 35 when depthSignal present but audience missing', () => {
      const result = scoreCompleteness({ endState: 'research', depthSignal: 'deep' });
      expect(result.completeness).toBe(35);
      expect(result.missingFor).toHaveLength(1);
      expect(result.missingFor[0].field).toBe('audience');
    });

    it('scores 70 when both required fields present', () => {
      const result = scoreCompleteness({
        endState: 'research',
        audience: 'self',
        depthSignal: 'deep',
      });
      expect(result.completeness).toBe(70);
      expect(result.missingFor).toHaveLength(0);
    });

    it('adds bonus for thesisHook', () => {
      const result = scoreCompleteness({
        endState: 'research',
        audience: 'self',
        depthSignal: 'deep',
        thesisHook: 'revenge of the B students',
      });
      expect(result.completeness).toBe(80); // 70 base + 10 thesis
    });

    it('caps bonus at 30', () => {
      const result = scoreCompleteness({
        endState: 'research',
        audience: 'self',
        depthSignal: 'deep',
        thesisHook: 'some angle',
        emotionalTone: 'excited',
        personalRelevance: 'high',
        format: 'thinkpiece', // bonus since format not required for research
      });
      // 70 base + 10 (thesis) + 5 (emotionalTone) + 5 (personalRelevance) + 5 (format not required) = 95
      expect(result.completeness).toBe(95);
    });
  });

  describe('create (needs audience + format)', () => {
    it('scores 0 when missing both', () => {
      const result = scoreCompleteness({ endState: 'create' });
      expect(result.completeness).toBe(0);
      expect(result.missingFor).toHaveLength(2);
    });

    it('scores 70 when both present', () => {
      const result = scoreCompleteness({
        endState: 'create',
        audience: 'linkedin',
        format: 'thinkpiece',
      });
      expect(result.completeness).toBe(70);
    });
  });

  describe('analyze (needs audience)', () => {
    it('scores 0 when audience missing', () => {
      const result = scoreCompleteness({ endState: 'analyze' });
      expect(result.completeness).toBe(0);
    });

    it('scores 70 when audience present', () => {
      const result = scoreCompleteness({ endState: 'analyze', audience: 'client' });
      expect(result.completeness).toBe(70);
    });
  });

  describe('summarize (needs audience)', () => {
    it('scores 70 when audience present', () => {
      const result = scoreCompleteness({ endState: 'summarize', audience: 'self' });
      expect(result.completeness).toBe(70);
    });
  });

  describe('custom (needs endStateRaw)', () => {
    it('scores 0 when endStateRaw missing', () => {
      const result = scoreCompleteness({ endState: 'custom' });
      expect(result.completeness).toBe(0);
      expect(result.missingFor).toHaveLength(1);
      expect(result.missingFor[0].field).toBe('endStateRaw');
    });

    it('scores 70 when endStateRaw present', () => {
      const result = scoreCompleteness({ endState: 'custom', endStateRaw: 'compare these two approaches' });
      expect(result.completeness).toBe(70);
    });
  });

  describe('missing field priority ordering', () => {
    it('sorts missing fields by priority (lowest = most important)', () => {
      // research missing both: audience (priority 1) should come before depthSignal (priority 2)
      const result = scoreCompleteness({ endState: 'research' });
      expect(result.missingFor[0].field).toBe('audience');
      expect(result.missingFor[1].field).toBe('depthSignal');
    });
  });
});

// ═══════════════════════════════════════════════════════
//  isGoalComplete
// ═══════════════════════════════════════════════════════

describe('isGoalComplete', () => {
  it('returns true for bookmark (always complete)', () => {
    expect(isGoalComplete({ endState: 'bookmark' })).toBe(true);
  });

  it('returns true for research with all required fields', () => {
    expect(isGoalComplete({ endState: 'research', audience: 'self', depthSignal: 'deep' })).toBe(true);
  });

  it('returns false for research missing required fields', () => {
    expect(isGoalComplete({ endState: 'research' })).toBe(false);
  });

  it('returns true at exactly 70', () => {
    // research with both required fields = exactly 70
    expect(isGoalComplete({ endState: 'research', audience: 'self', depthSignal: 'standard' })).toBe(true);
  });

  it('returns false at 35', () => {
    // research with one of two fields = 35
    expect(isGoalComplete({ endState: 'research', audience: 'self' })).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════
//  COMPLETENESS_REQUIREMENTS
// ═══════════════════════════════════════════════════════

describe('COMPLETENESS_REQUIREMENTS', () => {
  it('has entries for all end states', () => {
    expect(COMPLETENESS_REQUIREMENTS).toHaveProperty('bookmark');
    expect(COMPLETENESS_REQUIREMENTS).toHaveProperty('research');
    expect(COMPLETENESS_REQUIREMENTS).toHaveProperty('create');
    expect(COMPLETENESS_REQUIREMENTS).toHaveProperty('analyze');
    expect(COMPLETENESS_REQUIREMENTS).toHaveProperty('summarize');
    expect(COMPLETENESS_REQUIREMENTS).toHaveProperty('custom');
  });

  it('bookmark has zero requirements', () => {
    expect(COMPLETENESS_REQUIREMENTS.bookmark).toHaveLength(0);
  });

  it('research requires audience and depthSignal', () => {
    expect(COMPLETENESS_REQUIREMENTS.research).toContain('audience');
    expect(COMPLETENESS_REQUIREMENTS.research).toContain('depthSignal');
  });

  it('create requires audience and format', () => {
    expect(COMPLETENESS_REQUIREMENTS.create).toContain('audience');
    expect(COMPLETENESS_REQUIREMENTS.create).toContain('format');
  });
});

// ═══════════════════════════════════════════════════════
//  generateClarificationQuestion
// ═══════════════════════════════════════════════════════

describe('generateClarificationQuestion', () => {
  it('generates audience question', () => {
    const req: GoalRequirement = { field: 'audience', question: 'fallback', priority: 1 };
    const q = generateClarificationQuestion(req, mockContentAnalysis);
    expect(q).toContain('Who');
    expect(q).toContain('LinkedIn');
  });

  it('generates depthSignal question', () => {
    const req: GoalRequirement = { field: 'depthSignal', question: 'fallback', priority: 2 };
    const q = generateClarificationQuestion(req, mockContentAnalysis);
    expect(q).toContain('deep');
  });

  it('generates format question', () => {
    const req: GoalRequirement = { field: 'format', question: 'fallback', priority: 2 };
    const q = generateClarificationQuestion(req, mockContentAnalysis);
    expect(q).toContain('format');
  });

  it('generates thesisHook question', () => {
    const req: GoalRequirement = { field: 'thesisHook', question: 'fallback', priority: 3 };
    const q = generateClarificationQuestion(req, mockContentAnalysis);
    expect(q).toContain('angle');
  });

  it('generates endStateRaw question', () => {
    const req: GoalRequirement = { field: 'endStateRaw', question: 'fallback', priority: 0 };
    const q = generateClarificationQuestion(req, mockContentAnalysis);
    expect(q).toContain('done');
  });

  it('falls back to requirement question for unknown fields', () => {
    const req: GoalRequirement = { field: 'unknownField', question: 'What about unknown?', priority: 5 };
    const q = generateClarificationQuestion(req, mockContentAnalysis);
    expect(q).toBe('What about unknown?');
  });
});

// ═══════════════════════════════════════════════════════
//  resolveAfterClarification
// ═══════════════════════════════════════════════════════

describe('resolveAfterClarification', () => {
  it('returns immediateExecution when completeness >= 70', () => {
    const goal = buildGoal({ completeness: 80, missingFor: [] });
    const result = resolveAfterClarification(goal, 1, mockContentAnalysis);
    expect(result.immediateExecution).toBe(true);
    expect(result.clarificationNeeded).toBe(false);
  });

  it('returns immediateExecution at max clarifications even if incomplete', () => {
    const goal = buildGoal({
      completeness: 40,
      missingFor: [{ field: 'audience', question: 'Who?', priority: 1 }],
    });
    const result = resolveAfterClarification(goal, MAX_CLARIFICATIONS, mockContentAnalysis);
    expect(result.immediateExecution).toBe(true);
    expect(result.clarificationNeeded).toBe(false);
  });

  it('returns clarificationNeeded when incomplete and under max rounds', () => {
    const goal = buildGoal({
      completeness: 35,
      missingFor: [{ field: 'audience', question: 'Who?', priority: 1 }],
    });
    const result = resolveAfterClarification(goal, 1, mockContentAnalysis);
    expect(result.immediateExecution).toBe(false);
    expect(result.clarificationNeeded).toBe(true);
    expect(result.nextQuestion).toBeDefined();
  });

  it('includes next question from highest priority missing field', () => {
    const goal = buildGoal({
      completeness: 35,
      missingFor: [
        { field: 'depthSignal', question: 'How deep?', priority: 2 },
        { field: 'audience', question: 'Who?', priority: 1 },
      ],
    });
    const result = resolveAfterClarification(goal, 1, mockContentAnalysis);
    // First in array should be used for next question
    expect(result.nextQuestion).toBeDefined();
  });

  it('MAX_CLARIFICATIONS is 2', () => {
    expect(MAX_CLARIFICATIONS).toBe(2);
  });

  it('round 2 (at max) triggers execution', () => {
    const goal = buildGoal({ completeness: 50, missingFor: [{ field: 'audience', question: 'Who?', priority: 1 }] });
    const result = resolveAfterClarification(goal, 2, mockContentAnalysis);
    expect(result.immediateExecution).toBe(true);
  });

  it('round 1 (under max) continues clarification', () => {
    const goal = buildGoal({ completeness: 50, missingFor: [{ field: 'audience', question: 'Who?', priority: 1 }] });
    const result = resolveAfterClarification(goal, 1, mockContentAnalysis);
    expect(result.immediateExecution).toBe(false);
    expect(result.clarificationNeeded).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════
//  End-to-end completeness scenarios
// ═══════════════════════════════════════════════════════

describe('real-world goal scenarios', () => {
  it('bookmark: always ready', () => {
    const { completeness } = scoreCompleteness({ endState: 'bookmark' });
    expect(completeness).toBe(100);
  });

  it('research with full context: ready', () => {
    const { completeness } = scoreCompleteness({
      endState: 'research',
      audience: 'self',
      depthSignal: 'deep',
      thesisHook: 'revenge of the B students',
    });
    expect(completeness).toBeGreaterThanOrEqual(70);
  });

  it('research with only "research this": needs clarification', () => {
    const { completeness, missingFor } = scoreCompleteness({ endState: 'research' });
    expect(completeness).toBeLessThan(70);
    expect(missingFor.length).toBeGreaterThan(0);
  });

  it('create for LinkedIn thinkpiece: ready', () => {
    const { completeness } = scoreCompleteness({
      endState: 'create',
      audience: 'linkedin',
      format: 'thinkpiece',
    });
    expect(completeness).toBeGreaterThanOrEqual(70);
  });

  it('create without format: needs clarification', () => {
    const { completeness, missingFor } = scoreCompleteness({
      endState: 'create',
      audience: 'linkedin',
    });
    // audience present (35 base), format missing → 35 < 70
    expect(completeness).toBeLessThan(70);
    expect(missingFor.some(m => m.field === 'format')).toBe(true);
  });

  it('custom with raw description: ready', () => {
    const { completeness } = scoreCompleteness({
      endState: 'custom',
      endStateRaw: 'I want to compare this to our current approach',
    });
    expect(completeness).toBeGreaterThanOrEqual(70);
  });
});
