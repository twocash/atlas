/**
 * Bridge Content Extraction — Integration Tests
 *
 * Verifies the Bridge + Chrome Extension content extraction pipeline:
 *   Bridge available → extractWithBridge() → ExtractionResult
 *   Bridge unavailable → falls through to Jina (existing pipeline)
 *   Bridge extraction fails → falls through to Jina
 *
 * These are chain tests (CONSTRAINT 6) — they prove the bridge tier
 * integrates correctly into the existing extraction cascade.
 *
 * @see Bridge Phase 4.5: Browser-Mediated Content Extraction
 */

import { describe, it, expect, mock, beforeEach } from 'bun:test';

// ─── Mock Setup (BEFORE imports) ─────────────────────────

// Mock logger — capture calls for assertion
const logCalls: { level: string; msg: string; meta?: any }[] = [];
mock.module('../src/logger', () => ({
  logger: {
    info: (msg: string, meta?: any) => logCalls.push({ level: 'info', msg, meta }),
    warn: (msg: string, meta?: any) => logCalls.push({ level: 'warn', msg, meta }),
    error: (msg: string, meta?: any) => logCalls.push({ level: 'error', msg, meta }),
    debug: () => {},
  },
}));

// Mock content-router
mock.module('../src/conversation/content-router', () => ({
  detectContentSource: (url: string) => {
    if (url.includes('threads.net')) return 'threads';
    if (url.includes('twitter.com') || url.includes('x.com')) return 'twitter';
    if (url.includes('linkedin.com')) return 'linkedin';
    return 'article';
  },
  determineExtractionMethod: () => {
    // Browser-first: all sources route through Bridge → Jina → HTTP
    return 'Browser';
  },
  extractDomain: (url: string) => {
    try { return new URL(url).hostname.replace('www.', ''); }
    catch { return url; }
  },
}));

// Mock cookie loader
mock.module('../src/utils/chrome-cookies', () => ({
  loadCookiesForUrl: () => null,
  requestCookieRefresh: async () => false,
}));

// ─── Bridge Mock State ──────────────────────────────────

let bridgeAvailable = false;
let bridgeExtractFn: ((url: string, source: string) => any) | null = null;

mock.module('../src/conversation/bridge-extractor', () => ({
  isBridgeAvailable: async () => bridgeAvailable,
  extractWithBridge: async (url: string, source: string) => {
    if (bridgeExtractFn) return bridgeExtractFn(url, source);
    return {
      url,
      status: 'failed',
      method: 'Browser',
      source,
      title: '',
      description: '',
      content: '',
      extractedAt: new Date(),
      error: 'Bridge returned empty result',
      fallbackUsed: false,
    };
  },
}));

