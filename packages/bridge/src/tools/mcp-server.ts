/**
 * Atlas Browser MCP Server — exposes 6 read-only browser tools to Claude Code.
 *
 * Architecture:
 *   Claude Code spawns this as a child process via .mcp.json.
 *   Communication is JSON-RPC over stdio (MCP standard transport).
 *
 *   tools/list  → returns TOOL_SCHEMAS
 *   tools/call  → POST http://localhost:{BRIDGE_PORT}/tool-dispatch
 *                 → Bridge routes via WebSocket to Extension
 *                 → Extension executes DOM tool
 *                 → Result flows back through the chain
 *
 * Usage (in .mcp.json):
 *   {
 *     "mcpServers": {
 *       "atlas-browser": {
 *         "command": "bun",
 *         "args": ["run", "packages/bridge/src/tools/mcp-server.ts"]
 *       }
 *     }
 *   }
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js"

import { resolve, dirname } from "path"
import { fileURLToPath } from "url"
import { mkdirSync, writeFileSync } from "fs"
import { TOOL_SCHEMAS, TOOL_NAMES, LOCAL_TOOL_NAMES } from "./schemas"
import { handleBridgeMemoryTool } from "./bridge-memory"
import { handleBridgeGoalsTool } from "./bridge-goals"
import {
  MCP_SERVER_NAME,
  TOOL_TIMEOUT_MS,
  type ToolDispatchRequest,
  type ToolDispatchResponse,
} from "../types/tool-protocol"

// ─── Config ──────────────────────────────────────────────────

const BRIDGE_PORT = parseInt(process.env.BRIDGE_PORT || "3848", 10)
const BRIDGE_URL = `http://localhost:${BRIDGE_PORT}`
const VERSION = "1.0.0"

// ─── Tool Dispatch ───────────────────────────────────────────

async function dispatchTool(
  name: string,
  args: Record<string, unknown>,
): Promise<ToolDispatchResponse> {
  const id = `tool-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  const body: ToolDispatchRequest = { id, name, input: args }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TOOL_TIMEOUT_MS)

  try {
    const res = await fetch(`${BRIDGE_URL}/tool-dispatch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    if (!res.ok) {
      const text = await res.text().catch(() => "")
      return { id, error: `Bridge returned ${res.status}: ${text}` }
    }

    return (await res.json()) as ToolDispatchResponse
  } catch (err: any) {
    if (err.name === "AbortError") {
      return { id, error: `Tool '${name}' timed out after ${TOOL_TIMEOUT_MS}ms` }
    }
    return { id, error: `Bridge unreachable: ${err.message}` }
  } finally {
    clearTimeout(timeout)
  }
}

// ─── MCP Server Setup ────────────────────────────────────────

const server = new Server(
  { name: MCP_SERVER_NAME, version: VERSION },
  { capabilities: { tools: {} } },
)

// tools/list — return all 6 tool schemas
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOL_SCHEMAS.map((schema) => ({
    name: schema.name,
    description: schema.description,
    inputSchema: schema.inputSchema,
  })),
}))

// tools/call — route to local handler or dispatch to browser extension
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params

  if (!TOOL_NAMES.has(name)) {
    return {
      content: [{ type: "text" as const, text: `Unknown tool: ${name}` }],
      isError: true,
    }
  }

  // Bridge-local tools are handled directly (not dispatched to browser)
  if (LOCAL_TOOL_NAMES.has(name)) {
    try {
      if (name === "bridge_update_memory") {
        return await handleBridgeMemoryTool((args ?? {}) as Record<string, unknown>)
      }
      if (name === "bridge_update_goals") {
        return await handleBridgeGoalsTool((args ?? {}) as Record<string, unknown>)
      }
      return {
        content: [{ type: "text" as const, text: `Local tool '${name}' has no handler` }],
        isError: true,
      }
    } catch (err: any) {
      return {
        content: [{ type: "text" as const, text: `Tool '${name}' failed: ${err.message}` }],
        isError: true,
      }
    }
  }

  // Browser tools — dispatch via HTTP to bridge → WebSocket to extension
  const response = await dispatchTool(name, (args ?? {}) as Record<string, unknown>)

  if (response.error) {
    return {
      content: [{ type: "text" as const, text: response.error }],
      isError: true,
    }
  }

  // Cookie refresh: write cookie files to disk after receiving from extension
  if (name === "atlas_refresh_cookies" && response.result) {
    try {
      const written = writeCookieFiles(response.result as CookieRefreshResult)
      const summary = Object.entries(written)
        .map(([d, n]) => `${d}: ${n} cookies`)
        .join(", ")
      return {
        content: [{ type: "text" as const, text: `Cookies refreshed and saved: ${summary}` }],
      }
    } catch (err: any) {
      return {
        content: [{ type: "text" as const, text: `Cookies received but failed to write: ${err.message}` }],
        isError: true,
      }
    }
  }

  // Return result as JSON text
  const resultText =
    typeof response.result === "string"
      ? response.result
      : JSON.stringify(response.result, null, 2)

  return {
    content: [{ type: "text" as const, text: resultText }],
  }
})

// ─── Cookie File Writing ─────────────────────────────────────

interface CookieEntry {
  name: string
  value: string
  domain: string
  path: string
  expirationDate?: number
}

interface CookieRefreshResult {
  domains: string[]
  counts: Record<string, number>
  cookies: Record<string, CookieEntry[]>
}

const COOKIE_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../apps/telegram/data/cookies",
)

/**
 * Write cookie data to disk as JSON files per domain.
 * Returns a map of domain → cookie count written.
 */
function writeCookieFiles(result: CookieRefreshResult): Record<string, number> {
  mkdirSync(COOKIE_DIR, { recursive: true })

  const written: Record<string, number> = {}

  for (const [domain, cookies] of Object.entries(result.cookies)) {
    // Normalize domain to filename: ".threads.net" → "threads.net.json"
    const filename = domain.replace(/^\./, "") + ".json"
    const filepath = resolve(COOKIE_DIR, filename)

    const data = {
      domain,
      refreshedAt: new Date().toISOString(),
      count: cookies.length,
      cookies,
    }

    writeFileSync(filepath, JSON.stringify(data, null, 2))
    written[domain] = cookies.length
  }

  return written
}

// ─── Start ───────────────────────────────────────────────────

const transport = new StdioServerTransport()
await server.connect(transport)
