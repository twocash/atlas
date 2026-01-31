/**
 * Atlas Telegram Bot - Tool Definitions
 *
 * All tools available to Claude for conversation handling.
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

/**
 * All available tools for Claude
 */
export const ALL_TOOLS: Anthropic.Tool[] = [
  ...CORE_TOOLS,
  ...AGENT_TOOLS,
  ...WORKSPACE_TOOLS,
  ...SELF_MOD_TOOLS,
  ...OPERATOR_TOOLS,
];

/**
 * Execute a tool call and return the result
 */
export async function executeTool(
  toolName: string,
  input: Record<string, unknown>
): Promise<{ success: boolean; result: unknown; error?: string }> {
  // Try each tool category
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
