/**
 * ProvenanceChain — Unit tests for Sprint A provenance core
 *
 * Tests: chain creation, accumulation, rendering (Telegram + Notion).
 * Verifies the contract between research pipeline and delivery layers.
 */

import { describe, it, expect } from 'bun:test';
import {
  createProvenanceChain,
  appendPhase,
  setConfig,
  setContext,
  setResult,
  appendPath,
  finalizeProvenance,
} from '../src/provenance';
import { renderProvenanceNotion } from '../src/provenance/render';
import { renderProvenanceTelegram } from '../../../apps/telegram/src/services/provenance-render';

// ─── Chain Creation ───────────────────────────────────────

describe('createProvenanceChain', () => {
  it('initializes all 6 fields with defaults', () => {
    const chain = createProvenanceChain('orchestrator', ['socratic-resolved']);

    // Route
    expect(chain.route.entry).toBe('orchestrator');
    expect(chain.route.path).toEqual(['socratic-resolved']);
    expect(chain.route.trigger).toBe('user-message');

    // Config defaults
    expect(chain.config.source).toBe('compiled-default');
    expect(chain.config.povContextInjected).toBe(false);
    expect(chain.config.v2ConfigApplied).toBe(false);

    // Compute empty
    expect(chain.compute.phases).toEqual([]);
    expect(chain.compute.apiCalls).toBe(0);

    // Context empty
    expect(chain.context.slots).toEqual({});
    expect(chain.context.ragSources).toEqual([]);
    expect(chain.context.preReaderAvailable).toBe(false);

    // Result empty
    expect(chain.result.citations).toEqual([]);
    expect(chain.result.ragChunks).toEqual([]);
    expect(chain.result.findingCount).toBe(0);
    expect(chain.result.hallucinationDetected).toBe(false);

    // Time
    expect(chain.time.startedAt).toBeTruthy();
    expect(chain.time.finalizedAt).toBeUndefined();
  });

  it('accepts custom trigger', () => {
    const chain = createProvenanceChain('research-agent', ['research'], 'url-share');
    expect(chain.route.trigger).toBe('url-share');
  });
});

// ─── Accumulation ─────────────────────────────────────────

describe('appendPhase', () => {
  it('appends phase and increments apiCalls', () => {
    const chain = createProvenanceChain('test', ['test']);

    appendPhase(chain, {
      name: 'retrieve',
      provider: 'claude-haiku',
      tools: ['web_search'],
      durationMs: 3200,
    });

    expect(chain.compute.phases).toHaveLength(1);
    expect(chain.compute.phases[0].name).toBe('retrieve');
    expect(chain.compute.apiCalls).toBe(1);

    appendPhase(chain, {
      name: 'synthesize',
      provider: 'gemini-2.0-flash',
      tools: [],
      durationMs: 8100,
    });

    expect(chain.compute.phases).toHaveLength(2);
    expect(chain.compute.apiCalls).toBe(2);
  });
});

describe('setConfig', () => {
  it('merges config fields', () => {
    const chain = createProvenanceChain('test', ['test']);

    setConfig(chain, { source: 'notion', depth: 'deep', pillar: 'The Grove' });

    expect(chain.config.source).toBe('notion');
    expect(chain.config.depth).toBe('deep');
    expect(chain.config.pillar).toBe('The Grove');
    // Defaults preserved
    expect(chain.config.povContextInjected).toBe(false);
  });
});

describe('setContext', () => {
  it('sets context fields individually', () => {
    const chain = createProvenanceChain('test', ['test']);

    setContext(chain, { sourceUrl: 'https://example.com', preReaderAvailable: true });

    expect(chain.context.sourceUrl).toBe('https://example.com');
    expect(chain.context.preReaderAvailable).toBe(true);
    expect(chain.context.ragSources).toEqual([]); // Unchanged
  });
});

describe('setResult', () => {
  it('sets Andon assessment fields', () => {
    const chain = createProvenanceChain('test', ['test']);

    setResult(chain, {
      andonGrade: 'grounded',
      andonConfidence: 0.87,
      findingCount: 5,
      citations: ['https://a.com', 'https://b.com'],
    });

    expect(chain.result.andonGrade).toBe('grounded');
    expect(chain.result.andonConfidence).toBe(0.87);
    expect(chain.result.findingCount).toBe(5);
    expect(chain.result.citations).toHaveLength(2);
    // Unchanged
    expect(chain.result.hallucinationDetected).toBe(false);
  });
});

describe('appendPath', () => {
  it('adds segments to route path', () => {
    const chain = createProvenanceChain('orchestrator', ['socratic-resolved']);

    appendPath(chain, 'research');
    appendPath(chain, 'delivery');

    expect(chain.route.path).toEqual(['socratic-resolved', 'research', 'delivery']);
  });
});

describe('finalizeProvenance', () => {
  it('stamps finalizedAt and totalDurationMs', () => {
    const chain = createProvenanceChain('test', ['test']);
    // Slight delay to ensure non-zero duration
    chain.time.startedAt = new Date(Date.now() - 100).toISOString();

    finalizeProvenance(chain);

    expect(chain.time.finalizedAt).toBeTruthy();
    expect(chain.time.totalDurationMs).toBeGreaterThanOrEqual(0);
  });
});

// ─── Rendering: Telegram HTML ─────────────────────────────

