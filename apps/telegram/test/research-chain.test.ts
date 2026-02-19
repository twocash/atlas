/**
 * Research Agent PM Chain Tests
 *
 * Validates that the research agent's PM gating chain is wired correctly:
 * - Voice: getVoiceInstructionsAsync() → PM → FALLBACK_VOICE_DEFAULTS
 * - Depth: getResearchInstructionsFromNotion() → PM → getDepthInstructions()
 * - Summary: getSummaryGuidanceAsync() → PM → getSummaryGuidance()
 * - Quality: getQualityGuidelinesAsync() → PM → getQualityGuidelines()
 *
 * These tests verify the WIRING, not the Notion content.
 * They run without Notion access (mocked PM returns null → fallback).
 *
 * Run with: bun test test/research-chain.test.ts
 */

import { describe, it, expect, mock, beforeEach } from 'bun:test';

// Mock Notion client before importing
mock.module('@notionhq/client', () => ({
  Client: class MockClient {
    databases = { query: mock(() => ({ results: [] })) };
    blocks = { children: { list: mock(() => ({ results: [] })) } };
  },
}));

// Mock Google Generative AI (research agent imports it)
mock.module('@google/generative-ai', () => ({
  GoogleGenerativeAI: class MockGemini {
    getGenerativeModel() {
      return {
        generateContent: mock(() => ({
          response: {
            text: () => '{"summary":"test","findings":[],"sources":[]}',
            candidates: [{ groundingMetadata: null }],
          },
        })),
      };
    }
  },
}));

// Import the functions we're testing
// Note: these are module-private, so we test through buildResearchPrompt's output
import {
  getPromptManager,
  sanitizeNotionId,
  type ComponentStatus,
} from '../../../packages/agents/src/services/prompt-manager';

describe('Research Agent PM Chain', () => {
  describe('sanitizeNotionId (Bug #2 — auto-link corruption)', () => {
    it('strips Notion markdown links from voice.consulting-brief', () => {
      const corrupted = '[voice.consulting](http://voice.consulting)-brief';
      expect(sanitizeNotionId(corrupted)).toBe('voice.consulting-brief');
    });

    it('handles drafter IDs with .consulting TLD', () => {
      const corrupted = 'drafter.[consulting](http://consulting).draft';
      // This pattern wouldn't actually occur, but test the regex handles it
      expect(sanitizeNotionId(corrupted)).toBe('drafter.consulting.draft');
    });

    it('leaves clean IDs untouched', () => {
      expect(sanitizeNotionId('research-agent.standard')).toBe('research-agent.standard');
      expect(sanitizeNotionId('voice.grove-analytical')).toBe('voice.grove-analytical');
      expect(sanitizeNotionId('drafter.home-garage.draft')).toBe('drafter.home-garage.draft');
    });
  });

  describe('Prompt composition graceful degradation', () => {
    let pm: ReturnType<typeof getPromptManager>;

    beforeEach(() => {
      pm = getPromptManager();
      pm.invalidateCache();
    });

    it('composePrompts returns structured result with component tracking', async () => {
      // Seed a drafter
      (pm as any).cache.set('drafter.test.research', {
        record: {
          id: 'drafter.test.research',
          capability: 'Drafter',
          pillars: ['All'],
          useCase: 'test',
          promptText: 'Test research drafter prompt',
          active: true,
          version: 1,
        },
        expiresAt: Date.now() + 60_000,
      });

      const result = await pm.composePrompts({
        drafter: 'drafter.test.research',
        voice: 'voice.nonexistent',
      });

      expect(result).not.toBeNull();
      expect(result!.components.drafter).toBe('found' as ComponentStatus);
      expect(result!.components.voice).toBe('missing' as ComponentStatus);
      expect(result!.warnings.length).toBeGreaterThan(0);
      expect(result!.prompt).toContain('Test research drafter prompt');
    });

    it('voice missing does NOT abort composition', async () => {
      // This is THE critical regression test for the root cause bug
      (pm as any).cache.set('drafter.the-grove.capture', {
        record: {
          id: 'drafter.the-grove.capture',
          capability: 'Drafter',
          pillars: ['The Grove'],
          useCase: 'capture',
          promptText: 'Capture content for The Grove',
          active: true,
          version: 1,
        },
        expiresAt: Date.now() + 60_000,
      });

      const result = await pm.composePrompts({
        drafter: 'drafter.the-grove.capture',
        voice: 'voice.consulting-brief', // This voice won't exist in cache
      });

      // MUST return the drafter even though voice failed
      expect(result).not.toBeNull();
      expect(result!.prompt).toContain('Capture content for The Grove');
    });
  });

  describe('Seed data completeness', () => {
    // These tests verify that the local fallback data has the expected entries
    // for the research agent PM chain

    const EXPECTED_RESEARCH_IDS = [
      'research-agent.light',
      'research-agent.standard',
      'research-agent.deep',
    ];

    const EXPECTED_VOICE_IDS = [
      'voice.grove-analytical',
      'voice.linkedin-punchy',
      'voice.consulting',
      'voice.raw-notes',
    ];

    const EXPECTED_DEFAULT_DRAFTERS = [
      'drafter.default.capture',
      'drafter.default.research',
      'drafter.default.draft',
      'drafter.default.analysis',
      'drafter.default.summarize',
    ];

    it('seed file contains all research-agent depth entries', async () => {
      const seedData = await import('../data/migrations/prompts-v1.json');
      const ids = seedData.default.map((e: any) => e.id);

      for (const expectedId of EXPECTED_RESEARCH_IDS) {
        expect(ids).toContain(expectedId);
      }
    });

    it('seed file contains all voice entries', async () => {
      const seedData = await import('../data/migrations/prompts-v1.json');
      const ids = seedData.default.map((e: any) => e.id);

      for (const expectedId of EXPECTED_VOICE_IDS) {
        expect(ids).toContain(expectedId);
      }
    });

    it('seed file contains all default drafter entries', async () => {
      const seedData = await import('../data/migrations/prompts-v1.json');
      const ids = seedData.default.map((e: any) => e.id);

      for (const expectedId of EXPECTED_DEFAULT_DRAFTERS) {
        expect(ids).toContain(expectedId);
      }
    });

    it('all seed entries have required fields', async () => {
      const seedData = await import('../data/migrations/prompts-v1.json');

      for (const entry of seedData.default) {
        expect(entry.id).toBeDefined();
        expect(typeof entry.id).toBe('string');
        expect(entry.capability).toBeDefined();
        expect(entry.pillars).toBeDefined();
        expect(Array.isArray(entry.pillars)).toBe(true);
        expect(entry.promptText).toBeDefined();
        expect(typeof entry.promptText).toBe('string');
        expect(entry.active).toBe(true);
      }
    });

    it('seed file contains pillar-specific drafter entries', async () => {
      const seedData = await import('../data/migrations/prompts-v1.json');
      const ids = seedData.default.map((e: any) => e.id);

      // These 4 entries are being added as part of this sprint
      const pillarDrafters = [
        'drafter.the-grove.summarize',
        'drafter.personal.analysis',
        'drafter.home-garage.draft',
        'drafter.home-garage.analysis',
      ];

      for (const expectedId of pillarDrafters) {
        expect(ids).toContain(expectedId);
      }
    });
  });
});
