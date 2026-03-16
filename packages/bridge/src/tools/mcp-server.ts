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
import { getPlaywrightManager } from "../browser/playwright-manager"
import type { InteractAction } from "../browser/types"
import {
  MCP_SERVER_NAME,
  TOOL_TIMEOUT_MS,
  getToolTimeout,
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
  const toolTimeout = getToolTimeout(name)
  const timeout = setTimeout(() => controller.abort(), toolTimeout)

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
      return { id, error: `Tool '${name}' timed out after ${toolTimeout}ms` }
    }
    return { id, error: `Bridge unreachable: ${err.message}` }
  } finally {
    clearTimeout(timeout)
  }
}

// ─── Headed Browser Tool Handler ─────────────────────────────

async function handleHeadedBrowserTool(
  name: string,
  args: Record<string, unknown>,
): Promise<{ content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }>; isError?: boolean }> {
  const mgr = getPlaywrightManager()

  try {
    switch (name) {
      case "atlas_headed_launch": {
        const { url } = args as { url: string }
        const page = await mgr.launch(url)

        // Check if auth is needed
        const needsAuth = mgr.isLoginPage(page.url)
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              pageId: page.id,
              url: page.url,
              title: page.title,
              needsAuth,
              message: needsAuth
                ? `Opened ${url} — login page detected. Jim needs to authenticate on grove-node-1.`
                : `Opened ${url} — session restored, ready for automation.`,
            }, null, 2),
          }],
        }
      }

      case "atlas_headed_auth_wait": {
        const { pageId, urlPattern, selector, timeout } = args as {
          pageId: string; urlPattern?: string; selector?: string; timeout?: number
        }
        const result = await mgr.waitForAuth(pageId, { urlPattern, selector, timeout })
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          }],
        }
      }

      case "atlas_headed_interact": {
        const { pageId, action, selector, value, key } = args as {
          pageId: string; action: string; selector?: string; value?: string; key?: string
        }
        const result = await mgr.interact(pageId, {
          type: action as InteractAction["type"],
          selector,
          value,
          key,
        })
        return { content: [{ type: "text" as const, text: result }] }
      }

      case "atlas_headed_content": {
        const { pageId, selector } = args as { pageId: string; selector?: string }
        const content = await mgr.getContent(pageId, selector)
        return { content: [{ type: "text" as const, text: content }] }
      }

      case "atlas_headed_screenshot": {
        const { pageId } = args as { pageId: string }
        const screenshot = await mgr.screenshot(pageId)
        return {
          content: [
            { type: "image" as const, data: screenshot.data, mimeType: "image/png" },
            { type: "text" as const, text: `Screenshot captured (${screenshot.width}x${screenshot.height})` },
          ],
        }
      }

      default:
        return {
          content: [{ type: "text" as const, text: `Unknown headed browser tool: ${name}` }],
          isError: true,
        }
    }
  } catch (err: any) {
    return {
      content: [{ type: "text" as const, text: `Headed browser error: ${err.message}` }],
      isError: true,
    }
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

      // ─── Headed Browser Tools ─────────────────────────────
      if (name.startsWith("atlas_headed_")) {
        return await handleHeadedBrowserTool(name, (args ?? {}) as Record<string, unknown>)
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

// Cross-boundary exemption: cookies are shared with Telegram surface intentionally.
// The bot reads these for authenticated web scraping. Do not move to packages/bridge/data/.
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
    // Normalize domain to filename: ".threads.com" → "threads.com.json"
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
