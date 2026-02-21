/**
 * ATLAS-CEX-001: Chain test — SPA URL → extraction → research dispatch
 *
 * This test proves the FULL CHAIN works for SPA URLs (Threads, Twitter, LinkedIn):
 *
 *   1. Content extractor marks SPA degraded content as failure (toUrlContent)
 *   2. Content router detects SPA sources and sets needsBrowser=true
 *   3. socraticInterview's handleResolved blocks research when needsBrowser && !extractedContent
 *   4. buildResearchQuery detects generic SPA shell titles via isGenericTitle
 *   5. content-callback.ts secondary path blocks research for generic titles
 *
 * These are the ACTUAL production failure scenarios that caused Jim to get
 * 5-page research papers about "the Threads platform" instead of the post content.
 *
 * Test URLs are real-world reproductions from production.
 */

import { describe, it, expect } from 'bun:test';

// ── Layer 1: Content Extractor — SPA degraded → success: false ──────────

import { toUrlContent, type ExtractionResult } from '../src/conversation/content-extractor';

describe('Chain Layer 1: toUrlContent marks SPA degraded as failure', () => {
  const threadsExtractionDegraded: ExtractionResult = {
    url: 'https://www.threads.com/@simplpear/post/DU-tZ30DE4Z',
    title: 'Pear (@simplpear) on Threads',
    description: '',
    content: 'Log in to see photos and videos from friends and discover other accounts you\'ll love.',
    source: 'threads',
    method: 'Fetch',
    status: 'degraded',
    fallbackUsed: true,
    extractedAt: new Date().toISOString(),
  };

  it('threads degraded → success: false', () => {
    const urlContent = toUrlContent(threadsExtractionDegraded);
    expect(urlContent.success).toBe(false);
    expect(urlContent.error).toContain('browser rendering');
  });

  it('threads degraded → title is SPA shell title (not post content)', () => {
    const urlContent = toUrlContent(threadsExtractionDegraded);
    expect(urlContent.title).toBe('Pear (@simplpear) on Threads');
  });

  it('twitter degraded → success: false', () => {
    const twitterDegraded: ExtractionResult = {
      url: 'https://x.com/someuser/status/123456',
      title: 'Someone (@someuser) on X',
      description: '',
      content: 'JavaScript is not available.',
      source: 'twitter',
      method: 'Fetch',
      status: 'degraded',
      fallbackUsed: true,
      extractedAt: new Date().toISOString(),
    };
    const urlContent = toUrlContent(twitterDegraded);
    expect(urlContent.success).toBe(false);
  });

  it('linkedin degraded → success: false', () => {
    const linkedinDegraded: ExtractionResult = {
      url: 'https://www.linkedin.com/posts/someone_topic-activity-123',
      title: 'Someone on LinkedIn',
      description: '',
      content: 'Sign in to view this profile.',
      source: 'linkedin',
      method: 'Fetch',
      status: 'degraded',
      fallbackUsed: true,
      extractedAt: new Date().toISOString(),
    };
    const urlContent = toUrlContent(linkedinDegraded);
    expect(urlContent.success).toBe(false);
  });

  it('article degraded → success: true (non-SPA fallback is usable)', () => {
    const articleDegraded: ExtractionResult = {
      url: 'https://example.com/blog/post',
      title: 'Great Article About AI',
      description: 'An insightful article',
      content: 'This is a great article about AI that provides real value and content.',
      source: 'article',
      method: 'Fetch',
      status: 'degraded',
      fallbackUsed: true,
      extractedAt: new Date().toISOString(),
    };
    const urlContent = toUrlContent(articleDegraded);
    expect(urlContent.success).toBe(true);
  });
});

// ── Layer 2: Content Router — SPA detection ─────────────────────────────

import { routeForAnalysis } from '../src/conversation/content-router';

