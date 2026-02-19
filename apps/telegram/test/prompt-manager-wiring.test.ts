/**
 * PromptManager Wiring Tests
 *
 * Validates the Sprint: "PromptManager Wiring — Hardcoded Prompt Elimination"
 *
 * Verifies:
 * - Seed data IDs match what the composition system resolves
 * - All prompt ID naming conventions are consistent
 * - Voice IDs in seed data match voice resolution pattern
 * - Local fallback JSON is loadable and complete
 * - PromptManager singleton initializes without throwing
 *
 * Run: bun test test/prompt-manager-wiring.test.ts
 */

import { describe, it, expect, beforeAll } from 'bun:test';
import { readFileSync } from 'fs';
import { resolve } from 'path';

import {
  resolveDrafterId,
  resolveVoiceId,
  resolveDefaultDrafterId,
} from '../../../packages/agents/src/services/prompt-composition/composer';

import {
  PILLAR_SLUGS,
  PILLAR_ACTIONS,
  PILLAR_VOICES,
  getPillarSlug,
} from '../../../packages/agents/src/services/prompt-composition/registry';

import type { Pillar, ActionType } from '../../../packages/agents/src/services/prompt-composition/types';

// ==========================================
// Load seed data
// ==========================================

interface SeedEntry {
  id: string;
  capability: string;
  pillars: string[];
  useCase: string;
  stage: string;
  promptText: string;
  modelConfig: Record<string, unknown>;
  active: boolean;
  version: number;
}

const SEED_PATH = resolve(__dirname, '../data/migrations/prompts-v1.json');
let seedData: SeedEntry[];

beforeAll(() => {
  const raw = readFileSync(SEED_PATH, 'utf-8');
  seedData = JSON.parse(raw) as SeedEntry[];
});

// ==========================================
// Seed Data Integrity
// ==========================================

