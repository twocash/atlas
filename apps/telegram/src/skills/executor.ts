/**
 * Atlas Skill System - Executor
 *
 * Phase 2: Executes skill process steps (tool sequences, compositions, agents).
 * Handles variable resolution, error handling, and metrics tracking.
 *
 * v1.1.0: Added browser automation support with HUD updates and tier-based safety latches.
 */

import { logger } from '../logger';
import { isFeatureEnabled } from '../config/features';
import { getSkillRegistry } from './registry';
import { logAction } from './action-log';
import {
  type SkillDefinition,
  type ProcessStep,
  type ToolStep,
  type SkillStep,
  type AgentStep,
  type ConditionalStep,
  type OnErrorBehavior,
  getTierEmoji,
} from './schema';
import type { Pillar } from '../conversation/types';

// =============================================================================
// BROWSER AUTOMATION SUPPORT
// =============================================================================

/**
 * Check if the Claude-in-Chrome MCP is available for browser automation
 * Returns true if the extension is responsive
 */
async function checkBrowserAutomationAvailable(): Promise<boolean> {
  try {
    const { isMcpTool, executeMcpTool } = await import('../mcp');

    // Check if tabs_context_mcp tool exists and responds
    if (!isMcpTool('mcp__claude-in-chrome__tabs_context_mcp')) {
      return false;
    }

    // Try to get tabs context with short timeout
    const result = await Promise.race([
      executeMcpTool('mcp__claude-in-chrome__tabs_context_mcp', {}),
      new Promise<{ success: boolean }>((resolve) =>
        setTimeout(() => resolve({ success: false }), 3000)
      )
    ]);

    return result.success;
  } catch {
    return false;
  }
}

/**
 * Execution stop error - thrown when user requests emergency stop
 */
export class ExecutionStoppedError extends Error {
  constructor() {
    super('Execution stopped by user');
    this.name = 'ExecutionStoppedError';
  }
}

// Module-level state for stop tracking
let currentExecutionId: string | null = null;
let stopRequested = false;

/**
 * Start tracking a skill execution (call before executing)
 */
export function startExecution(executionId: string): void {
  currentExecutionId = executionId;
  stopRequested = false;
  logger.debug('Execution started', { executionId });
}

/**
 * Request stop for current execution (called from external handler)
 */
export function requestStop(): boolean {
  if (currentExecutionId) {
    stopRequested = true;
    logger.info('Stop requested for execution', { executionId: currentExecutionId });
    return true;
  }
  return false;
}

/**
 * End execution tracking
 */
export function endExecution(): void {
  currentExecutionId = null;
  stopRequested = false;
}

/**
 * Check if stop was requested - call before each step
 * Throws ExecutionStoppedError if stop was requested
 */
function checkStop(): void {
  if (stopRequested) {
    throw new ExecutionStoppedError();
  }
}

/**
 * Log HUD update (for now, just logs - real-time HUD requires dedicated MCP tool)
 *
 * NOTE: Real-time HUD updates require the claude-in-chrome MCP to expose an
 * update_hud tool. Until then, updates are logged but not pushed to browser.
 * The AtlasLink component can poll via tabs_context_mcp if needed.
 */
function logHudUpdate(
  skill: string,
  step: string,
  status: 'running' | 'success' | 'error' | 'waiting',
  logs?: string[]
): void {
  logger.info('Skill step', { skill, step, status, logs });
}

/**
 * Check if a tool is a browser automation tool (claude-in-chrome)
 */
function isBrowserAutomationTool(toolName: string): boolean {
  return toolName.startsWith('mcp__claude-in-chrome__') ||
         toolName.startsWith('claude-in-chrome__');
}

// =============================================================================
// EXECUTION CONTEXT
// =============================================================================

/**
 * Execution context passed through skill execution
 */
export interface ExecutionContext {
  /** User ID executing the skill */
  userId: number;

  /** Original message text */
  messageText: string;

  /** Classified pillar */
  pillar: Pillar;

  /** Skill inputs from trigger match */
  input: Record<string, unknown>;

  /** Results from previous steps (keyed by step ID) */
  steps: Record<string, StepResult>;

