/**
 * Atlas Bridge Server — stdio-to-WebSocket adapter for Claude Code.
 *
 * Architecture:
 *   The bridge spawns Claude Code as a child process using
 *   `claude -p --input-format stream-json --output-format stream-json --verbose`
 *   and bridges its stdin/stdout to WebSocket clients.
 *
 * Endpoints:
 *   ws://localhost:3848/client  — Chrome extension side panel connects here
 *   GET /status                 — Bridge health check (JSON)
 *   POST /spawn                 — Spawn Claude Code process (if not running)
 *   POST /kill                  — Kill Claude Code process
 *
 * Protocol:
 *   Client → Bridge: { type: "user_message", content: [{ type: "text", text: "..." }] }
 *   Bridge → Claude: { type: "user", message: { role: "user", content: "..." } }
 *   Claude → Bridge: NDJSON lines (system, assistant, result)
 *   Bridge → Client: forwarded NDJSON lines as WebSocket frames
 *
 * Usage:
 *   bun run packages/bridge/src/server.ts
 */

import type { ServerWebSocket } from "bun"
import { spawn, type Subprocess } from "bun"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"
import type { WsData, BridgeEnvelope, HandlerContext } from "./types/bridge"
import { processEnvelope } from "./handlers"
import {
  addConnection,
  removeConnection,
  getClientConnections,
  getConnectionCount,
  startHealthChecks,
  stopHealthChecks,
} from "./connections"
import {
  TOOL_TIMEOUT_MS,
  type ToolDispatchRequest,
  type ToolDispatchResponse,
  type ToolRequest,
  type ToolResponse,
} from "./types/tool-protocol"

// ─── Config ──────────────────────────────────────────────────

const PORT = parseInt(process.env.BRIDGE_PORT || "3848", 10)
const CLAUDE_CMD = process.env.CLAUDE_PATH || "claude"
const startedAt = new Date().toISOString()

// ─── Pending Tool Requests ───────────────────────────────────
// Maps tool request ID → resolver. When MCP server POSTs to /tool-dispatch,
// we hold the HTTP request open, send to extension via WebSocket, and
// resolve when the extension sends back a tool_response with matching ID.

interface PendingRequest {
  resolve: (response: ToolDispatchResponse) => void
  timer: ReturnType<typeof setTimeout>
}

const pendingRequests = new Map<string, PendingRequest>()

// ─── Claude Process Management ───────────────────────────────

let claudeProcess: Subprocess<"pipe", "pipe", "pipe"> | null = null
let claudeSessionId: string | null = null
let claudeModel: string | null = null
let claudeReady = false
let stdoutBuffer = ""

function isClaudeRunning(): boolean {
  return claudeProcess !== null && claudeProcess.exitCode === null
}

async function spawnClaude(): Promise<{ ok: boolean; error?: string }> {
  if (isClaudeRunning()) {
    return { ok: true }
  }

  console.log("[bridge] Spawning Claude Code...")

  // Resolve paths relative to this file's location
  const thisDir = dirname(fileURLToPath(import.meta.url))
  const bridgeRoot = resolve(thisDir, "../..")   // packages/bridge/
  const repoRoot = resolve(thisDir, "../../../") // atlas-bridge/
  const mcpConfig = resolve(bridgeRoot, "mcp-config.json")

  try {
    claudeProcess = spawn({
      cmd: [CLAUDE_CMD, "-p",
        "--input-format", "stream-json",
        "--output-format", "stream-json",
        "--verbose",
        "--mcp-config", mcpConfig,
      ],
      cwd: repoRoot,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    })

    // Read stdout line by line (NDJSON)
    readClaudeStdout()
    readClaudeStderr()

    // Wait briefly for the process to start
    await new Promise((r) => setTimeout(r, 500))

    if (claudeProcess.exitCode !== null) {
      const error = `Claude exited immediately with code ${claudeProcess.exitCode}`
      console.error(`[bridge] ${error}`)
      claudeProcess = null
      return { ok: false, error }
    }

    console.log("[bridge] Claude Code process started (PID:", claudeProcess.pid, ")")

    // Notify all clients
    broadcastToClients({ type: "system", event: "claude_connected" })

    // Warn if Claude doesn't send init within 15s
    setTimeout(() => {
      if (isClaudeRunning() && !claudeReady) {
        console.warn("[bridge] WARNING: Claude process running for 15s but no init message received")
        console.warn("[bridge] This usually means Claude Code is stuck during startup")
        console.warn("[bridge] Check: does 'claude -p --output-format stream-json' work in this terminal?")
      }
    }, 15_000)

    return { ok: true }
  } catch (err: any) {
    const error = `Failed to spawn Claude: ${err.message}`
    console.error(`[bridge] ${error}`)
    claudeProcess = null
    return { ok: false, error }
  }
}

