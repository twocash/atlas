/**
 * Andon Gate — Epistemic Honesty Tests
 *
 * ATLAS-AG-001: These tests verify that the Andon Gate STOPS THE LINE
 * when quality is wrong. They are NOT soft-fallback tests. They verify
 * that speculative output NEVER gets grounded framing, and empty output
 * NEVER gets celebration.
 *
 * Named for Toyota's andon cord — the mechanism that empowers any worker
 * to stop the production line when quality is wrong.
 */

import { describe, it, expect } from 'bun:test';
import {
  assessOutput,
  calibrateDelivery,
  assessNovelty,
  computeSourceRelevance,
  type AndonInput,
  type ConfidenceLevel,
} from '../src/services/andon-gate';

// ─── Test Fixtures ──────────────────────────────────────────────────────────

/** Fully grounded research: 5 sources, 3 findings, novel summary */
const GROUNDED_INPUT: AndonInput = {
  wasDispatched: true,
  groundingUsed: true,
  sourceCount: 5,
  findingCount: 3,
  bibliographyCount: 0,
  durationMs: 12000,
  summary: 'Tesla announced the Cybertruck refresh with a revised battery architecture using 4680 cells. The new design reduces pack weight by 12% while maintaining range. Production begins Q3 2026 at Gigafactory Texas. Competitor analysis shows Ford and Rivian are 18 months behind on similar cell technology.',
  originalQuery: 'latest Tesla Cybertruck updates',
  success: true,
  hallucinationGuardPassed: true,
  source: 'socratic-resolved',
};

/** Thin research: 1 source, 1 finding */
const INFORMED_INPUT: AndonInput = {
  ...GROUNDED_INPUT,
  sourceCount: 1,
  findingCount: 1,
  summary: 'Tesla has announced updates to the Cybertruck including a new battery design. Details are limited but suggest improved range capabilities based on one analyst report.',
};

/** No dispatch — training data synthesis */
const SPECULATIVE_INPUT: AndonInput = {
  ...GROUNDED_INPUT,
  wasDispatched: false,
  groundingUsed: false,
  sourceCount: 0,
  findingCount: 0,
  summary: 'Based on my training data, Tesla has been working on Cybertruck improvements. The vehicle was initially launched in late 2023 and has undergone several revisions since then.',
};

/** Dispatched but no sources returned */
const SPECULATIVE_NO_SOURCES: AndonInput = {
  ...GROUNDED_INPUT,
  groundingUsed: false,
  sourceCount: 0,
  findingCount: 0,
  summary: 'I attempted to research the latest Cybertruck updates but was unable to find specific recent sources. Based on available information, the Cybertruck continues to be manufactured at Gigafactory Texas.',
};

/** Empty/failed output */
const INSUFFICIENT_INPUT: AndonInput = {
  ...GROUNDED_INPUT,
  success: false,
  summary: '',
};

/** Mirror anti-pattern: output restates the query without adding novel info.
 *  Must be 50+ chars AND have >70% token overlap with query to trigger.
 *  Token overlap must exceed NOVELTY_FLOOR (0.3) = novelty must be < 0.3.
 *  All significant summary tokens must come from the query. */
const MIRROR_INPUT: AndonInput = {
  ...GROUNDED_INPUT,
  summary: 'Latest Tesla Cybertruck updates Tesla Cybertruck updates are Tesla Cybertruck updates.',
  originalQuery: 'latest Tesla Cybertruck updates',
};

// ─── Classification Tests ───────────────────────────────────────────────────

