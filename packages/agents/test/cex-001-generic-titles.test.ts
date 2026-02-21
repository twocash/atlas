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
import { buildResearchQuery, isGenericTitle, isDirectiveIntent } from '../src/agents/research';

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

// ── ATLAS-CEX-001 P0 refinement: image-tag-only content ─────────────────

describe('ATLAS-CEX-001: extractTopicFromContent rejects image-only input', () => {
  it('image-only sourceContent → falls through to title (content topic is empty)', () => {
    // Simulates Jina returning only profile picture markdown
    const query = buildResearchQuery({
      triageTitle: 'Sung Kim on Threads',
      fallbackTitle: 'https://www.threads.com/@sung.kim.mw/post/DU-BRCvlT5P',
      sourceContent: '![Sung Kim profile](https://scontent.cdninstagram.com/v/t51.2885-19/12345_n.jpg)',
    });
    // Image stripping leaves nothing → content topic empty → title used as fallback
    expect(query).toBeTruthy();
  });

  it('image + bare URL content → stripped to nothing → title fallback', () => {
    const query = buildResearchQuery({
      triageTitle: 'Pear (@simplpear) on Threads',
      fallbackTitle: '',
      sourceContent: '![avatar](https://cdn.threads.net/avatar.jpg)\nhttps://cdn.threads.net/profile-pic.webp',
    });
    // All content is images/URLs → stripped to nothing → generic title used
    expect(query).toBeTruthy();
  });

  it('real text + images → uses text (ignores images)', () => {
    const query = buildResearchQuery({
      triageTitle: 'Someone on Threads',
      fallbackTitle: '',
      sourceContent: '![avatar](https://cdn.threads.net/avatar.jpg)\nRecursive language models represent a fundamentally different approach to AI architecture.',
    });
    expect(query).not.toContain('on Threads');
    expect(query.toLowerCase()).toContain('recursive language model');
  });
});

// ── ATLAS-CEX-001 Contract B: userIntent injection ──────────────────────

describe('ATLAS-CEX-001: buildResearchQuery with userIntent (Socratic reply)', () => {
  it('userIntent overrides generic SPA title', () => {
    const query = buildResearchQuery({
      triageTitle: 'Pear (@simplpear) on Threads',
      fallbackTitle: '',
      userIntent: 'recursive language models and innovation at the edge of AI architecture',
    });
    expect(query).not.toContain('on Threads');
    expect(query.toLowerCase()).toContain('recursive language model');
  });

  it('userIntent combines with good title', () => {
    const query = buildResearchQuery({
      triageTitle: 'Claude 4 autonomous computer use',
      fallbackTitle: '',
      userIntent: 'focus on the safety implications and alignment work',
    });
    expect(query).toContain('Claude 4');
    expect(query).toContain('safety implications');
  });

  it('short userIntent (<= 10 chars) is ignored', () => {
    const query = buildResearchQuery({
      triageTitle: 'TypeScript performance optimization',
      fallbackTitle: '',
      userIntent: 'cool stuff',  // too short to override
    });
    expect(query).toContain('TypeScript');
    expect(query).not.toContain('cool stuff');
  });

  it('userIntent + sourceContent + generic title → intent wins', () => {
    const query = buildResearchQuery({
      triageTitle: 'Someone on Twitter',
      fallbackTitle: '',
      sourceContent: 'TypeScript 6.0 introduces structural pattern matching.',
      userIntent: 'how does this compare to Rust pattern matching',
    });
    // userIntent takes priority over sourceContent extraction
    expect(query.toLowerCase()).toContain('rust pattern matching');
  });

  it('userIntent alone (no title, no content) produces valid query', () => {
    const query = buildResearchQuery({
      triageTitle: '',
      fallbackTitle: '',
      userIntent: 'decentralized AI governance frameworks for enterprise adoption',
    });
    expect(query.toLowerCase()).toContain('decentralized ai governance');
  });

  it('directive intent "research it" defers to sourceContent', () => {
    const query = buildResearchQuery({
      triageTitle: 'elvis (@omarsar0) on Threads',
      fallbackTitle: '',
      sourceContent: 'Recursive language models represent a fundamentally different approach to AI architecture.',
      userIntent: 'research it',
    });
    // "research it" is a directive — should NOT become the query
    expect(query.toLowerCase()).not.toContain('research it');
    // sourceContent should be used instead
    expect(query.toLowerCase()).toContain('recursive language model');
  });

  it('directive intent "go deep" defers to sourceContent', () => {
    const query = buildResearchQuery({
      triageTitle: 'Someone on Twitter',
      fallbackTitle: '',
      sourceContent: 'Agent-to-agent protocols for enterprise orchestration are emerging as a standard.',
      userIntent: 'go deep',
    });
    expect(query.toLowerCase()).not.toContain('go deep');
    expect(query.toLowerCase()).toContain('agent');
  });

  it('directive intent with no sourceContent falls through to title', () => {
    const query = buildResearchQuery({
      triageTitle: 'claude 4 computer use benchmarks',
      fallbackTitle: '',
      userIntent: 'research it',
    });
    // No sourceContent, directive skipped, title used
    expect(query.toLowerCase()).toContain('claude 4');
    expect(query.toLowerCase()).not.toContain('research it');
  });
});

// ── ATLAS-CEX-001: isDirectiveIntent unit tests ─────────────────────────

describe('ATLAS-CEX-001: isDirectiveIntent detects low-information directives', () => {
  // Positive cases — these ARE directives (no topic value)
  const directives = [
    'research it',
    'Research it',
    'go deep',
    'look into it',
    'dig into it',
    'check it out',
    'explore this',
    'investigate that',
    'analyze it',
    'summarize it',
    'read it',
    'deep dive',
    'go for it',
    'do it',
    'yes please',
    'full send',
    "let's go",
    'lets go',
    'what do you think',
    'what do you think?',
    'tell me more',
    "what's there",
    "what's there?",
    'research it.',
    'Go deep.',
  ];

  for (const d of directives) {
    it(`detects "${d}" as directive`, () => {
      expect(isDirectiveIntent(d)).toBe(true);
    });
  }

  // Negative cases — these carry actual topic information
  const topics = [
    'recursive language models and innovation at the edge',
    'how does this compare to Rust pattern matching',
    'focus on the safety implications',
    'this is about multi-agent orchestration protocols',
    'decentralized AI governance frameworks',
    'research the impact on healthcare',  // "research" + topic ≠ bare directive
    'go deep on the alignment implications',  // "go deep on X" has topic
  ];

  for (const t of topics) {
    it(`does NOT flag "${t}" as directive`, () => {
      expect(isDirectiveIntent(t)).toBe(false);
    });
  }
});
