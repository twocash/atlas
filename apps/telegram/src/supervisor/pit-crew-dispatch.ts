/**
 * Atlas Supervisor - Pit Crew Dispatch
 *
 * Auto-escalation logic for dispatching bugs to Pit Crew.
 * Integrates with the MCP pit_crew tools.
 */

import type {
  PatternMatch,
  PatternSeverity,
  PatternAction,
  PitCrewDispatch,
  PitCrewDispatchResult,
  ProcessState,
} from './types';

// ==========================================
// Dispatch Decision Logic
// ==========================================

export interface DispatchDecision {
  shouldDispatch: boolean;
  reason: string;
  priority: PatternSeverity;
  immediate: boolean;  // P0 = immediate, P1 = after threshold
}

/**
 * Decide whether to dispatch based on pattern match
 */
export function shouldDispatch(
  match: PatternMatch,
  processState: ProcessState,
  errorThreshold: number
): DispatchDecision {
  const { pattern } = match;

  // P0 patterns always dispatch immediately
  if (pattern.severity === 'P0' && pattern.action === 'dispatch') {
    return {
      shouldDispatch: true,
      reason: `Critical error: ${pattern.description}`,
      priority: 'P0',
      immediate: true,
    };
  }

  // P1 patterns dispatch after threshold
  if (pattern.severity === 'P1' && pattern.action === 'dispatch_after_threshold') {
    if (processState.consecutiveErrors >= errorThreshold) {
      return {
        shouldDispatch: true,
        reason: `${pattern.description} (${processState.consecutiveErrors} consecutive errors)`,
        priority: 'P1',
        immediate: false,
      };
    }

    return {
      shouldDispatch: false,
      reason: `Waiting for threshold (${processState.consecutiveErrors}/${errorThreshold})`,
      priority: 'P1',
      immediate: false,
    };
  }

  // restart_and_dispatch patterns
  if (pattern.action === 'restart_and_dispatch') {
    return {
      shouldDispatch: true,
      reason: `Process crash: ${pattern.description}`,
      priority: pattern.severity,
      immediate: true,
    };
  }

  // Log-only patterns don't dispatch
  return {
    shouldDispatch: false,
    reason: 'Pattern is log-only',
    priority: pattern.severity,
    immediate: false,
  };
}

// ==========================================
// Dispatch Formatting
// ==========================================

/**
 * Format a dispatch for Pit Crew
 */
export function formatDispatch(
  match: PatternMatch,
  processState: ProcessState,
  sourcePath: string
): PitCrewDispatch {
  const timestamp = new Date().toISOString();
  const uptime = processState.startTime
    ? Date.now() - processState.startTime.getTime()
    : 0;

  const uptimeStr = formatUptime(uptime);

  const context = `## 🤖 Supervisor Alert
> Auto-detected at ${timestamp}
> Mode: production
> Source: ${sourcePath}

## 📋 Error Details

**Pattern:** ${match.pattern.description}
**Severity:** ${match.pattern.severity}
**Matched Text:**
\`\`\`
${match.matchedText}
\`\`\`

**Context:**
\`\`\`
${match.context}
\`\`\`

## 🔄 Process State

- **Consecutive errors:** ${processState.consecutiveErrors}
- **Total errors (session):** ${processState.errorCount}
- **Last successful:** ${processState.lastSuccessTime?.toISOString() || 'Never'}
- **Process uptime:** ${uptimeStr}
- **Restart count:** ${processState.restartCount}

## 🎯 Impact Assessment

${getImpactAssessment(match, processState)}

---
*Auto-dispatched by Atlas Supervisor*`;

  return {
    type: 'bug',
    title: `[Supervisor] ${match.pattern.severity}: ${match.pattern.description}`,
    context,
    priority: match.pattern.severity,
    metadata: {
      source: 'supervisor',
      errorPattern: match.pattern.pattern,
      consecutiveErrors: processState.consecutiveErrors,
      uptime,
      lastSuccessTime: processState.lastSuccessTime?.toISOString(),
    },
  };
}

