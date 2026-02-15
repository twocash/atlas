/**
 * Structured Composition — Master Blaster Scenario Tests
 *
 * 8 real-world scenarios that exercise the full intent→action→voice→depth→compose chain.
 * Fixtures sourced from actual Feed 2.0 entries (Feb 2026).
 *
 * These test how Jim actually uses the system, not just whether mappers work in isolation.
 */

import { describe, it, expect, mock } from 'bun:test';

// Mock prompt-manager BEFORE importing composition modules
mock.module('../../../packages/agents/src/services/prompt-manager', () => ({
  getPromptManager: () => ({
    composePrompts: async (_ids: any, _vars: any) => null, // fallback path
  }),
}));

import {
  composeFromStructuredContext,
  composePrompt,
  mapIntentToAction,
  inferFormat,
  resolveAudienceVoice,
  getDepthConfig,
  type StructuredCompositionInput,
  type CompositionContext,
} from '../../../packages/agents/src/services/prompt-composition';

// ==========================================
// Real Feed 2.0 Fixtures (Feb 2026)
// ==========================================

/** Feed entry: "Content from github.com" — captured 2026-02-12 */
const GITHUB_FIXTURE = {
  url: 'https://github.com/getmaxun/maxun',
  title: 'Content from github.com',
  content: 'https://github.com/getmaxun/maxun',
  source_type: 'github' as const,
  pillar: 'The Grove' as const,
};

/** Feed entry: LinkedIn article — captured 2026-02-08 */
const LINKEDIN_FIXTURE = {
  url: 'https://www.linkedin.com/pulse/human-ai-relationships-beyond-uncanny-valley-chris-hood-m4lmc',
  title: 'Human-AI Relationships: Beyond the Uncanny Valley',
  content: 'https://www.linkedin.com/pulse/human-ai-relationships-beyond-uncanny-valley-chris-hood-m4lmc',
  source_type: 'linkedin' as const,
  pillar: 'Consulting' as const,
};

/** Feed entry: Threads post on AI agents — captured 2026-02-08 */
const THREADS_FIXTURE = {
  url: 'https://www.threads.com/@aiagents101/post/DUergIWjFjU',
  title: 'AI Agents Insights: Social Media Post',
  content: 'https://www.threads.com/@aiagents101/post/DUergIWjFjU',
  source_type: 'url' as const,
  pillar: 'The Grove' as const,
};

/** Synthetic: image share (no URL) */
const IMAGE_FIXTURE = {
  url: undefined as string | undefined,
  title: 'Screenshot of competitor dashboard',
  content: '[image data: competitor SaaS dashboard showing pricing tiers]',
  source_type: 'image' as const,
  pillar: 'Consulting' as const,
};

function makeInput(overrides: Partial<StructuredCompositionInput> = {}): StructuredCompositionInput {
  return {
    intent: 'research',
    depth: 'standard',
    audience: 'self',
    source_type: 'url',
    format: null,
    voice_hint: null,
    content: 'https://example.com/article',
    title: 'Test Article',
    url: 'https://example.com/article',
    pillar: 'The Grove',
    ...overrides,
  };
}

// ==========================================
// Scenario Tests
// ==========================================

describe('Scenario 1: Monday Morning GitHub Link', () => {
  // Jim shares a GitHub repo URL → taps Research → Deep → Self
  it('composes research drafter with deep precision config and raw-notes voice', async () => {
    const result = await composeFromStructuredContext(makeInput({
      intent: 'research',
      depth: 'deep',
      audience: 'self',
      source_type: GITHUB_FIXTURE.source_type,
      pillar: GITHUB_FIXTURE.pillar,
      content: GITHUB_FIXTURE.content,
      title: GITHUB_FIXTURE.title,
      url: GITHUB_FIXTURE.url,
      format: null,
      voice_hint: null,
    }));

    // Action: research (direct mapping)
    expect(mapIntentToAction('research')).toBe('research');

    // Voice: self + The Grove → raw-notes
    expect(resolveAudienceVoice('self', 'The Grove', null)).toBe('raw-notes');

    // Depth config: deep = precise (low temp), high capacity
    expect(result.temperature).toBe(0.3);
    expect(result.maxTokens).toBe(8192);

    // Depth modifier includes thorough + cite sources
    expect(result.prompt).toContain('thorough');
    expect(result.prompt).toContain('Cite sources');

    // Metadata carries structured context
    expect(result.metadata.originalIntent).toBe('research');
    expect(result.metadata.depth).toBe('deep');
    expect(result.metadata.audience).toBe('self');

    // Format inferred: research + deep → analysis
    expect(result.metadata.format).toBe('analysis');

    // Prompt references the actual content
    expect(result.prompt).toContain(GITHUB_FIXTURE.url);
  });
});