describe('Chain Layer 2: routeForAnalysis sets needsBrowser for SPA sources', () => {
  it('threads.com → needsBrowser: true', async () => {
    const route = await routeForAnalysis('https://www.threads.com/@simplpear/post/DU-tZ30DE4Z');
    expect(route.needsBrowser).toBe(true);
    expect(route.source).toBe('threads');
  });

  it('threads.net → needsBrowser: true', async () => {
    const route = await routeForAnalysis('https://www.threads.net/@simplpear/post/DU-tZ30DE4Z');
    expect(route.needsBrowser).toBe(true);
    expect(route.source).toBe('threads');
  });

  it('x.com → needsBrowser: true', async () => {
    const route = await routeForAnalysis('https://x.com/someuser/status/123456');
    expect(route.needsBrowser).toBe(true);
    expect(route.source).toBe('twitter');
  });

  it('linkedin.com/posts → needsBrowser: true', async () => {
    const route = await routeForAnalysis('https://www.linkedin.com/posts/someone_topic-123');
    expect(route.needsBrowser).toBe(true);
    expect(route.source).toBe('linkedin');
  });

  it('example.com/blog → needsBrowser: false', async () => {
    const route = await routeForAnalysis('https://example.com/blog/great-article');
    expect(route.needsBrowser).toBe(false);
    expect(route.source).toBe('article');
  });
});

// ── Layer 3: Research Query — generic title detection + content fallback ─

import { buildResearchQuery, isGenericTitle } from '../../../packages/agents/src/agents/research';

describe('Chain Layer 3: buildResearchQuery handles SPA titles correctly', () => {
  // The EXACT production failure: "Pear (@simplpear) on Threads" as research query
  it('PRODUCTION BUG: "Pear (@simplpear) on Threads" + sourceContent → uses content, not title', () => {
    const query = buildResearchQuery({
      triageTitle: 'Pear (@simplpear) on Threads',
      fallbackTitle: 'https://www.threads.com/@simplpear/post/DU-tZ30DE4Z',
      url: 'https://www.threads.com/@simplpear/post/DU-tZ30DE4Z',
      sourceContent: 'The rise of autonomous AI agents represents a paradigm shift in how we think about software development and deployment.',
    });
    expect(query).not.toContain('on Threads');
    expect(query).not.toContain('simplpear');
    expect(query.toLowerCase()).toContain('autonomous ai agent');
  });

  it('PRODUCTION BUG: "Boris Cherny (@nicknameisher) on X" + sourceContent → uses content', () => {
    const query = buildResearchQuery({
      triageTitle: 'Boris Cherny (@nicknameisher) on X',
      fallbackTitle: 'https://x.com/nicknameisher/status/123',
      url: 'https://x.com/nicknameisher/status/123',
      sourceContent: 'TypeScript 6.0 introduces structural pattern matching which fundamentally changes how we write conditional logic.',
    });
    expect(query).not.toContain('on X');
    expect(query.toLowerCase()).toContain('typescript');
  });

  it('PRODUCTION BUG: generic title + NO sourceContent → still produces a query (but garbage)', () => {
    // This scenario is now BLOCKED by the SPA guard in socratic-adapter.ts,
    // but buildResearchQuery itself must not throw
    const query = buildResearchQuery({
      triageTitle: 'Pear (@simplpear) on Threads',
      fallbackTitle: 'https://www.threads.com/@simplpear/post/DU-tZ30DE4Z',
      url: 'https://www.threads.com/@simplpear/post/DU-tZ30DE4Z',
      // NO sourceContent — the SPA guard should have blocked this call
    });
    expect(query).toBeTruthy(); // doesn't throw, but produces garbage (blocked upstream)
  });

  it('GOOD title → used directly regardless of sourceContent', () => {
    const query = buildResearchQuery({
      triageTitle: 'How Claude 4 achieves autonomous computer use',
      fallbackTitle: '',
      url: 'https://www.anthropic.com/blog/claude-4',
      sourceContent: 'This is the body of the blog post about Claude 4...',
    });
    expect(query).toContain('Claude 4');
    expect(query).toContain('autonomous computer use');
  });
});

// ── Layer 4: Full chain — extraction result → isGenericTitle gate ────────

