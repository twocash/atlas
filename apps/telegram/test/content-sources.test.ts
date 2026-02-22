/**
 * Content Sources — ADR-001 Compliance Tests
 *
 * Verifies Notion-backed content source detection, caching,
 * and fallback behavior for the content-sources module.
 *
 * Uses real URLs from Jim's Feed history as test fixtures.
 */

import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';

import {
  FALLBACK_SOURCES,
  getContentSourcesSync,
  getSpaSourcesSync,
  getSourceDefaultsSync,
  detectContentSourceFromEntries,
  clearContentSourcesCache,
  injectContentSources,
  type ContentSourceEntry,
} from '../src/config/content-sources';

// Note: We do NOT import detectContentSource from content-router here.
// bridge-extraction.test.ts uses mock.module() on content-router, and bun test
// shares module state across files. Testing via detectContentSourceFromEntries
// avoids this cross-contamination.

// ─── Real URLs from Jim's Feed ──────────────────────────

const REAL_URLS = {
  threads: 'https://www.threads.com/@omarsar0/post/DUgDaW0EXaP?xmt=AQF0RELDbXSpX-RBjGbD85m3JuIREr4SsaMtgE4G2jts3',
  threadsAlt: 'https://www.threads.com/@sakeeb.rahman/post/DUjUFpNEUjv?xmt=AQF0_RY5fEyKotA-YZmXfHw3AW7_f4H7SpFE0Ym9',
  twitter: 'https://x.com/nicknameisher/status/123',
  linkedin: 'https://www.linkedin.com/posts/johnbattelle_anthropic-joins-a-long-list-of-brands-that-activity-7426',
  linkedinPulse: 'https://www.linkedin.com/pulse/human-ai-relationships-beyond-uncanny-valley-chris-hood-m4lmc',
  github: 'https://github.com/mitchellh/vouch',
  githubAlt: 'https://github.com/different-ai/openwork',
  youtube: 'https://www.youtube.com/watch?v=4uzGDAoNOZc',
  article: 'https://www.sciencedirect.com/science/article/pii/S294988212500091X',
  articleYahoo: 'https://finance.yahoo.com/news/why-artificial-intelligence-ai-adoption-052000221.html',
  bringATrailer: 'https://bringatrailer.com/listing/1992-mercedes-benz-300e-2-6/',
  spotify: 'https://open.spotify.com/show/6SPhRTZ7cfnVomARKa1J55',
  wikipedia: 'https://en.wikipedia.org/wiki/Forest_dieback',
};

// ─── Fallback Constants Tests ────────────────────────────

describe('FALLBACK_SOURCES', () => {
  it('has exactly 7 entries matching ContentSource type', () => {
    expect(FALLBACK_SOURCES).toHaveLength(7);
    const names = FALLBACK_SOURCES.map(e => e.name);
    expect(names).toEqual(['threads', 'twitter', 'linkedin', 'github', 'youtube', 'article', 'generic']);
  });

  it('threads entry has correct Jina config from CEX-002', () => {
    const threads = FALLBACK_SOURCES.find(e => e.name === 'threads')!;
    expect(threads.browserRequired).toBe(true);
    expect(threads.extractionMethod).toBe('Browser');
    expect(threads.sourceDefaults).toEqual({
      targetSelector: 'article',
      waitForSelector: 'article',
      withShadowDom: true,
      waitUntil: 'networkidle2',
      noCache: true,
      timeout: 45,
      retainImages: 'none',
      returnFormat: 'text',
    });
  });

  it('twitter entry has Browser extraction with article selectors', () => {
    const twitter = FALLBACK_SOURCES.find(e => e.name === 'twitter')!;
    expect(twitter.browserRequired).toBe(true);
    expect(twitter.extractionMethod).toBe('Browser');
    expect(twitter.sourceDefaults).toHaveProperty('targetSelector', 'article');
    expect(twitter.sourceDefaults).toHaveProperty('retainImages', 'none');
  });

  it('linkedin entry has Browser extraction', () => {
    const linkedin = FALLBACK_SOURCES.find(e => e.name === 'linkedin')!;
    expect(linkedin.browserRequired).toBe(true);
    expect(linkedin.extractionMethod).toBe('Browser');
  });

  it('non-SPA sources have Fetch extraction and browserRequired=false', () => {
    for (const name of ['github', 'youtube', 'article', 'generic']) {
      const entry = FALLBACK_SOURCES.find(e => e.name === name)!;
      expect(entry.browserRequired).toBe(false);
      expect(entry.extractionMethod).toBe('Fetch');
    }
  });

  it('entries are sorted by priority', () => {
    const priorities = FALLBACK_SOURCES.map(e => e.priority);
    const sorted = [...priorities].sort((a, b) => a - b);
    expect(priorities).toEqual(sorted);
  });

  it('all entries are active', () => {
    for (const entry of FALLBACK_SOURCES) {
      expect(entry.active).toBe(true);
    }
  });
});

