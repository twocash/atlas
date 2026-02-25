/**
 * Atlas Telegram Bot - Execution Router
 *
 * Demoted from "front door" to "execution planner".
 * Called by Claude when dispatching tasks to select appropriate model/depth.
 */

export type TaskDepth = 'quick' | 'medium' | 'deep';

export interface TaskPlan {
  type: string;
  depth: TaskDepth;
  model: string;
  estimatedTime: string;
  reasoning: string;
}

/**
 * Determine task depth based on request type and context
 */
export function determineDepth(
  requestType: string,
  messageLength: number,
  hasAttachment: boolean
): TaskDepth {
  // Quick tasks
  if (requestType === 'Chat' || requestType === 'Quick' || requestType === 'Answer') {
    return 'quick';
  }

  // Deep tasks
  if (requestType === 'Research' || requestType === 'Draft') {
    if (messageLength > 200 || hasAttachment) {
      return 'deep';
    }
    return 'medium';
  }

  // Medium by default
  return 'medium';
}

/**
 * Select appropriate model based on depth
 */
export function selectModel(depth: TaskDepth): string {
  switch (depth) {
    case 'quick':
      return 'claude-haiku-4-5-20251001';
    case 'medium':
      return 'claude-sonnet-4-20250514';
    case 'deep':
      return 'claude-sonnet-4-20250514'; // Could upgrade to Opus for very deep tasks
    default:
      return 'claude-sonnet-4-20250514';
  }
}

/**
 * Estimate time for a task
 */
export function estimateTime(requestType: string, depth: TaskDepth): string {
  if (depth === 'quick') {
    return '< 30 sec';
  }

  if (requestType === 'Research') {
    switch (depth) {
      case 'medium':
        return '2-3 min';
      case 'deep':
        return '5-8 min';
      default:
        return '1-2 min';
    }
  }

  if (requestType === 'Draft') {
    switch (depth) {
      case 'medium':
        return '1-2 min';
      case 'deep':
        return '3-5 min';
      default:
        return '< 1 min';
    }
  }

  if (requestType === 'Build') {
    return '2-5 min';
  }

  return '< 1 min';
}

/**
 * Plan task execution
 */
export function planTask(
  requestType: string,
  messageLength: number,
  hasAttachment: boolean
): TaskPlan {
  const depth = determineDepth(requestType, messageLength, hasAttachment);
  const model = selectModel(depth);
  const estimatedTime = estimateTime(requestType, depth);

  return {
    type: requestType,
    depth,
    model,
    estimatedTime,
    reasoning: `${requestType} task at ${depth} depth using ${model.split('-').slice(0, 2).join(' ')}`,
  };
}

/**
 * Get model display name
 */
export function getModelName(modelId: string): string {
  if (modelId.includes('haiku')) return 'Haiku (fast)';
  if (modelId.includes('sonnet')) return 'Sonnet (balanced)';
  if (modelId.includes('opus')) return 'Opus (powerful)';
  return modelId;
}

/**
 * Format task plan for display
 */
export function formatTaskPlan(plan: TaskPlan): string {
  return `📋 ${plan.type} • ${plan.depth} depth • ~${plan.estimatedTime}`;
}