  /** Current execution depth (for composition limits) */
  depth: number;

  /** Start timestamp */
  startTime: number;

  /** Timeout (ms) */
  timeout: number;

  /** Skill invocation chain for circular dependency detection (Phase 4) */
  skillChain?: string[];

  /** Tier of the parent skill invoking composition (Phase 4) */
  parentTier?: number;

  /** Whether browser automation is available (Claude-in-Chrome MCP) */
  browserAutomationAvailable?: boolean;

  /** Approval latch for Tier 2 skills (external actions) */
  approvalLatch?: boolean;
}

/**
 * Result from a single step
 */
export interface StepResult {
  success: boolean;
  output?: unknown;
  error?: string;
  executionTimeMs: number;
}

/**
 * Result from skill execution
 */
export interface SkillExecutionResult {
  success: boolean;
  skillName: string;
  tier: number;
  output?: unknown;
  error?: string;
  stepResults: Record<string, StepResult>;
  executionTimeMs: number;
  toolsUsed: string[];
}

// =============================================================================
// VARIABLE RESOLUTION
// =============================================================================

/**
 * Resolve variables in a template string or object
 *
 * Supports:
 * - $input.fieldName - Skill inputs
 * - $step.stepId.field - Previous step outputs
 * - $context.pillar - Execution context
 */
function resolveVariables(
  template: unknown,
  context: ExecutionContext
): unknown {
  if (typeof template === 'string') {
    return template.replace(/\$(\w+)\.(\w+)(?:\.(\w+))?/g, (match, scope, key, subkey) => {
      switch (scope) {
        case 'input':
          return String(context.input[key] ?? '');

        case 'step': {
          const stepResult = context.steps[key];
          if (!stepResult?.output) return '';
          if (subkey) {
            const output = stepResult.output as Record<string, unknown>;
            return String(output[subkey] ?? '');
          }
          return String(stepResult.output);
        }

        case 'context':
          switch (key) {
            case 'pillar':
              return context.pillar;
            case 'userId':
              return String(context.userId);
            case 'messageText':
              return context.messageText;
            default:
              return '';
          }

        default:
          return match;
      }
    });
  }

  if (Array.isArray(template)) {
    return template.map(item => resolveVariables(item, context));
  }

  if (template && typeof template === 'object') {
    const resolved: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(template)) {
      resolved[key] = resolveVariables(value, context);
    }
    return resolved;
  }

  return template;
}

/**
 * Evaluate a condition expression
 */
function evaluateCondition(condition: string, context: ExecutionContext): boolean {
  // Simple condition evaluation
  // Supports: $step.id.success, $input.field == "value", etc.

  const resolved = resolveVariables(condition, context) as string;

  // Handle common patterns
  if (resolved === 'true') return true;
  if (resolved === 'false') return false;

  // Handle == comparisons
  const eqMatch = resolved.match(/^(.+?)\s*==\s*"?([^"]*)"?$/);
  if (eqMatch) {
    return eqMatch[1].trim() === eqMatch[2].trim();
  }

  // Handle != comparisons
  const neqMatch = resolved.match(/^(.+?)\s*!=\s*"?([^"]*)"?$/);
  if (neqMatch) {
    return neqMatch[1].trim() !== neqMatch[2].trim();
  }

  // Default: truthy check
  return Boolean(resolved);
}

// =============================================================================
// STEP EXECUTORS
// =============================================================================

/**
 * Execute a tool step
 */
