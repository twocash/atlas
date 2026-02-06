/**
 * Swarm Dispatch Tests
 *
 * Run with: bun test src/pit-crew/swarm-dispatch.test.ts
 *
 * Sprint: Pit Stop (Autonomous Skill Repair)
 */

import { describe, it, expect } from 'bun:test';
import {
  buildFixPrompt,
  isWritableBySwarm,
  validateSwarmScope,
  getSwarmStats,
  type SwarmTask,
} from './swarm-dispatch';
import { createOperation } from '../skills/zone-classifier';

// ==========================================
// Test Fixtures
// ==========================================

function createTestTask(overrides: Partial<SwarmTask> = {}): SwarmTask {
  const defaultOperation = createOperation({
    type: 'skill-edit',
    tier: 0,
    targetFiles: ['data/skills/test-skill/SKILL.md'],
    description: 'Test fix',
  });

  return {
    feedEntryId: 'test-feed-123',
    operation: defaultOperation,
    zone: 'auto-execute',
    context: 'Fix failing skill trigger pattern',
    targetSkill: 'test-skill',
    ...overrides,
  };
}

// ==========================================
// Prompt Generation Tests
// ==========================================

describe('Swarm Dispatch - Prompt Generation', () => {
  it('generates prompt with task context', () => {
    const task = createTestTask({
      context: 'The skill trigger pattern is not matching URLs correctly',
    });

    const prompt = buildFixPrompt(task);

    expect(prompt).toContain('The skill trigger pattern is not matching URLs correctly');
    expect(prompt).toContain('test-skill');
    expect(prompt).toContain('data/skills/test-skill/SKILL.md');
  });

  it('includes safety rules in prompt', () => {
    const task = createTestTask();
    const prompt = buildFixPrompt(task);

    // Core files listed together
    expect(prompt).toContain('supervisor.ts');
    expect(prompt).toContain('handler.ts');
    expect(prompt).toContain('bot.ts');
    expect(prompt).toContain('index.ts');
    expect(prompt).toContain('Do NOT modify .env');
    expect(prompt).toContain('Do NOT add new dependencies');
  });

  it('includes zone-specific instructions for auto-execute', () => {
    const task = createTestTask({ zone: 'auto-execute' });
    const prompt = buildFixPrompt(task);

    expect(prompt).toContain('deploy without notification');
    expect(prompt).not.toContain('PLAN ONLY');
  });

  it('includes zone-specific instructions for auto-notify', () => {
    const task = createTestTask({ zone: 'auto-notify' });
    const prompt = buildFixPrompt(task);

    expect(prompt).toContain('deploy and notify');
    expect(prompt).not.toContain('PLAN ONLY');
  });

  it('includes plan-only instructions for approve zone', () => {
    const task = createTestTask({ zone: 'approve' });
    const prompt = buildFixPrompt(task);

    expect(prompt).toContain('PLAN ONLY - DO NOT EXECUTE');
    expect(prompt).toContain('You must NOT execute any changes');
    expect(prompt).toContain('Return a structured plan for human review');
  });

  it('includes feed entry ID for tracking', () => {
    const task = createTestTask({ feedEntryId: 'feed-abc-123' });
    const prompt = buildFixPrompt(task);

    expect(prompt).toContain('feed-abc-123');
  });

  it('includes work queue ID when provided', () => {
    const task = createTestTask({ workQueueId: 'wq-xyz-456' });
    const prompt = buildFixPrompt(task);

    expect(prompt).toContain('wq-xyz-456');
  });
});

// ==========================================
// File Permission Tests
// ==========================================

describe('Swarm Dispatch - File Permissions', () => {
  describe('isWritableBySwarm', () => {
    it('allows files in data/skills/', () => {
      expect(isWritableBySwarm('data/skills/my-skill/SKILL.md')).toBe(true);
      expect(isWritableBySwarm('data/skills/another/config.yaml')).toBe(true);
    });

    it('allows files in data/pit-crew/', () => {
      expect(isWritableBySwarm('data/pit-crew/helpers/util.ts')).toBe(true);
    });

    it('allows files in src/skills/', () => {
      expect(isWritableBySwarm('src/skills/registry.ts')).toBe(true);
      expect(isWritableBySwarm('src/skills/executor.ts')).toBe(true);
    });

    it('denies core files', () => {
      expect(isWritableBySwarm('src/index.ts')).toBe(false);
      expect(isWritableBySwarm('src/bot.ts')).toBe(false);
      expect(isWritableBySwarm('src/handler.ts')).toBe(false);
    });

    it('denies auth files', () => {
      expect(isWritableBySwarm('.env')).toBe(false);
      expect(isWritableBySwarm('.env.local')).toBe(false);
      expect(isWritableBySwarm('.env.production')).toBe(false);
    });

    it('denies package files', () => {
      expect(isWritableBySwarm('package.json')).toBe(false);
      expect(isWritableBySwarm('bun.lockb')).toBe(false);
    });

    it('denies supervisor files', () => {
      expect(isWritableBySwarm('src/supervisor/main.ts')).toBe(false);
    });

    it('normalizes Windows paths', () => {
      expect(isWritableBySwarm('data\\skills\\my-skill\\SKILL.md')).toBe(true);
      expect(isWritableBySwarm('src\\index.ts')).toBe(false);
    });
  });

  describe('validateSwarmScope', () => {
    it('validates all files in safe directories', () => {
      const result = validateSwarmScope([
        'data/skills/skill-a/SKILL.md',
        'data/skills/skill-b/config.yaml',
        'src/skills/helper.ts',
      ]);

      expect(result.valid).toBe(true);
      expect(result.invalidFiles).toHaveLength(0);
    });

    it('rejects files outside safe directories', () => {
      const result = validateSwarmScope([
        'data/skills/safe.md',
        'src/bot.ts', // Not allowed
        'src/notion.ts', // Not allowed
      ]);

      expect(result.valid).toBe(false);
      expect(result.invalidFiles).toContain('src/bot.ts');
      expect(result.invalidFiles).toContain('src/notion.ts');
    });

    it('rejects mixed safe and forbidden files', () => {
      const result = validateSwarmScope([
        'data/skills/safe.md',
        '.env', // Forbidden
      ]);

      expect(result.valid).toBe(false);
      expect(result.invalidFiles).toContain('.env');
    });

    it('allows empty file list', () => {
      const result = validateSwarmScope([]);

      expect(result.valid).toBe(true);
      expect(result.invalidFiles).toHaveLength(0);
    });
  });
});

// ==========================================
// Stats Tests
// ==========================================

describe('Swarm Dispatch - Stats', () => {
  it('returns current dispatch stats', () => {
    const stats = getSwarmStats();

    expect(stats).toHaveProperty('dispatchesThisHour');
    expect(stats).toHaveProperty('maxPerHour');
    expect(stats).toHaveProperty('canDispatch');
    expect(typeof stats.dispatchesThisHour).toBe('number');
    expect(typeof stats.maxPerHour).toBe('number');
    expect(typeof stats.canDispatch).toBe('boolean');
  });
});
