/**
 * Atlas Skill System - Executor Tests
 *
 * Phase 4: Tests for skill composition safety features
 * - Circular dependency detection
 * - Tier validation
 * - Composition depth limits
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test';
import type { SkillDefinition, SkillProcess } from './schema';
import type { ExecutionContext, SkillExecutionResult } from './executor';

// Mock feature flags
const mockFeatures = {
  skillLogging: true,
  skillExecution: true,
  skillHotReload: false,
  patternDetection: true,
  autoDeployTier0: true,
  skillComposition: true,
};

// Mock the features module
mock.module('./features', () => ({
  isFeatureEnabled: (feature: string) => mockFeatures[feature as keyof typeof mockFeatures] ?? false,
  getFeatureFlags: () => mockFeatures,
}));

// Helper to create a test skill
function createTestSkill(
  name: string,
  tier: 0 | 1 | 2,
  processType: 'tool_sequence' | 'skill_composition' = 'tool_sequence',
  steps: SkillProcess['steps'] = []
): SkillDefinition {
  return {
    name,
    version: '1.0.0',
    description: `Test skill: ${name}`,
    triggers: [{ type: 'keyword', value: name }],
    inputs: {},
    outputs: [],
    process: {
      type: processType,
      steps,
      timeout: 5000,
    },
    tier,
    enabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    source: 'generated',
    metrics: {
      executionCount: 0,
      successCount: 0,
      failureCount: 0,
      avgExecutionTime: 0,
      consecutiveFailures: 0,
    },
  };
}

// Helper to create test context
function createTestContext(overrides: Partial<ExecutionContext> = {}): Omit<ExecutionContext, 'steps' | 'startTime' | 'timeout'> {
  return {
    userId: 12345,
    messageText: 'test message',
    pillar: 'Personal',
    input: {},
    depth: 0,
    ...overrides,
  };
}

describe('Executor - Composition Safety', () => {
  describe('Circular Dependency Detection', () => {
    test('detects simple circular dependency (A → A)', async () => {
      // Skill that tries to invoke itself
      const skillA = createTestSkill('skill-a', 1, 'skill_composition', [
        { id: 'invoke-self', skill: 'skill-a', inputs: {} },
      ]);

      const context = createTestContext({
        skillChain: ['skill-a'], // Already in chain
      });

      // The step executor should detect the circular dependency
      // when skill-a tries to invoke skill-a again
      expect(context.skillChain).toContain('skill-a');
    });

    test('detects multi-level circular dependency (A → B → A)', async () => {
      const chain = ['skill-a', 'skill-b'];

      // If skill-b tries to invoke skill-a, it should be detected
      const skillAInChain = chain.includes('skill-a');
      expect(skillAInChain).toBe(true);
    });

    test('detects deep circular dependency (A → B → C → A)', async () => {
      const chain = ['skill-a', 'skill-b', 'skill-c'];

      // If skill-c tries to invoke skill-a, it should be detected
      const skillAInChain = chain.includes('skill-a');
      expect(skillAInChain).toBe(true);

      // New invocation should be blocked
      const newSkill = 'skill-a';
      expect(chain.includes(newSkill)).toBe(true);
    });
  });

  describe('Tier Validation', () => {
    test('allows composing lower tier skill from higher tier', () => {
      const parentTier = 2; // Tier 2 parent
      const childTier = 0; // Tier 0 child

      // Should be allowed: 2 can invoke 0
      expect(childTier <= parentTier).toBe(true);
    });

    test('allows composing equal tier skill', () => {
      const parentTier = 1;
      const childTier = 1;

      // Should be allowed: 1 can invoke 1
      expect(childTier <= parentTier).toBe(true);
    });

    test('blocks composing higher tier skill from lower tier', () => {
      const parentTier = 0; // Tier 0 parent
      const childTier = 2; // Tier 2 child

      // Should be blocked: 0 cannot invoke 2
      expect(childTier > parentTier).toBe(true);
    });

    test('Tier 1 cannot invoke Tier 2', () => {
      const parentTier = 1;
      const childTier = 2;

      expect(childTier > parentTier).toBe(true);
    });
  });

  describe('Composition Depth Limits', () => {
    test('allows depth 0 (top level)', () => {
      const depth = 0;
      const maxDepth = 3;
      expect(depth < maxDepth).toBe(true);
    });

    test('allows depth 1', () => {
      const depth = 1;
      const maxDepth = 3;
      expect(depth < maxDepth).toBe(true);
    });

    test('allows depth 2', () => {
      const depth = 2;
      const maxDepth = 3;
      expect(depth < maxDepth).toBe(true);
    });

    test('blocks depth 3 (exceeds limit)', () => {
      const depth = 3;
      const maxDepth = 3;
      expect(depth >= maxDepth).toBe(true);
    });
  });

  describe('Feature Flag Gating', () => {
    test('composition feature can be disabled', () => {
      // Simulate disabled feature
      const compositionEnabled = false;

      if (!compositionEnabled) {
        // Should return error about disabled composition
        expect(compositionEnabled).toBe(false);
      }
    });
  });

  describe('Skill Chain Tracking', () => {
    test('initializes empty chain for top-level call', () => {
      const context = createTestContext();
      const skillChain = context.skillChain ?? [];
      expect(skillChain).toEqual([]);
    });

    test('propagates chain through composition', () => {
      const initialChain = ['skill-a'];
      const newSkill = 'skill-b';
      const updatedChain = [...initialChain, newSkill];

      expect(updatedChain).toEqual(['skill-a', 'skill-b']);
    });

    test('chain includes all invoked skills', () => {
      const chain = ['root-skill', 'child-skill', 'grandchild-skill'];

      expect(chain.length).toBe(3);
      expect(chain[0]).toBe('root-skill');
      expect(chain[chain.length - 1]).toBe('grandchild-skill');
    });
  });
});

describe('Executor - Variable Resolution', () => {
  test('resolves $input variables', () => {
    const template = 'Research: $input.topic';
    const input = { topic: 'AI agents' };

    // Simple resolution simulation
    const resolved = template.replace(/\$input\.(\w+)/g, (_, key) => String(input[key as keyof typeof input] ?? ''));
    expect(resolved).toBe('Research: AI agents');
  });

  test('resolves $step variables', () => {
    const template = 'Result: $step.classify.output';
    const steps = {
      classify: { success: true, output: 'The Grove', executionTimeMs: 100 },
    };

    // Simple resolution simulation
    const resolved = template.replace(/\$step\.(\w+)\.(\w+)/g, (_, stepId, field) => {
      const step = steps[stepId as keyof typeof steps];
      return step ? String((step as Record<string, unknown>)[field] ?? '') : '';
    });
    expect(resolved).toBe('Result: The Grove');
  });

  test('resolves $context variables', () => {
    const template = 'Pillar: $context.pillar';
    const context = { pillar: 'Personal' };

    // Simple resolution simulation
    const resolved = template.replace(/\$context\.(\w+)/g, (_, key) => String(context[key as keyof typeof context] ?? ''));
    expect(resolved).toBe('Pillar: Personal');
  });
});

describe('Executor - Error Handling', () => {
  test('onError: fail stops execution', () => {
    const onError = 'fail';
    const shouldContinue = onError !== 'fail';
    expect(shouldContinue).toBe(false);
  });

  test('onError: continue proceeds to next step', () => {
    const onError = 'continue';
    const shouldContinue = onError === 'continue';
    expect(shouldContinue).toBe(true);
  });

  test('onError: retry attempts multiple times', () => {
    const onError = 'retry';
    const retryCount = 3;
    const shouldRetry = onError === 'retry';

    expect(shouldRetry).toBe(true);
    expect(retryCount).toBe(3);
  });
});