async function executeToolStep(
  step: ToolStep,
  context: ExecutionContext
): Promise<StepResult> {
  const startTime = Date.now();
  const toolName = step.tool;

  // Normalize tool name (add mcp__ prefix if needed for claude-in-chrome tools)
  const normalizedToolName = toolName.startsWith('claude-in-chrome__') && !toolName.startsWith('mcp__')
    ? `mcp__${toolName}`
    : toolName;

  const skillName = context.skillChain?.[0] || 'unknown';

  try {
    // Check for stop request before each step
    checkStop();

    // Check if this is a browser automation tool
    if (isBrowserAutomationTool(normalizedToolName)) {
      // Check browser automation availability
      if (context.browserAutomationAvailable === undefined) {
        context.browserAutomationAvailable = await checkBrowserAutomationAvailable();
      }

      if (!context.browserAutomationAvailable) {
        return {
          success: false,
          error: 'Browser automation unavailable. Please ensure Chrome is running with the Atlas extension.',
          executionTimeMs: Date.now() - startTime,
        };
      }
    }

    // Log step start
    logHudUpdate(skillName, step.id, 'running', [`Executing ${normalizedToolName}`]);

    // Resolve inputs
    const resolvedInputs = resolveVariables(step.inputs, context) as Record<string, unknown>;

    // Import tool executor dynamically to avoid circular deps
    const { executeTool } = await import('../conversation/tools');

    logger.debug('Executing tool step', { stepId: step.id, tool: normalizedToolName, inputs: resolvedInputs });

    const result = await executeTool(normalizedToolName, resolvedInputs);

    // Check for stop after step completion
    checkStop();

    // Log step completion
    logHudUpdate(skillName, step.id, result.success ? 'success' : 'error', [
      result.success ? `Completed ${step.id}` : `Failed: ${result.error}`
    ]);

    return {
      success: result.success,
      output: result.result,
      error: result.error,
      executionTimeMs: Date.now() - startTime,
    };
  } catch (error) {
    // Re-throw stop errors
    if (error instanceof ExecutionStoppedError) {
      logHudUpdate(skillName, step.id, 'error', ['Stopped by user']);
      throw error;
    }

    const errorMsg = error instanceof Error ? error.message : String(error);
    logHudUpdate(skillName, step.id, 'error', [`Error: ${errorMsg}`]);

    return {
      success: false,
      error: errorMsg,
      executionTimeMs: Date.now() - startTime,
    };
  }
}

/**
 * Execute a skill composition step (Phase 4)
 *
 * Implements:
 * - Circular dependency detection (A → B → A prevention)
 * - Tier validation (can only compose equal or lower tier skills)
 * - Max composition depth (3 levels)
 * - Feature flag gating
 */
async function executeSkillStep(
  step: SkillStep,
  context: ExecutionContext
): Promise<StepResult> {
  const startTime = Date.now();

  // Phase 4: Check if skill composition is enabled
  if (!isFeatureEnabled('skillComposition')) {
    return {
      success: false,
      error: 'Skill composition is disabled (ATLAS_SKILL_COMPOSITION=false)',
      executionTimeMs: Date.now() - startTime,
    };
  }

  // Check composition depth limit (max 3 levels)
  if (context.depth >= 3) {
    return {
      success: false,
      error: 'Maximum skill composition depth (3) exceeded',
      executionTimeMs: Date.now() - startTime,
    };
  }

  // Phase 4: Circular dependency detection
  const skillChain = context.skillChain || [];
  if (skillChain.includes(step.skill)) {
    const cycle = [...skillChain, step.skill].join(' → ');
    logger.error('Circular skill dependency detected', { cycle });
    return {
      success: false,
      error: `Circular dependency detected: ${cycle}`,
      executionTimeMs: Date.now() - startTime,
    };
  }

  try {
    const registry = getSkillRegistry();
    const skill = registry.get(step.skill);

    if (!skill) {
      return {
        success: false,
        error: `Skill not found: ${step.skill}`,
        executionTimeMs: Date.now() - startTime,
      };
    }

    if (!skill.enabled) {
      return {
        success: false,
        error: `Skill is disabled: ${step.skill}`,
        executionTimeMs: Date.now() - startTime,
      };
    }

    // Phase 4: Tier validation - can only compose equal or lower tier
    if (context.parentTier !== undefined && skill.tier > context.parentTier) {
      logger.warn('Skill tier violation in composition', {
        parent: context.parentTier,
        child: skill.tier,
        childSkill: step.skill,
      });
      return {
        success: false,
        error: `Cannot compose Tier ${skill.tier} skill from Tier ${context.parentTier} (must be equal or lower)`,
        executionTimeMs: Date.now() - startTime,
      };
    }

    // Resolve inputs
    const resolvedInputs = resolveVariables(step.inputs, context) as Record<string, unknown>;

    // Execute nested skill with updated chain
    const result = await executeSkill(skill, {
      ...context,
      input: resolvedInputs,
      depth: context.depth + 1,
      skillChain: [...skillChain, step.skill],
      parentTier: skill.tier,
    });

    return {
      success: result.success,
      output: result.output,
      error: result.error,
      executionTimeMs: Date.now() - startTime,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      executionTimeMs: Date.now() - startTime,
    };
  }
}

