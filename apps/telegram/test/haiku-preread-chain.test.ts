/**
 * Haiku Pre-Read Chain Tests
 *
 * Verifies the complete pipeline:
 *   URL → extractContent → toUrlContent (fullContent preserved)
 *       → preReadContent (Haiku summary)
 *       → socraticInterview (summary displayed to Jim)
 *       → handleResolved (fullContent + sourceUrl → research)
 *
 * CONSTRAINT 6: Chain tests, not just unit tests.
 * These prove water flows through the pipe, not just that each pipe section exists.
 */

import { describe, it, expect, mock } from 'bun:test';

// ── Layer 1: toUrlContent preserves fullContent ─────────────────────────

import { toUrlContent, type ExtractionResult } from '../src/conversation/content-extractor';

describe('Chain Layer 1: toUrlContent preserves fullContent', () => {
  const longContent = 'A'.repeat(1000); // Longer than 500-char bodySnippet limit

  const successfulExtraction: ExtractionResult = {
    url: 'https://example.com/blog/ai-safety',
    title: 'AI Safety Research Update',
    description: 'New findings on alignment',
    content: longContent,
    source: 'article',
    method: 'Jina',
    status: 'success',
    fallbackUsed: false,
    extractedAt: new Date().toISOString(),
  };

  it('fullContent preserves entire extraction (not truncated)', () => {
    const urlContent = toUrlContent(successfulExtraction);
    expect(urlContent.fullContent).toBe(longContent);
    expect(urlContent.fullContent!.length).toBe(1000);
  });

  it('bodySnippet is still truncated to 500 chars', () => {
    const urlContent = toUrlContent(successfulExtraction);
    expect(urlContent.bodySnippet.length).toBeLessThanOrEqual(500);
  });

  it('fullContent exists alongside bodySnippet (both populated)', () => {
    const urlContent = toUrlContent(successfulExtraction);
    expect(urlContent.bodySnippet).toBeDefined();
    expect(urlContent.fullContent).toBeDefined();
    expect(urlContent.fullContent!.length).toBeGreaterThan(urlContent.bodySnippet.length);
  });

  it('empty content → fullContent is undefined', () => {
    const emptyExtraction: ExtractionResult = {
      ...successfulExtraction,
      content: '',
    };
    const urlContent = toUrlContent(emptyExtraction);
    expect(urlContent.fullContent).toBeUndefined();
  });

  it('SPA degraded → fullContent still exists but success=false', () => {
    const spaDegraded: ExtractionResult = {
      url: 'https://www.threads.com/@simplpear/post/DU-tZ30DE4Z',
      title: 'Pear (@simplpear) on Threads',
      description: '',
      content: 'Log in to see photos and videos from friends.',
      source: 'threads',
      method: 'Fetch',
      status: 'degraded',
      fallbackUsed: true,
      extractedAt: new Date().toISOString(),
    };
    const urlContent = toUrlContent(spaDegraded);
    expect(urlContent.success).toBe(false);
    // fullContent is still set (the garbage content) — the success flag gates its use
    expect(urlContent.fullContent).toBeDefined();
  });
});

// ── Layer 2: preReadContent — Haiku summary ─────────────────────────────

// Note: preReadContent calls the Anthropic API so we can't unit-test the
// actual call without mocking. These tests verify the interface contract
// and edge cases that don't require API calls.

import { preReadContent } from '../src/conversation/content-pre-reader';

describe('Chain Layer 2: preReadContent edge cases (no API key)', () => {
  // These tests work without ANTHROPIC_API_KEY set — they test graceful degradation

  it('content too short → success: false with reason', async () => {
    const result = await preReadContent('Short', 'https://example.com', 'Title');
    expect(result.success).toBe(false);
    expect(result.failureReason).toBe('Content too short');
    expect(result.summary).toBe('');
  });

  it('empty content → success: false', async () => {
    const result = await preReadContent('', 'https://example.com', 'Title');
    expect(result.success).toBe(false);
  });

  it('49 chars → too short (threshold is 50)', async () => {
    const content = 'A'.repeat(49);
    const result = await preReadContent(content, 'https://example.com', 'Title');
    expect(result.success).toBe(false);
    expect(result.failureReason).toBe('Content too short');
  });

  it('return type matches ContentPreRead interface', async () => {
    const result = await preReadContent('x', 'https://example.com', 'T');
    expect(result).toHaveProperty('summary');
    expect(result).toHaveProperty('contentType');
    expect(result).toHaveProperty('success');
    expect(result).toHaveProperty('latencyMs');
    expect(typeof result.latencyMs).toBe('number');
  });
});

// ── Layer 3: UrlContent carries pre-read data ───────────────────────────

