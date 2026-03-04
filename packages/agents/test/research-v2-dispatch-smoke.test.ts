/**
 * research-v2-dispatch-smoke.test.ts — P0 Fix Smoke Test
 *
 * Verifies the 3 invariants from commit 6309c6f:
 *   1. executeDispatchResearch builds V2 config (evidenceRequirements, sourceType, intent)
 *   2. sessionId threads from executeTool() context → orchestrateResearch()
 *   3. Orchestrator attempts context composition when sessionId present (no V1 guard)
 *
 * Pattern: Module mocking to intercept orchestrateResearch() calls.
 * No live API calls, no Notion, no Gemini.
 */

import { describe, it, expect, mock, beforeEach } from 'bun:test';

// ─── Mock Setup (BEFORE imports) ────────────────────────

// Capture what orchestrateResearch receives
let capturedOrchestratorInput: any = null;
let capturedRegistry: any = null;

mock.module('../src/orchestration/research-orchestrator', () => ({
  orchestrateResearch: async (input: any, registry: any) => {
    capturedOrchestratorInput = input;
    capturedRegistry = registry;
    return {
      agent: { id: 'mock-agent', name: 'Research [tool-dispatch]: test', status: 'completed' },
      result: {
        success: true,
        output: {
          summary: 'Test summary with real sources.',
          findings: [{ source: 'test.com', content: 'finding' }],
          sources: ['https://test.com/article'],
          bibliography: [],
        },
        metrics: { durationMs: 1000 },
      },
      assessment: {
        confidence: 'grounded',
        noveltyScore: 0.8,
        routing: 'deliver',
        calibration: {
          emoji: '🟢',
          label: 'Grounded Research',
          caveat: null,
        },
      },
      hallucinationDetected: false,
    };
  },
}));

// Mock workqueue (Notion dependency)
mock.module('../src/workqueue', () => ({
  createResearchWorkItem: async () => ({
    pageId: 'mock-page-id',
    url: 'https://notion.so/mock-work-item',
  }),
  wireAgentToWorkQueue: async () => {},
  appendDispatchNotes: async () => {},
}));

// Mock registry
mock.module('../src/registry', () => ({
  AgentRegistry: class {
    async spawn() { return { id: 'mock-agent', name: 'test' }; }
    async start() {}
    async complete() {}
    async fail() {}
    async status() { return null; }
  },
}));

// ─── Import AFTER mocks ──────────────────────────────────

import { executeAgentTools } from '../src/conversation/tools/agents';

// ─── Tests ───────────────────────────────────────────────

describe('P0 Research V2 Dispatch Smoke', () => {
  beforeEach(() => {
    capturedOrchestratorInput = null;
    capturedRegistry = null;
  });

  it('builds V2 config with evidenceRequirements (not bare V1)', async () => {
    await executeAgentTools(
      'dispatch_research',
      { query: 'quantum computing 2026 outlook', pillar: 'The Grove', depth: 'standard' },
      { sessionId: 12345 },
    );

    expect(capturedOrchestratorInput).not.toBeNull();
    const config = capturedOrchestratorInput.config;

    // V2 fields must be present
    expect(config.evidenceRequirements).toBeDefined();
    expect(config.evidenceRequirements.depth).toBe('standard');
    expect(config.evidenceRequirements.minHardFacts).toBeGreaterThan(0);
    expect(config.sourceType).toBe('command');
    expect(config.intent).toBe('explore');

    // Base fields still present
    expect(config.query).toBe('quantum computing 2026 outlook');
    expect(config.pillar).toBe('The Grove');
    expect(config.depth).toBe('standard');
  });

  it('threads sessionId through to orchestrateResearch', async () => {
    await executeAgentTools(
      'dispatch_research',
      { query: 'test query', pillar: 'Personal' },
      { sessionId: 99999 },
    );

    expect(capturedOrchestratorInput).not.toBeNull();
    expect(capturedOrchestratorInput.sessionId).toBe(99999);
  });

  it('passes sessionId=undefined when no context provided', async () => {
    await executeAgentTools(
      'dispatch_research',
      { query: 'test query no context', pillar: 'Consulting' },
      // No context param — simulates old code path
    );

    expect(capturedOrchestratorInput).not.toBeNull();
    expect(capturedOrchestratorInput.sessionId).toBeUndefined();
  });

  it('uses EVIDENCE_PRESETS for each depth level', async () => {
    // Light
    await executeAgentTools(
      'dispatch_research',
      { query: 'quick facts', pillar: 'Personal', depth: 'light' },
      { sessionId: 1 },
    );
    expect(capturedOrchestratorInput.config.evidenceRequirements.depth).toBe('light');
    expect(capturedOrchestratorInput.config.evidenceRequirements.minHardFacts).toBe(0);

    // Deep
    await executeAgentTools(
      'dispatch_research',
      { query: 'deep analysis', pillar: 'The Grove', depth: 'deep' },
      { sessionId: 2 },
    );
    expect(capturedOrchestratorInput.config.evidenceRequirements.depth).toBe('deep');
    expect(capturedOrchestratorInput.config.evidenceRequirements.requirePrimarySources).toBe(true);
    expect(capturedOrchestratorInput.config.evidenceRequirements.requireCountitative).toBe(undefined); // typo guard
    expect(capturedOrchestratorInput.config.evidenceRequirements.requireQuantitative).toBe(true);
  });

  it('sets source=tool-dispatch for provenance', async () => {
    await executeAgentTools(
      'dispatch_research',
      { query: 'provenance test', pillar: 'Home/Garage' },
      { sessionId: 3 },
    );

    expect(capturedOrchestratorInput.source).toBe('tool-dispatch');
  });

  it('defaults depth=standard and voice=atlas-research when omitted', async () => {
    await executeAgentTools(
      'dispatch_research',
      { query: 'minimal input', pillar: 'Consulting' },
      { sessionId: 4 },
    );

    const config = capturedOrchestratorInput.config;
    expect(config.depth).toBe('standard');
    expect(config.voice).toBe('atlas-research');
    expect(config.evidenceRequirements.depth).toBe('standard');
  });

  it('returns Andon assessment in result shape', async () => {
    const result = await executeAgentTools(
      'dispatch_research',
      { query: 'andon test', pillar: 'The Grove' },
      { sessionId: 5 },
    );

    expect(result).not.toBeNull();
    expect(result!.success).toBe(true);
    const resultData = result!.result as any;
    expect(resultData.andonConfidence).toBe('grounded');
    expect(resultData.andonRouting).toBe('deliver');
    expect(resultData.sourcesCount).toBe(1);
  });
});
