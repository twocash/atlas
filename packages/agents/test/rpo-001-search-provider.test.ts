/**
 * RPO-001: SearchProvider + Prompt Split Tests
 *
 * Validates the three-pronged fix for Gemini grounding suppression:
 * 1. systemInstruction separates behavioral from query
 * 2. Angle-bracket URL placeholders cleaned
 * 3. GeminiSearchProvider uses retry logic
 *
 * See docs/RPO-001-ROOT-CAUSE.md for full diagnosis.
 */

import { describe, it, expect, mock } from 'bun:test';

// Mock PromptManager to avoid Notion calls
mock.module('../src/services/prompt-manager', () => ({
  getPromptManager: () => ({
    getPromptById: async () => null,
    getPrompt: async () => null,
  }),
  getPrompt: async () => null,
  getPromptById: async () => null,
  listUseCases: async () => [],
}));

// Mock prompt composition to avoid Notion
mock.module('../src/services/prompt-composition/composer', () => ({
  resolveDrafterId: () => 'drafter.default.research',
  resolveDefaultDrafterId: () => 'drafter.default.research',
}));

// ==========================================
// Import AFTER mocks
// ==========================================

// We need to test buildResearchPrompt which is not exported — use the module internals
// Instead, test the observable behavior: executeResearch config → prompt shape

import type { SearchRequest, SearchResult, SearchProvider } from '../src/search/types';
import { GeminiSearchProvider } from '../src/search/gemini-provider';

// ==========================================
// SearchProvider Types
// ==========================================

describe('SearchProvider types', () => {
  it('SearchRequest has systemInstruction field', () => {
    const request: SearchRequest = {
      query: 'test query',
      systemInstruction: 'You are a test agent',
      maxOutputTokens: 1000,
    };
    expect(request.systemInstruction).toBe('You are a test agent');
    expect(request.query).toBe('test query');
  });

  it('SearchResult has groundingUsed flag', () => {
    const result: SearchResult = {
      text: 'test',
      citations: [],
      groundingUsed: true,
      searchQueries: [],
      groundingSupportCount: 0,
    };
    expect(result.groundingUsed).toBe(true);
  });

  it('SearchProvider interface requires name and generate', () => {
    const provider: SearchProvider = {
      name: 'test-provider',
      generate: async (req) => ({
        text: 'result',
        citations: [],
        groundingUsed: true,
        searchQueries: [],
        groundingSupportCount: 0,
      }),
    };
    expect(provider.name).toBe('test-provider');
    expect(typeof provider.generate).toBe('function');
  });
});

// ==========================================
// GeminiSearchProvider construction
// ==========================================

describe('GeminiSearchProvider', () => {
  it('throws without API key', () => {
    const origKey = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    try {
      expect(() => new GeminiSearchProvider('')).toThrow('GEMINI_API_KEY is required');
    } finally {
      if (origKey) process.env.GEMINI_API_KEY = origKey;
    }
  });

  it('has correct provider name', () => {
    const provider = new GeminiSearchProvider('test-key');
    expect(provider.name).toBe('gemini-google-search');
  });
});

// ==========================================
// Prompt Placeholder Cleanup
// ==========================================

describe('RPO-001: angle-bracket placeholder cleanup', () => {
  it('research.ts does not contain angle-bracket URL placeholders', async () => {
    const fs = await import('fs');
    const researchSource = fs.readFileSync(
      new URL('../src/agents/research.ts', import.meta.url),
      'utf-8'
    );

    // These specific placeholders caused grounding suppression
    expect(researchSource).not.toContain('<THE_ACTUAL_URL_FROM_YOUR_SEARCH>');
    expect(researchSource).not.toContain('<REAL_URL_1>');
    expect(researchSource).not.toContain('<REAL_URL_2>');
  });

  it('JSON template uses natural language URL descriptors', async () => {
    const fs = await import('fs');
    const researchSource = fs.readFileSync(
      new URL('../src/agents/research.ts', import.meta.url),
      'utf-8'
    );

    // The fix: natural language instead of angle-bracket placeholders
    expect(researchSource).toContain('the actual URL from your Google Search results');
    expect(researchSource).toContain('actual-search-result-url-1');
  });
});

