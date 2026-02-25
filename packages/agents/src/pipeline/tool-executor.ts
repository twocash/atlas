/**
 * OrchestratorToolExecutor — Bidirectional Tool Routing Seam
 *
 * The single point where execution backends invoke tools.
 * Routes each tool request to the correct handler:
 *
 *   desk tools  → system-level handlers (Notion MCP, filesystem, research, etc.)
 *   device tools → surface.executeDeviceTool() (physical actions on Jim's device)
 *
 * Backends (Claude API, Claude Code, local model) call execute().
 * They don't know — and don't need to know — where tools live.
 *
 * 10-Step Tool Execution Flow (from contract):
 *   1. Backend calls toolExecutor.execute(request)
 *   2. Executor classifies: desk or device?
 *   3a. Desk → deskToolHandlers.get(name).execute(request) → result
 *   3b. Device → surface.executeDeviceTool(request) → result
 *   4. Result flows back to backend → continues generation
 *
 * Sprint: ARCH-CPE-001 Phase 6 — Unified Cognitive Architecture
 */

import { logger } from '../logger';
import type { ToolDefinition, ToolRequest, ToolResult, AtlasSurface } from './surface';
import type { DeskToolHandler } from './system';

// ─── Tool Executor Interface ─────────────────────────────

export interface OrchestratorToolExecutorConfig {
  /** System-level desk tool handlers (always available) */
  deskToolHandlers: Map<string, DeskToolHandler>;
  /** Available tool definitions (desk + device, merged) */
  availableTools: ToolDefinition[];
  /** Surface for device tool execution (optional — no surface = desk-only) */
  surface?: AtlasSurface;
}

// ─── Implementation ──────────────────────────────────────

export class OrchestratorToolExecutor {
  private readonly deskToolHandlers: Map<string, DeskToolHandler>;
  private readonly toolIndex: Map<string, ToolDefinition>;
  private readonly surface?: AtlasSurface;

  constructor(config: OrchestratorToolExecutorConfig) {
    this.deskToolHandlers = config.deskToolHandlers;
    this.surface = config.surface;

    // Build lookup index for O(1) classification
    this.toolIndex = new Map();
    for (const tool of config.availableTools) {
      this.toolIndex.set(tool.name, tool);
    }

    logger.debug('OrchestratorToolExecutor initialized', {
      deskTools: [...this.deskToolHandlers.keys()].length,
      totalTools: this.toolIndex.size,
      hasSurface: !!this.surface,
    });
  }

  /**
   * Execute a tool request — routes to desk or device handler.
   *
   * This is the method execution backends call. They pass a ToolRequest
   * and get back a ToolResult. The backend never needs to know whether
   * the tool is system-level or surface-specific.
   */
  async execute(request: ToolRequest): Promise<ToolResult> {
    const definition = this.toolIndex.get(request.name);

    if (!definition) {
      logger.warn('Tool not found in executor', { tool: request.name });
      return {
        id: request.id,
        content: `Tool not found: ${request.name}`,
        isError: true,
      };
    }

    const startMs = Date.now();

    try {
      const result = definition.classification === 'device'
        ? await this.executeDeviceTool(request)
        : await this.executeDeskTool(request);

      const durationMs = Date.now() - startMs;
      logger.info('Tool executed', {
        tool: request.name,
        classification: definition.classification,
        isError: result.isError,
        durationMs,
      });

      return result;
    } catch (error) {
      const durationMs = Date.now() - startMs;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Tool execution failed', {
        tool: request.name,
        classification: definition.classification,
        error: errorMessage,
        durationMs,
      });

