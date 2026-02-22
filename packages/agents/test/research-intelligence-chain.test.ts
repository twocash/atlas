/**
 * ADR: Research Intelligence Chain Tests
 *
 * End-to-end chain tests verifying the full research intelligence pipeline:
 * 1. Socratic answer → parseAnswerToRouting → thesis hook + routing signals
 * 2. Thesis hook → fetchPOVContext → POV context (mocked Notion)
 * 3. Config → buildResearchPromptV2 → structured prompt with POV + evidence
 * 4. V1 backward compat — old config uses old prompt builder
 * 5. No 200-char cap — long queries pass through
 */

import { describe, it, expect, mock, beforeEach } from 'bun:test';

// Mock Notion before importing modules that use it
const mockNotionQuery = mock(() => Promise.resolve({ results: [] }));
mock.module('@notionhq/client', () => ({
  Client: class {
    databases = { query: mockNotionQuery };
  },
}));

import { parseAnswerToRouting } from '../src/services/answer-parser';
import { fetchPOVContext, clearPovCache } from '../src/services/pov-fetcher';
import { buildResearchPromptV2 } from '../src/services/research-prompt-v2';
import {
  EVIDENCE_PRESETS,
  isResearchConfigV2,
  type ResearchConfigV2,
  type ResearchConfig,
  type POVContext,
} from '../src/types/research-v2';
import type { ResolvedContext } from '../src/socratic/types';

// ==========================================
// Chain Test 1: Stargate — Full POV Pipeline
// ==========================================

describe('Chain: Stargate — thesis hook through to prompt', () => {
  beforeEach(() => {
    clearPovCache();
    mockNotionQuery.mockReset();
  });

  it('extracts thesis hook from answer → fetches POV → builds prompt with POV context', async () => {
    // Step 1: Parse answer with thesis-hook language
    const resolved: ResolvedContext = {
      intent: 'research',
      confidence: 0.9,
      extraContext: {
        userDirection: 'analyze through the lens of epistemic capture — how confirmation loops form',
      },
      slots: {
        content_signals: { score: 0.8, source: 'url', details: {} },
        classification: { score: 0.7, source: 'triage', details: { pillar: 'The Grove' } },
        bridge_context: { score: 0, source: 'none', details: {} },
        contact_data: { score: 0, source: 'none', details: {} },
        skill_requirements: { score: 0, source: 'none', details: {} },
      },
    };

    const routing = parseAnswerToRouting(resolved);

    // Thesis hook should be extracted
    expect(routing.thesisHook).toBe('epistemic_capture');
    expect(routing.intent).toBeDefined();

    // Step 2: Mock Notion to return a POV entry (must match Notion API property format)
    mockNotionQuery.mockResolvedValueOnce({
      results: [{
        id: 'pov-001',
        properties: {
          Title: { type: 'title', title: [{ plain_text: 'Epistemic Capture in AI Systems' }] },
          'Core Thesis': { type: 'rich_text', rich_text: [{ plain_text: 'Confirmation loops in AI create epistemic bubbles that narrow rather than expand understanding.' }] },
          'Evidence Standards': { type: 'rich_text', rich_text: [{ plain_text: 'Requires longitudinal data, not just snapshots.' }] },
          'Rhetorical Patterns': { type: 'rich_text', rich_text: [{ plain_text: 'Lead with the mechanism, not the conclusion.' }] },
          'Counter-Arguments Addressed': { type: 'rich_text', rich_text: [{ plain_text: 'Some argue echo chambers are a feature for focus.' }] },
          'Boundary Conditions': { type: 'rich_text', rich_text: [{ plain_text: 'Only applies to general-purpose AI, not narrow tools.' }] },
          'Domain Coverage': { type: 'multi_select', multi_select: [{ name: 'AI Architecture' }] },
          Status: { type: 'select', select: { name: 'Active' } },
        },
      }],
    });

    const povResult = await fetchPOVContext('The Grove', routing.thesisHook, ['AI', 'epistemic']);

    expect(povResult.status).toBe('found');
    expect(povResult.context).toBeDefined();
    expect(povResult.context!.coreThesis).toContain('Confirmation loops');

    // Step 3: Build V2 config with all pieces
    const config: ResearchConfigV2 = {
      query: 'How AI systems create epistemic capture through confirmation loops',
      depth: 'deep',
      evidenceRequirements: EVIDENCE_PRESETS['deep'],
      povContext: povResult.context!,
      thesisHook: routing.thesisHook,
      qualityFloor: 'grove_grade',
      userDirection: resolved.extraContext.userDirection,
      intent: routing.intent,
    };

    // Step 4: Build prompt — should include POV sections
    const prompt = buildResearchPromptV2(config);

    expect(prompt).toContain('Confirmation loops');
    expect(prompt).toContain('echo chambers');
    expect(prompt).toContain('Evidence Requirements');
    expect(prompt).toContain('Quality Floor');
    expect(prompt).toContain('Grove-Grade');
    expect(prompt).toContain('epistemic capture');
  });
});

