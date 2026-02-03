/**
 * packages/shared/src/mcp/manager.ts
 * 
 * Bulletproof MCP Client Manager
 * 
 * DESIGN PRINCIPLES:
 * 1. Stdio Isolation - stderr for logs, stdout strictly for JSON-RPC
 * 2. Tool Caching - Fetch once on connect, not every turn (saves 200-500ms/turn)
 * 3. Auto-Reconnect - Servers crash; we restart them automatically
 * 4. Timeouts - Every call has a strict timeout to prevent hangs
 * 5. Namespacing - Tools prefixed with server ID to avoid collisions
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { EventEmitter } from "events";

// === TYPES ===

export interface McpServerConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
  cwd?: string;
  disabled?: boolean;
  timeout?: number; // Tool call timeout in ms (default: 60000)
  reconnectDelay?: number; // Delay before reconnect attempt (default: 5000)
  maxReconnectAttempts?: number; // Max reconnect attempts (default: 3)
}

export interface McpHubConfig {
  servers: Record<string, McpServerConfig>;
}

interface ServerState {
  client: Client | null;
  transport: StdioClientTransport | null;
  tools: Tool[];
  status: 'disconnected' | 'connecting' | 'connected' | 'error';
  reconnectAttempts: number;
  lastError?: Error;
}

// === MAIN CLASS ===

export class McpHub extends EventEmitter {
  private configs: Map<string, McpServerConfig> = new Map();
  private states: Map<string, ServerState> = new Map();
  
  constructor(config: McpHubConfig) {
    super();
    
    for (const [id, serverConfig] of Object.entries(config.servers)) {
      if (!serverConfig.disabled) {
        this.configs.set(id, {
          timeout: 60000,
          reconnectDelay: 5000,
          maxReconnectAttempts: 3,
          ...serverConfig
        });
        this.states.set(id, {
          client: null,
          transport: null,
          tools: [],
          status: 'disconnected',
          reconnectAttempts: 0
        });
      }
    }
  }

  // === CONNECTION MANAGEMENT ===

  /**
   * Connect to all configured servers.
   * Non-blocking - failures don't prevent other servers from connecting.
   */
  async connectAll(): Promise<void> {
    const promises = Array.from(this.configs.keys()).map(id => 
      this.connectServer(id).catch(err => {
        // Log but don't throw - other servers should still connect
        console.error(`[MCP] Failed to connect to ${id}:`, err.message);
      })
    );
    await Promise.allSettled(promises);
  }

  /**
   * Connect to a specific server by ID.
   */
  async connectServer(id: string): Promise<void> {
    const config = this.configs.get(id);
    const state = this.states.get(id);
    
    if (!config || !state) {
      throw new Error(`Unknown MCP server: ${id}`);
    }

    // Clean up existing connection if any
    await this.disconnectServer(id);
    
    state.status = 'connecting';
    console.error(`[MCP] Connecting to ${id}...`);

    try {
      const transport = new StdioClientTransport({
        command: config.command,
        args: config.args,
        env: { ...process.env, ...config.env },
        cwd: config.cwd
      });

      const client = new Client(
        { name: "Atlas", version: "2.0.0" },
        { capabilities: { tools: {} } }
      );

      // Handle transport errors
      transport.onerror = (err) => {
        console.error(`[MCP] ${id} transport error:`, err);
        this.handleDisconnect(id, err as Error);
      };

      // Handle transport close
      transport.onclose = () => {
        console.error(`[MCP] ${id} transport closed`);
        this.handleDisconnect(id, new Error('Transport closed'));
      };

      await client.connect(transport);
      
      // Prime the tool cache immediately
      const result = await client.listTools();
      
      state.client = client;
      state.transport = transport;
      state.tools = result.tools;
      state.status = 'connected';
      state.reconnectAttempts = 0;
      state.lastError = undefined;

      console.error(`[MCP] Connected to ${id} (${result.tools.length} tools)`);
      this.emit('connected', { serverId: id, toolCount: result.tools.length });

    } catch (error) {
      state.status = 'error';
      state.lastError = error as Error;
      throw error;
    }
  }

  /**
   * Disconnect from a specific server.
   */
  async disconnectServer(id: string): Promise<void> {
    const state = this.states.get(id);
    if (!state) return;

    if (state.transport) {
      try {
        await state.transport.close();
      } catch {
        // Ignore close errors
      }
    }

    state.client = null;
    state.transport = null;
    state.tools = [];
    state.status = 'disconnected';
  }

  /**
   * Disconnect from all servers.
   */
  async disconnectAll(): Promise<void> {
    const promises = Array.from(this.states.keys()).map(id => 
      this.disconnectServer(id)
    );
    await Promise.allSettled(promises);
  }

  /**
   * Handle unexpected disconnection with auto-reconnect.
   */
  private handleDisconnect(id: string, error: Error): void {
    const config = this.configs.get(id);
    const state = this.states.get(id);
    
    if (!config || !state) return;

    state.client = null;
    state.transport = null;
    state.tools = [];
    state.status = 'error';
    state.lastError = error;
    state.reconnectAttempts++;

    this.emit('disconnected', { serverId: id, error });

    // Auto-reconnect if under max attempts
    if (state.reconnectAttempts <= (config.maxReconnectAttempts || 3)) {
      const delay = config.reconnectDelay || 5000;
      console.error(`[MCP] ${id} disconnected. Reconnect attempt ${state.reconnectAttempts} in ${delay}ms...`);
      
      setTimeout(() => {
        this.connectServer(id).catch(err => {
          console.error(`[MCP] ${id} reconnect failed:`, err.message);
        });
      }, delay);
    } else {
      console.error(`[MCP] ${id} max reconnect attempts (${config.maxReconnectAttempts}) reached. Giving up.`);
      this.emit('gaveUp', { serverId: id, attempts: state.reconnectAttempts });
    }
  }

  // === TOOL ACCESS ===

  /**
   * Get all available tools from all connected servers.
   * Returns from cache - instant, no network calls.
   * Tools are namespaced as: {serverId}__{toolName}
   */
  getTools(): any[] {
    const allTools: any[] = [];
    
    for (const [serverId, state] of this.states.entries()) {
      if (state.status !== 'connected') continue;
      
      const namespaced = state.tools.map(tool => ({
        name: `${serverId}__${tool.name}`,
        description: `[MCP: ${serverId}] ${tool.description || ''}`,
        input_schema: tool.inputSchema
      }));
      allTools.push(...namespaced);
    }
    
    return allTools;
  }

  /**
   * Get tools from a specific server.
   */
  getServerTools(serverId: string): Tool[] {
    const state = this.states.get(serverId);
    return state?.tools || [];
  }

  /**
   * Call a tool by its namespaced name.
   * Format: {serverId}__{toolName}
   */
  async callTool(namespacedName: string, args: Record<string, unknown>): Promise<any> {
    const [serverId, ...rest] = namespacedName.split('__');
    const toolName = rest.join('__'); // Handle tool names with underscores
    
    const config = this.configs.get(serverId);
    const state = this.states.get(serverId);
    
    if (!state || !state.client) {
      throw new Error(`MCP Server '${serverId}' is not connected`);
    }

    const timeout = config?.timeout || 60000;

    // Race the tool call against a timeout
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`MCP tool timeout after ${timeout}ms: ${namespacedName}`));
      }, timeout);
    });

    const callPromise = state.client.callTool({
      name: toolName,
      arguments: args
    });

    const result = await Promise.race([callPromise, timeoutPromise]);
    return result;
  }

  // === STATUS ===

  /**
   * Get status of all servers.
   */
  getStatus(): Record<string, { status: string; toolCount: number; error?: string }> {
    const status: Record<string, any> = {};
    
    for (const [id, state] of this.states.entries()) {
      status[id] = {
        status: state.status,
        toolCount: state.tools.length,
        error: state.lastError?.message
      };
    }
    
    return status;
  }

  /**
   * Check if a specific server is connected.
   */
  isConnected(serverId: string): boolean {
    const state = this.states.get(serverId);
    return state?.status === 'connected';
  }

  /**
   * Refresh tools from a specific server (re-fetch tool list).
   */
  async refreshServerTools(serverId: string): Promise<void> {
    const state = this.states.get(serverId);
    
    if (!state || !state.client) {
      throw new Error(`MCP Server '${serverId}' is not connected`);
    }

    const result = await state.client.listTools();
    state.tools = result.tools;
    
    console.error(`[MCP] Refreshed ${serverId} tools (${result.tools.length})`);
    this.emit('toolsRefreshed', { serverId, toolCount: result.tools.length });
  }

  /**
   * Refresh tools from all connected servers.
   */
  async refreshAllTools(): Promise<void> {
    const promises = Array.from(this.states.entries())
      .filter(([_, state]) => state.status === 'connected')
      .map(([id]) => this.refreshServerTools(id).catch(err => {
        console.error(`[MCP] Failed to refresh ${id}:`, err.message);
      }));
    
    await Promise.allSettled(promises);
  }
}

// === CONFIG LOADER ===

import { readFile } from 'fs/promises';
import { parse } from 'yaml';

/**
 * Load MCP configuration from a YAML file.
 * Supports environment variable substitution: ${VAR_NAME}
 */
export async function loadMcpConfig(configPath: string): Promise<McpHubConfig> {
  const content = await readFile(configPath, 'utf-8');
  let config = parse(content) as McpHubConfig;
  
  // Substitute environment variables in the config
  config = JSON.parse(
    JSON.stringify(config).replace(/\$\{(\w+)\}/g, (_, varName) => {
      return process.env[varName] || '';
    })
  );
  
  return config;
}

// === SINGLETON PATTERN ===

let _instance: McpHub | null = null;

export function getMcpHub(): McpHub | null {
  return _instance;
}

export function initMcpHub(config: McpHubConfig): McpHub {
  if (_instance) {
    console.error('[MCP] Warning: McpHub already initialized, returning existing instance');
    return _instance;
  }
  _instance = new McpHub(config);
  return _instance;
}