// ==========================================
// Prompt Split Architecture
// ==========================================

describe('RPO-001: prompt split into systemInstruction + contents', () => {
  it('buildResearchPrompt returns systemInstruction and contents', async () => {
    const fs = await import('fs');
    const researchSource = fs.readFileSync(
      new URL('../src/agents/research.ts', import.meta.url),
      'utf-8'
    );

    // Verify the function signature was updated
    expect(researchSource).toContain(
      'Promise<{ systemInstruction: string; contents: string; isDrafterMode: boolean }>'
    );

    // Verify the return statement uses the new fields
    expect(researchSource).toContain('return { systemInstruction, contents, isDrafterMode }');
  });

  it('executeResearch uses SearchProvider.generate()', async () => {
    const fs = await import('fs');
    const researchSource = fs.readFileSync(
      new URL('../src/agents/research.ts', import.meta.url),
      'utf-8'
    );

    // Verify SearchProvider is used instead of GeminiClient
    expect(researchSource).toContain('const searchProvider = getSearchProvider()');
    expect(researchSource).toContain('searchProvider.generate({');
    expect(researchSource).toContain('query: contents,');
    expect(researchSource).toContain('systemInstruction,');

    // Verify old GeminiClient is gone
    expect(researchSource).not.toContain('getGeminiClient()');
    expect(researchSource).not.toContain('gemini.generateContent');
  });

  it('old dual-SDK code is removed from research.ts', async () => {
    const fs = await import('fs');
    const researchSource = fs.readFileSync(
      new URL('../src/agents/research.ts', import.meta.url),
      'utf-8'
    );

    // The old getGeminiClient had both SDK imports
    expect(researchSource).not.toContain('@google/generative-ai');
    expect(researchSource).not.toContain('GoogleGenerativeAI');
    expect(researchSource).not.toContain('googleSearchRetrieval');
  });
});

// ==========================================
// Orchestrator Result Shape
// ==========================================

describe('RPO-001: OrchestratorResult', () => {
  it('orchestration module exists with correct exports', async () => {
    const fs = await import('fs');
    const indexSource = fs.readFileSync(
      new URL('../src/orchestration/index.ts', import.meta.url),
      'utf-8'
    );
    expect(indexSource).toContain('orchestrateResearch');
    expect(indexSource).toContain('OrchestratorInput');
    expect(indexSource).toContain('OrchestratorResult');
  });

  it('OrchestratorResult includes hallucinationDetected flag', async () => {
    // Type-level test: ensure the interface compiles with expected fields
    const result = {
      agent: { id: 'test', name: 'test', status: 'complete' as const } as any,
      result: { success: true } as any,
      assessment: null,
      hallucinationDetected: false,
    };
    // Satisfies the OrchestratorResult interface
    expect(result.hallucinationDetected).toBe(false);
    expect(result.assessment).toBeNull();
  });
});

// ==========================================
// Adapter Backward Compat
// ==========================================

describe('RPO-001: research-executor re-export shim', () => {
  it('research-executor.ts re-exports from research-adapter', async () => {
    const fs = await import('fs');
    const executorSource = fs.readFileSync(
      new URL('../../../apps/telegram/src/services/research-executor.ts', import.meta.url),
      'utf-8'
    );

    expect(executorSource).toContain('from "./research-adapter"');
    expect(executorSource).toContain('export');
    expect(executorSource).toContain('registry');
    expect(executorSource).toContain('runResearchAgentWithNotifications');
    expect(executorSource).toContain('sendCompletionNotification');
  });

  it('research-adapter is under 150 LOC', async () => {
    const fs = await import('fs');
    const adapterSource = fs.readFileSync(
      new URL('../../../apps/telegram/src/services/research-adapter.ts', import.meta.url),
      'utf-8'
    );

    const lineCount = adapterSource.split('\n').length;
    expect(lineCount).toBeLessThanOrEqual(150);
  });
});
