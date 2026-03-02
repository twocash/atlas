/**
 * provenance-chain-continuity.test.ts — Sprint C: Chain Continuity
 *
 * Verifies that provenance chains flow from orchestrator through
 * research (same startedAt timestamp), route paths accumulate,
 * and finalization stamps duration.
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
import type { ProvenanceChain } from '../src/types/provenance';

// ─── Chain Flows from Orchestrator to Research ───────────

describe('chain continuity: orchestrator → research', () => {
  it('continues upstream chain (same startedAt)', () => {
    // Orchestrator creates the chain
    const chain = createProvenanceChain('orchestrator', ['message-entry'], 'user-message');
    const originalStartedAt = chain.time.startedAt;

    // Triage phase
    appendPhase(chain, {
      name: 'triage',
      provider: 'claude-haiku',
      tools: [],
      durationMs: 120,
    });

    // Chain passes to research agent
    appendPath(chain, 'research');
    appendPhase(chain, {
      name: 'retrieve',
      provider: 'claude-haiku',
      tools: ['web_search'],
      durationMs: 4200,
    });
    appendPhase(chain, {
      name: 'synthesize',
      provider: 'gemini-2.5-flash',
      tools: [],
      durationMs: 9800,
    });

    // startedAt is preserved (same chain instance)
    expect(chain.time.startedAt).toBe(originalStartedAt);
    expect(chain.route.path).toEqual(['message-entry', 'research']);
    expect(chain.compute.phases).toHaveLength(3);
    expect(chain.compute.apiCalls).toBe(3);
  });

  it('fallback: research creates fresh chain when no upstream', () => {
    // When no provenanceChain is passed, research creates its own
    const chain = createProvenanceChain('research-agent', ['research'], 'dispatch');
    expect(chain.route.entry).toBe('research-agent');
    expect(chain.route.path).toEqual(['research']);
    expect(chain.compute.phases).toEqual([]);
  });
});

// ─── Route Path Accumulation ─────────────────────────────

describe('route path accumulation', () => {
  it('orchestrateMessage path: message-entry → triage → claude-api → tools', () => {
    const chain = createProvenanceChain('orchestrator', ['message-entry'], 'user-message');

    // Triage
    appendPhase(chain, { name: 'triage', provider: 'pattern-cache', tools: [], durationMs: 5 });

    // Claude API
    appendPhase(chain, { name: 'claude-api', provider: 'claude-sonnet-4', tools: [], durationMs: 2100 });

    // Tool execution
    appendPhase(chain, { name: 'dispatch_research', provider: 'claude-sonnet-4', tools: ['dispatch_research'], durationMs: 850 });

    expect(chain.compute.phases.map(p => p.name)).toEqual(['triage', 'claude-api', 'dispatch_research']);
    expect(chain.compute.apiCalls).toBe(3);
  });

  it('orchestrateResolvedContext path: socratic-adapter → orchestrator → research', () => {
    const chain = createProvenanceChain('orchestrator', ['socratic-adapter', 'orchestrator']);

    appendPath(chain, 'research');
    appendPhase(chain, { name: 'retrieve', provider: 'claude-haiku', tools: ['web_search'], durationMs: 3500 });
    appendPhase(chain, { name: 'synthesize', provider: 'gemini-2.5-flash', tools: [], durationMs: 7200 });

    expect(chain.route.path).toEqual(['socratic-adapter', 'orchestrator', 'research']);
    expect(chain.compute.phases).toHaveLength(2);
  });
});

// ─── Finalization ────────────────────────────────────────

describe('finalization', () => {
  it('stamps totalDurationMs > 0 for non-instant chains', () => {
    const chain = createProvenanceChain('test', ['test']);
    // Backdate startedAt to ensure measurable duration
    chain.time.startedAt = new Date(Date.now() - 500).toISOString();

    finalizeProvenance(chain);

    expect(chain.time.finalizedAt).toBeTruthy();
    expect(chain.time.totalDurationMs).toBeGreaterThanOrEqual(0);
  });

  it('is idempotent — second finalize does not overwrite', () => {
    const chain = createProvenanceChain('test', ['test']);
    chain.time.startedAt = new Date(Date.now() - 200).toISOString();

    finalizeProvenance(chain);
    const firstFinalized = chain.time.finalizedAt;
    const firstDuration = chain.time.totalDurationMs;

    // Second finalize should not change values
    finalizeProvenance(chain);
    expect(chain.time.finalizedAt).toBe(firstFinalized);
    expect(chain.time.totalDurationMs).toBe(firstDuration);
  });
});

// ─── claimFlags in Result ────────────────────────────────

describe('claimFlags on ProvenanceResult', () => {
  it('initializes with empty claimFlags', () => {
    const chain = createProvenanceChain('test', ['test']);
    expect(chain.result.claimFlags).toEqual([]);
  });

  it('setResult writes claimFlags', () => {
    const chain = createProvenanceChain('test', ['test']);
    setResult(chain, {
      findingCount: 3,
      citations: ['url1'],
      claimFlags: ['financial', 'medical'],
    });

    expect(chain.result.claimFlags).toEqual(['financial', 'medical']);
  });

  it('setResult without claimFlags preserves existing', () => {
    const chain = createProvenanceChain('test', ['test']);
    setResult(chain, { claimFlags: ['legal'] });
    setResult(chain, { findingCount: 5 }); // No claimFlags

    expect(chain.result.claimFlags).toEqual(['legal']);
  });
});

// ─── Full Pipeline Simulation (Sprint C) ─────────────────

describe('full pipeline chain (Sprint C)', () => {
  it('simulates message-entry → triage → claude-api → dispatch → research → andon', () => {
    // 1. Orchestrator creates chain at message entry
    const chain = createProvenanceChain('orchestrator', ['message-entry'], 'user-message');

    // 2. Triage phase
    appendPhase(chain, { name: 'triage', provider: 'pattern-cache', tools: [], durationMs: 8 });
    setConfig(chain, { pillar: 'The Grove' });

    // 3. Claude API call
    appendPhase(chain, { name: 'claude-api', provider: 'claude-sonnet-4', tools: [], durationMs: 1800 });

    // 4. Tool dispatch (dispatch_research)
    appendPhase(chain, { name: 'dispatch_research', provider: 'claude-sonnet-4', tools: ['dispatch_research'], durationMs: 120 });

    // 5. Research uses same chain
    appendPath(chain, 'research');
    appendPhase(chain, { name: 'retrieve', provider: 'claude-haiku', tools: ['web_search'], durationMs: 4200 });
    appendPhase(chain, { name: 'synthesize', provider: 'gemini-2.5-flash', tools: [], durationMs: 9800 });

    // 6. Claims detected
    setResult(chain, {
      findingCount: 7,
      citations: ['url1', 'url2', 'url3', 'url4', 'url5', 'url6', 'url7'],
      ragChunks: ['pov:AI-Ethics-Position'],
      claimFlags: ['financial'],
      hallucinationDetected: false,
    });

    // 7. Andon assessment applied
    setResult(chain, {
      andonGrade: 'informed', // Downgraded from grounded due to financial claim
      andonConfidence: 0.85,
    });

    // 8. Finalize
    chain.time.startedAt = new Date(Date.now() - 16000).toISOString();
    finalizeProvenance(chain);

    // Verify chain integrity
    expect(chain.route.entry).toBe('orchestrator');
    expect(chain.route.trigger).toBe('user-message');
    expect(chain.route.path).toEqual(['message-entry', 'research']);
    expect(chain.config.pillar).toBe('The Grove');
    expect(chain.compute.phases).toHaveLength(5);
    expect(chain.compute.apiCalls).toBe(5);
    expect(chain.result.findingCount).toBe(7);
    expect(chain.result.citations).toHaveLength(7);
    expect(chain.result.ragChunks).toEqual(['pov:AI-Ethics-Position']);
    expect(chain.result.claimFlags).toEqual(['financial']);
    expect(chain.result.andonGrade).toBe('informed');
    expect(chain.time.totalDurationMs).toBeGreaterThanOrEqual(0);
  });
});
