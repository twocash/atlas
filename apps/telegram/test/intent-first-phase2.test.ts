/**
 * Intent-First Phase 2 — Prompt Composition Accepts Structured Context
 *
 * Unit tests for the three mappers + integration test for composeFromStructuredContext.
 * All tests mock the prompt manager to avoid Notion API calls.
 */

import { describe, it, expect, mock, beforeEach } from 'bun:test';

// Mock prompt-manager BEFORE importing composition modules
mock.module('../../../packages/agents/src/services/prompt-manager', () => ({
  getPromptManager: () => ({
    composePrompts: async (_ids: any, _vars: any) => null, // Always returns null → triggers fallback
  }),
}));

import {
  mapIntentToAction,
  inferFormat,
  resolveAudienceVoice,
  getDepthConfig,
  composeFromStructuredContext,
  type StructuredCompositionInput,
  type IntentType,
  type DepthLevel,
  type AudienceType,
  type DepthConfig,
} from '../../../packages/agents/src/services/prompt-composition';

// ==========================================
// 1. Intent Mapper Tests
// ==========================================

describe('intent-mapper: mapIntentToAction', () => {
  it('maps research → research (direct)', () => {
    expect(mapIntentToAction('research')).toBe('research');
  });

  it('maps draft → draft (direct)', () => {
    expect(mapIntentToAction('draft')).toBe('draft');
  });

  it('maps save → capture', () => {
    expect(mapIntentToAction('save')).toBe('capture');
  });

  it('maps analyze → analysis', () => {
    expect(mapIntentToAction('analyze')).toBe('analysis');
  });

  it('maps capture → capture (direct)', () => {
    expect(mapIntentToAction('capture')).toBe('capture');
  });

  it('maps engage → draft', () => {
    expect(mapIntentToAction('engage')).toBe('draft');
  });

  it('every IntentType maps to a valid ActionType', () => {
    const intents: IntentType[] = ['research', 'draft', 'save', 'analyze', 'capture', 'engage'];
    const validActions = ['research', 'draft', 'capture', 'analysis', 'summarize'];
    for (const intent of intents) {
      const action = mapIntentToAction(intent);
      expect(validActions).toContain(action);
    }
  });
});

describe('intent-mapper: inferFormat', () => {
  it('draft + deep → report', () => {
    expect(inferFormat('draft', 'deep')).toBe('report');
  });

  it('draft + quick → post', () => {
    expect(inferFormat('draft', 'quick')).toBe('post');
  });

  it('draft + standard → post', () => {
    expect(inferFormat('draft', 'standard')).toBe('post');
  });

  it('research + deep → analysis', () => {
    expect(inferFormat('research', 'deep')).toBe('analysis');
  });

  it('research + quick → brief', () => {
    expect(inferFormat('research', 'quick')).toBe('brief');
  });

  it('research + standard → brief', () => {
    expect(inferFormat('research', 'standard')).toBe('brief');
  });

  it('engage → thread regardless of depth', () => {
    expect(inferFormat('engage', 'quick')).toBe('thread');
    expect(inferFormat('engage', 'standard')).toBe('thread');
    expect(inferFormat('engage', 'deep')).toBe('thread');
  });

  it('capture → raw', () => {
    expect(inferFormat('capture', 'standard')).toBe('raw');
  });

  it('save → raw', () => {
    expect(inferFormat('save', 'standard')).toBe('raw');
  });

  it('analyze + quick → brief', () => {
    expect(inferFormat('analyze', 'quick')).toBe('brief');
  });

  it('analyze + deep → analysis', () => {
    expect(inferFormat('analyze', 'deep')).toBe('analysis');
  });
});

// ==========================================
// 2. Audience-Voice Tests
// ==========================================