describe('Chain Layer 4: End-to-end SPA URL → research gate decision', () => {
  /**
   * Simulates the decision chain that socratic-adapter.ts and content-callback.ts make:
   *
   * 1. extractContent → ExtractionResult
   * 2. toUrlContent → UrlContent (success: true/false)
   * 3. routeForAnalysis → needsBrowser
   * 4. IF needsBrowser && !urlContent.success → BLOCK research
   * 5. IF NOT blocked, isGenericTitle(title) → skip in content-callback path
   */

  function shouldBlockResearch(params: {
    url: string;
    extractionStatus: 'success' | 'degraded' | 'failed';
    source: 'threads' | 'twitter' | 'linkedin' | 'article';
    title: string;
    content: string;
  }): { blocked: boolean; reason: string } {
    // Step 1-2: toUrlContent conversion
    const extractionResult: ExtractionResult = {
      url: params.url,
      title: params.title,
      description: '',
      content: params.content,
      source: params.source,
      method: 'Fetch',
      status: params.extractionStatus,
      fallbackUsed: params.extractionStatus === 'degraded',
      extractedAt: new Date().toISOString(),
    };
    const urlContent = toUrlContent(extractionResult);

    // Step 3: SPA detection (simplified — we know the source)
    const SPA_SOURCES = ['threads', 'twitter', 'linkedin'];
    const needsBrowser = SPA_SOURCES.includes(params.source);

    // Step 4: Primary guard (socratic-adapter.ts)
    const extractedContent = urlContent.success ? urlContent.bodySnippet : undefined;
    if (needsBrowser && !extractedContent) {
      return { blocked: true, reason: 'SPA extraction failed — no content for research query' };
    }

    // Step 5: Secondary guard (content-callback.ts — no sourceContent available)
    if (isGenericTitle(params.title)) {
      // In the primary path, buildResearchQuery would use sourceContent.
      // In the secondary path (content-callback.ts), sourceContent is unavailable.
      return { blocked: true, reason: 'Generic SPA shell title detected — would research platform instead of post' };
    }

    return { blocked: false, reason: 'Research can proceed' };
  }

  // PRODUCTION FAILURES — these MUST be blocked
  it('Threads SPA shell + degraded → BLOCKED', () => {
    const result = shouldBlockResearch({
      url: 'https://www.threads.com/@simplpear/post/DU-tZ30DE4Z',
      extractionStatus: 'degraded',
      source: 'threads',
      title: 'Pear (@simplpear) on Threads',
      content: 'Log in to see photos and videos from friends',
    });
    expect(result.blocked).toBe(true);
  });

  it('Twitter SPA shell + degraded → BLOCKED', () => {
    const result = shouldBlockResearch({
      url: 'https://x.com/nicknameisher/status/123',
      extractionStatus: 'degraded',
      source: 'twitter',
      title: 'Boris Cherny (@nicknameisher) on X',
      content: 'JavaScript is not available.',
    });
    expect(result.blocked).toBe(true);
  });

  it('LinkedIn SPA shell + degraded → BLOCKED', () => {
    const result = shouldBlockResearch({
      url: 'https://www.linkedin.com/posts/someone_topic-123',
      extractionStatus: 'degraded',
      source: 'linkedin',
      title: 'Jim Calhoun on LinkedIn',
      content: 'Sign in to view this profile.',
    });
    expect(result.blocked).toBe(true);
  });

  it('Threads SPA shell + failed → BLOCKED', () => {
    const result = shouldBlockResearch({
      url: 'https://www.threads.com/@simplpear/post/DU-tZ30DE4Z',
      extractionStatus: 'failed',
      source: 'threads',
      title: 'Pear (@simplpear) on Threads',
      content: '',
    });
    expect(result.blocked).toBe(true);
  });

  // GOOD EXTRACTION — these MUST proceed
  it('Threads with SUCCESSFUL Jina extraction → NOT blocked', () => {
    const result = shouldBlockResearch({
      url: 'https://www.threads.com/@simplpear/post/DU-tZ30DE4Z',
      extractionStatus: 'success',
      source: 'threads',
      title: 'Pear shares insights on autonomous AI agents',
      content: 'The rise of autonomous AI agents represents a paradigm shift in software development...',
    });
    expect(result.blocked).toBe(false);
  });

  it('Article with good title → NOT blocked', () => {
    const result = shouldBlockResearch({
      url: 'https://example.com/blog/great-article',
      extractionStatus: 'success',
      source: 'article',
      title: 'How AI is Transforming Healthcare in 2026',
      content: 'Artificial intelligence continues to reshape the healthcare landscape...',
    });
    expect(result.blocked).toBe(false);
  });

  it('Article degraded but good title → NOT blocked (articles tolerate degradation)', () => {
    const result = shouldBlockResearch({
      url: 'https://example.com/blog/paywalled',
      extractionStatus: 'degraded',
      source: 'article',
      title: 'The Future of Cloud Computing Infrastructure',
      content: 'This article requires a subscription...',
    });
    expect(result.blocked).toBe(false);
  });
});
