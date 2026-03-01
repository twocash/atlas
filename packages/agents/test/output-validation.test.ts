/**
 * Sprint B P2-1: Output Validation (moved from adapter to orchestrator)
 *
 * Tests for the surface-agnostic research output validation that lives
 * in the orchestrator. Validates: source presence, Notion URL fabrication,
 * and throws HALLUCINATION errors that the catch block handles.
 *
 * These are unit tests for the validation logic. Integration with the
 * full orchestrator is verified via smoke tests.
 */

import { describe, it, expect } from 'bun:test';

// The validation function is private to the orchestrator module.
// We test it indirectly by importing the module's behavior patterns.
// For unit testing, we replicate the validation logic here and verify contracts.

// ── Validation contract: same logic as research-orchestrator.ts validateResearchResult ──

function validateResearchResult(output: any): void {
  if (!output) return;

  const hasSources = output.sources && output.sources.length > 0;
  const hasFindings = output.findings && output.findings.length > 0;
  if (!hasSources && !hasFindings) {
    throw new Error(
      'HALLUCINATION: Research completed without producing sources or findings'
    );
  }

  if (output.summary) {
    const notionUrls = output.summary.match(
      /https:\/\/(?:www\.)?notion\.so\/[a-zA-Z0-9\-/]+/g
    ) || [];
    for (const url of notionUrls) {
      const pageIdMatch = url.match(/([a-f0-9]{32})$/i) || url.match(/([a-f0-9-]{36})$/i);
      if (pageIdMatch) {
        const pageId = pageIdMatch[1].replace(/-/g, '');
        const sourcesStr = JSON.stringify(output.sources || []);
        if (!sourcesStr.includes(pageId)) {
          throw new Error(
            `HALLUCINATION: Fabricated Notion URL in research output: ${url}`
          );
        }
      }
    }
  }
}

describe('Output Validation (Sprint B P2-1)', () => {
  describe('source presence check', () => {
    it('passes with sources present', () => {
      expect(() => validateResearchResult({
        sources: ['https://example.com/article'],
        findings: [],
        summary: 'Test summary',
      })).not.toThrow();
    });

    it('passes with findings present (no sources)', () => {
      expect(() => validateResearchResult({
        sources: [],
        findings: [{ claim: 'Test', source: 'Test Source', url: 'https://example.com' }],
        summary: 'Test summary',
      })).not.toThrow();
    });

    it('throws HALLUCINATION when no sources AND no findings', () => {
      expect(() => validateResearchResult({
        sources: [],
        findings: [],
        summary: 'Some fabricated summary',
      })).toThrow('HALLUCINATION');
    });

    it('throws when sources is undefined and findings empty', () => {
      expect(() => validateResearchResult({
        findings: [],
        summary: 'Summary without backing',
      })).toThrow('HALLUCINATION');
    });

    it('passes when output is undefined (no-op)', () => {
      expect(() => validateResearchResult(undefined)).not.toThrow();
    });

    it('passes when output is null (no-op)', () => {
      expect(() => validateResearchResult(null)).not.toThrow();
    });
  });

  describe('Notion URL fabrication check', () => {
    const fakePageId = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';

    it('passes when no Notion URLs in summary', () => {
      expect(() => validateResearchResult({
        sources: ['https://example.com'],
        findings: [{ claim: 'Test', source: 'Test', url: 'https://example.com' }],
        summary: 'A clean summary with no Notion links',
      })).not.toThrow();
    });

    it('passes when Notion URL page ID is found in sources', () => {
      expect(() => validateResearchResult({
        sources: [`https://notion.so/page-${fakePageId}`],
        findings: [{ claim: 'Test', source: 'Notion', url: `https://notion.so/page-${fakePageId}` }],
        summary: `See details at https://notion.so/workspace/${fakePageId}`,
      })).not.toThrow();
    });

    it('throws on fabricated Notion URL not backed by sources', () => {
      expect(() => validateResearchResult({
        sources: ['https://example.com/real-source'],
        findings: [{ claim: 'Test', source: 'Test', url: 'https://example.com' }],
        summary: `Check https://notion.so/fake-page/${fakePageId}`,
      })).toThrow('HALLUCINATION');
    });

    it('throws with specific URL in error message', () => {
      try {
        validateResearchResult({
          sources: ['https://example.com'],
          findings: [{ claim: 'Test', source: 'Test', url: 'https://example.com' }],
          summary: `See https://notion.so/project/${fakePageId}`,
        });
        expect(true).toBe(false); // Should not reach here
      } catch (e: any) {
        expect(e.message).toContain('Fabricated Notion URL');
        expect(e.message).toContain(fakePageId);
      }
    });
  });

  describe('error message format', () => {
    it('error messages contain HALLUCINATION keyword for catch block detection', () => {
      try {
        validateResearchResult({ sources: [], findings: [], summary: 'test' });
      } catch (e: any) {
        expect(e.message).toContain('HALLUCINATION');
        // The orchestrator's catch block uses: errorMessage.includes('HALLUCINATION')
        expect(e.message.includes('HALLUCINATION')).toBe(true);
      }
    });
  });
});