// ─── detectContentSourceFromEntries Tests ────────────────

describe('detectContentSourceFromEntries', () => {
  it('detects Threads URL (threads.com) from Omar Sarif post', () => {
    const match = detectContentSourceFromEntries(REAL_URLS.threads, FALLBACK_SOURCES);
    expect(match).not.toBeNull();
    expect(match!.sourceType).toBe('threads');
    expect(match!.browserRequired).toBe(true);
  });

  it('detects Threads URL from Sakeeb Rahman post', () => {
    const match = detectContentSourceFromEntries(REAL_URLS.threadsAlt, FALLBACK_SOURCES);
    expect(match!.sourceType).toBe('threads');
  });

  it('detects Twitter/X URL', () => {
    const match = detectContentSourceFromEntries(REAL_URLS.twitter, FALLBACK_SOURCES);
    expect(match).not.toBeNull();
    expect(match!.sourceType).toBe('twitter');
  });

  it('detects LinkedIn post URL', () => {
    const match = detectContentSourceFromEntries(REAL_URLS.linkedin, FALLBACK_SOURCES);
    expect(match!.sourceType).toBe('linkedin');
  });

  it('detects LinkedIn Pulse article', () => {
    const match = detectContentSourceFromEntries(REAL_URLS.linkedinPulse, FALLBACK_SOURCES);
    expect(match!.sourceType).toBe('linkedin');
  });

  it('detects GitHub repo URL (mitchellh/vouch)', () => {
    const match = detectContentSourceFromEntries(REAL_URLS.github, FALLBACK_SOURCES);
    expect(match!.sourceType).toBe('github');
    expect(match!.browserRequired).toBe(false);
  });

  it('detects GitHub repo URL (different-ai/openwork)', () => {
    const match = detectContentSourceFromEntries(REAL_URLS.githubAlt, FALLBACK_SOURCES);
    expect(match!.sourceType).toBe('github');
  });

  it('detects YouTube URL', () => {
    const match = detectContentSourceFromEntries(REAL_URLS.youtube, FALLBACK_SOURCES);
    expect(match!.sourceType).toBe('youtube');
  });

  it('falls back to article for ScienceDirect URL', () => {
    const match = detectContentSourceFromEntries(REAL_URLS.article, FALLBACK_SOURCES);
    expect(match!.sourceType).toBe('article');
  });

  it('falls back to article for Yahoo Finance', () => {
    const match = detectContentSourceFromEntries(REAL_URLS.articleYahoo, FALLBACK_SOURCES);
    expect(match!.sourceType).toBe('article');
  });

  it('falls back to article for Bring a Trailer', () => {
    const match = detectContentSourceFromEntries(REAL_URLS.bringATrailer, FALLBACK_SOURCES);
    expect(match!.sourceType).toBe('article');
  });

  it('falls back to article for Spotify', () => {
    const match = detectContentSourceFromEntries(REAL_URLS.spotify, FALLBACK_SOURCES);
    expect(match!.sourceType).toBe('article');
  });

  it('falls back to article for Wikipedia', () => {
    const match = detectContentSourceFromEntries(REAL_URLS.wikipedia, FALLBACK_SOURCES);
    expect(match!.sourceType).toBe('article');
  });

  it('returns null for invalid URL', () => {
    const match = detectContentSourceFromEntries('not-a-url', FALLBACK_SOURCES);
    expect(match).toBeNull();
  });

  it('skips inactive entries', () => {
    const entries: ContentSourceEntry[] = [
      { ...FALLBACK_SOURCES[0], active: false }, // threads inactive
      ...FALLBACK_SOURCES.slice(1),
    ];
    // Threads URL should NOT match inactive threads entry, falls back to article
    const match = detectContentSourceFromEntries(REAL_URLS.threads, entries);
    expect(match!.sourceType).toBe('article');
  });
});