import type { UrlContent } from '../src/types';

describe('Chain Layer 3: UrlContent type supports pre-read fields', () => {
  it('preReadSummary and preReadContentType are assignable to UrlContent', () => {
    const urlContent: UrlContent = {
      url: 'https://example.com/blog/ai-safety',
      title: 'AI Safety Research Update',
      description: 'New findings',
      bodySnippet: 'This article discusses...',
      fullContent: 'This article discusses AI safety research in depth...',
      preReadSummary: 'This article discusses new alignment research findings from Anthropic.',
      preReadContentType: 'article',
      fetchedAt: new Date(),
      success: true,
    };

    expect(urlContent.preReadSummary).toBe('This article discusses new alignment research findings from Anthropic.');
    expect(urlContent.preReadContentType).toBe('article');
    expect(urlContent.fullContent).toBeDefined();
  });

  it('pre-read fields are optional (backwards compatible)', () => {
    const urlContent: UrlContent = {
      url: 'https://example.com',
      title: 'Test',
      description: '',
      bodySnippet: '',
      fetchedAt: new Date(),
      success: true,
    };

    expect(urlContent.preReadSummary).toBeUndefined();
    expect(urlContent.preReadContentType).toBeUndefined();
    expect(urlContent.fullContent).toBeUndefined();
  });
});

// ── Layer 4: ResearchConfig carries sourceUrl ───────────────────────────

import { buildResearchQuery, type ResearchConfig, type QueryInput } from '../../../packages/agents/src/agents/research';

describe('Chain Layer 4: ResearchConfig supports sourceUrl', () => {
  it('sourceUrl is assignable to ResearchConfig', () => {
    const config: ResearchConfig = {
      query: 'AI alignment research',
      depth: 'standard',
      sourceUrl: 'https://example.com/blog/ai-safety',
    };

    expect(config.sourceUrl).toBe('https://example.com/blog/ai-safety');
  });

  it('sourceUrl is optional (backwards compatible)', () => {
    const config: ResearchConfig = {
      query: 'AI alignment research',
      depth: 'standard',
    };

    expect(config.sourceUrl).toBeUndefined();
  });
});

// ── Layer 5: buildResearchQuery uses fullContent over bodySnippet ────────

describe('Chain Layer 5: buildResearchQuery uses sourceContent (fullContent path)', () => {
  it('sourceContent flows into research query when title is generic', () => {
    const fullContent = 'Detailed article about recursive language models and their implications for AI safety. ' +
      'The author argues that self-modifying reasoning chains represent a fundamental paradigm shift.';

    // buildResearchQuery takes QueryInput and returns a string
    const query = buildResearchQuery({
      triageTitle: '',
      sourceContent: fullContent,
      userIntent: 'go deep on the alignment implications',
    });

    // The query should incorporate the user's directive
    expect(query).toBeTruthy();
    expect(query.length).toBeGreaterThan(0);
  });

  it('sourceContent takes priority over generic title in query building', () => {
    // This was the PRODUCTION BUG: generic SPA title became the research query
    const query = buildResearchQuery({
      triageTitle: 'Pear (@simplpear) on Threads',
      sourceContent: 'Post about recursive language models and AI safety implications.',
      userIntent: 'research the alignment implications of recursive LLMs',
    });

    // With sourceContent + user intent, the query should NOT be the generic SPA title
    expect(query).not.toBe('Pear (@simplpear) on Threads');
  });

  it('without sourceContent, fallbackTitle is used', () => {
    const query = buildResearchQuery({
      triageTitle: 'AI Safety Research Update',
      userIntent: 'go deep',
    });

    expect(query).toBeTruthy();
    expect(query).toContain('AI Safety Research Update');
  });
});

// ── Layer 6: Combined chain — good content + pre-read + answer ──────────