describe('renderProvenanceTelegram', () => {
  it('renders compact HTML with all sections', () => {
    const chain = createProvenanceChain('orchestrator', ['socratic-resolved']);
    appendPath(chain, 'research');
    setConfig(chain, { source: 'notion', depth: 'deep' });
    appendPhase(chain, { name: 'retrieve', provider: 'claude-haiku', tools: ['web_search'], durationMs: 3200 });
    appendPhase(chain, { name: 'synthesize', provider: 'gemini-2.0-flash', tools: [], durationMs: 8100 });
    setResult(chain, { andonGrade: 'grounded', andonConfidence: 0.92, citations: ['https://a.com'], findingCount: 3 });
    finalizeProvenance(chain);

    const html = renderProvenanceTelegram(chain);

    expect(html).toContain('<b>───── Provenance ─────</b>');
    expect(html).toContain('socratic-resolved');
    expect(html).toContain('research');
    expect(html).toContain('notion | deep');
    expect(html).toContain('retrieve (claude-haiku, 3.2s)');
    expect(html).toContain('synthesize (gemini-2.0-flash, 8.1s)');
    expect(html).toContain('1 web citation');
    expect(html).toContain('0 RAG chunks');
    expect(html).toContain('grounded');
    expect(html).toContain('0.92');
  });

  it('escapes HTML entities', () => {
    const chain = createProvenanceChain('test', ['path<script>']);
    const html = renderProvenanceTelegram(chain);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

// ─── Rendering: Notion Markdown ───────────────────────────

describe('renderProvenanceNotion', () => {
  it('renders markdown with all sections', () => {
    const chain = createProvenanceChain('orchestrator', ['socratic-resolved']);
    appendPath(chain, 'research');
    setConfig(chain, { source: 'notion', depth: 'deep', pillar: 'The Grove', drafter: 'grove-drafter' });
    setContext(chain, { sourceUrl: 'https://example.com', preReaderAvailable: true, slots: { pillar: 'filled', depth: 'inferred' } });
    appendPhase(chain, { name: 'retrieve', provider: 'claude-haiku', tools: ['web_search'], durationMs: 3200 });
    appendPhase(chain, { name: 'synthesize', provider: 'gemini-2.0-flash', tools: [], durationMs: 8100 });
    setResult(chain, {
      andonGrade: 'grounded',
      andonConfidence: 0.92,
      findingCount: 5,
      citations: ['https://a.com', 'https://b.com', 'https://c.com'],
      ragChunks: ['chunk-1'],
    });
    finalizeProvenance(chain);

    const md = renderProvenanceNotion(chain);

    expect(md).toContain('## Provenance');
    expect(md).toContain('**Entry:** orchestrator');
    expect(md).toContain('**Depth:** deep');
    expect(md).toContain('**Pillar:** The Grove');
    expect(md).toContain('**Drafter:** grove-drafter');
    expect(md).toContain('| retrieve | claude-haiku | web_search | 3.2s |');
    expect(md).toContain('**Source URL:** https://example.com');
    expect(md).toContain('pillar=filled');
    expect(md).toContain('**Andon Gate:** grounded (0.92)');
    expect(md).toContain('**Findings:** 5');
    expect(md).toContain('**Web Citations:** 3');
    expect(md).toContain('**RAG Chunks:** 1');
    expect(md).toContain('**Phase Breakdown:**');
  });
});

// ─── Full Pipeline Simulation ─────────────────────────────

describe('full pipeline chain', () => {
  it('simulates orchestrator → research → andon → delivery', () => {
    // 1. Orchestrator creates chain
    const chain = createProvenanceChain('orchestrator', ['socratic-resolved'], 'url-share');

    // 2. Config resolved from Notion
    setConfig(chain, { source: 'notion', depth: 'standard', pillar: 'The Grove', v2ConfigApplied: true });

    // 3. Context from Socratic resolution
    setContext(chain, {
      sourceUrl: 'https://anthropic.com/news',
      preReaderAvailable: true,
      slots: { pillar: 'filled', depth: 'inferred', intent: 'filled' },
    });

    // 4. Research pipeline
    appendPath(chain, 'research');
    appendPhase(chain, { name: 'retrieve', provider: 'claude-haiku', tools: ['web_search'], durationMs: 4200 });
    appendPhase(chain, { name: 'synthesize', provider: 'gemini-2.0-flash', tools: [], durationMs: 9800 });

    // 5. Andon assessment
    setResult(chain, {
      andonGrade: 'grounded',
      andonConfidence: 0.88,
      findingCount: 7,
      citations: ['url1', 'url2', 'url3', 'url4', 'url5', 'url6', 'url7'],
    });

    // 6. Finalize
    finalizeProvenance(chain);

    // Verify chain integrity
    expect(chain.route.trigger).toBe('url-share');
    expect(chain.route.path).toEqual(['socratic-resolved', 'research']);
    expect(chain.config.source).toBe('notion');
    expect(chain.config.v2ConfigApplied).toBe(true);
    expect(chain.compute.phases).toHaveLength(2);
    expect(chain.compute.apiCalls).toBe(2);
    expect(chain.context.preReaderAvailable).toBe(true);
    expect(chain.result.andonGrade).toBe('grounded');
    expect(chain.result.citations).toHaveLength(7);
    expect(chain.time.totalDurationMs).toBeGreaterThanOrEqual(0);

    // Renders for both surfaces
    const telegram = renderProvenanceTelegram(chain);
    expect(telegram).toContain('grounded');
    expect(telegram).toContain('7 web citations');

    const notion = renderProvenanceNotion(chain);
    expect(notion).toContain('**Web Citations:** 7');
  });
});