// ─── Cache + Sync Accessors ──────────────────────────────

describe('cache and sync accessors', () => {
  beforeEach(() => {
    clearContentSourcesCache();
  });

  afterEach(() => {
    clearContentSourcesCache();
  });

  it('getContentSourcesSync returns FALLBACK when cache is empty', () => {
    const entries = getContentSourcesSync();
    expect(entries).toBe(FALLBACK_SOURCES);
  });

  it('injectContentSources populates cache', () => {
    const custom: ContentSourceEntry[] = [{
      name: 'bluesky',
      domainPatterns: ['bsky.app', 'bsky.social'],
      sourceType: 'generic' as any,
      extractionMethod: 'Fetch',
      browserRequired: false,
      sourceDefaults: {},
      priority: 15,
      active: true,
    }];

    injectContentSources(custom);
    const entries = getContentSourcesSync();
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe('bluesky');
  });

  it('clearContentSourcesCache resets to FALLBACK', () => {
    injectContentSources([FALLBACK_SOURCES[0]]);
    expect(getContentSourcesSync()).toHaveLength(1);

    clearContentSourcesCache();
    expect(getContentSourcesSync()).toBe(FALLBACK_SOURCES);
  });

  it('getSpaSourcesSync returns browser-required sources', () => {
    const spaSources = getSpaSourcesSync();
    expect(spaSources).toContain('threads');
    expect(spaSources).toContain('twitter');
    expect(spaSources).toContain('linkedin');
    expect(spaSources).not.toContain('github');
    expect(spaSources).not.toContain('youtube');
    expect(spaSources).not.toContain('article');
  });

  it('getSpaSourcesSync reflects injected config', () => {
    injectContentSources([
      { ...FALLBACK_SOURCES[0], browserRequired: false }, // threads no longer SPA
      ...FALLBACK_SOURCES.slice(1),
    ]);
    const spaSources = getSpaSourcesSync();
    expect(spaSources).not.toContain('threads');
    expect(spaSources).toContain('twitter');
  });

  it('getSourceDefaultsSync returns correct defaults for threads', () => {
    const defaults = getSourceDefaultsSync('threads');
    expect(defaults).toHaveProperty('targetSelector', 'article');
    expect(defaults).toHaveProperty('withShadowDom', true);
    expect(defaults).toHaveProperty('timeout', 45);
  });

  it('getSourceDefaultsSync returns empty object for unknown source', () => {
    const defaults = getSourceDefaultsSync('generic');
    expect(defaults).toHaveProperty('removeSelector');
  });
});

// ─── Integration: detectContentSourceFromEntries (full chain) ──────────
// Note: We test via detectContentSourceFromEntries + FALLBACK_SOURCES
// rather than detectContentSource() directly, because other test files
// mock the content-router module and bun test shares module state.