function killClaude(): void {
  if (claudeProcess) {
    console.log("[bridge] Killing Claude Code process...")
    claudeProcess.kill()
    claudeProcess = null
    claudeSessionId = null
    claudeModel = null
    claudeReady = false
    broadcastToClients({ type: "system", event: "claude_disconnected" })
  }
}

async function readClaudeStdout(): Promise<void> {
  if (!claudeProcess?.stdout) {
    console.error("[bridge] No stdout pipe available")
    return
  }

  console.log("[bridge] Stdout reader started, waiting for Claude output...")
  const reader = claudeProcess.stdout.getReader()
  const decoder = new TextDecoder()
  let firstChunk = true

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      if (firstChunk) {
        console.log("[bridge] First stdout chunk received from Claude")
        firstChunk = false
      }

      stdoutBuffer += decoder.decode(value, { stream: true })

      // Process complete lines
      let newlineIdx: number
      while ((newlineIdx = stdoutBuffer.indexOf("\n")) !== -1) {
        const line = stdoutBuffer.slice(0, newlineIdx).trim()
        stdoutBuffer = stdoutBuffer.slice(newlineIdx + 1)

        if (!line) continue
        handleClaudeLine(line)
      }
    }
  } catch (err: any) {
    console.error("[bridge] Stdout read error:", err.message)
  } finally {
    console.log("[bridge] Claude stdout stream ended")
    claudeProcess = null
    claudeSessionId = null
    claudeReady = false
    broadcastToClients({ type: "system", event: "claude_disconnected" })
  }
}

async function readClaudeStderr(): Promise<void> {
  if (!claudeProcess?.stderr) return

  const reader = claudeProcess.stderr.getReader()
  const decoder = new TextDecoder()

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const text = decoder.decode(value, { stream: true })
      if (text.trim()) {
        console.log("[claude:stderr]", text.trim())
      }
    }
  } catch {
    // stderr closed
  }
}

function handleClaudeLine(line: string): void {
  let msg: any
  try {
    msg = JSON.parse(line)
  } catch {
    console.warn("[bridge] Non-JSON from Claude:", line.slice(0, 100))
    return
  }

  // Extract session info from system init
  if (msg.type === "system" && msg.subtype === "init") {
    claudeSessionId = msg.session_id
    claudeModel = msg.model
    claudeReady = true
    console.log(`[bridge] Claude init — session: ${claudeSessionId}, model: ${claudeModel}`)
  }

  // Log all message types for diagnostics
  console.log(`[bridge] Claude → type=${msg.type}${msg.subtype ? ` subtype=${msg.subtype}` : ""}`)

  // Route through handler chain (response router can observe/intercept)
  const envelope: BridgeEnvelope = {
    message: msg,
    surface: "claude_code",
    sessionId: claudeSessionId || "unknown",
    timestamp: new Date().toISOString(),
    direction: "claude_to_client",
    sourceConnectionId: "claude",
  }

  const handlerContext: HandlerContext = {
    sendToClaude: (m) => sendToClaude(m),
    sendToClient: (connId, m) => {
      const raw = JSON.stringify(m)
      for (const client of getClientConnections()) {
        if (client.data.id === connId) {
          client.send(raw)
          break
        }
      }
    },
    broadcastToClients: (m) => broadcastToClients(m),
    isClaudeConnected: () => isClaudeRunning(),
  }

  processEnvelope(envelope, handlerContext).catch((err) => {
    console.error("[bridge] Claude→client handler error:", err)
  })
}

// ─── Client → Claude Translation ────────────────────────────

