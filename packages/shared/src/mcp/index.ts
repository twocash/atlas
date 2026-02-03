/**
 * MCP Client Manager - Package Exports
 *
 * Provides Atlas with the ability to connect to any MCP-compatible tool server.
 */

export { McpHub } from './manager.js';
export type {
  McpServerConfig,
  McpHubConfig,
  McpServerStatus,
  ClaudeTool,
  McpHubEvents,
} from './types.js';
