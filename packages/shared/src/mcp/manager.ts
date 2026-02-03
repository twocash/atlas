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
 *
 * CRITICAL: ALL logging MUST use console.error(), NEVER console.log()
 * The MCP protocol uses stdout for JSON-RPC messages. Any console.log()
 * would corrupt the protocol stream and crash the connection.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { EventEmitter } from 'events';
import type {
  McpServerConfig,
  McpHubConfig,
  McpServerStatus,
  McpServerStatusInfo,
  ClaudeTool,
} from './types.js';

/**
 * Internal state for a connected server.
 */
interface ServerState {
  client: Client | null;
  transport: StdioClientTransport | null;
  tools: Tool[];
  status: McpServerStatus;
  reconnectAttempts: number;
  lastError?: Error;
}

/**
 * MCP Hub - manages connections to multiple MCP servers.
 *
 * Usage:
 * ```typescript
 * const hub = new McpHub({ servers: { ... } });
 * await hub.connectAll();
 * const tools = hub.getTools(); // Returns cached tools instantly
 * const result = await hub.callTool('pit-crew__dispatch_work', { ... });
 * ```
 */
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
          ...serverConfig,
        });
        this.states.set(id, {
          client: null,
          transport: null,
          tools: [],
          status: 'disconnected',
          reconnectAttempts: 0,
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
    const promises = Array.from(this.configs.keys()).map((id) =>
      this.connectServer(id).catch((err) => {
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
        env: { ...process.env, ...config.env } as Record<string, string>,
        ...(config.cwd ? { cwd: config.cwd } : {}),
      } as any);

      const client = new Client(
        { name: 'Atlas', version: '2.0.0' },
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
    const promises = Array.from(this.states.keys()).map((id) =>
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
      console.error(
        `[MCP] ${id} disconnected. Reconnect attempt ${state.reconnectAttempts} in ${delay}ms...`
      );

      setTimeout(() => {
        this.connectServer(id).catch((err) => {
          console.error(`[MCP] ${id} reconnect failed:`, err.message);
        });
      }, delay);
    } else {
      console.error(
        `[MCP] ${id} max reconnect attempts (${config.maxReconnectAttempts}) reached. Giving up.`
      );
      this.emit('gaveUp', { serverId: id, attempts: state.reconnectAttempts });
    }
  }

  // === TOOL ACCESS ===

  /**
   * Get all available tools from all connected servers.
   * Returns from cache - instant, no network calls.
   * Tools are namespaced as: {serverId}__{toolName}
   */
  getTools(): ClaudeTool[] {
    const allTools: ClaudeTool[] = [];

    for (const [serverId, state] of this.states.entries()) {
      if (state.status !== 'connected') continue;

      const namespaced = state.tools.map((tool) => ({
        name: `${serverId}__${tool.name}`,
        description: `[MCP: ${serverId}] ${tool.description || ''}`,
        input_schema: tool.inputSchema as ClaudeTool['input_schema'],
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
   * Check if a tool name is an MCP tool (contains "__").
   */
  isMcpTool(name: string): boolean {
    return name.includes('__');
  }

  /**
   * Call a tool by its namespaced name.
   * Format: {serverId}__{toolName}
   */
  async callTool(
    namespacedName: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    const [serverId, ...rest] = namespacedName.split('__');
    const toolName = rest.join('__'); // Handle tool names with underscores

    const config = this.configs.get(serverId);
    const state = this.states.get(serverId);

    if (!state || !state.client) {
      throw new Error(`MCP Server '${serverId}' is not connected`);
    }

    const timeout = config?.timeout || 60000;

    // Race the tool call against a timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(
          new Error(`MCP tool timeout after ${timeout}ms: ${namespacedName}`)
        );
      }, timeout);
    });

    const callPromise = state.client.callTool({
      name: toolName,
      arguments: args,
    });

    const result = await Promise.race([callPromise, timeoutPromise]);
    return result;
  }

  // === STATUS ===

  /**
   * Get status of all servers.
   */
  getStatus(): Record<string, McpServerStatusInfo> {
    const status: Record<string, McpServerStatusInfo> = {};

    for (const [id, state] of this.states.entries()) {
      status[id] = {
        status: state.status,
        toolCount: state.tools.length,
        error: state.lastError?.message,
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
      .map(([id]) =>
        this.refreshServerTools(id).catch((err) => {
          console.error(`[MCP] Failed to refresh ${id}:`, err.message);
        })
      );

    await Promise.allSettled(promises);
  }
}