function sendToClaude(clientMessage: any): void {
  if (!isClaudeRunning() || !claudeProcess?.stdin) {
    console.warn("[bridge] Cannot send — Claude not running")
    return
  }

  if (!claudeReady) {
    console.warn("[bridge] Sending to Claude before init complete — message may be buffered")
  }

  // Translate client message format to Claude's stream-json format
  let claudeMessage: any

  if (clientMessage.type === "user_message") {
    // Client sends: { type: "user_message", content: [{ type: "text", text: "..." }] }
    // Claude wants: { type: "user", message: { role: "user", content: "..." | [...] } }
    const textBlocks = clientMessage.content?.filter((b: any) => b.type === "text") || []
    const content = textBlocks.length === 1
      ? textBlocks[0].text
      : textBlocks.map((b: any) => b)

    claudeMessage = {
      type: "user",
      message: {
        role: "user",
        content,
      },
    }
  } else {
    // Pass through any other message types as-is
    claudeMessage = clientMessage
  }

  const line = JSON.stringify(claudeMessage) + "\n"
  console.log(`[bridge] → Claude stdin: type=${claudeMessage.type} (${line.length} bytes)`)
  claudeProcess.stdin.write(line)
  claudeProcess.stdin.flush()
}

// ─── WebSocket Client Handling ───────────────────────────────

function handleClientMessage(ws: ServerWebSocket<WsData>, raw: string | Buffer): void {
  const text = typeof raw === "string" ? raw : raw.toString()
  const lines = text.split("\n").filter((l) => l.trim())

  for (const line of lines) {
    let parsed: any
    try {
      parsed = JSON.parse(line)
    } catch {
      console.error("[bridge] Invalid JSON from client:", line.slice(0, 100))
      continue
    }

    // Handle tool_response from extension (routed back to MCP server via HTTP)
    if (parsed.type === "tool_response") {
      handleToolResponse(parsed as ToolResponse)
      continue
    }

    // Wrap in BridgeEnvelope and route through handler chain
    const envelope: BridgeEnvelope = {
      message: parsed,
      surface: parsed.surface || "chrome_extension",
      sessionId: claudeSessionId || `session-${Date.now()}`,
      timestamp: new Date().toISOString(),
      direction: "client_to_claude",
      sourceConnectionId: ws.data.id,
    }

    const handlerContext: HandlerContext = {
      sendToClaude: (msg) => sendToClaude(msg),
      sendToClient: (connId, msg) => {
        const raw = JSON.stringify(msg)
        for (const client of getClientConnections()) {
          if (client.data.id === connId) {
            client.send(raw)
            break
          }
        }
      },
      broadcastToClients: (msg) => broadcastToClients(msg),
      isClaudeConnected: () => isClaudeRunning(),
    }

    processEnvelope(envelope, handlerContext).catch((err) => {
      console.error("[bridge] Handler chain error:", err)
    })
  }
}

function broadcastToClients(msg: any): void {
  const raw = JSON.stringify(msg)
  for (const ws of getClientConnections()) {
    ws.send(raw)
  }
}

// ─── Tool Dispatch ───────────────────────────────────────────

async function handleToolDispatch(req: Request): Promise<Response> {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  }

  let body: ToolDispatchRequest
  try {
    body = (await req.json()) as ToolDispatchRequest
  } catch {
    return new Response(
      JSON.stringify({ id: "", error: "Invalid JSON body" }),
      { status: 400, headers },
    )
  }

  if (!body.id || !body.name) {
    return new Response(
      JSON.stringify({ id: body.id || "", error: "Missing id or name" }),
      { status: 400, headers },
    )
  }

  // Check that at least one client is connected
  const clients = getClientConnections()
  if (clients.length === 0) {
    return new Response(
      JSON.stringify({ id: body.id, error: "No browser extension connected" }),
      { status: 503, headers },
    )
  }

  // Create a promise that will resolve when the extension responds
  const response = await new Promise<ToolDispatchResponse>((resolve) => {
    const timer = setTimeout(() => {
      pendingRequests.delete(body.id)
      resolve({ id: body.id, error: `Tool '${body.name}' timed out after ${TOOL_TIMEOUT_MS}ms` })
    }, TOOL_TIMEOUT_MS)

    pendingRequests.set(body.id, { resolve, timer })

    // Send tool_request to all connected clients (first to respond wins)
    const toolRequest: ToolRequest = {
      type: "tool_request",
      id: body.id,
      name: body.name,
      input: body.input,
      timestamp: Date.now(),
    }

    const raw = JSON.stringify(toolRequest)
    for (const ws of clients) {
      ws.send(raw)
    }
  })

  return new Response(JSON.stringify(response), { headers })
}

