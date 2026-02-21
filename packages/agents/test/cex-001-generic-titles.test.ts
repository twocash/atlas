/**
 * ATLAS-CEX-001: Regression tests for SPA generic title detection
 *
 * When content extraction fails on SPA sites (Threads, Twitter, LinkedIn),
 * the browser returns the platform's marketing <title> tag instead of post content.
 * These generic titles must be detected so research dispatches use extracted content
 * or get blocked entirely.
 *
 * Real-world examples that triggered platform-about research:
 * - "Pear (@simplpear) on Threads" → researched "Threads platform" instead of the post
 * - "Boris Cherny (@nicknameisher) · X" → researched Twitter/X platform
 */

import { describe, it, expect } from 'bun:test';
import { buildResearchQuery, isGenericTitle } from '../src/agents/research';

describe('ATLAS-CEX-001: isGenericTitle catches SPA shell titles', () => {
  // Real production failures
  it('catches "Username (@handle) on Threads"', () => {
    expect(isGenericTitle('Pear (@simplpear) on Threads')).toBe(true);
  });

  it('catches "Name (@handle) on X"', () => {
    expect(isGenericTitle('Boris Cherny (@nicknameisher) on X')).toBe(true);
  });

  it('catches "Name on LinkedIn"', () => {
    expect(isGenericTitle('Jim Calhoun on LinkedIn')).toBe(true);
  });

  it('catches "Name on Instagram"', () => {
    expect(isGenericTitle('grove_ai on Instagram')).toBe(true);
  });

  it('catches "Name on Twitter"', () => {
    expect(isGenericTitle('Some User on Twitter')).toBe(true);
  });

  // Handle-only titles
  it('catches bare "@handle"', () => {
    expect(isGenericTitle('@simplpear')).toBe(true);
  });

  it('catches "(@handle)"', () => {
    expect(isGenericTitle('(@simplpear)')).toBe(true);
  });

  // Bare platform names
  it('catches "Threads"', () => {
    expect(isGenericTitle('Threads')).toBe(true);
  });

  it('catches "X.com"', () => {
    expect(isGenericTitle('X.com')).toBe(true);
  });

  it('catches "LinkedIn"', () => {
    expect(isGenericTitle('LinkedIn')).toBe(true);
  });

  // Original patterns still work
  it('catches "Social Media Post"', () => {
    expect(isGenericTitle('Social Media Post')).toBe(true);
  });

  it('catches "threads post"', () => {
    expect(isGenericTitle('threads post')).toBe(true);
  });

  it('catches raw URL as title', () => {
    expect(isGenericTitle('https://www.threads.com/@simplpear/post/DU-tZ30DE4Z')).toBe(true);
  });

  // Legitimate titles must NOT be flagged
  it('does NOT flag a real article title', () => {
    expect(isGenericTitle('How AI is Transforming Healthcare in 2026')).toBe(false);
  });

  it('does NOT flag a title mentioning a platform in context', () => {
    expect(isGenericTitle('Why Threads is winning the social media war')).toBe(false);
  });

  it('does NOT flag a person name with context', () => {
    expect(isGenericTitle('Boris Cherny discusses TypeScript best practices')).toBe(false);
  });

  it('does NOT flag a descriptive title with a handle', () => {
    expect(isGenericTitle('@simplpear explains the future of AI agents')).toBe(false);
  });
});

describe('ATLAS-CEX-001: buildResearchQuery with generic SPA titles', () => {
  it('uses sourceContent when triage title is generic SPA shell', () => {
    const query = buildResearchQuery({
      triageTitle: 'Pear (@simplpear) on Threads',
      fallbackTitle: '',
      sourceContent: 'The future of AI agents is about autonomous decision-making and real-time learning from user feedback loops.',
    });
    // Should contain the content topic, NOT "Pear (@simplpear) on Threads"
    expect(query).not.toContain('on Threads');
    expect(query.toLowerCase()).toContain('ai agent');
  });

  it('falls back to generic title when no sourceContent provided', () => {
    // This is the content-callback.ts case — no sourceContent available
    // Title is generic but it's all we have
    const query = buildResearchQuery({
      triageTitle: 'Pear (@simplpear) on Threads',
      fallbackTitle: 'https://www.threads.com/@simplpear/post/DU-tZ30DE4Z',
    });
    // Without sourceContent, the generic title is still used (isGenericTitle triggers
    // the content branch, but no content → falls through to the title)
    expect(query).toBeTruthy();
  });

  it('uses real title when title is NOT generic', () => {
    const query = buildResearchQuery({
      triageTitle: 'TypeScript performance optimization techniques for large codebases',
      fallbackTitle: '',
    });
    expect(query).toContain('TypeScript performance');
  });
});
