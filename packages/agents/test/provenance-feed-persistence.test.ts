/**
 * provenance-feed-persistence.test.ts — Sprint C: Feed 2.0 Persistence
 *
 * Tests compact rendering, grade extraction, and the Feed update path.
 */

import { describe, it, expect } from 'bun:test';
import {
  createProvenanceChain,
  appendPhase,
  appendPath,
  setConfig,
  setContext,
  setResult,
  finalizeProvenance,
} from '../src/provenance';
import { renderProvenanceCompact, getProvenanceGrade } from '../src/provenance/render';

// ─── renderProvenanceCompact ─────────────────────────────

describe('renderProvenanceCompact', () => {
  it('produces text under 2000 chars', () => {
    const chain = createProvenanceChain('orchestrator', ['message-entry', 'research']);
    setConfig(chain, { source: 'notion', depth: 'deep', pillar: 'The Grove' });
    appendPhase(chain, { name: 'triage', provider: 'pattern-cache', tools: [], durationMs: 5 });
    appendPhase(chain, { name: 'claude-api', provider: 'claude-sonnet-4', tools: [], durationMs: 2100 });
    appendPhase(chain, { name: 'retrieve', provider: 'claude-haiku', tools: ['web_search'], durationMs: 4200 });
    appendPhase(chain, { name: 'synthesize', provider: 'gemini-2.5-flash', tools: [], durationMs: 9800 });
    setResult(chain, {
      andonGrade: 'grounded',
      andonConfidence: 0.92,
      findingCount: 7,
      citations: ['url1', 'url2', 'url3', 'url4', 'url5', 'url6', 'url7'],
      ragChunks: ['pov:AI-Ethics', 'pre-reader:extracted'],
      claimFlags: [],
    });
    chain.time.startedAt = new Date(Date.now() - 16000).toISOString();
    finalizeProvenance(chain);

    const compact = renderProvenanceCompact(chain);

    expect(compact.length).toBeLessThan(2000);
    expect(compact).toContain('Route:');
    expect(compact).toContain('Depth: deep');
    expect(compact).toContain('Pillar: The Grove');
    expect(compact).toContain('Phases:');
    expect(compact).toContain('Citations: 7 web');
    expect(compact).toContain('RAG: 2 chunks');
    expect(compact).toContain('Grade: grounded');
    expect(compact).toContain('Duration:');
  });

  it('includes claim flags when present', () => {
    const chain = createProvenanceChain('test', ['test']);
    setResult(chain, {
      claimFlags: ['financial', 'medical'],
      citations: [],
      ragChunks: [],
    });

    const compact = renderProvenanceCompact(chain);
    expect(compact).toContain('Claims: financial, medical');
  });

  it('omits optional fields when not present', () => {
    const chain = createProvenanceChain('test', ['test']);
    // No depth, no pillar, no phases, no grade
    const compact = renderProvenanceCompact(chain);

    expect(compact).toContain('Route:');
    expect(compact).toContain('Trigger: user-message');
    expect(compact).not.toContain('Depth:');
    expect(compact).not.toContain('Pillar:');
    expect(compact).not.toContain('Phases:');
    expect(compact).not.toContain('Grade:');
    expect(compact).not.toContain('Duration:');
    expect(compact).not.toContain('Claims:');
  });

  it('uses pipe separator', () => {
    const chain = createProvenanceChain('test', ['test']);
    const compact = renderProvenanceCompact(chain);
    expect(compact).toContain(' | ');
  });
});

// ─── getProvenanceGrade ──────────────────────────────────

describe('getProvenanceGrade', () => {
  it('returns "Grounded" for grounded', () => {
    const chain = createProvenanceChain('test', ['test']);
    setResult(chain, { andonGrade: 'grounded' });
    expect(getProvenanceGrade(chain)).toBe('Grounded');
  });

  it('returns "Informed" for informed', () => {
    const chain = createProvenanceChain('test', ['test']);
    setResult(chain, { andonGrade: 'informed' });
    expect(getProvenanceGrade(chain)).toBe('Informed');
  });

  it('returns "Speculative" for speculative', () => {
    const chain = createProvenanceChain('test', ['test']);
    setResult(chain, { andonGrade: 'speculative' });
    expect(getProvenanceGrade(chain)).toBe('Speculative');
  });

  it('returns "Insufficient" for insufficient', () => {
    const chain = createProvenanceChain('test', ['test']);
    setResult(chain, { andonGrade: 'insufficient' });
    expect(getProvenanceGrade(chain)).toBe('Insufficient');
  });

  it('returns "Pending" when no grade set', () => {
    const chain = createProvenanceChain('test', ['test']);
    expect(getProvenanceGrade(chain)).toBe('Pending');
  });
});

// ─── Feed Property Contract ──────────────────────────────

describe('Feed 2.0 property contract', () => {
  it('compact text + grade pair are consistent', () => {
    const chain = createProvenanceChain('orchestrator', ['socratic-adapter', 'orchestrator']);
    appendPath(chain, 'research');
    setConfig(chain, { source: 'notion', depth: 'standard', pillar: 'Consulting' });
    appendPhase(chain, { name: 'retrieve', provider: 'claude-haiku', tools: ['web_search'], durationMs: 3200 });
    appendPhase(chain, { name: 'synthesize', provider: 'gemini-2.5-flash', tools: [], durationMs: 8100 });
    setResult(chain, {
      andonGrade: 'informed',
      andonConfidence: 0.72,
      findingCount: 4,
      citations: ['url1', 'url2', 'url3', 'url4'],
      ragChunks: [],
      claimFlags: ['financial'],
    });
    chain.time.startedAt = new Date(Date.now() - 11300).toISOString();
    finalizeProvenance(chain);

    const grade = getProvenanceGrade(chain);
    const compact = renderProvenanceCompact(chain);

    // Grade matches what's in compact text
    expect(grade).toBe('Informed');
    expect(compact).toContain('Grade: informed');

    // Compact reflects all key data
    expect(compact).toContain('Pillar: Consulting');
    expect(compact).toContain('Citations: 4 web');
    expect(compact).toContain('Claims: financial');
    expect(compact).toContain('72%');
  });
});