/** Called when a client sends a tool_response message via WebSocket. */
function handleToolResponse(msg: ToolResponse): void {
  const pending = pendingRequests.get(msg.id)
  if (!pending) {
    console.warn(`[bridge] tool_response for unknown id: ${msg.id}`)
    return
  }

  clearTimeout(pending.timer)
  pendingRequests.delete(msg.id)

  const response: ToolDispatchResponse = {
    id: msg.id,
    result: msg.result,
    error: msg.error,
  }

  pending.resolve(response)
}

// ─── HTTP Handler ────────────────────────────────────────────

async function handleHttpRequest(req: Request, server: any): Promise<Response | undefined> {
  const url = new URL(req.url)

  // WebSocket upgrade for /client
  if (url.pathname === "/client") {
    const id = `client-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const upgraded = server.upgrade(req, {
      data: { id, role: "client" as const } satisfies WsData,
    })
    if (!upgraded) {
      return new Response("WebSocket upgrade failed", { status: 500 })
    }
    return undefined
  }

  // GET /status
  if (url.pathname === "/status" && req.method === "GET") {
    const counts = getConnectionCount()
    const body = {
      status: "ok",
      claude: isClaudeRunning() ? "connected" : "disconnected",
      claudeSession: claudeSessionId,
      claudeModel: claudeModel,
      clients: counts.clients,
      uptime: Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000),
      startedAt,
    }
    return new Response(JSON.stringify(body), {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    })
  }

  // POST /spawn — start Claude Code
  if (url.pathname === "/spawn" && req.method === "POST") {
    spawnClaude().then((result) => {
      // Result already logged
    })
    return new Response(JSON.stringify({ ok: true, message: "Spawning Claude Code..." }), {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    })
  }

  // POST /kill — stop Claude Code
  if (url.pathname === "/kill" && req.method === "POST") {
    killClaude()
    return new Response(JSON.stringify({ ok: true, message: "Claude Code killed" }), {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    })
  }

  // POST /tool-dispatch — MCP server dispatches tool calls here
  if (url.pathname === "/tool-dispatch" && req.method === "POST") {
    return await handleToolDispatch(req)
  }

  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    })
  }

  return new Response("Not Found", { status: 404 })
}

// ─── Start Server ────────────────────────────────────────────

const server = Bun.serve({
  port: PORT,

  fetch(req, server) {
    return handleHttpRequest(req, server)
  },

  websocket: {
    open(ws: ServerWebSocket<WsData>) {
      addConnection(ws)

      // Send current Claude status to newly connected client
      ws.send(JSON.stringify({
        type: "system",
        event: isClaudeRunning() ? "claude_connected" : "claude_disconnected",
        data: {
          session_id: claudeSessionId,
          model: claudeModel,
        },
      }))
    },

    message(ws: ServerWebSocket<WsData>, message: string | Buffer) {
      handleClientMessage(ws, message)
    },

    close(ws: ServerWebSocket<WsData>, code: number, reason: string) {
      removeConnection(ws.data.id)
    },

    ping() {
      // Bun handles pong automatically
    },
  },
})

startHealthChecks()

// Auto-spawn Claude on startup
spawnClaude()

console.log(`
  ╔══════════════════════════════════════════════════╗
  ║         Atlas Bridge v0.5.0                      ║
  ║──────────────────────────────────────────────────║
  ║  Client WS : ws://localhost:${PORT}/client          ║
  ║  Status    : http://localhost:${PORT}/status         ║
  ║  Spawn     : POST http://localhost:${PORT}/spawn     ║
  ║  Kill      : POST http://localhost:${PORT}/kill      ║
  ║  Tools     : POST http://localhost:${PORT}/tool-dispatch ║
  ╚══════════════════════════════════════════════════╝

  Claude Code is managed as a child process.
  MCP tools dispatched to extension via WebSocket.
`)

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\n[bridge] Shutting down...")
  killClaude()
  stopHealthChecks()
  server.stop()
  process.exit(0)
})

process.on("SIGTERM", () => {
  killClaude()
  stopHealthChecks()
  server.stop()
  process.exit(0)
})