      return {
        id: request.id,
        content: `Tool execution failed: ${errorMessage}`,
        isError: true,
      };
    }
  }

  // ─── Internal Routing ───────────────────────────────

  private async executeDeskTool(request: ToolRequest): Promise<ToolResult> {
    const handler = this.deskToolHandlers.get(request.name);

    if (!handler) {
      logger.warn('No desk tool handler registered', { tool: request.name });
      return {
        id: request.id,
        content: `No handler for desk tool: ${request.name}`,
        isError: true,
      };
    }

    return handler.execute(request);
  }

  private async executeDeviceTool(request: ToolRequest): Promise<ToolResult> {
    if (!this.surface) {
      logger.warn('Device tool requested but no surface available', { tool: request.name });
      return {
        id: request.id,
        content: `Device tool "${request.name}" requires a surface, but none is connected.`,
        isError: true,
      };
    }

    return this.surface.executeDeviceTool(request);
  }
}

// ─── Legacy Bridge ──────────────────────────────────────
//
// Wraps the existing getAllTools/executeTool system as a
// DeskToolHandler, allowing the current tool implementations
// to work through the new executor without modification.
//
// This is the strangler fig: the LegacyToolBridge lets Phase 6
// use Phase 5's tool system unchanged. Individual tools migrate
// to proper DeskToolHandler implementations over time.

export interface LegacyToolSystem {
  /** Get all available Anthropic-format tool definitions */
  getAllTools(): Array<{ name: string; description: string; input_schema: Record<string, unknown> }>;
  /** Execute a tool by name */
  executeTool(name: string, input: Record<string, unknown>): Promise<{
    success: boolean;
    result: unknown;
    error?: string;
    needsChoice?: boolean;
  }>;
}

/**
 * Bridge from legacy tool system to Phase 6 DeskToolHandler.
 *
 * Usage during migration:
 *   const bridge = new LegacyToolBridge(legacyToolSystem);
 *   const handlers = bridge.createHandlers();
 *   // handlers is a Map<string, DeskToolHandler> — plug into SystemCapabilities
 */
export class LegacyToolBridge {
  private readonly legacy: LegacyToolSystem;

  constructor(legacy: LegacyToolSystem) {
    this.legacy = legacy;
  }

  /** Create DeskToolHandler entries for all legacy tools */
  createHandlers(): Map<string, DeskToolHandler> {
    const handlers = new Map<string, DeskToolHandler>();
    const tools = this.legacy.getAllTools();

    for (const tool of tools) {
      handlers.set(tool.name, {
        execute: async (request: ToolRequest): Promise<ToolResult> => {
          const legacyResult = await this.legacy.executeTool(request.name, request.input);
          return {
            id: request.id,
            content: legacyResult.success
              ? JSON.stringify(legacyResult.result)
              : `Error: ${legacyResult.error || 'Unknown error'}`,
            isError: !legacyResult.success,
          };
        },
      });
    }

    logger.info('LegacyToolBridge created handlers', { count: handlers.size });
    return handlers;
  }

  /** Convert legacy Anthropic.Tool[] to Phase 6 ToolDefinition[] */
  createToolDefinitions(): ToolDefinition[] {
    return this.legacy.getAllTools().map(tool => ({
      name: tool.name,
      description: tool.description,
      schema: tool.input_schema,
      classification: 'desk' as const,
    }));
  }
}

// ─── Utility: Merge desk + device tools ─────────────────

/**
 * Merge system desk tools with surface device tools.
 *
 * The router calls this to build the complete tool set for
 * an execution strategy. Desk tools are always present;
 * device tools come from the surface (if any).
 */
export function mergeTools(
  deskTools: ToolDefinition[],
  surface?: AtlasSurface,
): ToolDefinition[] {
  const deviceTools = surface?.getDeviceTools() ?? [];

  if (deviceTools.length === 0) return deskTools;

  // Check for name collisions (desk wins — system-level takes priority)
  const deskNames = new Set(deskTools.map(t => t.name));
  const filtered = deviceTools.filter(dt => {
    if (deskNames.has(dt.name)) {
      logger.warn('Device tool name collides with desk tool, desk wins', { name: dt.name });
      return false;
    }
    return true;
  });

  return [...deskTools, ...filtered];
}
