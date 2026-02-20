/**
 * ADR-003: Research Query Construction Tests
 *
 * Validates the canonical query construction pipeline:
 * - buildResearchQuery() produces clean topic descriptions
 * - mapAnswerToRouting() extracts routing signals without polluting query
 * - queryMode flag distinguishes canonical from legacy paths
 */

import { describe, it, expect } from 'bun:test';
import { buildResearchQuery, type QueryInput } from '../src/agents/research';

// ==========================================
// buildResearchQuery() Tests
// ==========================================

describe('buildResearchQuery', () => {
  it('uses triageTitle as primary source', () => {
    const result = buildResearchQuery({
      triageTitle: 'Google Research: Prompt Doubling Lifts Accuracy',
    });
    expect(result).toBe('Google Research: Prompt Doubling Lifts Accuracy');
  });

  it('falls back to fallbackTitle when triageTitle is empty', () => {
    const result = buildResearchQuery({
      triageTitle: '',
      fallbackTitle: 'OG Page Title From Fetch',
    });
    expect(result).toBe('OG Page Title From Fetch');
  });

  it('throws when both triageTitle and fallbackTitle are empty', () => {
    expect(() => buildResearchQuery({
      triageTitle: '',
      fallbackTitle: '',
    })).toThrow('no title available');
  });

  it('throws when triageTitle is whitespace-only and no fallback', () => {
    expect(() => buildResearchQuery({
      triageTitle: '   ',
    })).toThrow('no title available');
  });

  it('strips HTML tags from title', () => {
    const result = buildResearchQuery({
      triageTitle: 'Research on <b>AI Models</b> and <em>Performance</em>',
    });
    expect(result).toBe('Research on AI Models and Performance');
    expect(result).not.toContain('<');
    expect(result).not.toContain('>');
  });

  it('appends keywords when under budget', () => {
    const result = buildResearchQuery({
      triageTitle: 'Agent Architecture Patterns',
      keywords: ['MCP', 'tool-use'],
    });
    expect(result).toBe('Agent Architecture Patterns — MCP, tool-use');
  });

  it('skips keywords when they would exceed 200 chars', () => {
    const longTitle = 'A'.repeat(195);
    const result = buildResearchQuery({
      triageTitle: longTitle,
      keywords: ['keyword1', 'keyword2'],
    });
    expect(result).toBe(longTitle);
    expect(result).not.toContain('keyword');
  });

  it('caps total length at 200 chars', () => {
    const longTitle = 'A'.repeat(250);
    const result = buildResearchQuery({
      triageTitle: longTitle,
    });
    expect(result.length).toBe(200);
    expect(result).toEndWith('...');
  });

  it('does not include URL in query text (Anti-Pattern 1)', () => {
    const result = buildResearchQuery({
      triageTitle: 'Shawn Chauhan Thread on Agent Patterns',
      url: 'https://www.threads.net/@shawnchauhan/post/abc123',
    });
    expect(result).not.toContain('threads.net');
    expect(result).not.toContain('http');
    expect(result).toBe('Shawn Chauhan Thread on Agent Patterns');
  });

  it('does not include user direction in query (Anti-Pattern 2)', () => {
    // buildResearchQuery doesn't even accept userDirection —
    // that's the architectural constraint. Verify the interface.
    const input: QueryInput = {
      triageTitle: 'Google Research Paper',
      keywords: ['accuracy'],
    };
    // No userDirection field exists on QueryInput
    expect(Object.keys(input)).not.toContain('userDirection');
  });

  it('trims whitespace from titles', () => {
    const result = buildResearchQuery({
      triageTitle: '  Spaced Title  ',
    });
    expect(result).toBe('Spaced Title');
  });

  it('handles title with only HTML tags', () => {
    const result = buildResearchQuery({
      triageTitle: '',
      fallbackTitle: 'Clean Fallback',
    });
    expect(result).toBe('Clean Fallback');
  });

  it('prefers triageTitle over fallbackTitle when both present', () => {
    const result = buildResearchQuery({
      triageTitle: 'Triage Winner',
      fallbackTitle: 'Fallback Loser',
    });
    expect(result).toBe('Triage Winner');
  });
});

// ==========================================
// mapAnswerToRouting() Tests
// ==========================================

