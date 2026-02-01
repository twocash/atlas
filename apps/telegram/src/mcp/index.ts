/**
 * Atlas MCP Integration
 *
 * Connects Atlas to external MCP servers defined in config/mcp.yaml.
 * Provides tool injection and routing for the conversation handler.
 */

import { readFile } from 'fs/promises';
import { join, resolve, isAbsolute } from 'path';
import { parse } from 'yaml';
import type Anthropic from '@anthropic-ai/sdk';
import { logger } from '../logger';

// MCP SDK imports
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

// === TYPES ===

interface McpServerConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
  cwd?: string;
  disabled?: boolean;
  timeout?: number;
  reconnectDelay?: number;
  maxReconnectAttempts?: number;
}

interface McpHubConfig {
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

// === STATE ===

const configs: Map<string, McpServerConfig> = new Map();
const states: Map<string, ServerState> = new Map();
let initialized = false;

// === CONFIG LOADING ===

/**
 * Substitute environment variables in config
 */
function substituteEnvVars(obj: unknown): unknown {
  if (typeof obj === 'string') {
    return obj.replace(/\$\{(\w+)(?::-([^}]*))?\}/g, (_, varName, defaultVal) => {
      return process.env[varName] || defaultVal || '';
    });
  }
  if (Array.isArray(obj)) {
    return obj.map(substituteEnvVars);
  }
  if (obj && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = substituteEnvVars(value);
    }
    return result;
  }
  return obj;
}

/**
 * Resolve relative paths in args to absolute paths
 * This fixes subprocess spawning issues on Windows
 */
function resolveArgsPath(args: string[]): string[] {
  return args.map(arg => {
    // Check if this looks like a relative path (starts with . or ..)
    if ((arg.startsWith('./') || arg.startsWith('../') || arg.startsWith('.\\') || arg.startsWith('..\\'))
        && (arg.endsWith('.ts') || arg.endsWith('.js'))) {
      const absolutePath = resolve(process.cwd(), arg);
      console.error(`[MCP] Resolved path: ${arg} → ${absolutePath}`);
      return absolutePath;
    }
    return arg;
  });
}

/**
 * Load MCP configuration from YAML file
 */
async function loadConfig(): Promise<McpHubConfig> {
  const configPath = join(process.cwd(), 'config', 'mcp.yaml');

  try {
    const content = await readFile(configPath, 'utf-8');
    const rawConfig = parse(content) as McpHubConfig;
    const config = substituteEnvVars(rawConfig) as McpHubConfig;

    // Resolve relative paths in args to absolute paths
    for (const server of Object.values(config.servers)) {
      if (server.args) {
        server.args = resolveArgsPath(server.args);
      }
    }

    return config;
  } catch (error) {
    logger.warn('MCP config not found or invalid, using empty config', { configPath, error });
    return { servers: {} };
  }
}

// === CONNECTION MANAGEMENT ===

/**
 * Connect to a specific MCP server
 */
async function connectServer(id: string): Promise<void> {
  const config = configs.get(id);
  const state = states.get(id);

  if (!config || !state) {
    throw new Error(`Unknown MCP server: ${id}`);
  }

  // Clean up existing connection
  await disconnectServer(id);

  state.status = 'connecting';

  // Diagnostic: Log the exact command we're about to run
  const resolvedCwd = config.cwd || process.cwd();
  console.error(`[MCP] Connecting to ${id}:`);
  console.error(`[MCP]   Command: ${config.command}`);
  console.error(`[MCP]   Args: ${JSON.stringify(config.args)}`);
  console.error(`[MCP]   CWD: ${resolvedCwd}`);

  logger.info('[MCP] Connecting', {
    server: id,
    command: config.command,
    args: config.args,
    cwd: resolvedCwd
  });

  try {
    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: { ...process.env, ...config.env } as Record<string, string>,
      cwd: config.cwd,
    });

    // Diagnostic: Log when transport is created
    console.error(`[MCP]   Transport created, connecting client...`);

    const client = new Client(
      { name: 'Atlas', version: '2.0.0' },
      { capabilities: { tools: {} } }
    );

    // Handle transport errors
    transport.onerror = (err) => {
      logger.error('[MCP] Transport error', { server: id, error: err });
      handleDisconnect(id, err as Error);
    };

    transport.onclose = () => {
      logger.warn('[MCP] Transport closed', { server: id });
      handleDisconnect(id, new Error('Transport closed'));
    };

    console.error(`[MCP]   Awaiting client.connect()...`);
    await client.connect(transport);
    console.error(`[MCP]   Connected! Fetching tools...`);

    // Prime the tool cache
    const result = await client.listTools();
    console.error(`[MCP]   Got ${result.tools.length} tools: ${result.tools.map(t => t.name).join(', ')}`);

    state.client = client;
    state.transport = transport;
    state.tools = result.tools;
    state.status = 'connected';
    state.reconnectAttempts = 0;
    state.lastError = undefined;

    logger.info('[MCP] Connected', { server: id, toolCount: result.tools.length });

  } catch (error) {
    state.status = 'error';
    state.lastError = error as Error;
    console.error(`[MCP] Connection to ${id} FAILED:`, error);
    logger.error('[MCP] Connection failed', { server: id, error: String(error) });
    throw error;
  }
}

