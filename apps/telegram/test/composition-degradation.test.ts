/**
 * Composition Graceful Degradation Tests
 *
 * Validates the core fix for Bug #1: composePrompts() now treats
 * voice and lens as OPTIONAL overlays, not required components.
 *
 * Root cause: Old code iterated [drafter, voice, lens] and returned null
 * if ANY component was missing. Drafter got thrown away when voice failed.
 *
 * Run with: bun test test/composition-degradation.test.ts
 */

import { describe, it, expect, mock, beforeEach } from 'bun:test';

// Mock the Notion client before importing PromptManager
mock.module('@notionhq/client', () => ({
  Client: class MockClient {
    databases = { query: mock(() => ({ results: [] })) };
    blocks = { children: { list: mock(() => ({ results: [] })) } };
  },
}));

import {
  PromptManager,
  getPromptManager,
  type PromptRecord,
  type ComposedPrompt,
  type ComponentStatus,
} from '../../../packages/agents/src/services/prompt-manager';

// ── Helpers ──────────────────────────────────────────────

function makeRecord(id: string, text: string, overrides?: Partial<PromptRecord>): PromptRecord {
  return {
    id,
    capability: 'Drafter',
    pillars: ['All'],
    useCase: 'test',
    promptText: text,
    active: true,
    version: 1,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────

describe('Composition Graceful Degradation (Bug #1 Fix)', () => {
  let pm: PromptManager;

  beforeEach(() => {
    pm = getPromptManager();
    // Wipe any cached prompts between tests
    pm.invalidateCache();
  });

  describe('composePrompts() contract', () => {
    it('returns null when no drafter ID is provided', async () => {
      const result = await pm.composePrompts({});
      expect(result).toBeNull();
    });

    it('returns null when drafter ID is provided but not found', async () => {
      // With Notion mocked to return no results + no local fallback,
      // getPromptRecordById returns null → drafter missing → null
      const result = await pm.composePrompts({
        drafter: 'drafter.nonexistent.research',
      });
      expect(result).toBeNull();
    });

    it('returns prompt with component status when drafter is found', async () => {
      // Seed the cache with a drafter record
      const drafterId = 'drafter.the-grove.research';
      const drafterRecord = makeRecord(drafterId, 'Research the following: {{content}}');

      // Inject into cache directly (bypassing Notion)
      (pm as any).cache.set(drafterId, {
        record: drafterRecord,
        expiresAt: Date.now() + 60_000,
      });

      const result = await pm.composePrompts({
        drafter: drafterId,
      });

      expect(result).not.toBeNull();
      expect(result!.components.drafter).toBe('found');
      expect(result!.components.voice).toBe('missing');
      expect(result!.components.lens).toBe('missing');
      expect(result!.warnings).toHaveLength(0); // No voice/lens requested, so no warnings
      expect(result!.prompt).toContain('Research the following:');
    });

    it('composes drafter + voice when both are found', async () => {
      const drafterId = 'drafter.consulting.draft';
      const voiceId = 'voice.consulting-brief';

      (pm as any).cache.set(drafterId, {
        record: makeRecord(drafterId, 'Draft content for consulting.'),
        expiresAt: Date.now() + 60_000,
      });
      (pm as any).cache.set(voiceId, {
        record: makeRecord(voiceId, 'Use a professional, client-ready tone.', {
          capability: 'Voice',
        }),
        expiresAt: Date.now() + 60_000,
      });

      const result = await pm.composePrompts({
        drafter: drafterId,
        voice: voiceId,
      });

      expect(result).not.toBeNull();
      expect(result!.components.drafter).toBe('found');
      expect(result!.components.voice).toBe('found');
      expect(result!.warnings).toHaveLength(0);
      expect(result!.prompt).toContain('Draft content for consulting.');
      expect(result!.prompt).toContain('professional, client-ready');
    });

    it('THE BIG FIX: returns drafter prompt even when voice is missing', async () => {
      // This is the exact scenario that was broken before Bug #1 fix.
      // Old behavior: voice missing → entire composition aborted → drafter thrown away
      // New behavior: voice missing → warning logged → drafter returned with degraded note
      const drafterId = 'drafter.the-grove.capture';
      const voiceId = 'voice.nonexistent-voice';

      (pm as any).cache.set(drafterId, {
        record: makeRecord(drafterId, 'Capture this content for The Grove.'),
        expiresAt: Date.now() + 60_000,
      });

      const result = await pm.composePrompts({
        drafter: drafterId,
        voice: voiceId,
      });

      // MUST return a result — drafter was found
      expect(result).not.toBeNull();
      expect(result!.components.drafter).toBe('found');
      expect(result!.components.voice).toBe('missing');
      expect(result!.prompt).toContain('Capture this content for The Grove.');

      // Warning about the missing voice
      expect(result!.warnings.length).toBeGreaterThan(0);
      expect(result!.warnings[0]).toContain('voice');
      expect(result!.warnings[0]).toContain('nonexistent-voice');
    });

    it('returns drafter prompt even when lens is missing', async () => {
      const drafterId = 'drafter.personal.research';
      const lensId = 'lens.strategic';

      (pm as any).cache.set(drafterId, {
        record: makeRecord(drafterId, 'Research personal finance topics.'),
        expiresAt: Date.now() + 60_000,
      });

      const result = await pm.composePrompts({
        drafter: drafterId,
        lens: lensId,
      });

      expect(result).not.toBeNull();
      expect(result!.components.drafter).toBe('found');
      expect(result!.components.lens).toBe('missing');
      expect(result!.prompt).toContain('Research personal finance topics.');
      expect(result!.warnings.length).toBeGreaterThan(0);
      expect(result!.warnings[0]).toContain('lens');
    });

    it('composes all three components when found', async () => {
      const drafterId = 'drafter.the-grove.analysis';
      const voiceId = 'voice.grove-analytical';
      const lensId = 'lens.strategic';

      (pm as any).cache.set(drafterId, {
        record: makeRecord(drafterId, 'Analyze this topic deeply.'),
        expiresAt: Date.now() + 60_000,
      });
      (pm as any).cache.set(voiceId, {
        record: makeRecord(voiceId, 'Write with analytical precision.', {
          capability: 'Voice',
        }),
        expiresAt: Date.now() + 60_000,
      });
      (pm as any).cache.set(lensId, {
        record: makeRecord(lensId, 'Apply strategic lens.', {
          capability: 'System',
        }),
        expiresAt: Date.now() + 60_000,
      });

      const result = await pm.composePrompts({
        drafter: drafterId,
        voice: voiceId,
        lens: lensId,
      });

      expect(result).not.toBeNull();
      expect(result!.components.drafter).toBe('found');
      expect(result!.components.voice).toBe('found');
      expect(result!.components.lens).toBe('found');
      expect(result!.warnings).toHaveLength(0);
      // All three sections joined with separator
      expect(result!.prompt).toContain('Analyze this topic deeply.');
      expect(result!.prompt).toContain('analytical precision');
      expect(result!.prompt).toContain('strategic lens');
    });

    it('hydrates template variables in drafter', async () => {
      const drafterId = 'drafter.consulting.capture';

      (pm as any).cache.set(drafterId, {
        record: makeRecord(drafterId, 'Capture "{{title}}" for {{pillar}}. URL: {{url}}'),
        expiresAt: Date.now() + 60_000,
      });

      const result = await pm.composePrompts(
        { drafter: drafterId },
        { title: 'Client Proposal', pillar: 'Consulting', url: 'https://example.com' }
      );

      expect(result).not.toBeNull();
      expect(result!.prompt).toContain('Client Proposal');
      expect(result!.prompt).toContain('Consulting');
      expect(result!.prompt).toContain('https://example.com');
    });

    it('uses drafter modelConfig when present', async () => {
      const drafterId = 'drafter.the-grove.research';

      (pm as any).cache.set(drafterId, {
        record: makeRecord(drafterId, 'Deep research prompt.', {
          modelConfig: { temperature: 0.3, maxTokens: 8192 },
        }),
        expiresAt: Date.now() + 60_000,
      });

      const result = await pm.composePrompts({ drafter: drafterId });

      expect(result).not.toBeNull();
      expect(result!.temperature).toBe(0.3);
      expect(result!.maxTokens).toBe(8192);
    });
  });

  describe('sanitizeNotionId', () => {
    // Import the exported function
    const { sanitizeNotionId } = require('../../../packages/agents/src/services/prompt-manager');

    it('passes clean IDs through unchanged', () => {
      expect(sanitizeNotionId('voice.consulting-brief')).toBe('voice.consulting-brief');
      expect(sanitizeNotionId('drafter.the-grove.research')).toBe('drafter.the-grove.research');
    });

    it('strips Notion auto-link markup from .consulting TLD', () => {
      // Notion auto-links .consulting as a TLD
      expect(sanitizeNotionId('[voice.consulting](http://voice.consulting)-brief'))
        .toBe('voice.consulting-brief');
    });

    it('strips multiple auto-link corruptions', () => {
      expect(sanitizeNotionId('[foo.bar](http://foo.bar)-baz-[qux.net](http://qux.net)'))
        .toBe('foo.bar-baz-qux.net');
    });

    it('handles IDs with no markdown links', () => {
      expect(sanitizeNotionId('simple-id')).toBe('simple-id');
    });
  });

  describe('ComponentStatus type contract', () => {
    it('result.components has exactly three fields', async () => {
      const drafterId = 'drafter.test.capture';
      (pm as any).cache.set(drafterId, {
        record: makeRecord(drafterId, 'Test prompt'),
        expiresAt: Date.now() + 60_000,
      });

      const result = await pm.composePrompts({ drafter: drafterId });
      expect(result).not.toBeNull();

      const keys = Object.keys(result!.components);
      expect(keys).toContain('drafter');
      expect(keys).toContain('voice');
      expect(keys).toContain('lens');
      expect(keys).toHaveLength(3);
    });

    it('each component status is a valid ComponentStatus value', async () => {
      const drafterId = 'drafter.test.check';
      const voiceId = 'voice.test-missing';

      (pm as any).cache.set(drafterId, {
        record: makeRecord(drafterId, 'Test'),
        expiresAt: Date.now() + 60_000,
      });

      const result = await pm.composePrompts({
        drafter: drafterId,
        voice: voiceId,
      });

      expect(result).not.toBeNull();
      const validStatuses: ComponentStatus[] = ['found', 'missing', 'fallback'];
      expect(validStatuses).toContain(result!.components.drafter);
      expect(validStatuses).toContain(result!.components.voice);
      expect(validStatuses).toContain(result!.components.lens);
    });
  });
});
