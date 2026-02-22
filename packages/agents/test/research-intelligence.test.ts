/**
 * Research Intelligence v2 — Unit Tests
 *
 * Tests for:
 * - EVIDENCE_PRESETS (depth-based evidence requirements)
 * - parseAnswerToRouting (Socratic answer → routing signals)
 * - buildResearchPromptV2 (structured prompt composition)
 * - POV fetcher scoring (thesis-hook-based matching)
 *
 * Sprint: ATLAS-RESEARCH-INTEL-001
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import {
  EVIDENCE_PRESETS,
  type POVContext,
  type EvidenceRequirements,
  type ResearchConfigV2,
  isResearchConfigV2,
} from '../src/types/research-v2';
import {
  parseAnswerToRouting,
  extractThesisHook,
  inferDepth,
  classifyIntent,
  extractFocusHints,
  isDirective,
} from '../src/services/answer-parser';
import {
  buildResearchPromptV2,
  buildPOVSection,
  buildEvidenceSection,
  buildQualityFloorSection,
} from '../src/services/research-prompt-v2';
import {
  pickBestMatch,
} from '../src/services/pov-fetcher';
import type { ResolvedContext } from '../src/socratic/types';

// ─── Test Fixtures ──────────────────────────────────────

function makeResolvedContext(overrides: Partial<ResolvedContext> = {}): ResolvedContext {
  return {
    intent: 'research',
    depth: 'standard',
    audience: 'self',
    pillar: 'The Grove',
    confidence: 0.8,
    resolvedVia: 'single_question',
    extraContext: {},
    ...overrides,
  };
}

const TEST_POV: POVContext = {
  title: 'AI Infrastructure Concentration',
  coreThesis: 'A small number of companies control the critical infrastructure layers of AI, creating epistemic capture risk.',
  evidenceStandards: 'Official announcements, SEC filings, technical analysis',
  counterArguments: 'Open source alternatives, regulatory intervention, market competition',
  rhetoricalPatterns: 'Name the company, the product, the number. Show the mechanism.',
  boundaryConditions: 'Does not apply to academic research or open datasets',
  domainCoverage: ['Grove Research'],
};

const TEST_POV_2: POVContext = {
  title: 'Data Marketplace Economics',
  coreThesis: 'Data marketplaces will restructure how AI training data is valued and traded.',
  evidenceStandards: 'Market data, transaction volumes, regulatory frameworks',
  counterArguments: 'Data abundance, synthetic data replacing real data',
  rhetoricalPatterns: 'Follow the money. Show who pays, who profits, who loses.',
  boundaryConditions: 'Does not apply to open-source datasets with permissive licenses',
  domainCoverage: ['Grove Research'],
};

// ─── EVIDENCE_PRESETS Tests ─────────────────────────────

describe('EVIDENCE_PRESETS', () => {
  it('light depth has minimal requirements', () => {
    const light = EVIDENCE_PRESETS.light;
    expect(light.minHardFacts).toBe(0);
    expect(light.requireCounterArguments).toBe(false);
    expect(light.requirePrimarySources).toBe(false);
    expect(light.requireQuantitative).toBe(false);
    expect(light.maxAcademicPadding).toBeGreaterThan(5);
  });

  it('standard depth requires hard facts and sources', () => {
    const standard = EVIDENCE_PRESETS.standard;
    expect(standard.minHardFacts).toBeGreaterThanOrEqual(3);
    expect(standard.minHardFacts).toBeLessThanOrEqual(5);
    expect(standard.requirePrimarySources).toBe(true);
    expect(standard.requireQuantitative).toBe(true);
    expect(standard.maxAcademicPadding).toBeLessThanOrEqual(5);
  });

  it('deep depth requires everything — grove-grade', () => {
    const deep = EVIDENCE_PRESETS.deep;
    expect(deep.minHardFacts).toBeGreaterThanOrEqual(5);
    expect(deep.requireCounterArguments).toBe(true);
    expect(deep.requirePrimarySources).toBe(true);
    expect(deep.requireQuantitative).toBe(true);
    expect(deep.maxAcademicPadding).toBe(0);
  });

  it('padding limits decrease as depth increases', () => {
    expect(EVIDENCE_PRESETS.light.maxAcademicPadding)
      .toBeGreaterThan(EVIDENCE_PRESETS.standard.maxAcademicPadding);
    expect(EVIDENCE_PRESETS.standard.maxAcademicPadding)
      .toBeGreaterThan(EVIDENCE_PRESETS.deep.maxAcademicPadding);
  });
});

// ─── isResearchConfigV2 Tests ───────────────────────────

describe('isResearchConfigV2', () => {
  it('returns false for plain ResearchConfig', () => {
    expect(isResearchConfigV2({ query: 'test' })).toBe(false);
  });

  it('returns true when evidenceRequirements present', () => {
    expect(isResearchConfigV2({
      query: 'test',
      evidenceRequirements: EVIDENCE_PRESETS.standard,
    } as ResearchConfigV2)).toBe(true);
  });

  it('returns true when povContext present', () => {
    expect(isResearchConfigV2({
      query: 'test',
      povContext: TEST_POV,
    } as ResearchConfigV2)).toBe(true);
  });

  it('returns true when thesisHook present', () => {
    expect(isResearchConfigV2({
      query: 'test',
      thesisHook: 'epistemic_capture',
    } as ResearchConfigV2)).toBe(true);
  });
});

// ─── parseAnswerToRouting Tests ─────────────────────────

describe('parseAnswerToRouting', () => {
  it('extracts thesis hook from "epistemic capture through Grove lens"', () => {
    const resolved = makeResolvedContext({
      extraContext: { userDirection: 'epistemic capture through Grove lens' },
    });
    const result = parseAnswerToRouting(resolved);
    expect(result.thesisHook).toBe('epistemic_capture');
    expect(result.pillar).toBe('The Grove');
  });

  it('extracts thesis hook from "data marketplace economics"', () => {
    const resolved = makeResolvedContext({
      extraContext: { userDirection: 'data marketplace economics angle' },
    });
    const result = parseAnswerToRouting(resolved);
    expect(result.thesisHook).toBe('data_marketplace');
  });

  it('returns undefined thesis hook for directive "research it"', () => {
    const resolved = makeResolvedContext({
      extraContext: { userDirection: 'research it' },
    });
    const result = parseAnswerToRouting(resolved);
    expect(result.thesisHook).toBeUndefined();
  });

  it('returns undefined thesis hook for "go deep"', () => {
    const resolved = makeResolvedContext({
      extraContext: { userDirection: 'go deep' },
    });
    const result = parseAnswerToRouting(resolved);
    expect(result.thesisHook).toBeUndefined();
  });

  it('infers deep depth from "risk" language', () => {
    const resolved = makeResolvedContext({
      depth: 'standard',
      extraContext: { userDirection: 'epistemic capture risk assessment' },
    });
    const result = parseAnswerToRouting(resolved);
    expect(result.depth).toBe('deep');
  });

  it('infers light depth from "quick summary"', () => {
    const resolved = makeResolvedContext({
      depth: 'standard',
      extraContext: { userDirection: 'quick summary for the team' },
    });
    const result = parseAnswerToRouting(resolved);
    expect(result.depth).toBe('light');
  });

  it('maps DepthLevel "quick" to ResearchDepth "light"', () => {
    const resolved = makeResolvedContext({ depth: 'quick' });
    const result = parseAnswerToRouting(resolved);
    expect(result.depth).toBe('light');
  });

  it('classifies "compare" intent from user direction', () => {
    const resolved = makeResolvedContext({
      extraContext: { userDirection: 'compare Claude vs GPT-4 for code generation' },
    });
    const result = parseAnswerToRouting(resolved);
    expect(result.intent).toBe('compare');
  });

  it('classifies "validate" intent from user direction', () => {
    const resolved = makeResolvedContext({
      extraContext: { userDirection: 'validate whether this claim is supported' },
    });
    const result = parseAnswerToRouting(resolved);
    expect(result.intent).toBe('validate');
  });

  it('defaults to "explore" intent for research', () => {
    const resolved = makeResolvedContext({ intent: 'research' });
    const result = parseAnswerToRouting(resolved);
    expect(result.intent).toBe('explore');
  });

  it('maps "draft" intent to "synthesize"', () => {
    const resolved = makeResolvedContext({ intent: 'draft' });
    const result = parseAnswerToRouting(resolved);
    expect(result.intent).toBe('synthesize');
  });

  it('extracts focus hints from natural language', () => {
    const resolved = makeResolvedContext({
      extraContext: { userDirection: 'epistemic capture risk in AI infrastructure' },
    });
    const result = parseAnswerToRouting(resolved);
    expect(result.focusHints.length).toBeGreaterThan(0);
    expect(result.focusHints).toContain('epistemic');
    expect(result.focusHints).toContain('capture');
  });

  it('preserves focus direction from user direction', () => {
    const resolved = makeResolvedContext({
      extraContext: { userDirection: 'Focus on edge deployment patterns' },
    });
    const result = parseAnswerToRouting(resolved);
    expect(result.focusDirection).toBe('Focus on edge deployment patterns');
  });

  it('handles empty extraContext gracefully', () => {
    const resolved = makeResolvedContext({ extraContext: {} });
    const result = parseAnswerToRouting(resolved);
    expect(result.pillar).toBe('The Grove');
    expect(result.depth).toBe('standard');
    expect(result.thesisHook).toBeUndefined();
    expect(result.intent).toBe('explore');
    expect(result.focusHints).toEqual([]);
    expect(result.focusDirection).toBeUndefined();
  });

  it('uses contentTopic for thesis hook when userDirection is empty', () => {
    const resolved = makeResolvedContext({
      contentTopic: 'AI infrastructure concentration and compute monopolies',
      extraContext: {},
    });
    const result = parseAnswerToRouting(resolved);
    expect(result.thesisHook).toBe('ai_infrastructure_concentration');
  });
});

// ─── Directive Detection Tests ──────────────────────────

describe('isDirective', () => {
  it.each([
    'research it',
    'go deep',
    'look into it',
    'dig into this',
    'check it out',
    'full send',
    "let's go",
    'yes please',
    'do it',
    'summarize this',
  ])('detects "%s" as directive', (text) => {
    expect(isDirective(text)).toBe(true);
  });

  it.each([
    'epistemic capture risk in AI infrastructure',
    'compare Claude vs GPT-4 for code generation',
    'How distributed teams scale LLM inference',
    'The risk of compute monopolies in foundation model training',
  ])('does NOT flag "%s" as directive', (text) => {
    expect(isDirective(text)).toBe(false);
  });
});

// ─── extractFocusHints Tests ────────────────────────────

describe('extractFocusHints', () => {
  it('extracts meaningful keywords', () => {
    const hints = extractFocusHints('epistemic capture risk in AI infrastructure');
    expect(hints).toContain('epistemic');
    expect(hints).toContain('capture');
    expect(hints).toContain('infrastructure');
    // Should NOT contain stop words
    expect(hints).not.toContain('in');
  });

  it('returns empty for short text', () => {
    expect(extractFocusHints('hi')).toEqual([]);
  });

  it('caps at 8 hints', () => {
    const long = 'one two three four five six seven eight nine ten eleven twelve';
    expect(extractFocusHints(long).length).toBeLessThanOrEqual(8);
  });
});

// ─── buildResearchPromptV2 Tests ────────────────────────

describe('buildResearchPromptV2', () => {
  it('includes Research Topic section', () => {
    const prompt = buildResearchPromptV2({
      query: 'AI infrastructure concentration and compute monopolies',
    } as ResearchConfigV2);
    expect(prompt).toContain('## Research Topic');
    expect(prompt).toContain('AI infrastructure concentration and compute monopolies');
  });

  it('does NOT truncate query at 200 chars', () => {
    const longQuery = 'A'.repeat(500);
    const prompt = buildResearchPromptV2({
      query: longQuery,
    } as ResearchConfigV2);
    expect(prompt).toContain(longQuery);
  });

  it('includes POV section when povContext provided', () => {
    const prompt = buildResearchPromptV2({
      query: 'test',
      povContext: TEST_POV,
    } as ResearchConfigV2);
    expect(prompt).toContain('## Analytical Lens: AI Infrastructure Concentration');
    expect(prompt).toContain('Frame findings through this lens');
    expect(prompt).toContain(TEST_POV.coreThesis);
  });

  it('omits POV section when povContext is undefined', () => {
    const prompt = buildResearchPromptV2({
      query: 'test',
    } as ResearchConfigV2);
    expect(prompt).not.toContain('## Analytical Lens');
    expect(prompt).not.toContain('Frame findings through this lens');
  });

  it('includes Evidence Requirements when provided', () => {
    const prompt = buildResearchPromptV2({
      query: 'test',
      evidenceRequirements: EVIDENCE_PRESETS.deep,
    } as ResearchConfigV2);
    expect(prompt).toContain('## Evidence Requirements');
    expect(prompt).toContain('Counter-arguments required');
    expect(prompt).toContain('Primary sources required');
    expect(prompt).toContain('Quantitative data required');
    expect(prompt).toContain('Zero academic padding');
  });

  it('includes Quality Floor for grove_grade', () => {
    const prompt = buildResearchPromptV2({
      query: 'test',
      qualityFloor: 'grove_grade',
    } as ResearchConfigV2);
    expect(prompt).toContain('## Source Quality Floor: Grove-Grade');
    expect(prompt).toContain('SEC filings');
    expect(prompt).toContain('NOT acceptable');
  });

  it('omits Quality Floor for "any"', () => {
    const prompt = buildResearchPromptV2({
      query: 'test',
      qualityFloor: 'any',
    } as ResearchConfigV2);
    expect(prompt).not.toContain('## Source Quality Floor');
  });

  it('includes Source URL with type', () => {
    const prompt = buildResearchPromptV2({
      query: 'test',
      sourceUrl: 'https://example.com/article',
      sourceType: 'article',
    } as ResearchConfigV2);
    expect(prompt).toContain('## Source');
    expect(prompt).toContain('https://example.com/article (article)');
  });

  it('includes User Direction', () => {
    const prompt = buildResearchPromptV2({
      query: 'test',
      userDirection: 'Focus on edge deployment patterns',
    } as ResearchConfigV2);
    expect(prompt).toContain('## User Direction');
    expect(prompt).toContain('Focus on edge deployment patterns');
  });

  it('falls back to userContext when userDirection missing', () => {
    const prompt = buildResearchPromptV2({
      query: 'test',
      userContext: 'I care about cost implications',
    } as ResearchConfigV2);
    expect(prompt).toContain('## User Direction');
    expect(prompt).toContain('I care about cost implications');
  });

  it('includes Thesis section when thesisHook provided', () => {
    const prompt = buildResearchPromptV2({
      query: 'test',
      thesisHook: 'epistemic_capture',
      intent: 'validate',
    } as ResearchConfigV2);
    expect(prompt).toContain('## Research Lens');
    expect(prompt).toContain('epistemic capture');
    expect(prompt).toContain('Test a specific claim');
  });

  it('produces valid prompt with NO V2 fields (just query)', () => {
    const prompt = buildResearchPromptV2({
      query: 'What is the state of AI infrastructure?',
    } as ResearchConfigV2);
    expect(prompt).toContain('## Research Topic');
    expect(prompt).toContain('What is the state of AI infrastructure?');
    // Should NOT contain V2 sections
    expect(prompt).not.toContain('## Analytical Lens');
    expect(prompt).not.toContain('## Evidence Requirements');
    expect(prompt).not.toContain('## Source Quality Floor');
    expect(prompt).not.toContain('## Research Lens');
  });
});

// ─── POV Scoring Tests ──────────────────────────────────

describe('pickBestMatch (POV scoring)', () => {
  it('picks entry matching thesis hook keywords', () => {
    const entries = [TEST_POV, TEST_POV_2];
    const result = pickBestMatch(entries, 'epistemic_capture');
    expect(result?.title).toBe('AI Infrastructure Concentration');
  });

  it('picks data marketplace entry for matching hook', () => {
    const entries = [TEST_POV, TEST_POV_2];
    const result = pickBestMatch(entries, 'data_marketplace');
    expect(result?.title).toBe('Data Marketplace Economics');
  });

  it('uses keyword fallback when no thesis hook', () => {
    const entries = [TEST_POV, TEST_POV_2];
    const result = pickBestMatch(entries, undefined, ['marketplace', 'trading']);
    expect(result?.title).toBe('Data Marketplace Economics');
  });

  it('returns first entry when no scoring signals', () => {
    const entries = [TEST_POV, TEST_POV_2];
    const result = pickBestMatch(entries);
    expect(result?.title).toBe('AI Infrastructure Concentration');
  });

  it('returns null for empty entries', () => {
    expect(pickBestMatch([])).toBeNull();
  });

  it('thesis hook scoring outweighs keyword scoring', () => {
    const entries = [TEST_POV, TEST_POV_2];
    // Hook matches POV_2, keywords match POV_1
    const result = pickBestMatch(entries, 'data_marketplace', ['infrastructure', 'concentration']);
    expect(result?.title).toBe('Data Marketplace Economics');
  });
});

// ─── buildPOVSection Tests ──────────────────────────────

describe('buildPOVSection', () => {
  it('includes all POV fields', () => {
    const section = buildPOVSection(TEST_POV);
    expect(section).toContain('AI Infrastructure Concentration');
    expect(section).toContain(TEST_POV.coreThesis);
    expect(section).toContain(TEST_POV.evidenceStandards);
    expect(section).toContain(TEST_POV.counterArguments);
    expect(section).toContain(TEST_POV.rhetoricalPatterns);
    expect(section).toContain(TEST_POV.boundaryConditions);
  });

  it('handles empty optional fields', () => {
    const sparse: POVContext = {
      ...TEST_POV,
      evidenceStandards: '',
      counterArguments: '',
      rhetoricalPatterns: '',
      boundaryConditions: '',
    };
    const section = buildPOVSection(sparse);
    expect(section).toContain(sparse.coreThesis);
    expect(section).not.toContain('Prioritize evidence');
    expect(section).not.toContain('Engage these objections');
  });
});

// ─── buildEvidenceSection Tests ─────────────────────────

describe('buildEvidenceSection', () => {
  it('deep requirements include all constraints', () => {
    const section = buildEvidenceSection(EVIDENCE_PRESETS.deep);
    expect(section).toContain('hard facts');
    expect(section).toContain('Counter-arguments required');
    expect(section).toContain('Primary sources required');
    expect(section).toContain('Quantitative data required');
    expect(section).toContain('Zero academic padding');
  });

  it('light requirements are minimal', () => {
    const section = buildEvidenceSection(EVIDENCE_PRESETS.light);
    // Light has 0 hard facts — no hard facts line
    expect(section).not.toContain('hard facts');
    expect(section).not.toContain('Counter-arguments required');
    expect(section).not.toContain('Primary sources required');
  });
});

describe('buildQualityFloorSection', () => {
  it('grove_grade includes source restrictions', () => {
    const section = buildQualityFloorSection('grove_grade');
    expect(section).toContain('Grove-Grade');
    expect(section).toContain('SEC filings');
    expect(section).toContain('NOT acceptable');
  });

  it('"any" returns empty string', () => {
    expect(buildQualityFloorSection('any')).toBe('');
  });

  it('primary_sources mentions original research', () => {
    const section = buildQualityFloorSection('primary_sources');
    expect(section).toContain('Primary Sources');
    expect(section).toContain('Original research');
  });
});