/**
 * Execute an agent dispatch step
 */
async function executeAgentStep(
  step: AgentStep,
  context: ExecutionContext
): Promise<StepResult> {
  const startTime = Date.now();

  try {
    // Resolve task template
    const resolvedTask = resolveVariables(step.task, context) as string;
    const resolvedInputs = step.inputs
      ? resolveVariables(step.inputs, context) as Record<string, unknown>
      : {};

    logger.debug('Executing agent step', { stepId: step.id, agent: step.agent, task: resolvedTask });

    // For now, agent execution returns the task description
    // Full agent integration will be added in Phase 4
    // This allows skills to be defined with agent steps before full implementation

    return {
      success: true,
      output: {
        agent: step.agent,
        task: resolvedTask,
        inputs: resolvedInputs,
        status: 'pending', // Would be 'completed' with real agent
      },
      executionTimeMs: Date.now() - startTime,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      executionTimeMs: Date.now() - startTime,
    };
  }
}

/**
 * Execute a conditional step
 */
async function executeConditionalStep(
  step: ConditionalStep,
  context: ExecutionContext
): Promise<StepResult> {
  const startTime = Date.now();

  try {
    const conditionResult = evaluateCondition(step.condition, context);

    logger.debug('Conditional step evaluated', {
      stepId: step.id,
      condition: step.condition,
      result: conditionResult,
    });

    const stepsToExecute = conditionResult ? step.then : (step.else || []);

    // Execute the appropriate branch
    for (const branchStep of stepsToExecute) {
      const result = await executeStep(branchStep, context);
      context.steps[branchStep.id] = result;

      if (!result.success && branchStep.onError !== 'continue') {
        return {
          success: false,
          error: `Branch step ${branchStep.id} failed: ${result.error}`,
          executionTimeMs: Date.now() - startTime,
        };
      }
    }

    return {
      success: true,
      output: { branch: conditionResult ? 'then' : 'else' },
      executionTimeMs: Date.now() - startTime,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      executionTimeMs: Date.now() - startTime,
    };
  }
}

/**
 * Execute a single step (dispatches to appropriate executor)
 */
async function executeStep(
  step: ProcessStep,
  context: ExecutionContext
): Promise<StepResult> {
  // Check timeout
  if (Date.now() - context.startTime > context.timeout) {
    return {
      success: false,
      error: 'Skill execution timeout',
      executionTimeMs: Date.now() - context.startTime,
    };
  }

  // Dispatch based on step type
  if ('tool' in step && step.tool) {
    return executeToolStep(step as ToolStep, context);
  }

  if ('skill' in step && step.skill) {
    return executeSkillStep(step as SkillStep, context);
  }

  if ('agent' in step && step.agent) {
    return executeAgentStep(step as AgentStep, context);
  }

  if ('then' in step) {
    return executeConditionalStep(step as ConditionalStep, context);
  }

  return {
    success: false,
    error: `Unknown step type: ${JSON.stringify(step)}`,
    executionTimeMs: 0,
  };
}

/**
 * Handle step error based on onError behavior
 */
async function handleStepError(
  step: ProcessStep,
  result: StepResult,
  context: ExecutionContext
): Promise<StepResult> {
  const onError: OnErrorBehavior = step.onError || 'fail';

  switch (onError) {
    case 'continue':
      logger.warn('Step failed but continuing', { stepId: step.id, error: result.error });
      return result;

    case 'retry': {
      const retryCount = step.retryCount || 3;
      for (let attempt = 1; attempt <= retryCount; attempt++) {
        logger.info('Retrying step', { stepId: step.id, attempt, maxAttempts: retryCount });
        const retryResult = await executeStep(step, context);
        if (retryResult.success) {
          return retryResult;
        }
      }
      return result; // All retries failed
    }

    case 'fail':
    default:
      return result;
  }
}