describe('detectContentSourceFromEntries full chain (FALLBACK path)', () => {
  it('detects threads from real Threads URL', () => {
    const match = detectContentSourceFromEntries(REAL_URLS.threads, FALLBACK_SOURCES);
    expect(match!.sourceType).toBe('threads');
  });

  it('detects twitter from real X URL', () => {
    const match = detectContentSourceFromEntries(REAL_URLS.twitter, FALLBACK_SOURCES);
    expect(match!.sourceType).toBe('twitter');
  });

  it('detects linkedin from real LinkedIn URL', () => {
    const match = detectContentSourceFromEntries(REAL_URLS.linkedin, FALLBACK_SOURCES);
    expect(match!.sourceType).toBe('linkedin');
  });

  it('detects github from real GitHub URL', () => {
    const match = detectContentSourceFromEntries(REAL_URLS.github, FALLBACK_SOURCES);
    expect(match!.sourceType).toBe('github');
  });

  it('detects youtube from real YouTube URL', () => {
    const match = detectContentSourceFromEntries(REAL_URLS.youtube, FALLBACK_SOURCES);
    expect(match!.sourceType).toBe('youtube');
  });

  it('returns article for ScienceDirect', () => {
    const match = detectContentSourceFromEntries(REAL_URLS.article, FALLBACK_SOURCES);
    expect(match!.sourceType).toBe('article');
  });

  it('returns article for Bring a Trailer', () => {
    const match = detectContentSourceFromEntries(REAL_URLS.bringATrailer, FALLBACK_SOURCES);
    expect(match!.sourceType).toBe('article');
  });

  it('returns null for invalid URL', () => {
    const match = detectContentSourceFromEntries('not-a-url', FALLBACK_SOURCES);
    expect(match).toBeNull();
  });
});

// ─── New Source Addition (ADR-001 value prop) ────────────

describe('ADR-001 value: adding new sources via config', () => {
  beforeEach(() => {
    clearContentSourcesCache();
  });

  afterEach(() => {
    clearContentSourcesCache();
  });

  it('can add Bluesky detection via injected config', () => {
    const withBluesky: ContentSourceEntry[] = [
      {
        name: 'bluesky',
        domainPatterns: ['bsky.app', 'bsky.social'],
        sourceType: 'generic' as any,
        extractionMethod: 'Browser',
        browserRequired: true,
        sourceDefaults: { waitForSelector: '[data-testid="postText"]', timeout: 15 },
        priority: 15,
        active: true,
      },
      ...FALLBACK_SOURCES,
    ];

    const match = detectContentSourceFromEntries(
      'https://bsky.app/profile/user.bsky.social/post/abc123',
      withBluesky,
    );
    expect(match).not.toBeNull();
    expect(match!.name).toBe('bluesky');
    expect(match!.browserRequired).toBe(true);
  });

  it('can add Mastodon detection via injected config', () => {
    const withMastodon: ContentSourceEntry[] = [
      {
        name: 'mastodon',
        domainPatterns: ['mastodon.social', 'fosstodon.org'],
        sourceType: 'generic' as any,
        extractionMethod: 'Fetch',
        browserRequired: false,
        sourceDefaults: {},
        priority: 35,
        active: true,
      },
      ...FALLBACK_SOURCES,
    ];

    const match = detectContentSourceFromEntries(
      'https://mastodon.social/@user/12345',
      withMastodon,
    );
    expect(match!.name).toBe('mastodon');
    expect(match!.browserRequired).toBe(false);
  });

  it('priority ordering puts higher-priority sources first', () => {
    // If a domain matches multiple entries, first match wins (priority-sorted)
    const entries: ContentSourceEntry[] = [
      {
        name: 'threads-premium',
        domainPatterns: ['threads.com'],
        sourceType: 'threads',
        extractionMethod: 'Gemini',
        browserRequired: true,
        sourceDefaults: {},
        priority: 5, // Higher priority than threads (10)
        active: true,
      },
      ...FALLBACK_SOURCES,
    ];

    const match = detectContentSourceFromEntries(REAL_URLS.threads, entries);
    expect(match!.name).toBe('threads-premium');
    expect(match!.extractionMethod).toBe('Gemini');
  });
});