describe('Andon Gate: assessOutput()', () => {

  describe('Confidence Classification', () => {

    it('classifies well-sourced research as GROUNDED', () => {
      const assessment = assessOutput(GROUNDED_INPUT);
      expect(assessment.confidence).toBe('grounded');
      expect(assessment.routing).toBe('deliver');
    });

    it('classifies thin-sourced research as INFORMED', () => {
      const assessment = assessOutput(INFORMED_INPUT);
      expect(assessment.confidence).toBe('informed');
      expect(assessment.routing).toBe('caveat');
    });

    it('classifies non-dispatched output as SPECULATIVE', () => {
      const assessment = assessOutput(SPECULATIVE_INPUT);
      expect(assessment.confidence).toBe('speculative');
    });

    it('classifies dispatched-but-no-sources as SPECULATIVE', () => {
      const assessment = assessOutput(SPECULATIVE_NO_SOURCES);
      expect(assessment.confidence).toBe('speculative');
    });

    it('classifies failed execution as INSUFFICIENT', () => {
      const assessment = assessOutput(INSUFFICIENT_INPUT);
      expect(assessment.confidence).toBe('insufficient');
      expect(assessment.routing).toBe('clarify');
    });

    it('classifies mirror anti-pattern as INSUFFICIENT', () => {
      const assessment = assessOutput(MIRROR_INPUT);
      expect(assessment.confidence).toBe('insufficient');
      expect(assessment.reason).toContain('Mirror Anti-Pattern');
    });

    it('classifies empty summary as INSUFFICIENT', () => {
      const assessment = assessOutput({
        ...GROUNDED_INPUT,
        summary: 'Too short',
      });
      expect(assessment.confidence).toBe('insufficient');
      expect(assessment.reason).toContain('too short');
    });

    it('classifies hallucination guard failure as INSUFFICIENT', () => {
      const assessment = assessOutput({
        ...GROUNDED_INPUT,
        hallucinationGuardPassed: false,
      });
      expect(assessment.confidence).toBe('insufficient');
      expect(assessment.reason).toContain('Hallucination guard');
    });
  });

  describe('Boundary Conditions', () => {

    it('3 sources + 1 finding + novelty = GROUNDED (exact threshold)', () => {
      const assessment = assessOutput({
        ...GROUNDED_INPUT,
        sourceCount: 3,
        findingCount: 1,
      });
      expect(assessment.confidence).toBe('grounded');
    });

    it('2 sources = INFORMED (below grounded threshold)', () => {
      const assessment = assessOutput({
        ...GROUNDED_INPUT,
        sourceCount: 2,
        findingCount: 3,
      });
      expect(assessment.confidence).toBe('informed');
    });

    it('3 sources + 0 findings = INFORMED (substance check fails)', () => {
      const assessment = assessOutput({
        ...GROUNDED_INPUT,
        sourceCount: 3,
        findingCount: 0,
      });
      expect(assessment.confidence).toBe('informed');
    });

    it('deep research with bibliography gets GROUNDED if qualifying', () => {
      const assessment = assessOutput({
        ...GROUNDED_INPUT,
        bibliographyCount: 12,
      });
      expect(assessment.confidence).toBe('grounded');
    });
  });

  describe('Telemetry', () => {

    it('produces correct telemetry keyword', () => {
      const assessment = assessOutput(GROUNDED_INPUT);
      expect(assessment.telemetry.keyword).toBe('andon:grounded');
    });

    it('captures source and finding counts in telemetry', () => {
      const assessment = assessOutput(GROUNDED_INPUT);
      expect(assessment.telemetry.sourceCount).toBe(5);
      expect(assessment.telemetry.findingCount).toBe(3);
    });

    it('captures novelty pass/fail in telemetry', () => {
      const grounded = assessOutput(GROUNDED_INPUT);
      expect(grounded.telemetry.noveltyPassed).toBe(true);

      const mirror = assessOutput(MIRROR_INPUT);
      expect(mirror.telemetry.noveltyPassed).toBe(false);
    });

    it('captures duration in telemetry', () => {
      const assessment = assessOutput(GROUNDED_INPUT);
      expect(assessment.telemetry.durationMs).toBe(12000);
    });
  });
});

// ─── Delivery Calibration Tests ─────────────────────────────────────────────

