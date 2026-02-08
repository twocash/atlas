/**
 * Zone Classifier Tests
 *
 * Run with: bun test src/skills/zone-classifier.test.ts
 *
 * Sprint: Pit Stop (Autonomous Skill Repair)
 */

import { describe, it, expect } from 'bun:test';
import {
  classifyZone,
  createOperation,
  detectTouchesCore,
  detectTouchesAuth,
  detectTouchesExternal,
  type PitCrewOperation,
} from './zone-classifier';

describe('Zone Classifier', () => {
  // ==========================================
  // Zone 1: Auto-Execute Tests
  // ==========================================

  describe('Zone 1 (auto-execute)', () => {
    it('Tier 0 skill creation in data/skills/ → auto-execute', () => {
      const op = createOperation({
        type: 'skill-create',
        tier: 0,
        targetFiles: ['data/skills/new-skill/SKILL.md'],
        description: 'Create new read-only skill',
      });

      const result = classifyZone(op);
      expect(result.zone).toBe('auto-execute');
      expect(result.ruleApplied).toBe('RULE_5_TIER0_SKILL');
    });

    it('Tier 0 skill edit in data/skills/ → auto-execute', () => {
      const op = createOperation({
        type: 'skill-edit',
        tier: 0,
        targetFiles: ['data/skills/existing-skill/config.yaml'],
        description: 'Edit existing skill config',
      });

      const result = classifyZone(op);
      expect(result.zone).toBe('auto-execute');
      expect(result.ruleApplied).toBe('RULE_5_TIER0_SKILL');
    });

    it('Tier 0 skill in data/pit-crew/ → auto-execute', () => {
      const op = createOperation({
        type: 'skill-create',
        tier: 0,
        targetFiles: ['data/pit-crew/helper/README.md'],
        description: 'Create pit crew helper',
      });

      const result = classifyZone(op);
      expect(result.zone).toBe('auto-execute');
      expect(result.ruleApplied).toBe('RULE_5_TIER0_SKILL');
    });
  });

  // ==========================================
  // Zone 2: Auto-Notify Tests
  // ==========================================

  describe('Zone 2 (auto-notify)', () => {
    it('Tier 1 skill creation in data/skills/ → auto-notify', () => {
      const op = createOperation({
        type: 'skill-create',
        tier: 1,
        targetFiles: ['data/skills/new-notion-skill/SKILL.md'],
        description: 'Create skill that writes to Notion',
      });

      const result = classifyZone(op);
      expect(result.zone).toBe('auto-notify');
      expect(result.ruleApplied).toBe('RULE_6_TIER1_SAFE');
    });

    it('Tier 1 bug fix in src/skills/ → auto-notify', () => {
      const op = createOperation({
        type: 'code-fix',
        tier: 1,
        targetFiles: ['src/skills/registry.ts'],
        description: 'Fix bug in skill registry',
      });

      const result = classifyZone(op);
      expect(result.zone).toBe('auto-notify');
      expect(result.ruleApplied).toBe('RULE_6_TIER1_SAFE');
    });

    it('Skill deletion (any tier) → auto-notify', () => {
      const op = createOperation({
        type: 'skill-delete',
        tier: 0,
        targetFiles: ['data/skills/old-skill/'],
        description: 'Delete unused skill',
      });

      const result = classifyZone(op);
      expect(result.zone).toBe('auto-notify');
      expect(result.ruleApplied).toBe('RULE_7_SKILL_DELETE');
    });

    it('Config change in data/skills/ (Tier 1) → auto-notify', () => {
      const op = createOperation({
        type: 'config-change',
        tier: 1,
        targetFiles: ['data/skills/my-skill/settings.json'],
        description: 'Update skill settings',
      });

      const result = classifyZone(op);
      expect(result.zone).toBe('auto-notify');
      expect(result.ruleApplied).toBe('RULE_8_CONFIG_SAFE');
    });
  });

  // ==========================================
  // Zone 3: Approve Tests
  // ==========================================

  describe('Zone 3 (approve)', () => {
    it('ANY operation touching supervisor.ts → approve', () => {
      const op = createOperation({
        type: 'code-fix',
        tier: 0,
        targetFiles: ['src/supervisor/supervisor.ts'],
        description: 'Fix supervisor bug',
      });

      const result = classifyZone(op);
      expect(result.zone).toBe('approve');
      expect(result.ruleApplied).toBe('RULE_1_CORE');
    });

    it('ANY operation touching bot.ts → approve', () => {
      const op = createOperation({
        type: 'code-fix',
        tier: 0,
        targetFiles: ['src/bot.ts'],
        description: 'Fix bot startup',
      });

      const result = classifyZone(op);
      expect(result.zone).toBe('approve');
      expect(result.ruleApplied).toBe('RULE_1_CORE');
    });

    it('ANY operation touching index.ts → approve', () => {
      const op = createOperation({
        type: 'code-fix',
        tier: 0,
        targetFiles: ['src/index.ts'],
        description: 'Fix entry point',
      });

      const result = classifyZone(op);
      expect(result.zone).toBe('approve');
      expect(result.ruleApplied).toBe('RULE_1_CORE');
    });

    it('ANY operation touching handler.ts → approve', () => {
      const op = createOperation({
        type: 'code-fix',
        tier: 0,
        targetFiles: ['src/handler.ts'],
        description: 'Fix handler',
      });

      const result = classifyZone(op);
      expect(result.zone).toBe('approve');
      expect(result.ruleApplied).toBe('RULE_1_CORE');
    });

    it('ANY operation touching .env → approve', () => {
      const op = createOperation({
        type: 'config-change',
        tier: 0,
        targetFiles: ['.env'],
        description: 'Update environment',
      });

      const result = classifyZone(op);
      expect(result.zone).toBe('approve');
      expect(result.ruleApplied).toBe('RULE_1_AUTH');
    });

    it('ANY operation touching credentials → approve', () => {
      const op = createOperation({
        type: 'config-change',
        tier: 0,
        targetFiles: ['config/credentials.json'],
        description: 'Update credentials',
      });

      const result = classifyZone(op);
      expect(result.zone).toBe('approve');
      expect(result.ruleApplied).toBe('RULE_1_AUTH');
    });

    it('Tier 2 skill (any operation) → approve', () => {
      const op = createOperation({
        type: 'skill-create',
        tier: 2,
        targetFiles: ['data/skills/api-caller-skill/SKILL.md'],
        description: 'Create skill with external API access',
      });

      const result = classifyZone(op);
      expect(result.zone).toBe('approve');
      expect(result.ruleApplied).toBe('RULE_3_TIER2');
    });

    it('Dependency addition → approve', () => {
      const op = createOperation({
        type: 'dependency-add',
        tier: 0,
        targetFiles: ['package.json'],
        description: 'Add new npm package',
      });

      const result = classifyZone(op);
      expect(result.zone).toBe('approve');
      expect(result.ruleApplied).toBe('RULE_2_DEPENDENCY');
    });

    it('Schema change → approve', () => {
      const op = createOperation({
        type: 'schema-change',
        tier: 0,
        targetFiles: ['src/types.ts'],
        description: 'Update database schema',
      });

      const result = classifyZone(op);
      expect(result.zone).toBe('approve');
      expect(result.ruleApplied).toBe('RULE_2_SCHEMA');
    });

    it('Files outside data/skills/ and src/skills/ → approve', () => {
      const op = createOperation({
        type: 'code-fix',
        tier: 0,
        targetFiles: ['src/notion.ts'],
        description: 'Fix Notion integration',
      });

      const result = classifyZone(op);
      expect(result.zone).toBe('approve');
      expect(result.ruleApplied).toBe('RULE_4_OUTSIDE_SAFE');
    });
  });

  // ==========================================
  // Edge Cases
  // ==========================================

  describe('Edge Cases', () => {
    it('Mixed file list (one safe + one core) → approve', () => {
      const op = createOperation({
        type: 'code-fix',
        tier: 0,
        targetFiles: ['data/skills/safe-skill/SKILL.md', 'src/bot.ts'],
        description: 'Multi-file fix',
      });

      const result = classifyZone(op);
      expect(result.zone).toBe('approve');
      // Core file detection should trigger first
      expect(result.ruleApplied).toBe('RULE_1_CORE');
    });

    it('Empty target files array → approve (default)', () => {
      const op: PitCrewOperation = {
        type: 'skill-create',
        tier: 0,
        targetFiles: [],
        touchesCore: false,
        touchesAuth: false,
        touchesExternal: false,
        description: 'No files specified',
      };

      const result = classifyZone(op);
      // Empty files means not in safe directories
      expect(result.zone).toBe('approve');
    });

    it('touchesCore flag overrides file path analysis', () => {
      const op: PitCrewOperation = {
        type: 'skill-create',
        tier: 0,
        targetFiles: ['data/skills/safe/SKILL.md'],
        touchesCore: true, // Explicit flag
        touchesAuth: false,
        touchesExternal: false,
        description: 'Flagged as touching core',
      };

      const result = classifyZone(op);
      expect(result.zone).toBe('approve');
      expect(result.ruleApplied).toBe('RULE_1_CORE');
    });

    it('touchesAuth flag overrides file path analysis', () => {
      const op: PitCrewOperation = {
        type: 'skill-create',
        tier: 0,
        targetFiles: ['data/skills/safe/SKILL.md'],
        touchesCore: false,
        touchesAuth: true, // Explicit flag
        touchesExternal: false,
        description: 'Flagged as touching auth',
      };

      const result = classifyZone(op);
      expect(result.zone).toBe('approve');
      expect(result.ruleApplied).toBe('RULE_1_AUTH');
    });

    it('touchesExternal flag overrides file path analysis', () => {
      const op: PitCrewOperation = {
        type: 'skill-create',
        tier: 0,
        targetFiles: ['data/skills/safe/SKILL.md'],
        touchesCore: false,
        touchesAuth: false,
        touchesExternal: true, // Explicit flag
        description: 'Flagged as touching external',
      };

      const result = classifyZone(op);
      expect(result.zone).toBe('approve');
      expect(result.ruleApplied).toBe('RULE_1_EXTERNAL');
    });

    it('Windows-style paths are normalized', () => {
      const op = createOperation({
        type: 'skill-create',
        tier: 0,
        targetFiles: ['data\\skills\\my-skill\\SKILL.md'],
        description: 'Windows path',
      });

      const result = classifyZone(op);
      expect(result.zone).toBe('auto-execute');
    });

    it('restart operation → approve (default)', () => {
      const op = createOperation({
        type: 'restart',
        tier: 0,
        targetFiles: [],
        description: 'Restart service',
      });

      const result = classifyZone(op);
      expect(result.zone).toBe('approve');
    });
  });

  // ==========================================
  // Path Traversal Security Tests
  // ==========================================

  describe('Path Traversal Prevention', () => {
    it('data/skills/../../src/notion.ts → approve (traversal escapes safe dir)', () => {
      const op = createOperation({
        type: 'skill-edit',
        tier: 0,
        targetFiles: ['data/skills/../../src/notion.ts'],
        description: 'Attempted traversal to src/',
      });

      const result = classifyZone(op);
      expect(result.zone).toBe('approve');
    });

    it('data/skills/../../src/bot.ts → approve (core file via traversal)', () => {
      const op = createOperation({
        type: 'code-fix',
        tier: 0,
        targetFiles: ['data/skills/../../src/bot.ts'],
        description: 'Attempted traversal to core file',
      });

      const result = classifyZone(op);
      expect(result.zone).toBe('approve');
      expect(result.ruleApplied).toBe('RULE_1_CORE');
    });

    it('data/skills/../../../.env → approve (auth file via traversal)', () => {
      const op = createOperation({
        type: 'config-change',
        tier: 0,
        targetFiles: ['data/skills/../../../.env'],
        description: 'Attempted traversal to .env',
      });

      const result = classifyZone(op);
      expect(result.zone).toBe('approve');
      expect(result.ruleApplied).toBe('RULE_1_AUTH');
    });

    it('data/skills/./legitimate-skill/SKILL.md → auto-execute (benign dot segment)', () => {
      const op = createOperation({
        type: 'skill-create',
        tier: 0,
        targetFiles: ['data/skills/./legitimate-skill/SKILL.md'],
        description: 'Benign single dot in path',
      });

      const result = classifyZone(op);
      expect(result.zone).toBe('auto-execute');
      expect(result.ruleApplied).toBe('RULE_5_TIER0_SKILL');
    });

    it('data/skills/foo/../bar/SKILL.md → auto-execute (traversal stays within safe dir)', () => {
      const op = createOperation({
        type: 'skill-create',
        tier: 0,
        targetFiles: ['data/skills/foo/../bar/SKILL.md'],
        description: 'Traversal that stays within data/skills/',
      });

      const result = classifyZone(op);
      expect(result.zone).toBe('auto-execute');
      expect(result.ruleApplied).toBe('RULE_5_TIER0_SKILL');
    });

    it('mixed: one clean + one traversal → approve', () => {
      const op = createOperation({
        type: 'skill-edit',
        tier: 0,
        targetFiles: [
          'data/skills/good-skill/SKILL.md',
          'data/skills/../../src/notion.ts',
        ],
        description: 'Mixed clean and traversal paths',
      });

      const result = classifyZone(op);
      expect(result.zone).toBe('approve');
    });
  });

  // ==========================================
  // Helper Function Tests
  // ==========================================

  describe('Helper Functions', () => {
    describe('detectTouchesCore', () => {
      it('detects index.ts', () => {
        expect(detectTouchesCore(['src/index.ts'])).toBe(true);
      });

      it('detects bot.ts', () => {
        expect(detectTouchesCore(['src/bot.ts'])).toBe(true);
      });

      it('detects handler.ts', () => {
        expect(detectTouchesCore(['src/handler.ts'])).toBe(true);
      });

      it('detects supervisor directory', () => {
        expect(detectTouchesCore(['src/supervisor/main.ts'])).toBe(true);
      });

      it('does not flag skill files', () => {
        expect(detectTouchesCore(['src/skills/registry.ts'])).toBe(false);
      });
    });

    describe('detectTouchesAuth', () => {
      it('detects .env', () => {
        expect(detectTouchesAuth(['.env'])).toBe(true);
      });

      it('detects .env.local', () => {
        expect(detectTouchesAuth(['.env.local'])).toBe(true);
      });

      it('detects credentials in path', () => {
        expect(detectTouchesAuth(['config/credentials.json'])).toBe(true);
      });

      it('detects token in filename', () => {
        expect(detectTouchesAuth(['auth/token.txt'])).toBe(true);
      });

      it('does not flag normal files', () => {
        expect(detectTouchesAuth(['src/skills/registry.ts'])).toBe(false);
      });
    });

    describe('detectTouchesExternal', () => {
      it('detects webhook in path', () => {
        expect(detectTouchesExternal(['config/webhook-config.json'])).toBe(true);
      });

      it('detects api-config in path', () => {
        expect(detectTouchesExternal(['settings/api-config.yaml'])).toBe(true);
      });

      it('detects external- prefix', () => {
        expect(detectTouchesExternal(['config/external-services.json'])).toBe(true);
      });

      it('does not flag normal files', () => {
        expect(detectTouchesExternal(['src/skills/registry.ts'])).toBe(false);
      });
    });

    describe('createOperation', () => {
      it('auto-detects touchesCore from file paths', () => {
        const op = createOperation({
          type: 'code-fix',
          tier: 0,
          targetFiles: ['src/bot.ts'],
          description: 'Fix bot',
        });

        expect(op.touchesCore).toBe(true);
        expect(op.touchesAuth).toBe(false);
        expect(op.touchesExternal).toBe(false);
      });

      it('auto-detects touchesAuth from file paths', () => {
        const op = createOperation({
          type: 'config-change',
          tier: 0,
          targetFiles: ['.env.production'],
          description: 'Update env',
        });

        expect(op.touchesCore).toBe(false);
        expect(op.touchesAuth).toBe(true);
        expect(op.touchesExternal).toBe(false);
      });
    });
  });
});