/**
 * Format uptime in human-readable form
 */
function formatUptime(ms: number): string {
  if (ms < 1000) return `${ms}ms`;

  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}d ${hours % 24}h ${minutes % 60}m`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

/**
 * Generate impact assessment based on error pattern
 */
function getImpactAssessment(match: PatternMatch, processState: ProcessState): string {
  const pattern = match.pattern;

  if (pattern.severity === 'P0') {
    return `**CRITICAL:** This error indicates a fundamental connectivity or authentication issue. ` +
      `The bot may be unable to process any requests until resolved.`;
  }

  if (pattern.pattern.includes('ECONNREFUSED') || pattern.pattern.includes('ETIMEDOUT')) {
    return `**Service Connectivity:** External service (Notion/Claude API) is unreachable. ` +
      `Check network connectivity and service status. May recover automatically.`;
  }

  if (pattern.pattern.includes('401') || pattern.pattern.includes('Unauthorized')) {
    return `**Authentication Failure:** API credentials may be invalid or expired. ` +
      `Check environment variables and API key validity.`;
  }

  if (pattern.pattern.includes('UnhandledPromiseRejection')) {
    return `**Code Error:** An unhandled async error occurred. This may indicate a bug in the ` +
      `application code that needs investigation.`;
  }

  if (pattern.pattern.includes('exit code')) {
    return `**Process Crash:** The bot process exited unexpectedly. Check logs for the root cause. ` +
      `Supervisor will attempt auto-restart.`;
  }

  if (processState.consecutiveErrors > 5) {
    return `**Recurring Issue:** This error has occurred ${processState.consecutiveErrors} times ` +
      `in succession, suggesting a persistent problem that won't self-heal.`;
  }

  return `This error may impact bot functionality. Monitor for recurrence.`;
}

// ==========================================
// MCP Dispatch Execution
// ==========================================

/**
 * Execute dispatch via MCP Pit Crew tools
 *
 * Note: This function should be called from the supervisor index
 * which has access to the MCP execution context.
 */
export async function executeDispatch(
  dispatch: PitCrewDispatch,
  mcpExecutor: (toolName: string, args: Record<string, unknown>) => Promise<{
    success: boolean;
    result: unknown;
    error?: string;
  }>
): Promise<PitCrewDispatchResult> {
  try {
    const result = await mcpExecutor('mcp__pit_crew__dispatch_work', {
      type: dispatch.type,
      title: dispatch.title,
      context: dispatch.context,
      priority: dispatch.priority,
    });

    if (!result.success) {
      return {
        success: false,
        error: result.error || 'Pit Crew dispatch failed',
      };
    }

    // Parse MCP response
    const mcpResult = result.result as { content?: Array<{ type: string; text?: string }> };
    const textContent = mcpResult?.content?.find(c => c.type === 'text');

    if (!textContent?.text) {
      return {
        success: false,
        error: 'Pit Crew returned empty response',
      };
    }

    const parsed = JSON.parse(textContent.text);

    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error || 'Pit Crew dispatch failed',
      };
    }

    return {
      success: true,
      discussionId: parsed.discussion_id,
      notionUrl: parsed.notion_url,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// ==========================================
// Deduplication
// ==========================================

/**
 * Check if we should skip dispatch (deduplication)
 */
export function shouldSkipDuplicate(
  match: PatternMatch,
  recentDispatches: Array<{ pattern: string; timestamp: Date }>,
  cooldownMs: number = 5 * 60 * 1000  // 5 minutes default
): boolean {
  const now = Date.now();

  for (const dispatch of recentDispatches) {
    // Same pattern within cooldown period
    if (dispatch.pattern === match.pattern.pattern) {
      const age = now - dispatch.timestamp.getTime();
      if (age < cooldownMs) {
        return true;
      }
    }
  }

  return false;
}
