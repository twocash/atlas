/**
 * provenance-exit-paths.test.ts — Sprint C: Bug 7 + Bug 8
 *
 * Validates the architectural invariant: every provenance feature must fire
 * on every exit path. The orchestrator has three exits:
 *   1. Action/tool (Schedule, Build, Process, Triage)
 *   2. Chat/conversational (Chat, Quick Answer, Answer)
 *   3. Research/resolved context (Socratic → dispatch)
 *
 * These tests verify:
 * - Grade is set BEFORE Feed write (Bug 7)
 * - Claim detection fires on all paths (Bug 8)
 * - getProvenanceGrade never returns 'Pending' after finalization
 *
 * Pattern: Re-implement provenance lifecycle to test the contract,
 * same approach as research-hallucination-guard.test.ts.
 */

import { describe, it, expect } from 'bun:test';
import { detectSensitiveClaims } from '../src/services/claim-detector';

// ─── Re-implement provenance lifecycle (same as orchestrator.ts) ──

interface ProvenanceResult {
  findingCount: number;
  citations: string[];
  ragChunks: string[];
  hallucinationDetected: boolean;
  andonGrade?: string;
  claimFlags: string[];
}

interface ProvenanceChain {
  result: ProvenanceResult;
  time: { startedAt: string; finalizedAt?: string; totalDurationMs?: number };
}

function createChain(): ProvenanceChain {
  return {
    result: {
      findingCount: 0,
      citations: [],
      ragChunks: [],
      hallucinationDetected: false,
      claimFlags: [],
    },
    time: { startedAt: new Date().toISOString() },
  };
}

function setResult(chain: ProvenanceChain, result: Partial<ProvenanceResult>): void {
  if (result.andonGrade !== undefined) chain.result.andonGrade = result.andonGrade;
  if (result.claimFlags) chain.result.claimFlags = result.claimFlags;
  if (result.findingCount !== undefined) chain.result.findingCount = result.findingCount;
  if (result.citations) chain.result.citations = result.citations;
  if (result.hallucinationDetected !== undefined) chain.result.hallucinationDetected = result.hallucinationDetected;
}

function finalize(chain: ProvenanceChain): void {
  chain.time.finalizedAt = new Date().toISOString();
  chain.time.totalDurationMs = Date.now() - new Date(chain.time.startedAt).getTime();
}

function getProvenanceGrade(chain: ProvenanceChain): string {
  return chain.result.andonGrade
    ? chain.result.andonGrade.charAt(0).toUpperCase() + chain.result.andonGrade.slice(1)
    : 'Pending';
}

// ─── Simulate the three exit paths (same logic as orchestrator.ts) ──

function simulateOrchestratePath(
  requestType: string,
  responseText: string,
): { chain: ProvenanceChain; grade: string; claimFlags: string[] } {
  const chain = createChain();

  // Grade determination (matches orchestrator.ts logic)
  const actionTypes = new Set(['Schedule', 'Build', 'Process', 'Triage']);
  const grade = actionTypes.has(requestType) ? 'grounded' : 'informed';

  // Claim detection on response text
  const claims = detectSensitiveClaims(responseText);

  // Set result BEFORE simulated audit write
  setResult(chain, {
    findingCount: 0,
    citations: [],
    ragChunks: [],
    hallucinationDetected: false,
    andonGrade: grade,
    claimFlags: claims.flags,
  });
  finalize(chain);

  // At this point, Feed write would happen — grade must be set
  return { chain, grade: getProvenanceGrade(chain), claimFlags: claims.flags };
}

function simulateResolvedContextPath(
  requestType: string,
  content: string,
  title: string,
): { chain: ProvenanceChain; grade: string; claimFlags: string[] } {
  const chain = createChain();

  // Grade determination (matches orchestrateResolvedContext logic)
  const resolvedActionTypes = new Set(['Schedule', 'Build', 'Process', 'Triage']);
  const grade = resolvedActionTypes.has(requestType) ? 'grounded' : 'informed';

  // Claim detection on content + title
  const claims = detectSensitiveClaims(content + ' ' + title);

  setResult(chain, {
    findingCount: 0,
    citations: [],
    ragChunks: [],
    hallucinationDetected: false,
    andonGrade: grade,
    claimFlags: claims.flags,
  });
  finalize(chain);

  return { chain, grade: getProvenanceGrade(chain), claimFlags: claims.flags };
}