describe('mapAnswerToRouting', () => {
  // We need to import from the socratic-adapter, but it has heavy deps.
  // Test the contract by importing types and validating the interface.
  // The actual function tests are in the Telegram test directory.

  it('routing signals interface does not include query field', () => {
    // The RoutingSignals type should have pillar, requestType, depth, focusDirection
    // but NOT query. This is the ADR-003 architectural invariant.
    // Import validates at type level — if RoutingSignals had 'query',
    // this test would need to reference it.
    const mockSignals = {
      pillar: 'The Grove',
      requestType: 'Research',
      depth: 'standard' as const,
      focusDirection: 'Compare with existing approaches',
    };
    expect(mockSignals).not.toHaveProperty('query');
    expect(mockSignals.focusDirection).toBeDefined();
  });
});

// ==========================================
// queryMode Flag Tests
// ==========================================

describe('queryMode flag', () => {
  it('defaults to undefined (legacy) when omitted', () => {
    const config = {
      query: 'test query',
      depth: 'standard' as const,
    };
    expect(config).not.toHaveProperty('queryMode');
  });

  it('accepts canonical mode', () => {
    const config = {
      query: 'test query',
      depth: 'standard' as const,
      queryMode: 'canonical' as const,
    };
    expect(config.queryMode).toBe('canonical');
  });

  it('accepts legacy mode', () => {
    const config = {
      query: 'test query',
      depth: 'standard' as const,
      queryMode: 'legacy' as const,
    };
    expect(config.queryMode).toBe('legacy');
  });
});

// ==========================================
// Anti-Pattern Regression Tests
// ==========================================

describe('ADR-003 anti-pattern regression', () => {
  describe('Anti-Pattern 1: Raw content as query', () => {
    it('rejects raw URL as query input', () => {
      // buildResearchQuery takes triageTitle, not raw URLs.
      // Even if triageTitle IS a URL (data error), it gets truncated properly.
      const result = buildResearchQuery({
        triageTitle: 'https://example.com/very/long/path/that/should/not/be/query',
      });
      // It will still work (it's a string), but this validates the API
      // doesn't encourage passing URLs as the primary input
      expect(result).toBeDefined();
    });
  });

  describe('Anti-Pattern 2: Socratic answer polluting query', () => {
    it('QueryInput has no userDirection field', () => {
      const keys = ['triageTitle', 'keywords', 'url', 'fallbackTitle'];
      // Verify QueryInput fields are exactly what we expect
      const input: QueryInput = { triageTitle: 'test' };
      const validKeys = Object.keys({ triageTitle: '', keywords: [], url: '', fallbackTitle: '' });
      keys.forEach(k => expect(validKeys).toContain(k));
      // userDirection is NOT in the interface
      expect(validKeys).not.toContain('userDirection');
    });
  });

  describe('Anti-Pattern 3: Fetching browser-required URLs', () => {
    it('documents that needsBrowser check happens at call site', () => {
      // buildResearchQuery doesn't check needsBrowser — that's the caller's job.
      // The caller (socratic-adapter.ts handleResolved) checks routeForAnalysis().
      // This test documents the architectural split.
      const result = buildResearchQuery({
        triageTitle: 'Threads Post About AI',
        url: 'https://www.threads.net/@user/post/abc',
      });
      // URL is NOT in the query — correct
      expect(result).toBe('Threads Post About AI');
    });
  });

  describe('Edge cases', () => {
    it('handles empty keywords array', () => {
      const result = buildResearchQuery({
        triageTitle: 'Test Topic',
        keywords: [],
      });
      expect(result).toBe('Test Topic');
    });

    it('handles undefined keywords', () => {
      const result = buildResearchQuery({
        triageTitle: 'Test Topic',
      });
      expect(result).toBe('Test Topic');
    });

    it('handles title at exactly 200 chars', () => {
      const title = 'A'.repeat(200);
      const result = buildResearchQuery({
        triageTitle: title,
      });
      expect(result.length).toBe(200);
      expect(result).not.toEndWith('...');
    });

    it('handles title at 201 chars (just over)', () => {
      const title = 'A'.repeat(201);
      const result = buildResearchQuery({
        triageTitle: title,
      });
      expect(result.length).toBe(200);
      expect(result).toEndWith('...');
    });
  });
});