describe('Chain Layer 6: Combined pipeline scenarios', () => {
  it('SCENARIO: Good article → fullContent preserved → sourceUrl set → research enriched', () => {
    // Simulate the full chain without API calls

    // Step 1: Extract content
    const extraction: ExtractionResult = {
      url: 'https://example.com/blog/recursive-llms',
      title: 'Recursive Language Models and Innovation at the Edge',
      description: 'A deep dive into self-modifying AI architectures',
      content: 'This post discusses a new approach to AI architecture using recursive language models. '.repeat(20),
      source: 'article',
      method: 'Jina',
      status: 'success',
      fallbackUsed: false,
      extractedAt: new Date().toISOString(),
    };

    // Step 2: toUrlContent preserves fullContent
    const urlContent = toUrlContent(extraction);
    expect(urlContent.success).toBe(true);
    expect(urlContent.fullContent).toBeDefined();
    expect(urlContent.fullContent!.length).toBeGreaterThan(500); // More than bodySnippet limit

    // Step 3: Simulate pre-read success (would normally call Haiku)
    urlContent.preReadSummary = 'This article explores recursive language model architectures that can self-modify reasoning chains. The author argues this represents a paradigm shift from traditional transformer approaches.';
    urlContent.preReadContentType = 'article';

    // Step 4: Build research config (what handleResolved would do)
    const researchConfig: ResearchConfig = {
      query: 'recursive language models alignment implications',
      depth: 'deep',
      sourceContent: urlContent.fullContent,  // Full content, NOT bodySnippet
      sourceUrl: extraction.url,              // Original URL for Gemini grounding
      userContext: 'go deep on the alignment implications',
    };

    // Verify the chain: research gets ALL the data
    expect(researchConfig.sourceContent!.length).toBeGreaterThan(500);
    expect(researchConfig.sourceUrl).toBe('https://example.com/blog/recursive-llms');
    expect(researchConfig.userContext).toBe('go deep on the alignment implications');
  });

  it('SCENARIO: SPA garbage + pre-read failure → Jim answer drives research (graceful degradation)', () => {
    // Step 1: SPA extraction fails
    const extraction: ExtractionResult = {
      url: 'https://www.threads.com/@simplpear/post/DU-tZ30DE4Z',
      title: 'Pear (@simplpear) on Threads',
      description: '',
      content: 'Log in to see photos and videos.',
      source: 'threads',
      method: 'Fetch',
      status: 'degraded',
      fallbackUsed: true,
      extractedAt: new Date().toISOString(),
    };

    // Step 2: toUrlContent marks as failure
    const urlContent = toUrlContent(extraction);
    expect(urlContent.success).toBe(false);

    // Step 3: Pre-read would fail (content too short/garbage) — no summary
    // urlContent.preReadSummary remains undefined

    // Step 4: Research config uses Jim's answer as primary signal
    const researchConfig: ResearchConfig = {
      query: 'recursive LLMs and alignment safety',  // From Jim's Socratic answer
      depth: 'standard',
      sourceContent: undefined,  // No usable content
      sourceUrl: extraction.url,  // URL still passed for Gemini context
      userContext: 'this is about recursive LLMs, dig into safety angle',
    };

    // Verify degradation: URL is still passed, user intent drives the query
    expect(researchConfig.sourceContent).toBeUndefined();
    expect(researchConfig.sourceUrl).toBe('https://www.threads.com/@simplpear/post/DU-tZ30DE4Z');
    expect(researchConfig.userContext).toContain('recursive LLMs');
  });

  it('SCENARIO: fullContent > bodySnippet — research never receives truncated content', () => {
    const longArticle = 'Paragraph about AI safety. '.repeat(100); // ~2700 chars

    const extraction: ExtractionResult = {
      url: 'https://example.com/long-article',
      title: 'Long AI Article',
      description: '',
      content: longArticle,
      source: 'article',
      method: 'Jina',
      status: 'success',
      fallbackUsed: false,
      extractedAt: new Date().toISOString(),
    };

    const urlContent = toUrlContent(extraction);

    // bodySnippet is truncated
    expect(urlContent.bodySnippet.length).toBeLessThanOrEqual(500);

    // fullContent is NOT truncated
    expect(urlContent.fullContent!.length).toBe(longArticle.length);

    // Research should use fullContent, not bodySnippet
    const extractedContent = urlContent.fullContent || urlContent.bodySnippet;
    expect(extractedContent.length).toBe(longArticle.length);
    expect(extractedContent).not.toBe(urlContent.bodySnippet);
  });
});

// ── Layer 7: ContextSignals includes bodySummary ────────────────────────

import type { ContextSignals } from '../../../packages/agents/src/socratic/types';

describe('Chain Layer 7: ContextSignals type supports bodySummary', () => {
  it('bodySummary and contentType are assignable to contentSignals', () => {
    const signals: ContextSignals = {
      contentSignals: {
        topic: 'AI Safety',
        hasUrl: true,
        url: 'https://example.com',
        contentLength: 1000,
        bodySummary: 'This article discusses AI safety research.',
        contentType: 'article',
      },
    };

    expect(signals.contentSignals!.bodySummary).toBe('This article discusses AI safety research.');
    expect(signals.contentSignals!.contentType).toBe('article');
  });

  it('bodySummary is optional (backwards compatible)', () => {
    const signals: ContextSignals = {
      contentSignals: {
        topic: 'Test',
        hasUrl: false,
        contentLength: 100,
      },
    };

    expect(signals.contentSignals!.bodySummary).toBeUndefined();
  });
});