// ─── Bug 7: Grade finalization on all exit paths ──────────────

describe('Bug 7: Provenance grade fires on all exit paths', () => {
  // Path 1: Action/tool exits
  it('Schedule gets grade "Grounded" (not Pending)', () => {
    const { grade } = simulateOrchestratePath('Schedule', 'Meeting scheduled for Friday.');
    expect(grade).toBe('Grounded');
  });

  it('Build gets grade "Grounded"', () => {
    const { grade } = simulateOrchestratePath('Build', 'Deployed to production.');
    expect(grade).toBe('Grounded');
  });

  it('Process gets grade "Grounded"', () => {
    const { grade } = simulateOrchestratePath('Process', 'Migration complete.');
    expect(grade).toBe('Grounded');
  });

  it('Triage gets grade "Grounded"', () => {
    const { grade } = simulateOrchestratePath('Triage', 'Triaged 3 items from Feed.');
    expect(grade).toBe('Grounded');
  });

  // Path 2: Chat/conversational exits
  it('Chat gets grade "Informed" (not Pending)', () => {
    const { grade } = simulateOrchestratePath('Chat', 'Here is what I think about edge AI chips...');
    expect(grade).toBe('Informed');
  });

  it('Quick Answer gets grade "Informed"', () => {
    const { grade } = simulateOrchestratePath('Quick Answer', 'The answer is 42.');
    expect(grade).toBe('Informed');
  });

  it('Answer gets grade "Informed"', () => {
    const { grade } = simulateOrchestratePath('Answer', 'Yes, that looks correct.');
    expect(grade).toBe('Informed');
  });

  // Path 3: Resolved context exits
  it('Research resolved context gets grade "Informed"', () => {
    const { grade } = simulateResolvedContextPath('Research', 'https://threads.com/post/123', 'AI Agents Discussion');
    expect(grade).toBe('Informed');
  });

  it('Draft resolved context gets grade "Informed"', () => {
    const { grade } = simulateResolvedContextPath('Draft', 'Write a LinkedIn post about AI', 'LinkedIn Post');
    expect(grade).toBe('Informed');
  });

  it('Schedule resolved context gets grade "Grounded"', () => {
    const { grade } = simulateResolvedContextPath('Schedule', 'Meet with Bob tomorrow', 'Meeting with Bob');
    expect(grade).toBe('Grounded');
  });

  // The critical invariant: no path returns "Pending"
  it('NO exit path returns Pending after finalization', () => {
    const requestTypes = ['Schedule', 'Build', 'Process', 'Triage', 'Chat', 'Quick Answer', 'Answer', 'Research', 'Draft'];
    for (const rt of requestTypes) {
      const { grade } = simulateOrchestratePath(rt, 'Some response.');
      expect(grade).not.toBe('Pending');
    }
  });

  // Unfinalzed chain returns Pending (the bug condition)
  it('unfinalized chain returns Pending (regression check)', () => {
    const chain = createChain();
    // No setResult, no finalize — this is the bug condition
    expect(getProvenanceGrade(chain)).toBe('Pending');
  });
});

// ─── Bug 8: Claim detection fires on all exit paths ──────────