describe('Andon Gate: calibrateDelivery()', () => {

  it('GROUNDED gets "Research Complete" with celebration', () => {
    const cal = calibrateDelivery('grounded');
    expect(cal.label).toBe('Research Complete');
    expect(cal.celebrationAllowed).toBe(true);
    expect(cal.caveat).toBeNull();
    expect(cal.emoji).toBe('✅');
  });

  it('INFORMED gets "Research Summary" with caveat', () => {
    const cal = calibrateDelivery('informed');
    expect(cal.label).toBe('Research Summary');
    expect(cal.celebrationAllowed).toBe(false);
    expect(cal.caveat).toBeTruthy();
    expect(cal.emoji).toBe('📋');
  });

  it('SPECULATIVE gets "Initial Analysis" with deeper-offer', () => {
    const cal = calibrateDelivery('speculative');
    expect(cal.label).toBe('Initial Analysis');
    expect(cal.celebrationAllowed).toBe(false);
    expect(cal.caveat).toContain('deeper');
    expect(cal.emoji).toBe('💭');
  });

  it('INSUFFICIENT gets "Research Incomplete" — line stopped', () => {
    const cal = calibrateDelivery('insufficient');
    expect(cal.label).toBe('Research Incomplete');
    expect(cal.celebrationAllowed).toBe(false);
    expect(cal.caveat).toBeTruthy();
    expect(cal.emoji).toBe('⚠️');
  });

  // ── NEGATIVE TESTS: Anti-Soft-Fallback ──

  it('NEGATIVE: Speculative output NEVER gets Grounded framing', () => {
    const assessment = assessOutput(SPECULATIVE_INPUT);
    expect(assessment.calibration.label).not.toBe('Research Complete');
    expect(assessment.calibration.celebrationAllowed).toBe(false);
    expect(assessment.calibration.emoji).not.toBe('✅');
  });

  it('NEGATIVE: Empty output NEVER gets celebration', () => {
    const assessment = assessOutput(INSUFFICIENT_INPUT);
    expect(assessment.calibration.celebrationAllowed).toBe(false);
    expect(assessment.calibration.label).not.toBe('Research Complete');
    expect(assessment.calibration.emoji).not.toBe('✅');
  });

  it('NEGATIVE: Mirror output NEVER gets celebration', () => {
    const assessment = assessOutput(MIRROR_INPUT);
    expect(assessment.calibration.celebrationAllowed).toBe(false);
    expect(assessment.calibration.label).not.toBe('Research Complete');
  });

  it('NEGATIVE: Only GROUNDED gets "Research Complete"', () => {
    const levels: ConfidenceLevel[] = ['informed', 'speculative', 'insufficient'];
    for (const level of levels) {
      const cal = calibrateDelivery(level);
      expect(cal.label).not.toBe('Research Complete');
      expect(cal.celebrationAllowed).toBe(false);
    }
  });
});

// ─── Novelty Assessment Tests ───────────────────────────────────────────────

describe('Andon Gate: assessNovelty()', () => {

  it('returns 0 for null/empty summary', () => {
    expect(assessNovelty(null, 'any query')).toBe(0);
    expect(assessNovelty('', 'any query')).toBe(0);
    expect(assessNovelty(undefined, 'any query')).toBe(0);
  });

  it('returns 1 for empty query (nothing to mirror)', () => {
    expect(assessNovelty('some output text', '')).toBe(1);
  });

  it('detects pure restatement (high overlap)', () => {
    const score = assessNovelty(
      'latest Tesla Cybertruck updates news',
      'latest Tesla Cybertruck updates'
    );
    expect(score).toBeLessThan(0.3); // Below NOVELTY_FLOOR
  });

  it('passes novel content (low overlap)', () => {
    const score = assessNovelty(
      'Tesla announced the Cybertruck refresh with a revised battery architecture using 4680 cells. The new design reduces pack weight by 12% while maintaining range. Production begins Q3 2026 at Gigafactory Texas.',
      'latest Tesla Cybertruck updates'
    );
    expect(score).toBeGreaterThanOrEqual(0.3); // Above NOVELTY_FLOOR
  });

  it('filters stop words from comparison', () => {
    // "research deep dive analysis" should not count toward overlap
    const score = assessNovelty(
      'The architecture employs microservices with event-driven communication patterns and container orchestration across distributed nodes.',
      'research deep dive analysis on cloud architecture'
    );
    expect(score).toBeGreaterThanOrEqual(0.3);
  });

  it('penalizes very short summaries relative to query', () => {
    const score = assessNovelty(
      'Yes confirmed.',  // Very short, different words but too brief
      'What is the current status of the SpaceX Starship program and when is the next launch window?'
    );
    // Short response gets length penalty
    expect(score).toBeLessThan(1.0);
  });

  it('handles long summaries with genuine novel content', () => {
    const longSummary = 'SpaceX successfully completed Flight 7 of the Starship program on January 16, 2026, achieving several milestones. The Super Heavy booster was caught by the mechazilla tower arms for the third time. The upper stage performed a controlled descent over the Indian Ocean, demonstrating improved thermal protection system performance. Next launch window is targeting March 2026 with an orbital insertion attempt.';
    const score = assessNovelty(
      longSummary,
      'SpaceX Starship program status'
    );
    expect(score).toBeGreaterThanOrEqual(0.5);
  });
});