describe('Scenario 2: Client Deliverable', () => {
  // Research → Standard → Client. Voice is consulting-brief.
  it('composes with consulting voice and standard defaults', async () => {
    const result = await composeFromStructuredContext(makeInput({
      intent: 'research',
      depth: 'standard',
      audience: 'client',
      pillar: 'Consulting',
      source_type: LINKEDIN_FIXTURE.source_type,
      content: LINKEDIN_FIXTURE.content,
      title: LINKEDIN_FIXTURE.title,
      url: LINKEDIN_FIXTURE.url,
      format: null,
      voice_hint: null,
    }));

    // Voice: client + Consulting → consulting-brief
    expect(resolveAudienceVoice('client', 'Consulting', null)).toBe('consulting-brief');

    // Standard depth: production defaults
    expect(result.temperature).toBe(0.7);
    expect(result.maxTokens).toBe(4096);

    // Standard has no depth modifier appended
    expect(result.prompt).not.toContain('Be concise');
    expect(result.prompt).not.toContain('Cite sources');

    // Metadata
    expect(result.metadata.originalIntent).toBe('research');
    expect(result.metadata.depth).toBe('standard');
    expect(result.metadata.audience).toBe('client');

    // Pillar in prompt context
    expect(result.prompt).toContain('Consulting');
  });
});

describe('Scenario 3: LinkedIn Engage', () => {
  // Engage → Quick → Public. Action resolves to draft.
  it('maps engage→draft with public grove-analytical voice and quick config', async () => {
    const result = await composeFromStructuredContext(makeInput({
      intent: 'engage',
      depth: 'quick',
      audience: 'public',
      pillar: 'The Grove',
      source_type: 'linkedin',
      content: LINKEDIN_FIXTURE.content,
      title: LINKEDIN_FIXTURE.title,
      url: LINKEDIN_FIXTURE.url,
      format: null,
      voice_hint: null,
    }));

    // Action: engage → draft
    expect(mapIntentToAction('engage')).toBe('draft');

    // Voice: public + The Grove → grove-analytical
    expect(resolveAudienceVoice('public', 'The Grove', null)).toBe('grove-analytical');

    // Quick config
    expect(result.temperature).toBe(0.7);
    expect(result.maxTokens).toBe(2048);

    // Depth modifier: concise
    expect(result.prompt).toContain('Be concise');

    // Metadata tracks original intent (not the mapped action)
    expect(result.metadata.originalIntent).toBe('engage');

    // Format: engage → thread (regardless of depth)
    expect(result.metadata.format).toBe('thread');

    // Prompt produced without error
    expect(result.prompt.length).toBeGreaterThan(0);
    expect(result.metadata.drafter).toBeTruthy();
  });
});

describe('Scenario 4: Save-and-Forget', () => {
  // Save → Quick → Self. Quick capture, minimal processing.
  it('maps save→capture with raw-notes voice and quick config', async () => {
    const result = await composeFromStructuredContext(makeInput({
      intent: 'save',
      depth: 'quick',
      audience: 'self',
      pillar: 'The Grove',
      source_type: THREADS_FIXTURE.source_type,
      content: THREADS_FIXTURE.content,
      title: THREADS_FIXTURE.title,
      url: THREADS_FIXTURE.url,
      format: null,
      voice_hint: null,
    }));

    // Action: save → capture
    expect(mapIntentToAction('save')).toBe('capture');

    // Voice: self + The Grove → raw-notes
    expect(resolveAudienceVoice('self', 'The Grove', null)).toBe('raw-notes');

    // Quick config
    expect(result.temperature).toBe(0.7);
    expect(result.maxTokens).toBe(2048);

    // Format: save + quick → raw
    expect(result.metadata.format).toBe('raw');

    // Metadata
    expect(result.metadata.originalIntent).toBe('save');
    expect(result.metadata.depth).toBe('quick');
  });
});

describe('Scenario 5: Voice Hint Override', () => {
  // Research → Deep → Self with explicit voice_hint: 'consulting-brief'
  it('voice_hint overrides audience default (consulting-brief instead of raw-notes)', async () => {
    const result = await composeFromStructuredContext(makeInput({
      intent: 'research',
      depth: 'deep',
      audience: 'self',
      pillar: 'The Grove',
      source_type: GITHUB_FIXTURE.source_type,
      content: GITHUB_FIXTURE.content,
      title: GITHUB_FIXTURE.title,
      url: GITHUB_FIXTURE.url,
      format: null,
      voice_hint: 'consulting-brief',
    }));

    // Audience default would be raw-notes, but voice_hint wins
    expect(resolveAudienceVoice('self', 'The Grove', 'consulting-brief')).toBe('consulting-brief');
    expect(resolveAudienceVoice('self', 'The Grove', null)).toBe('raw-notes');

    // Everything else matches Scenario 1
    expect(result.temperature).toBe(0.3);
    expect(result.maxTokens).toBe(8192);
    expect(result.prompt).toContain('thorough');
    expect(result.prompt).toContain('Cite sources');
    expect(result.metadata.originalIntent).toBe('research');
    expect(result.metadata.depth).toBe('deep');
    expect(result.metadata.format).toBe('analysis');
  });
});