// ==========================================
// Chain Test 2: Directive — No Thesis Hook
// ==========================================

describe('Chain: Directive — "research it" without thesis hook', () => {
  beforeEach(() => {
    clearPovCache();
  });

  it('directive answer produces prompt with evidence but no POV', () => {
    // Step 1: Parse a simple directive
    const resolved: ResolvedContext = {
      intent: 'research',
      confidence: 0.9,
      extraContext: {
        userDirection: 'research it',
      },
      slots: {
        content_signals: { score: 0.8, source: 'url', details: {} },
        classification: { score: 0.7, source: 'triage', details: { pillar: 'The Grove' } },
        bridge_context: { score: 0, source: 'none', details: {} },
        contact_data: { score: 0, source: 'none', details: {} },
        skill_requirements: { score: 0, source: 'none', details: {} },
      },
    };

    const routing = parseAnswerToRouting(resolved);

    // No thesis hook for simple directives
    expect(routing.thesisHook).toBeUndefined();

    // Step 2: Build config without POV
    const config: ResearchConfigV2 = {
      query: 'Latest developments in multi-agent architectures',
      depth: 'standard',
      evidenceRequirements: EVIDENCE_PRESETS['standard'],
      userDirection: resolved.extraContext.userDirection,
      intent: routing.intent,
    };

    // Step 3: Build prompt — evidence present, no POV
    const prompt = buildResearchPromptV2(config);

    expect(prompt).toContain('Evidence Requirements');
    expect(prompt).toContain('Latest developments');
    expect(prompt).not.toContain('Analytical Lens');
    expect(prompt).not.toContain('Counter-Arguments');
  });
});

// ==========================================
// Chain Test 3: POV Unreachable — Graceful Degradation
// ==========================================

describe('Chain: POV unreachable — research proceeds without POV', () => {
  beforeEach(() => {
    clearPovCache();
    mockNotionQuery.mockReset();
  });

  it('Notion error produces prompt without POV sections', async () => {
    // Mock Notion to throw
    mockNotionQuery.mockRejectedValueOnce(new Error('Notion API timeout'));

    const povResult = await fetchPOVContext('The Grove', 'epistemic_capture');

    // Should be unreachable, not thrown
    expect(povResult.status).toBe('unreachable');
    expect(povResult.error).toBeDefined();

    // Build config without POV — research still works
    const config: ResearchConfigV2 = {
      query: 'Epistemic capture in AI recommendation systems',
      depth: 'deep',
      evidenceRequirements: EVIDENCE_PRESETS['deep'],
      thesisHook: 'epistemic_capture',
      qualityFloor: 'grove_grade',
      // NO povContext — it was unreachable
    };

    const prompt = buildResearchPromptV2(config);

    // Evidence and quality floor still present
    expect(prompt).toContain('Evidence Requirements');
    expect(prompt).toContain('Quality Floor');
    // No POV sections
    expect(prompt).not.toContain('Analytical Lens');
  });
});

// ==========================================
// Chain Test 4: V1 Backward Compatibility
// ==========================================