// ─── Routing Decision Tests ─────────────────────────────────────────────────

describe('Andon Gate: Routing Decisions', () => {

  it('GROUNDED routes to deliver', () => {
    const assessment = assessOutput(GROUNDED_INPUT);
    expect(assessment.routing).toBe('deliver');
  });

  it('INFORMED routes to caveat', () => {
    const assessment = assessOutput(INFORMED_INPUT);
    expect(assessment.routing).toBe('caveat');
  });

  it('SPECULATIVE with novelty routes to caveat', () => {
    const assessment = assessOutput(SPECULATIVE_INPUT);
    // Speculative + novelty passed = caveat (deliver with limitation)
    expect(assessment.routing).toBe('caveat');
  });

  it('mirror anti-pattern routes to clarify (insufficient)', () => {
    // Mirror check fires BEFORE dispatch check in the cascade.
    // A restatement is always insufficient — regardless of dispatch status.
    const assessment = assessOutput({
      ...SPECULATIVE_INPUT,
      summary: 'Latest Tesla Cybertruck updates Tesla Cybertruck updates are Tesla Cybertruck updates.',
      originalQuery: 'latest Tesla Cybertruck updates',
    });
    // Mirror check fires BEFORE dispatch check — restatement = insufficient
    expect(assessment.confidence).toBe('insufficient');
    expect(assessment.routing).toBe('clarify');
  });

  it('INSUFFICIENT routes to clarify', () => {
    const assessment = assessOutput(INSUFFICIENT_INPUT);
    expect(assessment.routing).toBe('clarify');
  });
});

// ─── Integration: Full Assessment Pipeline ──────────────────────────────────

describe('Andon Gate: Full Pipeline', () => {

  it('produces complete assessment with all fields', () => {
    const assessment = assessOutput(GROUNDED_INPUT);

    // All top-level fields present
    expect(assessment.confidence).toBeDefined();
    expect(assessment.calibration).toBeDefined();
    expect(assessment.routing).toBeDefined();
    expect(assessment.noveltyScore).toBeDefined();
    expect(assessment.reason).toBeDefined();
    expect(assessment.telemetry).toBeDefined();

    // Calibration complete
    expect(assessment.calibration.label).toBeDefined();
    expect(assessment.calibration.emoji).toBeDefined();
    expect(typeof assessment.calibration.celebrationAllowed).toBe('boolean');

    // Telemetry complete
    expect(assessment.telemetry.keyword).toMatch(/^andon:/);
    expect(typeof assessment.telemetry.sourceCount).toBe('number');
    expect(typeof assessment.telemetry.findingCount).toBe('number');
    expect(typeof assessment.telemetry.noveltyPassed).toBe('boolean');
    expect(typeof assessment.telemetry.durationMs).toBe('number');
  });

  it('reason field explains classification decision', () => {
    const grounded = assessOutput(GROUNDED_INPUT);
    expect(grounded.reason).toContain('sources');
    expect(grounded.reason).toContain('findings');

    const mirror = assessOutput(MIRROR_INPUT);
    expect(mirror.reason).toContain('Mirror');

    const failed = assessOutput(INSUFFICIENT_INPUT);
    expect(failed.reason).toContain('failed');
  });

  it('noveltyScore is between 0 and 1', () => {
    const assessment = assessOutput(GROUNDED_INPUT);
    expect(assessment.noveltyScore).toBeGreaterThanOrEqual(0);
    expect(assessment.noveltyScore).toBeLessThanOrEqual(1);
  });

  it('every confidence level maps to exactly one routing decision', () => {
    const levels: ConfidenceLevel[] = ['grounded', 'informed', 'speculative', 'insufficient'];
    for (const level of levels) {
      const cal = calibrateDelivery(level);
      expect(cal.label).toBeTruthy();
      expect(cal.emoji).toBeTruthy();
    }
  });

  it('sourceRelevanceScore is between 0 and 1', () => {
    const assessment = assessOutput(GROUNDED_INPUT);
    expect(assessment.sourceRelevanceScore).toBeGreaterThanOrEqual(0);
    expect(assessment.sourceRelevanceScore).toBeLessThanOrEqual(1);
  });

  it('telemetry includes sourceRelevancePassed', () => {
    const assessment = assessOutput(GROUNDED_INPUT);
    expect(typeof assessment.telemetry.sourceRelevancePassed).toBe('boolean');
  });
});