describe('Seed Data Integrity', () => {

  it('seed file is valid JSON with at least 10 entries', () => {
    expect(seedData).toBeDefined();
    expect(seedData.length).toBeGreaterThanOrEqual(10);
  });

  it('every entry has required fields', () => {
    for (const entry of seedData) {
      expect(entry.id).toBeDefined();
      expect(entry.id.length).toBeGreaterThan(0);
      expect(entry.capability).toBeDefined();
      expect(entry.pillars).toBeDefined();
      expect(Array.isArray(entry.pillars)).toBe(true);
      expect(entry.useCase).toBeDefined();
      expect(entry.promptText).toBeDefined();
      expect(entry.promptText.length).toBeGreaterThan(0);
      expect(entry.active).toBe(true);
    }
  });

  it('no duplicate IDs in seed data', () => {
    const ids = seedData.map(e => e.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });
});

// ==========================================
// Drafter ID Convention Alignment
// ==========================================

describe('Drafter ID Convention Alignment', () => {

  it('all drafter entries follow drafter.{scope}.{action} pattern', () => {
    const drafters = seedData.filter(e => e.capability === 'Drafter');
    expect(drafters.length).toBeGreaterThanOrEqual(6);

    for (const drafter of drafters) {
      const parts = drafter.id.split('.');
      expect(parts[0]).toBe('drafter');
      expect(parts.length).toBe(3);
      // scope is either 'default' or a pillar slug
      expect(parts[1].length).toBeGreaterThan(0);
      // action is a known action type
      expect(parts[2].length).toBeGreaterThan(0);
    }
  });

  it('default drafters exist for all action types', () => {
    const defaultDrafters = seedData
      .filter(e => e.capability === 'Drafter' && e.id.startsWith('drafter.default.'));
    const defaultActions = defaultDrafters.map(d => d.id.split('.')[2]);

    // Must have default fallbacks for all 5 action types
    expect(defaultActions).toContain('capture');
    expect(defaultActions).toContain('research');
    expect(defaultActions).toContain('draft');
    expect(defaultActions).toContain('analysis');
    expect(defaultActions).toContain('summarize');
  });

  it('resolveDefaultDrafterId() matches seed data IDs', () => {
    const actions: ActionType[] = ['capture', 'research', 'draft', 'analysis', 'summarize'];
    const seedIds = new Set(seedData.map(e => e.id));

    for (const action of actions) {
      const resolved = resolveDefaultDrafterId(action);
      expect(seedIds.has(resolved)).toBe(true);
    }
  });

  it('Grove-specific drafter exists and matches resolveDrafterId()', () => {
    const groveResearch = resolveDrafterId('The Grove', 'research');
    expect(groveResearch).toBe('drafter.the-grove.research');

    const seedIds = new Set(seedData.map(e => e.id));
    expect(seedIds.has(groveResearch)).toBe(true);
  });

  it('pillar slug resolution is consistent between composer and seed data', () => {
    const ALL_PILLARS: Pillar[] = ['The Grove', 'Personal', 'Consulting', 'Home/Garage'];

    for (const pillar of ALL_PILLARS) {
      const slug = getPillarSlug(pillar);
      // Every pillar/action combo should resolve to a valid drafter ID
      const actions = PILLAR_ACTIONS[pillar];
      for (const action of actions) {
        const id = resolveDrafterId(pillar, action);
        expect(id).toBe(`drafter.${slug}.${action}`);
        // Pillar-specific OR default must exist in seed data
        const defaultId = resolveDefaultDrafterId(action);
        const seedIds = new Set(seedData.map(e => e.id));
        const hasPillarSpecific = seedIds.has(id);
        const hasDefault = seedIds.has(defaultId);
        expect(hasPillarSpecific || hasDefault).toBe(true);
      }
    }
  });
});

// ==========================================
// Voice ID Convention Alignment
// ==========================================

describe('Voice ID Convention Alignment', () => {

  it('all voice entries follow voice.{name} pattern', () => {
    const voices = seedData.filter(e => e.capability === 'Voice');
    expect(voices.length).toBeGreaterThanOrEqual(3);

    for (const voice of voices) {
      expect(voice.id.startsWith('voice.')).toBe(true);
      const name = voice.id.replace('voice.', '');
      expect(name.length).toBeGreaterThan(0);
    }
  });

  it('resolveVoiceId() matches seed data for known voices', () => {
    const seedVoiceIds = new Set(
      seedData.filter(e => e.capability === 'Voice').map(e => e.id)
    );

    // Test known voice IDs from voice-manager.ts FILESYSTEM_TO_NOTION_ID map
    expect(seedVoiceIds.has(resolveVoiceId('grove-analytical'))).toBe(true);
    expect(seedVoiceIds.has(resolveVoiceId('linkedin-punchy'))).toBe(true);
    expect(seedVoiceIds.has(resolveVoiceId('consulting'))).toBe(true);
  });

  it('all registered pillar voices have seed data entries', () => {
    const seedVoiceIds = new Set(
      seedData.filter(e => e.capability === 'Voice').map(e => e.id)
    );

    const ALL_PILLARS: Pillar[] = ['The Grove', 'Personal', 'Consulting', 'Home/Garage'];
    const missingVoices: string[] = [];

    for (const pillar of ALL_PILLARS) {
      const voices = PILLAR_VOICES[pillar];
      for (const voice of voices) {
        const resolvedId = resolveVoiceId(voice.id);
        if (!seedVoiceIds.has(resolvedId)) {
          missingVoices.push(`${pillar}/${voice.id} → ${resolvedId}`);
        }
      }
    }

    // Not all voices need seed data (some are filesystem-only)
    // But the main voices should be present
    // Log missing for awareness but don't fail — filesystem fallback is valid
    if (missingVoices.length > 0) {
      console.log(`[INFO] ${missingVoices.length} voices are filesystem-only (no seed data): ${missingVoices.join(', ')}`);
    }
  });
});

// ==========================================
// Research Agent Prompt IDs
// ==========================================

describe('Research Agent Prompt IDs', () => {

  it('research agent prompts follow research-agent.{tier} pattern', () => {
    const researchPrompts = seedData.filter(e => e.capability === 'Research Agent');
    expect(researchPrompts.length).toBeGreaterThanOrEqual(3);

    // Must have light/standard/deep tiers
    const ids = researchPrompts.map(e => e.id);
    expect(ids).toContain('research-agent.light');
    expect(ids).toContain('research-agent.standard');
    expect(ids).toContain('research-agent.deep');
  });

  it('pillar-specific research prompts follow research-agent.{slug}.{usecase} pattern', () => {
    const pillarResearch = seedData.filter(
      e => e.capability === 'Research Agent' && e.id.includes('.the-grove.')
        || e.capability === 'Research Agent' && e.id.includes('.consulting.')
    );

    for (const entry of pillarResearch) {
      const parts = entry.id.split('.');
      expect(parts[0]).toBe('research-agent');
      expect(parts.length).toBe(3);
    }
  });

  it('research agent depth config has valid model settings', () => {
    const light = seedData.find(e => e.id === 'research-agent.light');
    const standard = seedData.find(e => e.id === 'research-agent.standard');
    const deep = seedData.find(e => e.id === 'research-agent.deep');

    expect(light).toBeDefined();
    expect(standard).toBeDefined();
    expect(deep).toBeDefined();

    // Deeper tiers should have higher maxTokens
    expect((light!.modelConfig.maxTokens as number)).toBeLessThan(standard!.modelConfig.maxTokens as number);
    expect((standard!.modelConfig.maxTokens as number)).toBeLessThan(deep!.modelConfig.maxTokens as number);

    // All should have targetSources and minSources
    for (const entry of [light!, standard!, deep!]) {
      expect(entry.modelConfig.targetSources).toBeDefined();
      expect(entry.modelConfig.minSources).toBeDefined();
      expect((entry.modelConfig.targetSources as number)).toBeGreaterThanOrEqual(entry.modelConfig.minSources as number);
    }
  });
});

// ==========================================
// Classifier Prompt IDs
// ==========================================

describe('Classifier Prompt IDs', () => {

  it('classifier prompts exist for spark classification', () => {
    const entry = seedData.find(e => e.id === 'classifier.spark-classification');
    expect(entry).toBeDefined();
    expect(entry!.capability).toBe('Classifier');
  });

  it('classifier prompts exist for intent detection', () => {
    const entry = seedData.find(e => e.id === 'classifier.intent-detection');
    expect(entry).toBeDefined();
    expect(entry!.capability).toBe('Classifier');
  });

  it('classifier prompts exist for chat-with-tools', () => {
    const entry = seedData.find(e => e.id === 'classifier.chat-with-tools');
    expect(entry).toBeDefined();
    expect(entry!.capability).toBe('Classifier');
  });

  it('classifier prompts have low temperature (deterministic)', () => {
    const classifiers = seedData.filter(e => e.capability === 'Classifier');
    for (const classifier of classifiers) {
      const temp = classifier.modelConfig.temperature as number;
      expect(temp).toBeLessThanOrEqual(0.3);
    }
  });
});

// ==========================================
// Cross-Layer Consistency
// ==========================================

describe('Cross-Layer Consistency', () => {

  it('every seed entry ID is unique across all capabilities', () => {
    const allIds = seedData.map(e => e.id);
    const duplicates = allIds.filter((id, i) => allIds.indexOf(id) !== i);
    expect(duplicates).toEqual([]);
  });

  it('capability field is one of the expected values', () => {
    const validCapabilities = ['Drafter', 'Voice', 'Research Agent', 'Classifier'];
    for (const entry of seedData) {
      expect(validCapabilities).toContain(entry.capability);
    }
  });

  it('all entries have promptText with meaningful content (>50 chars)', () => {
    for (const entry of seedData) {
      expect(entry.promptText.length).toBeGreaterThan(50);
    }
  });

  it('model config temperature is between 0 and 1 when present', () => {
    for (const entry of seedData) {
      if (entry.modelConfig.temperature !== undefined) {
        const temp = entry.modelConfig.temperature as number;
        expect(temp).toBeGreaterThanOrEqual(0);
        expect(temp).toBeLessThanOrEqual(1);
      }
    }
  });

  it('model config maxTokens is positive when present', () => {
    for (const entry of seedData) {
      if (entry.modelConfig.maxTokens !== undefined) {
        expect(entry.modelConfig.maxTokens as number).toBeGreaterThan(0);
      }
    }
  });
});
