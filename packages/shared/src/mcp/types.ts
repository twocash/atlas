/**
 * packages/shared/src/mcp/types.ts
 *
 * TypeScript interfaces for MCP client configuration and state.
 */

/**
 * Configuration for a single MCP server.
 */
export interface McpServerConfig {
  /** Executable command (node, npx, python, etc.) */
  command: string;

  /** Command arguments */
  args: string[];

  /** Environment variables to pass to the server */
  env?: Record<string, string>;

  /** Working directory for the server process */
  cwd?: string;

  /** Whether this server is disabled (won't connect on startup) */
  disabled?: boolean;

  /** Tool call timeout in milliseconds (default: 60000) */
  timeout?: number;

  /** Delay before reconnect attempt in milliseconds (default: 5000) */
  reconnectDelay?: number;

  /** Maximum reconnect attempts before giving up (default: 3) */
  maxReconnectAttempts?: number;
}

/**
 * Configuration for the MCP hub.
 */
export interface McpHubConfig {
  /** Map of server ID to server configuration */
  servers: Record<string, McpServerConfig>;
}

/**
 * Connection status for an MCP server.
 */
export type McpServerStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

/**
 * Status information for a server.
 */
export interface McpServerStatusInfo {
  status: McpServerStatus;
  toolCount: number;
  error?: string;
}

/**
 * Tool definition in Claude/Anthropic format.
 */
export interface ClaudeTool {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/**
 * Events emitted by McpHub.
 */
export interface McpHubEvents {
  connected: { serverId: string; toolCount: number };
  disconnected: { serverId: string; error: Error };
  gaveUp: { serverId: string; attempts: number };
  toolsRefreshed: { serverId: string; toolCount: number };
}