// =============================================================================
// MAIN EXECUTOR
// =============================================================================

/**
 * Execute a skill
 */
export async function executeSkill(
  skill: SkillDefinition,
  context: Omit<ExecutionContext, 'steps' | 'startTime' | 'timeout' | 'depth'> & { depth?: number }
): Promise<SkillExecutionResult> {
  const startTime = Date.now();
  const toolsUsed: string[] = [];

  // Check if skill execution is enabled
  if (!isFeatureEnabled('skillExecution')) {
    logger.debug('Skill execution disabled', { skill: skill.name });
    return {
      success: false,
      skillName: skill.name,
      tier: skill.tier,
      error: 'Skill execution is disabled (ATLAS_SKILL_EXECUTION=false)',
      stepResults: {},
      executionTimeMs: 0,
      toolsUsed: [],
    };
  }

  // Tier 2 safety latch: Require explicit approval for external actions
  if (skill.tier >= 2 && !context.approvalLatch) {
    logger.warn('Tier 2 skill requires approval', { skill: skill.name, tier: skill.tier });
    return {
      success: false,
      skillName: skill.name,
      tier: skill.tier,
      error: `Tier ${skill.tier} skill "${skill.name}" requires explicit approval. This skill performs external actions.`,
      stepResults: {},
      executionTimeMs: 0,
      toolsUsed: [],
    };
  }

  // Build full context
  // For top-level calls, initialize skillChain with current skill
  // For nested calls (from executeSkillStep), skillChain is already set
  const fullContext: ExecutionContext = {
    ...context,
    steps: {},
    startTime,
    timeout: skill.process.timeout || 30000, // Default 30s
    depth: context.depth ?? 0,
    // Phase 4: Initialize composition tracking
    skillChain: context.skillChain ?? [skill.name],
    parentTier: context.parentTier ?? skill.tier,
  };

  // Generate execution ID and start tracking (only for top-level)
  const executionId = `${skill.name}-${Date.now()}`;
  const isTopLevel = fullContext.depth === 0;

  if (isTopLevel) {
    startExecution(executionId);
  }

  logger.info('Executing skill', {
    skill: skill.name,
    tier: skill.tier,
    tierEmoji: getTierEmoji(skill.tier),
    depth: fullContext.depth,
    executionId: isTopLevel ? executionId : undefined,
  });

  try {
    // Execute each step in sequence
    for (const step of skill.process.steps) {
      // Check for stop request before each step
      checkStop();
      const result = await executeStep(step, fullContext);

      // Track tools used
      if ('tool' in step && step.tool) {
        toolsUsed.push(step.tool);
      }

      // Store result
      fullContext.steps[step.id] = result;

      // Handle errors
      if (!result.success) {
        const handled = await handleStepError(step, result, fullContext);
        fullContext.steps[step.id] = handled;

        if (!handled.success && step.onError !== 'continue') {
          // Step failed and we should stop
          const executionTime = Date.now() - startTime;

          // Update metrics
          getSkillRegistry().updateMetrics(skill.name, false, executionTime);

          // Log action
          if (isFeatureEnabled('skillLogging')) {
            logAction({
              messageText: context.messageText,
              pillar: context.pillar,
              requestType: 'Process',
              actionType: 'dispatch',
              toolsUsed,
              userId: context.userId,
              confidence: 0,
              executionTimeMs: executionTime,
              entrySummary: `Skill failed: ${skill.name}`,
            }).catch(() => { /* non-fatal */ });
          }

          return {
            success: false,
            skillName: skill.name,
            tier: skill.tier,
            error: `Step ${step.id} failed: ${handled.error}`,
            stepResults: fullContext.steps,
            executionTimeMs: executionTime,
            toolsUsed,
          };
        }
      }
    }

    // Success!
    const executionTime = Date.now() - startTime;

    // Update metrics
    getSkillRegistry().updateMetrics(skill.name, true, executionTime);

    // Log action
    if (isFeatureEnabled('skillLogging')) {
      logAction({
        messageText: context.messageText,
        pillar: context.pillar,
        requestType: 'Process',
        actionType: 'dispatch',
        toolsUsed,
        userId: context.userId,
        confidence: 1,
        executionTimeMs: executionTime,
        entrySummary: `Skill executed: ${skill.name}`,
      }).catch(() => { /* non-fatal */ });
    }

    // Gather output from last step
    const stepIds = Object.keys(fullContext.steps);
    const lastStepId = stepIds[stepIds.length - 1];
    const lastStepResult = fullContext.steps[lastStepId];

    logger.info('Skill executed successfully', {
      skill: skill.name,
      executionTimeMs: executionTime,
      stepsCompleted: stepIds.length,
    });

    // End execution tracking
    if (isTopLevel) {
      endExecution();
    }

    return {
      success: true,
      skillName: skill.name,
      tier: skill.tier,
      output: lastStepResult?.output,
      stepResults: fullContext.steps,
      executionTimeMs: executionTime,
      toolsUsed,
    };
  } catch (error) {
    const executionTime = Date.now() - startTime;

    // End execution tracking
    if (isTopLevel) {
      endExecution();
    }

    // Handle stop request specially
    if (error instanceof ExecutionStoppedError) {
      logger.info('Skill execution stopped by user', { skill: skill.name });
      return {
        success: false,
        skillName: skill.name,
        tier: skill.tier,
        error: 'Execution stopped by user',
        stepResults: fullContext.steps,
        executionTimeMs: executionTime,
        toolsUsed,
      };
    }

    const errorMessage = error instanceof Error ? error.message : String(error);

    // Update metrics
    getSkillRegistry().updateMetrics(skill.name, false, executionTime);

    logger.error('Skill execution error', {
      skill: skill.name,
      error: errorMessage,
      executionTimeMs: executionTime,
    });

    return {
      success: false,
      skillName: skill.name,
      tier: skill.tier,
      error: errorMessage,
      stepResults: fullContext.steps,
      executionTimeMs: executionTime,
      toolsUsed,
    };
  }
}

