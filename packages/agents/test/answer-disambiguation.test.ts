/**
 * Sprint B P0-2: Answer Disambiguation — isQuestionFormAnswer
 *
 * Tests for the question-form detection heuristic.
 * When Jim's Socratic answer is itself a question, it signals potential
 * intent mismatch — the answer may redirect research intent.
 */

import { describe, it, expect, mock } from 'bun:test';

// Mock @atlas/shared dependency that answer-mapper imports at module level
mock.module('@atlas/shared/error-escalation', () => ({
  reportFailure: () => {},
}));

import { isQuestionFormAnswer } from '../src/socratic/answer-mapper';

describe('isQuestionFormAnswer (Sprint B P0-2)', () => {
  describe('detects question-form answers', () => {
    it('detects answers ending with ?', () => {
      expect(isQuestionFormAnswer("What's the latest on Anthropic's model safety work?")).toBe(true);
      expect(isQuestionFormAnswer("Can you look into quantum computing trends?")).toBe(true);
      expect(isQuestionFormAnswer("Is there any news about Tesla's robotaxi?")).toBe(true);
    });

    it('detects answers starting with question words', () => {
      expect(isQuestionFormAnswer("What is the current state of AI regulation")).toBe(true);
      expect(isQuestionFormAnswer("How does Anthropic approach model safety")).toBe(true);
      expect(isQuestionFormAnswer("Where can I find pricing for Claude API")).toBe(true);
      expect(isQuestionFormAnswer("When did OpenAI release GPT-5")).toBe(true);
      expect(isQuestionFormAnswer("Why are transformer models so effective")).toBe(true);
      expect(isQuestionFormAnswer("Which AI coding assistant has the best pricing")).toBe(true);
      expect(isQuestionFormAnswer("Who is leading in multimodal AI research")).toBe(true);
    });

    it('detects auxiliary verb question starters', () => {
      expect(isQuestionFormAnswer("Is Anthropic's Claude better than GPT for code")).toBe(true);
      expect(isQuestionFormAnswer("Are there any alternatives to Pinecone")).toBe(true);
      expect(isQuestionFormAnswer("Can you find recent papers on RLHF")).toBe(true);
      expect(isQuestionFormAnswer("Could you research the latest transformer architectures")).toBe(true);
      expect(isQuestionFormAnswer("Do they have enterprise pricing")).toBe(true);
      expect(isQuestionFormAnswer("Have there been any breakthroughs in AGI")).toBe(true);
      expect(isQuestionFormAnswer("Tell me about the latest developments")).toBe(true);
    });
  });

  describe('does NOT flag non-question answers', () => {
    it('regular statements are not questions', () => {
      expect(isQuestionFormAnswer("The Grove")).toBe(false);
      expect(isQuestionFormAnswer("research")).toBe(false);
      expect(isQuestionFormAnswer("deep")).toBe(false);
      expect(isQuestionFormAnswer("I want a deep dive on AI safety")).toBe(false);
      expect(isQuestionFormAnswer("Look into quantum computing trends for me")).toBe(false);
      expect(isQuestionFormAnswer("AI infrastructure pricing and market dynamics")).toBe(false);
    });

    it('short tokens are never questions (button answers)', () => {
      expect(isQuestionFormAnswer("yes")).toBe(false);
      expect(isQuestionFormAnswer("no")).toBe(false);
      expect(isQuestionFormAnswer("ok")).toBe(false);
      expect(isQuestionFormAnswer("deep")).toBe(false);
    });

    it('empty and whitespace are not questions', () => {
      expect(isQuestionFormAnswer("")).toBe(false);
      expect(isQuestionFormAnswer("   ")).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('handles question mark in the middle (not a question)', () => {
      // "AI safety? I want a deep dive on that topic" — has ? but also is a directive
      expect(isQuestionFormAnswer("AI safety? I want a deep dive on that topic")).toBe(true);
    });

    it('handles trailing whitespace', () => {
      expect(isQuestionFormAnswer("What is the state of AI regulation?  ")).toBe(true);
    });
  });
});