/**
 * Disconnect from a specific server
 */
async function disconnectServer(id: string): Promise<void> {
  const state = states.get(id);
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
 * Handle unexpected disconnection with auto-reconnect
 */
function handleDisconnect(id: string, error: Error): void {
  const config = configs.get(id);
  const state = states.get(id);

  if (!config || !state) return;

  state.client = null;
  state.transport = null;
  state.tools = [];
  state.status = 'error';
  state.lastError = error;
  state.reconnectAttempts++;

  const maxAttempts = config.maxReconnectAttempts || 3;

  if (state.reconnectAttempts <= maxAttempts) {
    const delay = config.reconnectDelay || 5000;
    logger.info('[MCP] Scheduling reconnect', { server: id, attempt: state.reconnectAttempts, delay });

    setTimeout(() => {
      connectServer(id).catch(err => {
        logger.error('[MCP] Reconnect failed', { server: id, error: err });
      });
    }, delay);
  } else {
    logger.error('[MCP] Max reconnect attempts reached', { server: id, attempts: state.reconnectAttempts });
  }
}

// === PUBLIC API ===

/**
 * Initialize MCP hub - load config and connect to enabled servers
 */
export async function initMcp(): Promise<void> {
  if (initialized) {
    logger.warn('[MCP] Already initialized');
    return;
  }

  const config = await loadConfig();

  // Initialize state for each enabled server
  for (const [id, serverConfig] of Object.entries(config.servers)) {
    if (!serverConfig.disabled) {
      configs.set(id, {
        timeout: 60000,
        reconnectDelay: 5000,
        maxReconnectAttempts: 3,
        ...serverConfig,
      });
      states.set(id, {
        client: null,
        transport: null,
        tools: [],
        status: 'disconnected',
        reconnectAttempts: 0,
      });
    }
  }

  // Connect to all servers (non-blocking)
  const promises = Array.from(configs.keys()).map(id =>
    connectServer(id).catch(err => {
      logger.error('[MCP] Failed to connect', { server: id, error: err.message });
    })
  );

  await Promise.allSettled(promises);
  initialized = true;

  const connectedCount = Array.from(states.values()).filter(s => s.status === 'connected').length;
  const totalTools = Array.from(states.values()).reduce((sum, s) => sum + s.tools.length, 0);

  console.error(`[MCP] === INITIALIZATION COMPLETE ===`);
  console.error(`[MCP] Servers: ${connectedCount}/${configs.size} connected`);
  console.error(`[MCP] Total MCP tools available: ${totalTools}`);

  // Log status of each server
  for (const [id, state] of states.entries()) {
    console.error(`[MCP]   ${id}: ${state.status} (${state.tools.length} tools)${state.lastError ? ` - Error: ${state.lastError.message}` : ''}`);
  }

  logger.info('[MCP] Initialization complete', {
    totalServers: configs.size,
    connectedServers: connectedCount,
    totalTools,
  });
}

/**
 * Get all MCP tools formatted for Claude API
 * Tools are namespaced as: {serverId}__{toolName}
 */
export function getMcpTools(): Anthropic.Tool[] {
  const allTools: Anthropic.Tool[] = [];

  for (const [serverId, state] of states.entries()) {
    if (state.status !== 'connected') {
      console.error(`[MCP] Server ${serverId} not connected (status: ${state.status})`);
      continue;
    }

    const namespaced = state.tools.map(tool => ({
      name: `mcp__${serverId}__${tool.name}`,
      description: `[MCP: ${serverId}] ${tool.description || ''}`,
      input_schema: tool.inputSchema as Anthropic.Tool['input_schema'],
    }));

    allTools.push(...namespaced);
  }

  return allTools;
}

/**
 * Check if a tool name is an MCP tool
 */
export function isMcpTool(toolName: string): boolean {
  return toolName.startsWith('mcp__');
}

/**
 * Execute an MCP tool by its namespaced name
 * Format: mcp__{serverId}__{toolName}
 */
export async function executeMcpTool(
  namespacedName: string,
  args: Record<string, unknown>
): Promise<{ success: boolean; result: unknown; error?: string }> {
  // Parse: mcp__{serverId}__{toolName}
  const parts = namespacedName.split('__');
  if (parts.length < 3 || parts[0] !== 'mcp') {
    return {
      success: false,
      result: null,
      error: `Invalid MCP tool name format: ${namespacedName}`,
    };
  }

  const serverId = parts[1];
  const toolName = parts.slice(2).join('__'); // Handle tool names with underscores

  const config = configs.get(serverId);
  const state = states.get(serverId);

  if (!state || !state.client) {
    return {
      success: false,
      result: null,
      error: `MCP Server '${serverId}' is not connected`,
    };
  }

  const timeout = config?.timeout || 60000;

  try {
    // Race the tool call against a timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`MCP tool timeout after ${timeout}ms: ${namespacedName}`));
      }, timeout);
    });

    const callPromise = state.client.callTool({
      name: toolName,
      arguments: args,
    });

    const result = await Promise.race([callPromise, timeoutPromise]) as {
      content: Array<{ type: string; text?: string }>;
      isError?: boolean;
    };

    // Check if the MCP tool returned an error (isError flag or error in content)
    if (result.isError) {
      const errorText = result.content
        ?.filter(c => c.type === 'text')
        .map(c => c.text)
        .join('\n') || 'MCP tool returned error';
      logger.error('[MCP] Tool returned error', { tool: namespacedName, error: errorText });
      return {
        success: false,
        result,
        error: errorText,
      };
    }

    // Also check for error patterns in the content itself
    const contentText = result.content
      ?.filter(c => c.type === 'text')
      .map(c => c.text)
      .join('\n') || '';

    if (contentText.includes('"object":"error"') || contentText.includes('object_not_found')) {
      logger.error('[MCP] Tool content contains error', { tool: namespacedName, content: contentText.substring(0, 500) });
      return {
        success: false,
        result,
        error: contentText,
      };
    }

    return {
      success: true,
      result,
    };
  } catch (error) {
    logger.error('[MCP] Tool call failed', { tool: namespacedName, error });
    return {
      success: false,
      result: null,
      error: String(error),
    };
  }
}