/**
 * Execute a skill by name
 */
export async function executeSkillByName(
  skillName: string,
  context: Omit<ExecutionContext, 'steps' | 'startTime' | 'timeout' | 'depth'>
): Promise<SkillExecutionResult> {
  const registry = getSkillRegistry();
  const skill = registry.get(skillName);

  if (!skill) {
    return {
      success: false,
      skillName,
      tier: 0,
      error: `Skill not found: ${skillName}`,
      stepResults: {},
      executionTimeMs: 0,
      toolsUsed: [],
    };
  }

  if (!skill.enabled) {
    return {
      success: false,
      skillName,
      tier: skill.tier,
      error: `Skill is disabled: ${skillName}`,
      stepResults: {},
      executionTimeMs: 0,
      toolsUsed: [],
    };
  }

  return executeSkill(skill, context);
}

/**
 * Execute a skill with explicit approval (for Tier 2+ skills)
 * Use this when the user has explicitly approved external actions
 */
export async function executeSkillWithApproval(
  skillName: string,
  context: Omit<ExecutionContext, 'steps' | 'startTime' | 'timeout' | 'depth'>
): Promise<SkillExecutionResult> {
  const registry = getSkillRegistry();
  const skill = registry.get(skillName);

  if (!skill) {
    return {
      success: false,
      skillName,
      tier: 0,
      error: `Skill not found: ${skillName}`,
      stepResults: {},
      executionTimeMs: 0,
      toolsUsed: [],
    };
  }

  if (!skill.enabled) {
    return {
      success: false,
      skillName,
      tier: skill.tier,
      error: `Skill is disabled: ${skillName}`,
      stepResults: {},
      executionTimeMs: 0,
      toolsUsed: [],
    };
  }

  // Execute with approval latch set
  return executeSkill(skill, { ...context, approvalLatch: true });
}

/**
 * Check if browser automation is available
 * Useful for pre-flight checks before attempting browser skills
 */
export async function isBrowserAutomationReady(): Promise<boolean> {
  return checkBrowserAutomationAvailable();
}