describe('Chain: V1 backward compatibility', () => {
  it('plain ResearchConfig is not detected as V2', () => {
    const v1Config: ResearchConfig = {
      query: 'Basic research query',
      depth: 'standard',
    };

    expect(isResearchConfigV2(v1Config)).toBe(false);
  });

  it('ResearchConfigV2 with evidence requirements is detected', () => {
    const v2Config: ResearchConfigV2 = {
      query: 'Advanced research query',
      depth: 'standard',
      evidenceRequirements: EVIDENCE_PRESETS['standard'],
    };

    expect(isResearchConfigV2(v2Config)).toBe(true);
  });

  it('ResearchConfigV2 with only POV context is detected', () => {
    const v2Config: ResearchConfigV2 = {
      query: 'POV-enriched query',
      depth: 'deep',
      povContext: {
        title: 'Test POV',
        coreThesis: 'Test thesis',
        domainCoverage: ['AI'],
      },
    };

    expect(isResearchConfigV2(v2Config)).toBe(true);
  });
});

// ==========================================
// Chain Test 5: No 200-char Cap
// ==========================================

describe('Chain: Long query passes through untruncated', () => {
  it('query over 200 chars builds full prompt', () => {
    const longQuery = 'A'.repeat(500) + ' — exploring the intersection of epistemic frameworks and AI alignment';

    const config: ResearchConfigV2 = {
      query: longQuery,
      depth: 'deep',
      evidenceRequirements: EVIDENCE_PRESETS['deep'],
    };

    const prompt = buildResearchPromptV2(config);

    // The full query should be in the prompt
    expect(prompt).toContain(longQuery);
    expect(prompt.length).toBeGreaterThan(500);
  });
});

// ==========================================
// Chain Test 6: Entry Point Config Construction
// ==========================================

describe('Chain: Entry point config construction patterns', () => {
  it('agent-handler pattern produces valid V2 config', () => {
    const config: ResearchConfigV2 = {
      query: 'Test query from agent command',
      depth: 'standard',
      focus: 'pricing',
      voice: 'custom',
      voiceInstructions: 'Write in Grove voice',
      evidenceRequirements: EVIDENCE_PRESETS['standard'],
    };

    expect(isResearchConfigV2(config)).toBe(true);
    expect(config.evidenceRequirements?.minHardFacts).toBe(4);
  });

  it('notion-callback pattern produces valid V2 config', () => {
    const config: ResearchConfigV2 = {
      query: 'Research from Notion page',
      depth: 'standard',
      evidenceRequirements: EVIDENCE_PRESETS['standard'],
      sourceType: 'notion',
    };

    expect(isResearchConfigV2(config)).toBe(true);
    expect(config.sourceType).toBe('notion');
  });

  it('content-callback pattern produces valid V2 config', () => {
    const config: ResearchConfigV2 = {
      query: 'Research from URL content',
      depth: 'standard',
      evidenceRequirements: EVIDENCE_PRESETS['standard'],
      sourceType: 'article',
      qualityFloor: 'primary_sources',
    };

    expect(isResearchConfigV2(config)).toBe(true);
    expect(config.qualityFloor).toBe('primary_sources');
  });

  it('socratic-adapter pattern produces full V2 config', () => {
    const config: ResearchConfigV2 = {
      query: 'Socratic-resolved research query',
      depth: 'deep',
      evidenceRequirements: EVIDENCE_PRESETS['deep'],
      thesisHook: 'epistemic_capture',
      povContext: {
        title: 'Test POV',
        coreThesis: 'Test thesis',
        domainCoverage: ['AI'],
      },
      qualityFloor: 'grove_grade',
      sourceType: 'article',
      intent: 'explore',
      userDirection: 'analyze through Grove lens',
    };

    expect(isResearchConfigV2(config)).toBe(true);

    const prompt = buildResearchPromptV2(config);
    expect(prompt).toContain('Test thesis');
    expect(prompt).toContain('Socratic-resolved research query');
    expect(prompt).toContain('Grove-Grade');
    expect(prompt).toContain('analyze through Grove lens');
  });
});