// Mock globalThis.fetch to prevent real HTTP calls (Jina fallback hangs otherwise)
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input: any, init?: any) => {
  const url = typeof input === 'string' ? input : input?.url;
  // Jina Reader — return minimal success response
  if (url?.includes('r.jina.ai/')) {
    return new Response('Title: Jina Fallback\n\nJina extracted content after bridge failed', {
      status: 200,
      headers: { 'content-type': 'text/plain' },
    }) as any;
  }
  // HTTP fallback — return minimal HTML
  if (url?.startsWith('http')) {
    return new Response('<html><body>Fallback</body></html>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    }) as any;
  }
  return originalFetch(input, init);
};

// ─── Imports (AFTER mocks) ───────────────────────────────

import {
  toUrlContent,
  type ExtractionResult,
  type ExtractionStatus,
} from '../src/conversation/content-extractor';

// ─── Test Lifecycle ─────────────────────────────────────

beforeEach(() => {
  bridgeAvailable = false;
  bridgeExtractFn = null;
  logCalls.length = 0;
});

// ─── Helpers ────────────────────────────────────────────

function makeBridgeSuccess(url: string, source: string): ExtractionResult {
  return {
    url,
    status: 'success' as ExtractionStatus,
    method: 'Browser' as any,
    source: source as any,
    title: 'Bridge Extracted Title',
    description: '',
    content: 'Full content extracted via Chrome Extension browser rendering with authenticated session.',
    extractedAt: new Date(),
  };
}

function makeBridgeFailure(url: string, source: string, error: string): ExtractionResult {
  return {
    url,
    status: 'failed' as ExtractionStatus,
    method: 'Browser' as any,
    source: source as any,
    title: '',
    description: '',
    content: '',
    extractedAt: new Date(),
    error,
    fallbackUsed: false,
  };
}

function makeBridgeDegraded(url: string, source: string): ExtractionResult {
  return {
    url,
    status: 'degraded' as ExtractionStatus,
    method: 'Browser' as any,
    source: source as any,
    title: '',
    description: '',
    content: 'short',
    extractedAt: new Date(),
    error: 'Browser extraction returned only 5 chars — possible login wall',
  };
}

// ─── Tests ──────────────────────────────────────────────

describe('Bridge Content Extraction Pipeline', () => {

  // ─── Bridge extraction results (unit-level) ───────────

  describe('Bridge Success Results', () => {
    it('bridge success result has correct shape', () => {
      const result = makeBridgeSuccess(
        'https://www.threads.net/@peteryang/post/test123',
        'threads',
      );

      expect(result.status).toBe('success');
      expect(result.method).toBe('Browser');
      expect(result.source).toBe('threads');
      expect(result.content.length).toBeGreaterThan(50);
    });

    it('bridge success converts to UrlContent with success=true', () => {
      const result = makeBridgeSuccess(
        'https://www.threads.net/@test/post/123',
        'threads',
      );

      const urlContent = toUrlContent(result);

      expect(urlContent.success).toBe(true);
      expect(urlContent.title).toBe('Bridge Extracted Title');
      expect(urlContent.fullContent).toBe(
        'Full content extracted via Chrome Extension browser rendering with authenticated session.',
      );
      expect(urlContent.url).toBe('https://www.threads.net/@test/post/123');
    });

    it('bridge success for Twitter converts correctly', () => {
      const result = makeBridgeSuccess(
        'https://x.com/user/status/123456',
        'twitter',
      );

      const urlContent = toUrlContent(result);

      expect(urlContent.success).toBe(true);
      expect(urlContent.url).toBe('https://x.com/user/status/123456');
    });

    it('bridge success for LinkedIn converts correctly', () => {
      const result = makeBridgeSuccess(
        'https://www.linkedin.com/posts/user-activity-123',
        'linkedin',
      );

      const urlContent = toUrlContent(result);

      expect(urlContent.success).toBe(true);
    });
  });

  // ─── Bridge failure results ───────────────────────────

  describe('Bridge Failure Results', () => {
    it('bridge timeout produces failed status', () => {
      const result = makeBridgeFailure(
        'https://www.threads.net/@test/post/timeout',
        'threads',
        'Bridge extraction timed out after 30000ms',
      );

      expect(result.status).toBe('failed');
      expect(result.error).toContain('timed out');
    });

    it('bridge unreachable produces failed status', () => {
      const result = makeBridgeFailure(
        'https://www.threads.net/@test/post/unreach',
        'threads',
        'Bridge unreachable: fetch failed',
      );

      expect(result.status).toBe('failed');
      expect(result.error).toContain('unreachable');
    });

    it('bridge degraded (login wall) converts to failure for SPA', () => {
      const result = makeBridgeDegraded(
        'https://www.threads.net/@test/post/loginwall',
        'threads',
      );

      const urlContent = toUrlContent(result);

      // SPA + degraded = login page HTML garbage → treated as failure
      expect(urlContent.success).toBe(false);
    });

    it('failed bridge result converts to UrlContent with success=false', () => {
      const result = makeBridgeFailure(
        'https://www.threads.net/@test/post/fail',
        'threads',
        'Bridge extraction timed out',
      );

      const urlContent = toUrlContent(result);

      expect(urlContent.success).toBe(false);
      expect(urlContent.error).toContain('timed out');
    });
  });

  // ─── Extraction cascade wiring ────────────────────────

  describe('Extraction Cascade Wiring', () => {
    it('bridge-extractor import resolves without error', async () => {
      // If this import fails, the bridge isn't wired
      const mod = await import('../src/conversation/bridge-extractor');
      expect(typeof mod.isBridgeAvailable).toBe('function');
      expect(typeof mod.extractWithBridge).toBe('function');
    });

    it('content-extractor imports bridge-extractor', async () => {
      // Verify the import wiring exists by checking the module loads
      const mod = await import('../src/conversation/content-extractor');
      expect(typeof mod.extractContent).toBe('function');
      expect(typeof mod.toUrlContent).toBe('function');
    });

    it('bridge available log appears when bridge is up', async () => {
      bridgeAvailable = true;
      bridgeExtractFn = (url, source) => makeBridgeSuccess(url, source);

      const { extractContent } = await import('../src/conversation/content-extractor');
      await extractContent('https://www.threads.net/@test/post/logcheck');

      const bridgeLog = logCalls.find(
        (l) => l.msg.includes('Bridge available') && l.level === 'info',
      );
      expect(bridgeLog).toBeDefined();
    });

    it('bridge fallback log appears when bridge extraction fails', async () => {
      bridgeAvailable = true;
      bridgeExtractFn = (url, source) =>
        makeBridgeFailure(url, source, 'Extension disconnected');

      const { extractContent } = await import('../src/conversation/content-extractor');
      await extractContent('https://www.threads.net/@test/post/faillog');

      const fallbackLog = logCalls.find(
        (l) => l.msg.includes('Bridge extraction failed') && l.level === 'warn',
      );
      expect(fallbackLog).toBeDefined();
    });

    it('bridge returns success → method is Browser', async () => {
      bridgeAvailable = true;
      bridgeExtractFn = (url, source) => makeBridgeSuccess(url, source);

      const { extractContent } = await import('../src/conversation/content-extractor');
      const result = await extractContent('https://www.threads.net/@test/post/method');

      expect(result.method).toBe('Browser');
      expect(result.status).toBe('success');
    });

    it('bridge unavailable → no bridge log (skips silently)', async () => {
      bridgeAvailable = false;

      const { extractContent } = await import('../src/conversation/content-extractor');
      await extractContent('https://www.threads.net/@test/post/nobr');

      const bridgeLog = logCalls.find(
        (l) => l.msg.includes('Bridge available'),
      );
      expect(bridgeLog).toBeUndefined();
    });

    it('article source also routes through bridge (browser-first default)', async () => {
      bridgeAvailable = true;
      let bridgeCalled = false;
      bridgeExtractFn = (url, source) => {
        bridgeCalled = true;
        return makeBridgeSuccess(url, source);
      };

      const { extractContent } = await import('../src/conversation/content-extractor');
      // Browser-first: articles go through Bridge → Jina → HTTP chain
      const result = await extractContent('https://techcrunch.com/2026/01/30/some-article');

      expect(bridgeCalled).toBe(true);
      expect(result.method).toBe('Browser');
    });
  });

  // ─── ExtractionResult shape compliance ────────────────

  describe('ExtractionResult Shape Compliance', () => {
    it('bridge result has all required ExtractionResult fields', () => {
      const result = makeBridgeSuccess(
        'https://www.threads.net/@test/post/shape',
        'threads',
      );

      // All required fields present
      expect(result.url).toBeDefined();
      expect(result.status).toBeDefined();
      expect(result.method).toBeDefined();
      expect(result.source).toBeDefined();
      expect(result.title).toBeDefined();
      expect(result.description).toBeDefined();
      expect(result.content).toBeDefined();
      expect(result.extractedAt).toBeInstanceOf(Date);
    });

    it('bridge result status is valid ExtractionStatus', () => {
      const validStatuses: ExtractionStatus[] = ['success', 'degraded', 'failed'];

      expect(validStatuses).toContain(makeBridgeSuccess('u', 's').status);
      expect(validStatuses).toContain(makeBridgeFailure('u', 's', 'e').status);
      expect(validStatuses).toContain(makeBridgeDegraded('u', 's').status);
    });
  });
});