// ─── Sprint B P1-2: Speculative Padding Guard ────────────────────────────────

describe('Andon Gate: Source Relevance (Sprint B P1-2)', () => {

  describe('computeSourceRelevance', () => {
    it('returns 1.0 when no source titles provided (fail open)', () => {
      expect(computeSourceRelevance('quantum computing 2026', undefined)).toBe(1.0);
      expect(computeSourceRelevance('quantum computing 2026', [])).toBe(1.0);
    });

    it('returns 1.0 when query is empty', () => {
      expect(computeSourceRelevance('', ['some title'])).toBe(1.0);
    });

    it('scores high when source titles match query terms', () => {
      const score = computeSourceRelevance(
        'Tesla Cybertruck battery updates 2026',
        ['Tesla Cybertruck gets new 4680 battery pack', 'EV battery technology 2026 roundup']
      );
      expect(score).toBeGreaterThan(0.5);
    });

    it('scores low when source titles are tangential to query', () => {
      const score = computeSourceRelevance(
        'quantum computing breakthroughs 2026',
        ['History of classical computing 1970s', 'Alan Turing biography', 'Mainframe architecture overview']
      );
      expect(score).toBeLessThan(0.3);
    });

    it('extracts useful tokens from URLs', () => {
      const score = computeSourceRelevance(
        'Anthropic model safety research',
        ['anthropic.com blog model-safety', 'arxiv.org abs anthropic-safety-paper']
      );
      expect(score).toBeGreaterThan(0.3);
    });
  });

  describe('confidence downgrade on low relevance', () => {
    /** Input that would be grounded WITHOUT relevance check */
    const GROUNDED_WITH_TITLES: AndonInput = {
      ...GROUNDED_INPUT,
      sourceTitles: [
        'Tesla Cybertruck refresh with 4680 battery cells',
        'Gigafactory Texas production update Q3 2026',
        'Ford and Rivian EV cell technology comparison',
      ],
    };

    /** Same source count but tangential titles */
    const TANGENTIAL_SOURCES: AndonInput = {
      ...GROUNDED_INPUT,
      sourceTitles: [
        'History of electric vehicles in the 1990s',
        'How combustion engines work explained',
        'Railroad transportation logistics overview',
      ],
    };

    it('grounded when sources are relevant', () => {
      const assessment = assessOutput(GROUNDED_WITH_TITLES);
      expect(assessment.confidence).toBe('grounded');
      expect(assessment.sourceRelevanceScore).toBeGreaterThan(0.15);
    });

    it('downgrades to informed when sources are tangential', () => {
      const assessment = assessOutput(TANGENTIAL_SOURCES);
      expect(assessment.confidence).toBe('informed');
      expect(assessment.reason).toContain('relevance');
      expect(assessment.sourceRelevanceScore).toBeLessThan(0.15);
    });

    it('no downgrade when sourceTitles not provided (backward compat)', () => {
      // Original GROUNDED_INPUT has no sourceTitles — should stay grounded
      const assessment = assessOutput(GROUNDED_INPUT);
      expect(assessment.confidence).toBe('grounded');
      expect(assessment.sourceRelevanceScore).toBe(1.0); // Fail-open default
    });

    it('relevance downgrade reason mentions tangential sources', () => {
      const assessment = assessOutput(TANGENTIAL_SOURCES);
      expect(assessment.reason).toContain('tangential');
    });
  });
});