/**
 * Get status of all MCP servers
 */
export function getMcpStatus(): Record<string, { status: string; toolCount: number; error?: string }> {
  const status: Record<string, { status: string; toolCount: number; error?: string }> = {};

  for (const [id, state] of states.entries()) {
    status[id] = {
      status: state.status,
      toolCount: state.tools.length,
      error: state.lastError?.message,
    };
  }

  return status;
}

/**
 * Shutdown all MCP connections
 */
export async function shutdownMcp(): Promise<void> {
  const promises = Array.from(states.keys()).map(id => disconnectServer(id));
  await Promise.allSettled(promises);
  configs.clear();
  states.clear();
  initialized = false;
  logger.info('[MCP] Shutdown complete');
}

/**
 * Restart the MCP subsystem - reload config and reconnect all servers.
 * Use this after modifying mcp.yaml to load new servers without restarting the bot.
 */
export async function restartMcp(): Promise<{ servers: string[]; toolCount: number }> {
  console.error('[MCP] === RESTARTING SUBSYSTEM ===');
  logger.info('[MCP] Restarting subsystem...');

  // 1. Disconnect everything
  await shutdownMcp();

  // 2. Re-initialize (shutdownMcp sets initialized = false)
  await initMcp();

  // 3. Return status
  const serverList = Array.from(states.keys());
  const totalTools = Array.from(states.values()).reduce((sum, s) => sum + s.tools.length, 0);

  console.error(`[MCP] Restart complete. ${serverList.length} servers, ${totalTools} tools.`);
  logger.info('[MCP] Restart complete', { servers: serverList, toolCount: totalTools });

  return { servers: serverList, toolCount: totalTools };
}

/**
 * List all available MCP tools with their descriptions
 */
export function listMcpTools(): Array<{ server: string; tool: string; description: string }> {
  const toolList: Array<{ server: string; tool: string; description: string }> = [];

  for (const [serverId, state] of states.entries()) {
    if (state.status !== 'connected') continue;

    for (const tool of state.tools) {
      toolList.push({
        server: serverId,
        tool: tool.name,
        description: tool.description || '',
      });
    }
  }

  return toolList;
}