describe('Scenario 6: Backward Compatibility Canary', () => {
  // Legacy composePrompt() with pillar+action, no StructuredContext.
  // Output should be identical to pre-Phase-2 behavior.
  it('legacy composePrompt() produces same output shape as before', async () => {
    const ctx: CompositionContext = {
      pillar: 'The Grove',
      action: 'research',
      voice: 'grove-analytical',
      content: GITHUB_FIXTURE.content,
      title: GITHUB_FIXTURE.title,
      url: GITHUB_FIXTURE.url,
    };

    const result = await composePrompt(ctx);

    // Core output shape (unchanged from pre-Phase-2)
    expect(result).toHaveProperty('prompt');
    expect(result).toHaveProperty('temperature');
    expect(result).toHaveProperty('maxTokens');
    expect(result).toHaveProperty('metadata');
    expect(typeof result.prompt).toBe('string');
    expect(result.prompt.length).toBeGreaterThan(0);

    // Fallback path defaults (no depth overrides applied by composePrompt)
    expect(result.temperature).toBe(0.7);
    expect(result.maxTokens).toBe(4096);

    // Metadata does NOT contain Phase 2 fields (originalIntent, depth, audience)
    // because we called composePrompt directly, not composeFromStructuredContext
    expect(result.metadata.originalIntent).toBeUndefined();
    expect(result.metadata.depth).toBeUndefined();
    expect(result.metadata.audience).toBeUndefined();
    expect(result.metadata.format).toBeUndefined();

    // Drafter resolves to fallback (since prompt manager mock returns null)
    expect(result.metadata.drafter).toBeTruthy();
  });
});

describe('Scenario 7: Partial Context Graceful Degradation', () => {
  // Intent and depth present, but audience missing (runtime edge case).
  // Should not throw; uses pillar-derived defaults.
  it('handles missing audience without throwing', async () => {
    const input = makeInput({
      intent: 'research',
      depth: 'deep',
      pillar: 'The Grove',
      content: GITHUB_FIXTURE.content,
      title: GITHUB_FIXTURE.title,
      url: GITHUB_FIXTURE.url,
    });

    // Simulate runtime missing audience (TypeScript type says required, but runtime may differ)
    (input as any).audience = undefined;

    // Should not throw
    const result = await composeFromStructuredContext(input);

    // Prompt is still produced
    expect(result.prompt.length).toBeGreaterThan(0);

    // Depth config still applies
    expect(result.temperature).toBe(0.3);
    expect(result.maxTokens).toBe(8192);

    // Metadata records what was provided
    expect(result.metadata.originalIntent).toBe('research');
    expect(result.metadata.depth).toBe('deep');
  });
});

describe('Scenario 8: Image Share', () => {
  // Analyze → Standard → Client, source_type: image. No URL field.
  it('resolves analysis drafter without URL field', async () => {
    const result = await composeFromStructuredContext(makeInput({
      intent: 'analyze',
      depth: 'standard',
      audience: 'client',
      pillar: IMAGE_FIXTURE.pillar,
      source_type: IMAGE_FIXTURE.source_type,
      content: IMAGE_FIXTURE.content,
      title: IMAGE_FIXTURE.title,
      url: IMAGE_FIXTURE.url,
      format: null,
      voice_hint: null,
    }));

    // Action: analyze → analysis
    expect(mapIntentToAction('analyze')).toBe('analysis');

    // Voice: client + Consulting → consulting-brief
    expect(resolveAudienceVoice('client', 'Consulting', null)).toBe('consulting-brief');

    // Standard config (no depth modifier)
    expect(result.temperature).toBe(0.7);
    expect(result.maxTokens).toBe(4096);

    // No URL in prompt context, but content is present
    expect(result.prompt).toContain(IMAGE_FIXTURE.content);

    // Metadata
    expect(result.metadata.originalIntent).toBe('analyze');
    expect(result.metadata.depth).toBe('standard');
    expect(result.metadata.audience).toBe('client');

    // Format: analyze + standard → analysis (only quick → brief)
    expect(result.metadata.format).toBe('analysis');

    // Drafter present
    expect(result.metadata.drafter).toBeTruthy();
  });
});
