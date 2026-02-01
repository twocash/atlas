/**
 * Atlas Telegram Bot - Tool Definitions
 *
 * All tools available to Claude for conversation handling.
 * Includes both native Atlas tools and dynamic MCP tools.
 */

export { CORE_TOOLS, executeCoreTools } from './core';
export { AGENT_TOOLS, executeAgentTools } from './agents';
export { WORKSPACE_TOOLS, executeWorkspaceTools } from './workspace';
export { SELF_MOD_TOOLS, executeSelfModTools } from './self-mod';
export { OPERATOR_TOOLS, executeOperatorTools } from './operator';

import type Anthropic from '@anthropic-ai/sdk';
import { CORE_TOOLS, executeCoreTools } from './core';
import { AGENT_TOOLS, executeAgentTools } from './agents';
import { WORKSPACE_TOOLS, executeWorkspaceTools } from './workspace';
import { SELF_MOD_TOOLS, executeSelfModTools } from './self-mod';
import { OPERATOR_TOOLS, executeOperatorTools } from './operator';
import { getMcpTools, isMcpTool, executeMcpTool } from '../../mcp';

/**
 * Native Atlas tools (static)
 */
const NATIVE_TOOLS: Anthropic.Tool[] = [
  ...CORE_TOOLS,
  ...AGENT_TOOLS,
  ...WORKSPACE_TOOLS,
  ...SELF_MOD_TOOLS,
  ...OPERATOR_TOOLS,
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
 */
export async function executeTool(
  toolName: string,
  input: Record<string, unknown>
): Promise<{ success: boolean; result: unknown; error?: string }> {
  // Check if this is an MCP tool (format: mcp__{serverId}__{toolName})
  if (isMcpTool(toolName)) {
    return await executeMcpTool(toolName, input);
  }

  // Try each native tool category
  const coreResult = await executeCoreTools(toolName, input);
  if (coreResult !== null) return coreResult;

  const agentResult = await executeAgentTools(toolName, input);
  if (agentResult !== null) return agentResult;

  const workspaceResult = await executeWorkspaceTools(toolName, input);
  if (workspaceResult !== null) return workspaceResult;

  const selfModResult = await executeSelfModTools(toolName, input);
  if (selfModResult !== null) return selfModResult;

  const operatorResult = await executeOperatorTools(toolName, input);
  if (operatorResult !== null) return operatorResult;

  return {
    success: false,
    result: null,
    error: `Unknown tool: ${toolName}`,
  };
}
