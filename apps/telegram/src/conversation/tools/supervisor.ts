/**
 * Atlas Telegram Bot - Supervisor Tools
 *
 * Tools for starting, monitoring, and controlling the Atlas Supervisor.
 * These tools allow Claude Code to manage the bot process remotely.
 */

import type Anthropic from '@anthropic-ai/sdk';
import {
  createSupervisor,
  getSupervisor,
  setSupervisor,
  resetSupervisor,
  type Supervisor,
  type SupervisorConfig,
  type SupervisorStatus,
} from '../../supervisor';
import { executeMcpTool } from '../../mcp';

// ==========================================
// Tool Definitions
// ==========================================

export const SUPERVISOR_START_TOOL: Anthropic.Tool = {
  name: 'supervisor_start',
  description: 'Start the Atlas Supervisor to monitor and manage the Telegram bot process. Supports production and dev modes.',
  input_schema: {
    type: 'object' as const,
    properties: {
      mode: {
        type: 'string',
        enum: ['production', 'dev'],
        description: 'Mode to run in. Production uses the main atlas repo, dev uses a specified worktree path.',
        default: 'production',
      },
      devPath: {
        type: 'string',
        description: 'Path to worktree (required if mode=dev). Example: C:\\github\\atlas-worktrees\\feature-branch\\apps\\telegram',
      },
      pitCrewEnabled: {
        type: 'boolean',
        description: 'Enable automatic dispatch to Pit Crew on errors (default: true)',
        default: true,
      },
      errorThreshold: {
        type: 'number',
        description: 'Number of consecutive errors before dispatching to Pit Crew (default: 3)',
        default: 3,
      },
    },
    required: [],
  },
};

export const SUPERVISOR_STOP_TOOL: Anthropic.Tool = {
  name: 'supervisor_stop',
  description: 'Stop the Atlas Supervisor and the bot process it manages.',
  input_schema: {
    type: 'object' as const,
    properties: {},
    required: [],
  },
};

export const SUPERVISOR_STATUS_TOOL: Anthropic.Tool = {
  name: 'supervisor_status',
  description: 'Get detailed status of the Atlas Supervisor including process health, error counts, telemetry, and pattern detection.',
  input_schema: {
    type: 'object' as const,
    properties: {
      includeHeartbeats: {
        type: 'boolean',
        description: 'Include recent heartbeat data for trend analysis',
        default: false,
      },
    },
    required: [],
  },
};

export const SUPERVISOR_RESTART_TOOL: Anthropic.Tool = {
  name: 'supervisor_restart',
  description: 'Restart the bot process managed by the supervisor.',
  input_schema: {
    type: 'object' as const,
    properties: {},
    required: [],
  },
};

export const SUPERVISOR_PATTERN_TOOL: Anthropic.Tool = {
  name: 'supervisor_pattern',
  description: 'Manage error detection patterns. View proposed patterns, approve or reject them.',
  input_schema: {
    type: 'object' as const,
    properties: {
      action: {
        type: 'string',
        enum: ['list_proposed', 'approve', 'reject', 'list_active'],
        description: 'Action to perform on patterns',
      },
      patternId: {
        type: 'string',
        description: 'Pattern ID (required for approve/reject actions)',
      },
    },
    required: ['action'],
  },
};

// All supervisor tools
export const SUPERVISOR_TOOLS: Anthropic.Tool[] = [
  SUPERVISOR_START_TOOL,
  SUPERVISOR_STOP_TOOL,
  SUPERVISOR_STATUS_TOOL,
  SUPERVISOR_RESTART_TOOL,
  SUPERVISOR_PATTERN_TOOL,
];

// ==========================================
// Tool Executors
// ==========================================

/**
 * Start the supervisor
 */