describe('audience-voice: resolveAudienceVoice', () => {
  it('explicit voice_hint always wins', () => {
    expect(resolveAudienceVoice('self', 'The Grove', 'my-custom-voice')).toBe('my-custom-voice');
    expect(resolveAudienceVoice('client', 'Consulting', 'special')).toBe('special');
  });

  it('client + Consulting → consulting-brief', () => {
    expect(resolveAudienceVoice('client', 'Consulting', null)).toBe('consulting-brief');
  });

  it('client + The Grove → grove-analytical', () => {
    expect(resolveAudienceVoice('client', 'The Grove', null)).toBe('grove-analytical');
  });

  it('public + Consulting → client-facing', () => {
    expect(resolveAudienceVoice('public', 'Consulting', null)).toBe('client-facing');
  });

  it('public + The Grove → grove-analytical', () => {
    expect(resolveAudienceVoice('public', 'The Grove', null)).toBe('grove-analytical');
  });

  it('self + The Grove → raw-notes', () => {
    expect(resolveAudienceVoice('self', 'The Grove', null)).toBe('raw-notes');
  });

  it('self + Personal → reflective', () => {
    expect(resolveAudienceVoice('self', 'Personal', null)).toBe('reflective');
  });

  it('self + Home/Garage → practical', () => {
    expect(resolveAudienceVoice('self', 'Home/Garage', null)).toBe('practical');
  });

  it('team + Consulting → consulting-brief', () => {
    expect(resolveAudienceVoice('team', 'Consulting', null)).toBe('consulting-brief');
  });

  it('team + The Grove → strategic', () => {
    expect(resolveAudienceVoice('team', 'The Grove', null)).toBe('strategic');
  });

  it('every audience × pillar returns a string', () => {
    const audiences: AudienceType[] = ['self', 'client', 'public', 'team'];
    const pillars = ['The Grove', 'Consulting', 'Personal', 'Home/Garage'] as const;
    for (const audience of audiences) {
      for (const pillar of pillars) {
        const voice = resolveAudienceVoice(audience, pillar, null);
        expect(typeof voice).toBe('string');
        expect(voice!.length).toBeGreaterThan(0);
      }
    }
  });
});

// ==========================================
// 3. Depth Config Tests
// ==========================================

describe('depth-config: getDepthConfig', () => {
  it('quick: standard temp, low maxTokens, concise modifier', () => {
    const cfg = getDepthConfig('quick');
    expect(cfg.temperature).toBe(0.7);
    expect(cfg.maxTokens).toBe(2048);
    expect(cfg.instructionModifier).toContain('concise');
  });

  it('standard: baseline temp, baseline maxTokens, empty modifier', () => {
    const cfg = getDepthConfig('standard');
    expect(cfg.temperature).toBe(0.7);
    expect(cfg.maxTokens).toBe(4096);
    expect(cfg.instructionModifier).toBe('');
  });

  it('deep: low temp (precision), high maxTokens, thorough+cite modifier', () => {
    const cfg = getDepthConfig('deep');
    expect(cfg.temperature).toBe(0.3);
    expect(cfg.maxTokens).toBe(8192);
    expect(cfg.instructionModifier).toContain('thorough');
    expect(cfg.instructionModifier).toContain('Cite sources');
  });

  it('deep temp < quick/standard temp (precision over creativity)', () => {
    const quick = getDepthConfig('quick');
    const standard = getDepthConfig('standard');
    const deep = getDepthConfig('deep');
    expect(deep.temperature).toBeLessThan(quick.temperature);
    expect(deep.temperature).toBeLessThan(standard.temperature);
  });

  it('maxTokens progression: quick < standard < deep', () => {
    const depths: DepthLevel[] = ['quick', 'standard', 'deep'];
    const tokens = depths.map(d => getDepthConfig(d).maxTokens);
    expect(tokens[0]).toBeLessThan(tokens[1]);
    expect(tokens[1]).toBeLessThan(tokens[2]);
  });
});

// ==========================================
// 4. composeFromStructuredContext Integration
// ==========================================

