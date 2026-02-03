/**
 * Atlas Skill System - Schema Definitions
 *
 * Phase 2: Formalizes skills as typed definitions with tier classification.
 * Supports both YAML skill files and legacy SKILL.md format.
 */

import { z } from 'zod';
import type { Pillar } from '../conversation/types';

// =============================================================================
// TRIGGER SCHEMAS
// =============================================================================

/**
 * Trigger types for skill matching
 */
export type TriggerType =
  | 'phrase'       // Exact phrase match
  | 'pattern'      // Regex pattern match
  | 'keyword'      // Keyword presence
  | 'pillar'       // Pillar-based routing
  | 'intentHash'   // Match by intent hash
  | 'contentType'; // Match by content type (image, url, etc.)

/**
 * Individual trigger definition
 */
export interface SkillTrigger {
  type: TriggerType;
  value: string;
  /** Optional: Only match if this pillar */
  pillar?: Pillar;
  /** Optional: Minimum confidence to match (0-1) */
  minConfidence?: number;
}

/**
 * Zod schema for trigger validation
 */
export const TriggerSchema = z.object({
  type: z.enum(['phrase', 'pattern', 'keyword', 'pillar', 'intentHash', 'contentType']),
  value: z.string().min(1),
  pillar: z.enum(['Personal', 'The Grove', 'Consulting', 'Home/Garage']).optional(),
  minConfidence: z.number().min(0).max(1).optional(),
});

// =============================================================================
// INPUT/OUTPUT SCHEMAS
// =============================================================================

/**
 * Skill input definition
 */
export interface SkillInput {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  required: boolean;
  description?: string;
  default?: unknown;
}

/**
 * Skill output types
 */
export type SkillOutputType =
  | 'feed_entry'
  | 'work_queue_item'
  | 'message'
  | 'file'
  | 'data';

/**
 * Skill output definition
 */
export interface SkillOutput {
  type: SkillOutputType;
  description?: string;
}

// =============================================================================
// PROCESS STEP SCHEMAS
// =============================================================================

/**
 * Error handling options for process steps
 */
export type OnErrorBehavior = 'fail' | 'continue' | 'retry';

/**
 * Base step interface
 */
interface BaseStep {
  id: string;
  onError?: OnErrorBehavior;
  retryCount?: number;
  condition?: string; // Expression to evaluate
  always_run?: boolean; // If true, runs even if previous steps failed (for cleanup)
}

/**
 * Tool execution step
 */
export interface ToolStep extends BaseStep {
  tool: string;
  inputs: Record<string, unknown>;
}

/**
 * Skill invocation step (for composition)
 */
export interface SkillStep extends BaseStep {
  skill: string;
  inputs: Record<string, unknown>;
}

/**
 * Agent dispatch step
 */
export interface AgentStep extends BaseStep {
  agent: string;
  task: string;
  inputs?: Record<string, unknown>;
}

/**
 * Conditional branch step
 */
export interface ConditionalStep extends BaseStep {
  condition: string;
  then: ProcessStep[];
  else?: ProcessStep[];
}

/**
 * Union of all step types
 */
export type ProcessStep = ToolStep | SkillStep | AgentStep | ConditionalStep;

/**
 * Process definition - how the skill executes
 */
export interface SkillProcess {
  type: 'tool_sequence' | 'skill_composition' | 'agent_dispatch' | 'conditional';
  steps: ProcessStep[];
  /** Maximum execution time in ms */
  timeout?: number;
}

/**
 * Zod schema for process validation
 */
export const ProcessSchema = z.object({
  type: z.enum(['tool_sequence', 'skill_composition', 'agent_dispatch', 'conditional']),
  steps: z.array(z.object({
    id: z.string(),
    tool: z.string().optional(),
    skill: z.string().optional(),
    agent: z.string().optional(),
    task: z.string().optional(),
    inputs: z.record(z.string(), z.unknown()).optional(),
    condition: z.string().optional(),
    then: z.array(z.any()).optional(),
    else: z.array(z.any()).optional(),
    onError: z.enum(['fail', 'continue', 'retry']).optional(),
    retryCount: z.number().int().min(1).max(5).optional(),
    always_run: z.boolean().optional(), // Runs even if previous steps failed (for cleanup)
  })),
  timeout: z.number().int().positive().optional(),
});

// =============================================================================
// TIER CLASSIFICATION
// =============================================================================

/**
 * Skill tier determines approval requirements
 *
 * Tier 0: Read-only operations (queries, status checks) - Auto-deploy
 * Tier 1: Creates entries (Feed, WQ, comments) - Batch approval
 * Tier 2: External actions or 3+ skill composition - Explicit approval
 */
export type SkillTier = 0 | 1 | 2;

/**
 * Tools that create/modify internal entries (Tier 1)
 */
const INTERNAL_WRITE_TOOLS = new Set([
  'notion_create',
  'notion_update',
  'feed_create',
  'workqueue_create',
  'workqueue_update',
  'comment_add',
]);

/**
 * Tools that perform external actions (Tier 2)
 */
const EXTERNAL_TOOLS = new Set([
  'email_send',
  'slack_post',
  'github_create',
  'publish',
  'deploy',
]);

/**
 * Classify skill tier based on process definition
 */