describe('Bug 8: Claim detection fires on all exit paths', () => {
  // Path 1: Chat/conversational — financial claims
  it('detects financial claims in chat response', () => {
    const { claimFlags } = simulateOrchestratePath(
      'Chat',
      'Tesla stock will reach $500 by Q3. You should buy before the earnings call.',
    );
    expect(claimFlags).toContain('financial');
  });

  // Path 1: Chat/conversational — medical claims
  it('detects medical claims in chat response', () => {
    const { claimFlags } = simulateOrchestratePath(
      'Chat',
      'You should stop taking your medication and try this supplement instead.',
    );
    expect(claimFlags).toContain('medical');
  });

  // Path 1: Chat/conversational — legal claims
  it('detects legal claims in chat response', () => {
    const { claimFlags } = simulateOrchestratePath(
      'Chat',
      'You should sue your employer for breach of contract.',
    );
    expect(claimFlags).toContain('legal');
  });

  // Path 2: Action exits — still runs claim detection
  it('detects financial claims even on action-type exits', () => {
    const { claimFlags } = simulateOrchestratePath(
      'Schedule',
      'Scheduled a meeting to discuss investing $50,000 into Bitcoin. You should buy before the halving.',
    );
    expect(claimFlags).toContain('financial');
  });

  // Path 3: Resolved context — financial claims in URL content
  it('detects financial claims in resolved context', () => {
    const { claimFlags } = simulateResolvedContextPath(
      'Research',
      'https://example.com/stocks',
      'Stock XYZ will reach $1000 — you should buy now',
    );
    expect(claimFlags).toContain('financial');
  });

  // Path 3: Resolved context — medical claims
  it('detects medical claims in resolved context', () => {
    const { claimFlags } = simulateResolvedContextPath(
      'Research',
      'Take 200mg aspirin daily for heart health',
      'Aspirin dosage recommendation',
    );
    expect(claimFlags).toContain('medical');
  });

  // Neutral content — no false positives
  it('no flags for neutral edge AI discussion', () => {
    const { claimFlags } = simulateOrchestratePath(
      'Chat',
      'The edge AI chip market is growing. NVIDIA leads enterprise, Qualcomm leads consumer NPUs.',
    );
    expect(claimFlags).toHaveLength(0);
  });

  it('no flags for neutral URL share', () => {
    const { claimFlags } = simulateResolvedContextPath(
      'Research',
      'https://threads.com/interesting-ai-post',
      'New research on transformer architectures',
    );
    expect(claimFlags).toHaveLength(0);
  });

  // Attributed claims — not flagged
  it('attributed financial claims are not flagged', () => {
    const { claimFlags } = simulateOrchestratePath(
      'Chat',
      'According to Bloomberg, Tesla stock will reach $500 by year end.',
    );
    expect(claimFlags).toHaveLength(0);
  });

  // Claims in claimFlags propagate to provenance chain
  it('claimFlags are set on the provenance chain', () => {
    const { chain } = simulateOrchestratePath(
      'Chat',
      'You should buy NVIDIA stock immediately. It will reach $2000.',
    );
    expect(chain.result.claimFlags).toContain('financial');
    expect(chain.result.claimFlags.length).toBeGreaterThan(0);
  });
});

// ─── Integration: Grade + Claims combined ──────────────────

describe('Provenance: grade + claims combined on exit paths', () => {
  it('chat with financial claim gets Informed grade + financial flag', () => {
    const { grade, claimFlags } = simulateOrchestratePath(
      'Chat',
      'Tesla will reach $500 by Q3.',
    );
    expect(grade).toBe('Informed');
    expect(claimFlags).toContain('financial');
  });

  it('action with no claims gets Grounded grade + empty flags', () => {
    const { grade, claimFlags } = simulateOrchestratePath(
      'Schedule',
      'Meeting booked for 3pm.',
    );
    expect(grade).toBe('Grounded');
    expect(claimFlags).toHaveLength(0);
  });

  it('resolved context with legal claim gets Informed grade + legal flag', () => {
    const { grade, claimFlags } = simulateResolvedContextPath(
      'Draft',
      'You should sue for breach of contract',
      'Legal draft',
    );
    expect(grade).toBe('Informed');
    expect(claimFlags).toContain('legal');
  });

  it('all three exit paths produce finalized chains with timing', () => {
    const paths = [
      simulateOrchestratePath('Chat', 'Hello'),
      simulateOrchestratePath('Build', 'Deployed'),
      simulateResolvedContextPath('Research', 'content', 'title'),
    ];
    for (const { chain } of paths) {
      expect(chain.time.finalizedAt).toBeDefined();
      expect(chain.time.totalDurationMs).toBeGreaterThanOrEqual(0);
    }
  });
});
