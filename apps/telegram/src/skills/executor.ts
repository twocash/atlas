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
import { pushActivity } from '../health/status-server';
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
 * Check if browser automation is available
 * Uses Playwright (native) - always available if installed
 */
async function checkBrowserAutomationAvailable(): Promise<boolean> {
  try {
    // Playwright is a native dependency, check if it's importable
    const playwright = await import('playwright');
    return !!playwright.chromium;
  } catch {
    logger.warn('Playwright not available for browser automation');
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
 * Log HUD update and push to status server for Chrome extension polling
 *
 * The status server (localhost:3847) provides an HTTP bridge that the
 * Chrome extension polls to get real-time skill execution updates.
 * @see health/status-server.ts
 */
function logHudUpdate(
  skill: string,
  step: string,
  status: 'running' | 'success' | 'error' | 'waiting',
  logs?: string[]
): void {
  logger.info('Skill step', { skill, step, status, logs });
  pushActivity(skill, step, status, logs || []);
}

/**
 * Check if a tool is a browser automation tool
 * Supports both Playwright-based tools (native) and legacy chrome MCP tools
 */
function isBrowserAutomationTool(toolName: string): boolean {
  // New Playwright-based tools (native)
  if (toolName.startsWith('browser_')) return true;
  // Legacy chrome MCP tools (for backwards compatibility)
  if (toolName.startsWith('mcp__claude-in-chrome__')) return true;
  if (toolName.startsWith('claude-in-chrome__')) return true;
  return false;
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
 * Resolve a single variable reference to its raw value (no string conversion)
 * Returns undefined if the variable cannot be resolved
 */
function resolveVariableRaw(
  scope: string,
  key: string,
  subkey: string | undefined,
  context: ExecutionContext
): unknown {
  switch (scope) {
    case 'input': {
      const value = context.input[key];
      // Return raw value - could be string, object, number, etc.
      return value;
    }

    case 'step': {
      const stepResult = context.steps[key];
      if (!stepResult) {
        logger.warn('Variable resolution: step not found', { key, subkey, availableSteps: Object.keys(context.steps) });
        return undefined;
      }

      // Handle special step result fields
      if (subkey === 'success') return stepResult.success;
      if (subkey === 'error') return stepResult.error || '';
      if (subkey === 'executionTimeMs') return stepResult.executionTimeMs;

      // Handle 'output' subkey - return the full output
      if (subkey === 'output') {
        if (key.includes('analyze') || key.includes('text')) {
          const outputStr = stepResult.output ? String(stepResult.output) : '';
          logger.info('Variable resolution: output', {
            step: key,
            hasOutput: !!stepResult.output,
            outputType: typeof stepResult.output,
            outputLength: outputStr.length,
            preview: outputStr.substring(0, 100),
          });
        }
        return stepResult.output;
      }

      // Access nested output fields (when output is an object)
      if (subkey && stepResult.output && typeof stepResult.output === 'object') {
        const output = stepResult.output as Record<string, unknown>;
        return output[subkey];
      }

      // Return full output if no subkey
      return stepResult.output;
    }

    case 'context':
      switch (key) {
        case 'pillar':
          return context.pillar;
        case 'userId':
          return context.userId;
        case 'messageText':
          return context.messageText;
        default:
          return undefined;
      }

    default:
      return undefined;
  }
}

/**
 * Resolve variables in a template string or object
 *
 * Supports:
 * - $input.fieldName - Skill inputs
 * - $step.stepId.field - Previous step outputs
 * - $context.pillar - Execution context
 *
 * Object passthrough: When the entire template is just a variable reference
 * (e.g., "$input.composedPrompt"), the raw value is returned instead of
 * converting to string. This allows passing objects through to tools.
 */
function resolveVariables(
  template: unknown,
  context: ExecutionContext
): unknown {
  if (typeof template === 'string') {
    // Check if the entire template is just a single variable reference
    // Pattern: $scope.key or $scope.key.subkey with nothing else
    const exactVarMatch = template.match(/^\$(\w+)\.(\w+)(?:\.(\w+))?$/);
    if (exactVarMatch) {
      const [, scope, key, subkey] = exactVarMatch;
      // Return raw value for object passthrough (don't convert to string)
      const rawValue = resolveVariableRaw(scope, key, subkey, context);
      if (rawValue !== undefined) {
        return rawValue;
      }
    }

    // Template contains embedded variables or multiple variables - use string replacement
    return template.replace(/\$(\w+)\.(\w+)(?:\.(\w+))?/g, (match, scope, key, subkey) => {
      const value = resolveVariableRaw(scope, key, subkey, context);
      return value !== undefined ? String(value) : match;
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

    // Log at INFO level for skill debugging - critical for tracing content flow
    logger.info('Executing tool step', {
      stepId: step.id,
      tool: normalizedToolName,
      inputKeys: Object.keys(resolvedInputs),
      // Log content preview for notion_append to trace what's being written
      ...(normalizedToolName === 'notion_append' ? {
        pageId: resolvedInputs.pageId,
        contentLength: typeof resolvedInputs.content === 'string' ? resolvedInputs.content.length : 0,
        contentPreview: typeof resolvedInputs.content === 'string' ? resolvedInputs.content.substring(0, 100) : 'NOT_STRING',
      } : {}),
    });

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

  // Separate always_run steps for guaranteed cleanup
  const regularSteps = skill.process.steps.filter(s => !(s as any).always_run);
  const alwaysRunSteps = skill.process.steps.filter(s => (s as any).always_run);
  let earlyFailure: SkillExecutionResult | null = null;

  try {
    try {
      // Execute regular steps in sequence
      for (const step of regularSteps) {
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
            // Step failed and we should stop - but still run cleanup
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

            // Store failure but continue to finally block for cleanup
            earlyFailure = {
              success: false,
              skillName: skill.name,
              tier: skill.tier,
              error: `Step ${step.id} failed: ${handled.error}`,
              stepResults: fullContext.steps,
              executionTimeMs: executionTime,
              toolsUsed,
            };
            break;
          }
        }
      }
    } finally {
      // Run always_run steps even on error (for cleanup like closing tabs)
      for (const step of alwaysRunSteps) {
        try {
          logger.debug('Running always_run cleanup step', { stepId: step.id });
          const cleanupResult = await executeStep(step, fullContext);
          fullContext.steps[step.id] = cleanupResult;
          if ('tool' in step && step.tool) {
            toolsUsed.push(step.tool);
          }
        } catch (cleanupError) {
          logger.warn('Cleanup step failed (non-fatal)', { stepId: step.id, error: cleanupError });
        }
      }
    }

    // Return early failure if we had one
    if (earlyFailure) {
      // End execution tracking
      if (isTopLevel) {
        endExecution();
      }
      // Update step results with any cleanup results
      earlyFailure.stepResults = fullContext.steps;
      return earlyFailure;
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

/**
 * Contextual Extraction Parameters
 */
export interface ContextualExtractionParams {
  url: string;
  pillar: Pillar;
  feedId?: string;
  workQueueId?: string;
  userId: number;
  chatId?: number;
  requestType?: string;
}

/**
 * Trigger contextual extraction based on pillar
 *
 * This is the single entry point for pillar-aware skill execution.
 * Call this after content is saved to Feed/Work Queue to trigger
 * appropriate extraction depth based on the content's life domain.
 *
 * - The Grove: Deep extraction (expand replies, extract links, analyze for research)
 * - Consulting: Standard extraction (business intel, competitor signals)
 * - Personal/Home: Shallow extraction (quick snapshot)
 *
 * @param params - Extraction parameters including URL, pillar, and IDs
 * @returns Promise that resolves when extraction completes (non-blocking recommended)
 */
export async function triggerContextualExtraction(
  params: ContextualExtractionParams
): Promise<SkillExecutionResult | null> {
  const { url, pillar, feedId, workQueueId, userId, chatId, requestType } = params;

  // Check if skill execution is enabled
  if (!isFeatureEnabled('skillExecution')) {
    logger.debug('Contextual extraction skipped: skillExecution feature disabled');
    return null;
  }

  // Determine extraction depth from pillar
  const depth = pillar === 'The Grove' ? 'deep'
              : pillar === 'Consulting' ? 'standard'
              : 'shallow';

  // Find matching skill for this URL
  const registry = getSkillRegistry();
  const match = registry.findBestMatch(url, { pillar });

  if (!match || match.score < 0.7) {
    logger.debug('No matching extraction skill for URL', {
      url,
      pillar,
      bestMatch: match ? { skill: match.skill.name, score: match.score } : null,
    });
    return null;
  }

  logger.info('Triggering contextual extraction', {
    skill: match.skill.name,
    pillar,
    depth,
    url: url.substring(0, 50),
    feedId,
  });

  try {
    const result = await executeSkillByName(match.skill.name, {
      userId,
      messageText: url,
      pillar,
      input: {
        url,
        pillar,
        intent: requestType,
        depth,
        feedId,
        workQueueId,
        telegramChatId: chatId,
      },
    });

    if (result.success) {
      logger.info('Contextual extraction completed', {
        skill: match.skill.name,
        feedId,
        executionTimeMs: result.executionTimeMs,
      });
    } else {
      logger.warn('Contextual extraction failed', {
        skill: match.skill.name,
        error: result.error,
      });
    }

    return result;
  } catch (error) {
    logger.error('Contextual extraction error', { error, url, pillar });
    return null;
  }
}
