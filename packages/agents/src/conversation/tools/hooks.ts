/**
 * Atlas Agent Tools - Shared MCP Hooks
 *
 * Extracted to avoid circular imports between index.ts and sibling tool files
 * (dispatcher, operator, supervisor) that all need MCP functions.
 *
 * Pattern: injectable hooks with safe no-op defaults, following setExecutorHooks
 * from packages/agents/src/skills/executor.ts.
 */

// ---- Shared tool hooks (injected by app layer, no-op defaults) ----
// Covers all MCP functions used across tools files (index, dispatcher, operator, supervisor)

export interface ToolHooks {
  getMcpTools: () => any[];
  isMcpTool: (name: string) => boolean;
  executeMcpTool: (name: string, input: Record<string, unknown>) => Promise<{ success: boolean; result: any; error?: string }>;
  getMcpStatus: () => Record<string, any>;
  restartMcp: () => Promise<any>;
  listMcpTools: () => any[];
}

let _toolHooks: ToolHooks = {
  getMcpTools: () => [],
  isMcpTool: () => false,
  executeMcpTool: async () => ({ success: false, result: null, error: 'MCP hooks not initialized' }),
  getMcpStatus: () => ({}),
  restartMcp: async () => ({ servers: [], toolCount: 0 }),
  listMcpTools: () => [],
};

/**
 * Inject app-layer MCP hooks. Called once during app startup.
 */
export function setToolHooks(hooks: Partial<ToolHooks>) {
  if (hooks.getMcpTools) _toolHooks.getMcpTools = hooks.getMcpTools;
  if (hooks.isMcpTool) _toolHooks.isMcpTool = hooks.isMcpTool;
  if (hooks.executeMcpTool) _toolHooks.executeMcpTool = hooks.executeMcpTool;
  if (hooks.getMcpStatus) _toolHooks.getMcpStatus = hooks.getMcpStatus;
  if (hooks.restartMcp) _toolHooks.restartMcp = hooks.restartMcp;
  if (hooks.listMcpTools) _toolHooks.listMcpTools = hooks.listMcpTools;
}

/** Access the current hooks (for sibling tool files) */
export function getToolHooks(): ToolHooks {
  return _toolHooks;
}