async function handleSupervisorStart(
  input: Record<string, unknown>
): Promise<{ success: boolean; result: unknown; error?: string }> {
  // Check if already running
  const existing = getSupervisor();
  if (existing && existing.isRunning()) {
    return {
      success: false,
      result: null,
      error: 'Supervisor is already running. Use supervisor_stop first if you want to restart with different settings.',
    };
  }

  const mode = (input.mode as string) || 'production';
  const devPath = input.devPath as string | undefined;
  const pitCrewEnabled = input.pitCrewEnabled !== false;  // Default true
  const errorThreshold = (input.errorThreshold as number) || 3;

  // Validate dev mode has path
  if (mode === 'dev' && !devPath) {
    return {
      success: false,
      result: null,
      error: 'devPath is required when mode=dev',
    };
  }

  const config: Partial<SupervisorConfig> = {
    mode: mode as 'production' | 'dev',
    devPath,
    pitCrewEnabled,
    errorThreshold,
  };

  try {
    const supervisor = createSupervisor(config);

    // Set MCP executor for Pit Crew integration
    supervisor.setMcpExecutor(executeMcpTool);

    // Start the supervisor
    const result = await supervisor.start();

    if (result.success) {
      setSupervisor(supervisor);

      return {
        success: true,
        result: {
          message: `Supervisor started in ${mode} mode`,
          pid: result.pid,
          config: {
            mode,
            sourcePath: mode === 'dev' ? devPath : 'C:\\github\\atlas\\apps\\telegram',
            pitCrewEnabled,
            errorThreshold,
          },
        },
      };
    } else {
      return {
        success: false,
        result: null,
        error: result.error,
      };
    }
  } catch (error) {
    return {
      success: false,
      result: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Stop the supervisor
 */
async function handleSupervisorStop(
  _input: Record<string, unknown>
): Promise<{ success: boolean; result: unknown; error?: string }> {
  const supervisor = getSupervisor();

  if (!supervisor) {
    return {
      success: true,
      result: { message: 'No supervisor running' },
    };
  }

  try {
    const result = await supervisor.stop();
    resetSupervisor();

    return {
      success: result.success,
      result: { message: 'Supervisor stopped' },
      error: result.error,
    };
  } catch (error) {
    return {
      success: false,
      result: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Get supervisor status
 */
async function handleSupervisorStatus(
  input: Record<string, unknown>
): Promise<{ success: boolean; result: unknown; error?: string }> {
  const supervisor = getSupervisor();

  if (!supervisor) {
    return {
      success: true,
      result: {
        status: 'not_running',
        message: 'Supervisor is not running. Use supervisor_start to start it.',
      },
    };
  }

  try {
    const status = await supervisor.getStatus();
    const logStats = supervisor.getLogStats();

    const result: Record<string, unknown> = {
      status: status.status,
      uptime: status.uptime ? formatUptime(status.uptime) : null,
      processId: status.processId,
      errors: {
        count: status.errorCount,
        consecutive: status.consecutiveErrors,
        last: status.lastError,
        lastTime: status.lastErrorTime?.toISOString(),
      },
      restarts: status.restartCount,
      dispatchedBugs: status.dispatchedBugs,
      config: status.config,
      telemetry: {
        localHeartbeats: status.telemetry.localHeartbeatCount,
        feedPromotions: status.telemetry.feedPromotionCount,
        lastSnapshot: status.telemetry.lastSnapshot ? {
          memory: `${status.telemetry.lastSnapshot.memoryUsageMb} MB`,
          requests: status.telemetry.lastSnapshot.requestCount,
          errorRate: `${status.telemetry.lastSnapshot.errorRate.toFixed(1)}%`,
          p50Latency: `${status.telemetry.lastSnapshot.p50Latency}ms`,
          p95Latency: `${status.telemetry.lastSnapshot.p95Latency}ms`,
        } : null,
      },
      patterns: {
        active: status.patterns.activeCount,
        proposed: status.patterns.proposedCount,
        recentMatches: status.patterns.recentMatches.length,
      },
      logStats: {
        totalLines: logStats.totalLines,
        errors: logStats.errorCount,
        warnings: logStats.warnCount,
        requests: logStats.requestCount,
        errorRate: `${logStats.errorRate.toFixed(1)}%`,
        p50Latency: `${logStats.p50Latency}ms`,
        p95Latency: `${logStats.p95Latency}ms`,
      },
    };

    // Include heartbeats if requested
    if (input.includeHeartbeats) {
      const heartbeats = await supervisor.getRecentHeartbeats(3);
      result.recentHeartbeats = heartbeats.map(h => ({
        timestamp: h.timestamp.toISOString(),
        memory: h.memoryUsageMb,
        errorRate: h.errorRate.toFixed(1),
        p95Latency: h.p95Latency,
      }));
    }

    return {
      success: true,
      result,
    };
  } catch (error) {
    return {
      success: false,
      result: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Restart the bot process
 */
async function handleSupervisorRestart(
  _input: Record<string, unknown>
): Promise<{ success: boolean; result: unknown; error?: string }> {
  const supervisor = getSupervisor();

  if (!supervisor) {
    return {
      success: false,
      result: null,
      error: 'Supervisor is not running. Use supervisor_start first.',
    };
  }

  try {
    const result = await supervisor.restart();

    return {
      success: result.success,
      result: {
        message: result.success ? 'Bot restarted' : 'Restart failed',
        pid: result.pid,
      },
      error: result.error,
    };
  } catch (error) {
    return {
      success: false,
      result: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Manage error patterns
 */
async function handleSupervisorPattern(
  input: Record<string, unknown>
): Promise<{ success: boolean; result: unknown; error?: string }> {
  const supervisor = getSupervisor();

  if (!supervisor) {
    return {
      success: false,
      result: null,
      error: 'Supervisor is not running. Use supervisor_start first.',
    };
  }

  const action = input.action as string;
  const patternId = input.patternId as string | undefined;
  const registry = supervisor.getPatternRegistry();

  try {
    switch (action) {
      case 'list_proposed': {
        const proposed = await registry.getProposalsReadyForApproval();
        return {
          success: true,
          result: {
            count: proposed.length,
            patterns: proposed.map(p => ({
              id: p.id,
              pattern: p.pattern,
              severity: p.severity,
              description: p.description,
              occurrences: p.occurrenceCount,
              firstSeen: p.firstSeen.toISOString(),
              lastSeen: p.lastSeen.toISOString(),
              contexts: p.contexts.slice(0, 2),
            })),
          },
        };
      }

      case 'list_active': {
        const active = await registry.getActivePatterns();
        return {
          success: true,
          result: {
            count: active.length,
            patterns: active.map(p => ({
              id: p.id,
              pattern: p.pattern,
              severity: p.severity,
              action: p.action,
              description: p.description,
              isBootstrap: p.id.startsWith('bootstrap-'),
            })),
          },
        };
      }

      case 'approve': {
        if (!patternId) {
          return { success: false, result: null, error: 'patternId is required for approve action' };
        }
        await registry.approvePattern(patternId);
        return {
          success: true,
          result: { message: `Pattern ${patternId} approved and added to active detection` },
        };
      }

      case 'reject': {
        if (!patternId) {
          return { success: false, result: null, error: 'patternId is required for reject action' };
        }
        await registry.rejectPattern(patternId);
        return {
          success: true,
          result: { message: `Pattern ${patternId} rejected and removed from proposals` },
        };
      }

      default:
        return {
          success: false,
          result: null,
          error: `Unknown action: ${action}`,
        };
    }
  } catch (error) {
    return {
      success: false,
      result: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// ==========================================
// Main Executor
// ==========================================

/**
 * Execute supervisor tools
 */
export async function executeSupervisorTools(
  toolName: string,
  input: Record<string, unknown>
): Promise<{ success: boolean; result: unknown; error?: string } | null> {
  switch (toolName) {
    case 'supervisor_start':
      return handleSupervisorStart(input);
    case 'supervisor_stop':
      return handleSupervisorStop(input);
    case 'supervisor_status':
      return handleSupervisorStatus(input);
    case 'supervisor_restart':
      return handleSupervisorRestart(input);
    case 'supervisor_pattern':
      return handleSupervisorPattern(input);
    default:
      return null;  // Not a supervisor tool
  }
}

// ==========================================
// Helpers
// ==========================================

function formatUptime(ms: number): string {
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
