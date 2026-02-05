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

import type Anthropic from '@anthropic-ai/sdk';
import { CORE_TOOLS, executeCoreTools } from './core';
import { DISPATCHER_TOOLS, executeDispatcherTools } from './dispatcher';
import { AGENT_TOOLS, executeAgentTools } from './agents';
import { WORKSPACE_TOOLS, executeWorkspaceTools } from './workspace';
import { SELF_MOD_TOOLS, executeSelfModTools } from './self-mod';
import { OPERATOR_TOOLS, executeOperatorTools } from './operator';
import { BROWSER_TOOLS, executeBrowserTools } from './browser';
import { SUPERVISOR_TOOLS, executeSupervisorTools } from './supervisor';
import { getMcpTools, isMcpTool, executeMcpTool } from '../../mcp';

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
 * 7. AGENT_TOOLS - Legacy dispatch (deprecated)
 */
const NATIVE_TOOLS: Anthropic.Tool[] = [
  ...DISPATCHER_TOOLS,  // PRIMARY: submit_ticket
  ...CORE_TOOLS,
  ...WORKSPACE_TOOLS,
  ...SELF_MOD_TOOLS,
  ...OPERATOR_TOOLS,
  ...BROWSER_TOOLS,     // Playwright-based browser automation
  ...SUPERVISOR_TOOLS,  // Process management
  ...AGENT_TOOLS,       // DEPRECATED: dispatch_research, etc.
];

/**
 * All available tools for Claude (native + MCP)
 * MCP tools are fetched dynamically from connected servers
 */
export function getAllTools(): Anthropic.Tool[] {
  const mcpTools = getMcpTools();
  console.error(`[Tools] Native: ${NATIVE_TOOLS.length}, MCP: ${mcpTools.length}`);
  if (mcpTools.length > 0) {
    console.error(`[Tools] MCP tools available: ${mcpTools.map(t => t.name).join(', ')}`);
  }
  return [...NATIVE_TOOLS, ...mcpTools];
}

/**
 * Legacy export for backward compatibility
 * @deprecated Use getAllTools() for dynamic MCP tool inclusion
 */
export const ALL_TOOLS: Anthropic.Tool[] = NATIVE_TOOLS;

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
  input: Record<string, unknown>
): Promise<{ success: boolean; result: unknown; error?: string; needsChoice?: boolean }> {
  // Check if this is an MCP tool (format: mcp__{serverId}__{toolName})
  if (isMcpTool(toolName)) {
    return await executeMcpTool(toolName, input);
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

  // Legacy agent tools (deprecated but still functional)
  const agentResult = await executeAgentTools(toolName, input);
  if (agentResult !== null) return agentResult;

  return {
    success: false,
    result: null,
    error: `Unknown tool: ${toolName}`,
  };
}
