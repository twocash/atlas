/**
 * Atlas Telegram Bot - Tool Definitions
 *
 * All tools available to Claude for conversation handling.
 * Includes both native Atlas tools and dynamic MCP tools.
 *
 * NEURO-LINK SPRINT: submit_ticket is now the PRIMARY way to dispatch async work.
 * Legacy tools (dispatch_research, work_queue_create) are deprecated but still
 * available for backwards compatibility.
 */

// Core tools (Notion search, status, broader access)
export { CORE_TOOLS, executeCoreTools } from './core';

// Dispatcher (PRIMARY - Neuro-Link Sprint)
export { DISPATCHER_TOOLS, executeDispatcherTools } from './dispatcher';

// Legacy agent tools (DEPRECATED - use submit_ticket instead)
export { AGENT_TOOLS, executeAgentTools } from './agents';

// Other tool categories
export { WORKSPACE_TOOLS, executeWorkspaceTools } from './workspace';
export { SELF_MOD_TOOLS, executeSelfModTools } from './self-mod';
export { OPERATOR_TOOLS, executeOperatorTools } from './operator';

// Browser automation (Playwright-based)
export { BROWSER_TOOLS, executeBrowserTools, closeBrowser } from './browser';

// Supervisor tools (process management)
export { SUPERVISOR_TOOLS, executeSupervisorTools } from './supervisor';

// Per-file hooks setters (re-exported for app-layer wiring)
export { setToolCoreHooks, type ToolCoreHooks } from './core';
export { setOperatorHooks, type OperatorHooks } from './operator';
export { setSupervisorHooks, type SupervisorHooks } from './supervisor';
export { setWorkspaceHooks, type WorkspaceHooks } from './workspace';

import type Anthropic from '@anthropic-ai/sdk';
import { CORE_TOOLS, executeCoreTools } from './core';
import { DISPATCHER_TOOLS, executeDispatcherTools } from './dispatcher';
import { AGENT_TOOLS, executeAgentTools } from './agents';
import { WORKSPACE_TOOLS, executeWorkspaceTools } from './workspace';
import { SELF_MOD_TOOLS, executeSelfModTools } from './self-mod';
import { OPERATOR_TOOLS, executeOperatorTools } from './operator';
import { BROWSER_TOOLS, executeBrowserTools } from './browser';
import { SUPERVISOR_TOOLS, executeSupervisorTools } from './supervisor';
import { getToolHooks } from './hooks';

// Re-export hooks API so app layer can import from tools/index
export { setToolHooks, getToolHooks, type ToolHooks } from './hooks';

/**
 * Native Atlas tools (static)
 *
 * Order matters for tool selection guidance:
 * 1. DISPATCHER_TOOLS - Primary async dispatch (submit_ticket)
 * 2. CORE_TOOLS - Notion operations, status
 * 3. WORKSPACE_TOOLS - File operations
 * 4. SELF_MOD_TOOLS - Memory/soul updates
 * 5. OPERATOR_TOOLS - Scripts, scheduling
 * 6. SUPERVISOR_TOOLS - Process management
 * 7. AGENT_TOOLS - Agent dispatch (research, transcription, draft)
 */
const NATIVE_TOOLS: Anthropic.Tool[] = [
  ...DISPATCHER_TOOLS,  // PRIMARY: submit_ticket
  ...CORE_TOOLS,
  ...WORKSPACE_TOOLS,
  ...SELF_MOD_TOOLS,
  ...OPERATOR_TOOLS,
  ...BROWSER_TOOLS,     // Playwright-based browser automation
  ...SUPERVISOR_TOOLS,  // Process management
  ...AGENT_TOOLS,       // Research, transcription, draft dispatch
];

/** Rough token estimate: ~4 chars per token for JSON schemas */
function estimateToolTokens(tools: Anthropic.Tool[]): number {
  const json = JSON.stringify(tools);
  return Math.ceil(json.length / 4);
}

/**
 * All available tools for Claude (native + MCP)
 * MCP tools are fetched dynamically from connected servers
 */
export function getAllTools(): Anthropic.Tool[] {
  const mcpTools = getToolHooks().getMcpTools();
  const allTools = [...NATIVE_TOOLS, ...mcpTools];

  const nativeTokens = estimateToolTokens(NATIVE_TOOLS);
  const mcpTokens = estimateToolTokens(mcpTools);
  const totalTokens = nativeTokens + mcpTokens;

  console.error(`[Tools] Native: ${NATIVE_TOOLS.length} (~${nativeTokens} tokens), MCP: ${mcpTools.length} (~${mcpTokens} tokens), Total: ${allTools.length} (~${totalTokens} tokens)`);
  if (mcpTools.length > 0) {
    console.error(`[Tools] MCP tools: ${mcpTools.map((t: any) => t.name).join(', ')}`);
  }
  return allTools;
}

/**
 * Get tool definition token cost breakdown.
 * Useful for monitoring context budget consumption per API call.
 */
export function getToolTokenCost(): { native: number; mcp: number; total: number; toolCount: number } {
  const mcpTools = getToolHooks().getMcpTools();
  const native = estimateToolTokens(NATIVE_TOOLS);
  const mcp = estimateToolTokens(mcpTools);
  return { native, mcp, total: native + mcp, toolCount: NATIVE_TOOLS.length + mcpTools.length };
}

/**
 * Legacy export for backward compatibility
 * @deprecated Use getAllTools() for dynamic MCP tool inclusion
 */
export const ALL_TOOLS: Anthropic.Tool[] = NATIVE_TOOLS;

/** Execution context threaded to tool handlers that need session state */
export interface ToolExecutionContext {
  /** Chat/session ID — maps to conversation state for context composition */
  sessionId?: number;
}

/**
 * Execute a tool call and return the result
 * Handles both native Atlas tools and MCP tools
 *
 * NEURO-LINK SPRINT: Dispatcher tools (submit_ticket) are checked FIRST
 *
 * Note: `needsChoice` is returned by submit_ticket when routing confidence < 85%
 */
export async function executeTool(
  toolName: string,
  input: Record<string, unknown>,
  context?: ToolExecutionContext,
): Promise<{ success: boolean; result: unknown; error?: string; needsChoice?: boolean }> {
  // Check if this is an MCP tool (format: mcp__{serverId}__{toolName})
  if (getToolHooks().isMcpTool(toolName)) {
    return await getToolHooks().executeMcpTool(toolName, input);
  }

  // Try dispatcher tools FIRST (submit_ticket is primary)
  const dispatcherResult = await executeDispatcherTools(toolName, input);
  if (dispatcherResult !== null) return dispatcherResult;

  // Try each native tool category
  const coreResult = await executeCoreTools(toolName, input);
  if (coreResult !== null) return coreResult;

  const workspaceResult = await executeWorkspaceTools(toolName, input);
  if (workspaceResult !== null) return workspaceResult;

  const selfModResult = await executeSelfModTools(toolName, input);
  if (selfModResult !== null) return selfModResult;

  const operatorResult = await executeOperatorTools(toolName, input);
  if (operatorResult !== null) return operatorResult;

  // Browser automation tools (Playwright-based)
  const browserResult = await executeBrowserTools(toolName, input);
  if (browserResult !== null) return browserResult;

  // Supervisor tools (process management)
  const supervisorResult = await executeSupervisorTools(toolName, input);
  if (supervisorResult !== null) return supervisorResult;

  // Agent dispatch tools (research, transcription, draft)
  const agentResult = await executeAgentTools(toolName, input, context);
  if (agentResult !== null) return agentResult;

  return {
    success: false,
    result: null,
    error: `Unknown tool: ${toolName}`,
  };
}