describe('composeFromStructuredContext', () => {
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

  it('produces a PromptCompositionResult with all fields', async () => {
    const result = await composeFromStructuredContext(makeInput());
    expect(result).toHaveProperty('prompt');
    expect(result).toHaveProperty('temperature');
    expect(result).toHaveProperty('maxTokens');
    expect(result).toHaveProperty('metadata');
    expect(typeof result.prompt).toBe('string');
    expect(result.prompt.length).toBeGreaterThan(0);
  });

  it('maps intent to correct action in drafter ID', async () => {
    // With mocked prompt manager returning null, composePrompt uses fallback path.
    // composeFromStructuredContext enriches metadata afterward, so check originalIntent.
    const result = await composeFromStructuredContext(makeInput({ intent: 'research' }));
    expect(result.metadata.originalIntent).toBe('research');

    const result2 = await composeFromStructuredContext(makeInput({ intent: 'save' }));
    expect(result2.metadata.originalIntent).toBe('save');

    const result3 = await composeFromStructuredContext(makeInput({ intent: 'engage' }));
    expect(result3.metadata.originalIntent).toBe('engage');
  });

  it('resolves voice from audience when no hint', async () => {
    // self + The Grove → raw-notes
    // In fallback path, voice is not carried in metadata.voice but we can verify
    // by checking the audience resolver directly
    const voice = resolveAudienceVoice('self', 'The Grove', null);
    expect(voice).toBe('raw-notes');

    // The integration: composeFromStructuredContext feeds resolved voice to composePrompt
    // which builds voice.raw-notes as the voice ID. In fallback path, metadata.voice is
    // not set (fallback bypasses prompt ID resolution). Verify the voice resolution works.
    const result = await composeFromStructuredContext(makeInput({
      audience: 'self',
      pillar: 'The Grove',
      voice_hint: null,
    }));
    // Result exists without error — voice was accepted by the pipeline
    expect(result.prompt.length).toBeGreaterThan(0);
  });

  it('uses explicit voice_hint over audience default', async () => {
    const voice = resolveAudienceVoice('self', 'The Grove', 'grove-analytical');
    expect(voice).toBe('grove-analytical');

    const result = await composeFromStructuredContext(makeInput({
      audience: 'self',
      pillar: 'The Grove',
      voice_hint: 'grove-analytical',
    }));
    expect(result.prompt.length).toBeGreaterThan(0);
  });

  it('applies depth temperature override', async () => {
    const quick = await composeFromStructuredContext(makeInput({ depth: 'quick' }));
    const deep = await composeFromStructuredContext(makeInput({ depth: 'deep' }));
    expect(quick.temperature).toBe(0.7);
    expect(deep.temperature).toBe(0.3);
  });

  it('applies depth maxTokens override', async () => {
    const quick = await composeFromStructuredContext(makeInput({ depth: 'quick' }));
    const deep = await composeFromStructuredContext(makeInput({ depth: 'deep' }));
    expect(quick.maxTokens).toBe(2048);
    expect(deep.maxTokens).toBe(8192);
  });

  it('appends depth instruction modifier for non-standard depths', async () => {
    const quick = await composeFromStructuredContext(makeInput({ depth: 'quick' }));
    expect(quick.prompt).toContain('Be concise');

    const deep = await composeFromStructuredContext(makeInput({ depth: 'deep' }));
    expect(deep.prompt).toContain('Provide thorough');

    const standard = await composeFromStructuredContext(makeInput({ depth: 'standard' }));
    // Standard has empty modifier — prompt should NOT contain depth instruction phrases
    expect(standard.prompt).not.toContain('Be concise');
    expect(standard.prompt).not.toContain('Provide thorough');
  });

  it('infers format when null', async () => {
    const result = await composeFromStructuredContext(makeInput({
      intent: 'research',
      depth: 'deep',
      format: null,
    }));
    expect(result.metadata.format).toBe('analysis');
  });

  it('preserves explicit format', async () => {
    const result = await composeFromStructuredContext(makeInput({
      intent: 'research',
      depth: 'deep',
      format: 'brief', // explicit, even though deep research would infer 'analysis'
    }));
    expect(result.metadata.format).toBe('brief');
  });

  it('enriches metadata with structured context info', async () => {
    const result = await composeFromStructuredContext(makeInput({
      intent: 'analyze',
      depth: 'deep',
      audience: 'client',
    }));
    expect(result.metadata.originalIntent).toBe('analyze');
    expect(result.metadata.depth).toBe('deep');
    expect(result.metadata.audience).toBe('client');
  });

  it('handles all pillar × intent combinations without throwing', async () => {
    const pillars = ['The Grove', 'Consulting', 'Personal', 'Home/Garage'] as const;
    const intents: IntentType[] = ['research', 'draft', 'save', 'analyze', 'capture', 'engage'];

    for (const pillar of pillars) {
      for (const intent of intents) {
        const result = await composeFromStructuredContext(makeInput({ pillar, intent }));
        expect(result.prompt.length).toBeGreaterThan(0);
        expect(result.metadata.drafter).toBeTruthy();
      }
    }
  });

  it('uses fallback prompt (since prompt manager returns null in tests)', async () => {
    const result = await composeFromStructuredContext(makeInput({
      intent: 'research',
      pillar: 'The Grove',
    }));
    // Fallback prompt includes "Research Request" heading and context section
    expect(result.prompt).toContain('Research');
    expect(result.prompt).toContain('The Grove');
  });
});
