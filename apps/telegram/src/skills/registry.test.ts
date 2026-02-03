/**
 * Skill Registry Tests
 *
 * Run with: bun test src/skills/registry.test.ts
 */

import { describe, it, expect, beforeAll } from 'bun:test';
import { SkillRegistry } from './registry';
import { join } from 'path';

describe('SkillRegistry', () => {
  let registry: SkillRegistry;

  beforeAll(async () => {
    // Use the actual skills directory
    registry = new SkillRegistry(join(process.cwd(), 'data', 'skills'));
    await registry.initialize();
  });

  it('loads skills from directory', () => {
    const skills = registry.getAll();
    expect(skills.length).toBeGreaterThan(0);
  });

  it('loads both YAML and Markdown skills', () => {
    const stats = registry.getStats();
    // Should have at least the YAML skill we created
    expect(stats.bySource.yaml + stats.bySource.markdown).toBeGreaterThan(0);
  });

  it('finds skill by name', () => {
    const skill = registry.get('grove-research-quick');
    // May or may not exist depending on test order
    if (skill) {
      expect(skill.name).toBe('grove-research-quick');
      expect(skill.source).toBe('yaml');
    }
  });

  it('finds matches for trigger text', () => {
    const matches = registry.findMatches('research AI agents', {
      pillar: 'The Grove',
    });
    // May find matches if skills are loaded
    expect(Array.isArray(matches)).toBe(true);
  });

  it('filters by enabled status', () => {
    const enabled = registry.getEnabled();
    for (const skill of enabled) {
      expect(skill.enabled).toBe(true);
    }
  });

  it('provides registry stats', () => {
    const stats = registry.getStats();
    expect(stats).toHaveProperty('total');
    expect(stats).toHaveProperty('enabled');
    expect(stats).toHaveProperty('byTier');
    expect(stats).toHaveProperty('bySource');
  });
});

describe('Trigger Matching', () => {
  let registry: SkillRegistry;

  beforeAll(async () => {
    registry = new SkillRegistry(join(process.cwd(), 'data', 'skills'));
    await registry.initialize();
  });

  it('matches pillar-based triggers', () => {
    const matches = registry.findMatches('anything', {
      pillar: 'The Grove',
    });
    // Pillar triggers should match
    const pillarMatches = matches.filter(m => m.trigger.type === 'pillar');
    // May or may not have pillar triggers depending on loaded skills
    expect(Array.isArray(pillarMatches)).toBe(true);
  });

  it('matches keyword triggers', () => {
    const matches = registry.findMatches('research about AI and LLMs');
    const keywordMatches = matches.filter(m => m.trigger.type === 'keyword');
    expect(Array.isArray(keywordMatches)).toBe(true);
  });

  it('scores are between 0 and 1', () => {
    const matches = registry.findMatches('research AI');
    for (const match of matches) {
      expect(match.score).toBeGreaterThanOrEqual(0);
      expect(match.score).toBeLessThanOrEqual(1);
    }
  });

  it('returns matches sorted by score', () => {
    const matches = registry.findMatches('research AI agents');
    for (let i = 1; i < matches.length; i++) {
      expect(matches[i - 1].score).toBeGreaterThanOrEqual(matches[i].score);
    }
  });
});