export function classifySkillTier(process: SkillProcess): SkillTier {
  const toolsUsed = new Set<string>();
  const skillsInvoked = new Set<string>();

  // Collect all tools and skills used
  function collectFromSteps(steps: ProcessStep[]): void {
    for (const step of steps) {
      if ('tool' in step && step.tool) {
        toolsUsed.add(step.tool);
      }
      if ('skill' in step && step.skill) {
        skillsInvoked.add(step.skill);
      }
      if ('then' in step && step.then) {
        collectFromSteps(step.then);
      }
      if ('else' in step && step.else) {
        collectFromSteps(step.else);
      }
    }
  }

  collectFromSteps(process.steps);

  // Check for external tools (Tier 2)
  for (const tool of toolsUsed) {
    if (EXTERNAL_TOOLS.has(tool)) {
      return 2;
    }
  }

  // Check for skill composition with 3+ skills (Tier 2)
  if (skillsInvoked.size >= 3) {
    return 2;
  }

  // Check for internal write tools (Tier 1)
  for (const tool of toolsUsed) {
    if (INTERNAL_WRITE_TOOLS.has(tool)) {
      return 1;
    }
  }

  // Check for any skill invocation (at least Tier 1)
  if (skillsInvoked.size > 0) {
    return 1;
  }

  // Default: read-only (Tier 0)
  return 0;
}

// =============================================================================
// SKILL DEFINITION
// =============================================================================

/**
 * Skill health metrics
 */
export interface SkillMetrics {
  /** Total execution count */
  executionCount: number;
  /** Successful executions */
  successCount: number;
  /** Failed executions */
  failureCount: number;
  /** Average execution time (ms) */
  avgExecutionTime: number;
  /** Last execution timestamp */
  lastExecuted?: string;
  /** Last failure timestamp */
  lastFailed?: string;
  /** Consecutive failures (for auto-disable) */
  consecutiveFailures: number;
}

/**
 * Complete skill definition
 */
export interface SkillDefinition {
  /** Unique skill identifier (kebab-case) */
  name: string;

  /** Semantic version */
  version: string;

  /** Human-readable description */
  description: string;

  /** When this skill should be triggered */
  triggers: SkillTrigger[];

  /** Input parameters */
  inputs: Record<string, SkillInput>;

  /** Output definitions */
  outputs: SkillOutput[];

  /** Execution process */
  process: SkillProcess;

  /** Auto-calculated tier (can be overridden) */
  tier: SkillTier;

  /** Whether skill is enabled */
  enabled: boolean;

  /** Creation timestamp */
  createdAt: string;

  /** Last modified timestamp */
  updatedAt: string;

  /** Source: 'yaml' | 'markdown' | 'generated' */
  source: 'yaml' | 'markdown' | 'generated';

  /** File path (for hot reload) */
  filePath?: string;

  /** Health metrics */
  metrics: SkillMetrics;

  /** Tags for organization */
  tags?: string[];

  /** Author (for generated skills) */
  author?: string;

  /** Priority for matching (higher = more specific, wins ties). Default: 50 */
  priority?: number;
}

/**
 * Zod schema for full skill validation
 */
export const SkillDefinitionSchema = z.object({
  name: z.string().regex(/^[a-z0-9-]+$/, 'Name must be kebab-case'),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, 'Version must be semver'),
  description: z.string().min(1),
  triggers: z.array(TriggerSchema).min(1),
  inputs: z.record(z.string(), z.object({
    type: z.enum(['string', 'number', 'boolean', 'array', 'object']),
    required: z.boolean(),
    description: z.string().optional(),
    default: z.unknown().optional(),
  })),
  outputs: z.array(z.object({
    type: z.enum(['feed_entry', 'work_queue_item', 'message', 'file', 'data']),
    description: z.string().optional(),
  })),
  process: ProcessSchema,
  tier: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  enabled: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  source: z.enum(['yaml', 'markdown', 'generated']),
  filePath: z.string().optional(),
  metrics: z.object({
    executionCount: z.number().int().min(0),
    successCount: z.number().int().min(0),
    failureCount: z.number().int().min(0),
    avgExecutionTime: z.number().min(0),
    lastExecuted: z.string().optional(),
    lastFailed: z.string().optional(),
    consecutiveFailures: z.number().int().min(0),
  }),
  tags: z.array(z.string()).optional(),
  author: z.string().optional(),
});

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Create default metrics for a new skill
 */
export function createDefaultMetrics(): SkillMetrics {
  return {
    executionCount: 0,
    successCount: 0,
    failureCount: 0,
    avgExecutionTime: 0,
    consecutiveFailures: 0,
  };
}

/**
 * Create a minimal skill definition
 */
export function createSkillDefinition(
  partial: Partial<SkillDefinition> & Pick<SkillDefinition, 'name' | 'description' | 'triggers' | 'process'>
): SkillDefinition {
  const now = new Date().toISOString();

  return {
    version: '1.0.0',
    inputs: {},
    outputs: [],
    tier: classifySkillTier(partial.process),
    enabled: true,
    createdAt: now,
    updatedAt: now,
    source: 'generated',
    metrics: createDefaultMetrics(),
    ...partial,
  };
}

/**
 * Get tier description for display
 */
export function getTierDescription(tier: SkillTier): string {
  switch (tier) {
    case 0:
      return 'Read-only (auto-deploy)';
    case 1:
      return 'Creates entries (batch approval)';
    case 2:
      return 'External actions (explicit approval)';
  }
}

/**
 * Get tier emoji for display
 */
export function getTierEmoji(tier: SkillTier): string {
  switch (tier) {
    case 0:
      return '🟢';
    case 1:
      return '🟡';
    case 2:
      return '🔴';
  }
}
