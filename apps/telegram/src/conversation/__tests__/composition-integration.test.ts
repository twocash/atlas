/**
 * Composition Integration Tests
 *
 * Verifies the prompt composition pipeline wiring:
 * - Drafter ID resolution follows the correct pattern
 * - All pillars have valid configurations in the registry
 * - Fallback chain is intact
 * - Type contracts between layers are consistent
 *
 * Run with: bun test src/conversation/__tests__/composition-integration.test.ts
 */

import { describe, it, expect } from 'bun:test';

import type {
  Pillar,
  PromptSelectionState,
} from '../../../../../packages/agents/src/services/prompt-composition/types';

import {
  PILLAR_OPTIONS,
  PILLAR_SLUGS,
  PILLAR_ACTIONS,
  PILLAR_VOICES,
  getPillarSlug,
  getPillarFromSlug,
  pillarSupportsAction,
  pillarHasVoice,
  getAvailableActions,
  getAvailableVoices,
} from '../../../../../packages/agents/src/services/prompt-composition/registry';

import {
  resolveDrafterId,
  resolveVoiceId,
  resolveDefaultDrafterId,
  buildPromptIds,
} from '../../../../../packages/agents/src/services/prompt-composition/composer';

// The four canonical pillars
const ALL_PILLARS: Pillar[] = ['The Grove', 'Personal', 'Consulting', 'Home/Garage'];

describe('Pillar Registry Completeness', () => {

  it('PILLAR_OPTIONS contains all four pillars', () => {
    const pillarValues = PILLAR_OPTIONS.map(p => p.pillar);
    for (const pillar of ALL_PILLARS) {
      expect(pillarValues).toContain(pillar);
    }
  });

  it('PILLAR_SLUGS maps all four pillars', () => {
    for (const pillar of ALL_PILLARS) {
      expect(PILLAR_SLUGS[pillar]).toBeDefined();
      expect(typeof PILLAR_SLUGS[pillar]).toBe('string');
    }
  });

  it('PILLAR_ACTIONS defines actions for all four pillars', () => {
    for (const pillar of ALL_PILLARS) {
      expect(PILLAR_ACTIONS[pillar]).toBeDefined();
      expect(PILLAR_ACTIONS[pillar].length).toBeGreaterThan(0);
    }
  });

  it('PILLAR_VOICES defines voices for all four pillars', () => {
    for (const pillar of ALL_PILLARS) {
      expect(PILLAR_VOICES[pillar]).toBeDefined();
      expect(PILLAR_VOICES[pillar].length).toBeGreaterThan(0);
    }
  });

  it('slug round-trips correctly for all pillars', () => {
    for (const pillar of ALL_PILLARS) {
      const slug = getPillarSlug(pillar);
      const roundTrip = getPillarFromSlug(slug);
      expect(roundTrip).toBe(pillar);
    }
  });
});

describe('Drafter ID Resolution', () => {

  it('follows pattern: drafter.{slug}.{action}', () => {
    const id = resolveDrafterId('The Grove', 'research');
    expect(id).toBe('drafter.the-grove.research');
  });

  it('resolves all pillar/action combinations', () => {
    for (const pillar of ALL_PILLARS) {
      const actions = PILLAR_ACTIONS[pillar];
      for (const action of actions) {
        const id = resolveDrafterId(pillar, action);
        const slug = PILLAR_SLUGS[pillar];
        expect(id).toBe(`drafter.${slug}.${action}`);
      }
    }
  });

  it('default drafter follows pattern: drafter.default.{action}', () => {
    expect(resolveDefaultDrafterId('research')).toBe('drafter.default.research');
    expect(resolveDefaultDrafterId('draft')).toBe('drafter.default.draft');
    expect(resolveDefaultDrafterId('capture')).toBe('drafter.default.capture');
  });
});

describe('Voice ID Resolution', () => {

  it('prefixes bare voice IDs', () => {
    expect(resolveVoiceId('grove-analytical')).toBe('voice.grove-analytical');
  });

  it('preserves already-prefixed voice IDs', () => {
    expect(resolveVoiceId('voice.grove-analytical')).toBe('voice.grove-analytical');
  });

  it('all registered voices have valid IDs', () => {
    for (const pillar of ALL_PILLARS) {
      const voices = PILLAR_VOICES[pillar];
      for (const voice of voices) {
        expect(voice.id).toBeDefined();
        expect(voice.id.length).toBeGreaterThan(0);
        // Should not already have prefix (registry stores bare IDs)
        expect(voice.id).not.toMatch(/^voice\./);
      }
    }
  });
});

describe('Selection State → Prompt IDs', () => {

  it('builds correct IDs from complete state', () => {
    const state: PromptSelectionState = {
      requestId: 'test-123',
      chatId: 1,
      userId: 1,
      content: 'https://example.com',
      contentType: 'url',
      step: 'confirm',
      pillar: 'The Grove',
      action: 'research',
      voice: 'grove-analytical',
      timestamp: Date.now(),
      expiresAt: Date.now() + 300_000,
    };

    const ids = buildPromptIds(state);
    expect(ids.drafter).toBe('drafter.the-grove.research');
    expect(ids.voice).toBe('voice.grove-analytical');
  });

  it('omits voice when not selected', () => {
    const state: PromptSelectionState = {
      requestId: 'test-456',
      chatId: 1,
      userId: 1,
      content: 'https://example.com',
      contentType: 'url',
      step: 'confirm',
      pillar: 'Consulting',
      action: 'draft',
      timestamp: Date.now(),
      expiresAt: Date.now() + 300_000,
    };

    const ids = buildPromptIds(state);
    expect(ids.drafter).toBe('drafter.consulting.draft');
    expect(ids.voice).toBeUndefined();
  });

  it('omits drafter when pillar or action missing', () => {
    const state: PromptSelectionState = {
      requestId: 'test-789',
      chatId: 1,
      userId: 1,
      content: 'test content',
      contentType: 'text',
      step: 'pillar',
      timestamp: Date.now(),
      expiresAt: Date.now() + 300_000,
    };

    const ids = buildPromptIds(state);
    expect(ids.drafter).toBeUndefined();
  });
});

describe('Action/Voice Compatibility', () => {

  it('getAvailableActions returns valid options for all pillars', () => {
    for (const pillar of ALL_PILLARS) {
      const actions = getAvailableActions(pillar);
      expect(actions.length).toBeGreaterThan(0);
      for (const action of actions) {
        expect(action.type).toBeDefined();
        expect(action.label).toBeDefined();
      }
    }
  });

  it('getAvailableVoices returns valid options for all pillars', () => {
    for (const pillar of ALL_PILLARS) {
      const voices = getAvailableVoices(pillar);
      expect(voices.length).toBeGreaterThan(0);
      for (const voice of voices) {
        expect(voice.id).toBeDefined();
        expect(voice.name).toBeDefined();
      }
    }
  });

  it('pillarSupportsAction is consistent with PILLAR_ACTIONS', () => {
    for (const pillar of ALL_PILLARS) {
      const declared = PILLAR_ACTIONS[pillar];
      for (const action of declared) {
        expect(pillarSupportsAction(pillar, action)).toBe(true);
      }
    }
  });

  it('pillarHasVoice is consistent with PILLAR_VOICES', () => {
    for (const pillar of ALL_PILLARS) {
      const declared = PILLAR_VOICES[pillar];
      for (const voice of declared) {
        expect(pillarHasVoice(pillar, voice.id)).toBe(true);
      }
    }
  });
});
