/**
 * Atlas Bridge Server — WebSocket adapter for Claude Code.
 *
 * Architecture:
 *   The bridge spawns Claude Code with `--sdk-url` so that Claude
 *   connects BACK to the bridge via WebSocket. This avoids the
 *   stdin/stdout MCP startup hang and enables richer control
 *   (permission gating, MCP hot-reload, session resume).
 *
 * Endpoints:
 *   ws://localhost:3848/client         — Chrome extension connects here
 *   ws://localhost:3848/ws/cli/:id     — Claude Code connects back here
 *   GET /status                        — Bridge health check (JSON)
 *   POST /spawn                        — Spawn Claude Code process
 *   POST /kill                         — Kill Claude Code process
 *   POST /tool-dispatch                — MCP tool dispatch from extension
 *
 * Protocol (SDK URL mode):
 *   Client → Bridge → Claude: NDJSON over WebSocket (/ws/cli/:id)
 *   Claude → Bridge → Client: NDJSON over WebSocket (/client)
 *   MCP servers configured via mcp_set_servers control request after init.
 *
 * Usage:
 *   bun run packages/bridge/src/server.ts
 */

import { resolve, dirname } from "path"
import { fileURLToPath } from "url"

// Load shared .env BEFORE any modules that read process.env (PromptManager needs NOTION_PROMPTS_DB_ID)
import { config } from "dotenv"
const __bridgeDir = dirname(fileURLToPath(import.meta.url))
config({ path: resolve(__bridgeDir, "../../../apps/telegram/.env") })

import type { ServerWebSocket } from "bun"
import { spawn, type Subprocess } from "bun"
import { randomUUID } from "crypto"
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
import { composeBridgePrompt } from "../../agents/src/services/prompt-composition"
import { hydrateSystemPreamble } from "./context/prompt-constructor"
import { detectStaleness } from "./staleness"
import { runBridgeHealthCheck } from "./health"

// ─── Config ──────────────────────────────────────────────────

const PORT = parseInt(process.env.BRIDGE_PORT || "3848", 10)
const CLAUDE_CMD = process.env.CLAUDE_PATH || "claude"
const BRIDGE_CWD = process.env.BRIDGE_CWD || "" // Empty = use repoRoot (default)
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

let claudeProcess: Subprocess | null = null
let cliSocket: ServerWebSocket<WsData> | null = null
let expectedCliSessionId: string | null = null
let pendingForCli: string[] = []
let claudeSessionId: string | null = null
let claudeModel: string | null = null
let claudeReady = false
let mcpConfigured = false
let mcpRequestId: string | null = null
let autoRespawn = true

function isClaudeRunning(): boolean {
  return claudeProcess !== null && claudeProcess.exitCode === null
}

function isClaudeConnected(): boolean {
  return cliSocket !== null
}

async function spawnClaude(): Promise<{ ok: boolean; error?: string }> {
  if (isClaudeRunning()) {
    return { ok: true }
  }

  autoRespawn = true
  console.log("[bridge] Spawning Claude Code (SDK URL mode)...")

  const thisDir = dirname(fileURLToPath(import.meta.url))
  const repoRoot = resolve(thisDir, "../../../")

  // Generate a unique session ID for Claude to connect back on
  expectedCliSessionId = randomUUID()
  const sdkUrl = `ws://localhost:${PORT}/ws/cli/${expectedCliSessionId}`

  try {
    claudeProcess = spawn({
      cmd: [
        CLAUDE_CMD,
        "--sdk-url", sdkUrl,
        "--print",
        "--output-format", "stream-json",
        "--input-format", "stream-json",
        "--verbose",
        "-p", "",
      ],
      cwd: BRIDGE_CWD || repoRoot,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    })

    // Read stdout/stderr for logging only (messages arrive via WebSocket)
    readProcessStdout()
    readProcessStderr()

    // Watch for process exit
    claudeProcess.exited.then((code) => {
      console.log(`[bridge] Claude process exited with code ${code}`)
      claudeProcess = null
      if (cliSocket) {
        // Process died but WS still open — close WS to trigger handleCliClose cleanup
        try { cliSocket.close(1000, "process exited") } catch {}
      } else {
        // WS already closed or never connected
        expectedCliSessionId = null
        pendingForCli = []
        scheduleRespawn()
      }
    })

    // Wait briefly for the process to start
    await new Promise((r) => setTimeout(r, 500))

    if (claudeProcess?.exitCode !== null && claudeProcess?.exitCode !== undefined) {
      const error = `Claude exited immediately with code ${claudeProcess.exitCode}`
      console.error(`[bridge] ${error}`)
      claudeProcess = null
      expectedCliSessionId = null
      return { ok: false, error }
    }

    console.log(`[bridge] Claude Code started (PID: ${claudeProcess!.pid}), awaiting WebSocket callback...`)
    console.log(`[bridge] SDK URL: ${sdkUrl}`)

    // Warn if Claude doesn't connect back within 15s
    setTimeout(() => {
      if (isClaudeRunning() && !cliSocket) {
        console.warn("[bridge] WARNING: Claude running 15s but no WebSocket connection")
        console.warn("[bridge] Verify 'claude' supports --sdk-url flag")
      }
    }, 15_000)

    return { ok: true }
  } catch (err: any) {
    const error = `Failed to spawn Claude: ${err.message}`
    console.error(`[bridge] ${error}`)
    claudeProcess = null
    expectedCliSessionId = null
    return { ok: false, error }
  }
}

function killClaude(): void {
  autoRespawn = false // Prevent auto-respawn during intentional kill

  if (cliSocket) {
    try { cliSocket.close(1000, "bridge shutting down") } catch {}
    cliSocket = null
  }

  if (claudeProcess) {
    console.log("[bridge] Killing Claude Code process...")
    claudeProcess.kill()
    claudeProcess = null
  }

  expectedCliSessionId = null
  pendingForCli = []
  claudeSessionId = null
  claudeModel = null
  claudeReady = false
  mcpConfigured = false
  mcpRequestId = null
  broadcastToClients({ type: "system", event: "claude_disconnected" })
}

/** Schedule a respawn attempt after a delay, if auto-respawn is enabled. */
function scheduleRespawn(): void {
  if (!autoRespawn) return
  console.log("[bridge] Auto-respawning Claude in 2s...")
  setTimeout(() => {
    if (!isClaudeRunning() && !cliSocket) {
      spawnClaude()
    }
  }, 2000)
}

// ─── Process stdout/stderr (logging only) ────────────────────

async function readProcessStdout(): Promise<void> {
  if (!claudeProcess?.stdout) return

  const reader = (claudeProcess.stdout as ReadableStream).getReader()
  const decoder = new TextDecoder()

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const text = decoder.decode(value, { stream: true })
      for (const line of text.split("\n")) {
        if (line.trim()) console.log("[claude:stdout]", line.trim().slice(0, 200))
      }
    }
  } catch {
    // stdout closed
  }
}

async function readProcessStderr(): Promise<void> {
  if (!claudeProcess?.stderr) return

  const reader = (claudeProcess.stderr as ReadableStream).getReader()
  const decoder = new TextDecoder()

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const text = decoder.decode(value, { stream: true })
      if (text.trim()) console.log("[claude:stderr]", text.trim())
    }
  } catch {
    // stderr closed
  }
}

// ─── Claude CLI WebSocket Handling ──────────────────────────

function handleCliOpen(ws: ServerWebSocket<WsData>): void {
  console.log("[bridge] Claude Code connected via WebSocket!")
  cliSocket = ws
  addConnection(ws)
  // Don't flush pendingForCli here — wait until MCP is configured (flushPending)
}

function handleCliMessage(raw: string | Buffer): void {
  const text = typeof raw === "string" ? raw : raw.toString()

  // NDJSON: split by newlines, process each JSON line
  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed) continue

    let msg: any
    try {
      msg = JSON.parse(trimmed)
    } catch {
      console.warn("[bridge] Non-JSON from Claude WS:", trimmed.slice(0, 100))
      continue
    }

    handleClaudeLine(msg)
  }
}

function handleCliClose(): void {
  console.log("[bridge] Claude Code WebSocket disconnected")
  cliSocket = null
  removeConnection("claude-ws")
  claudeSessionId = null
  claudeReady = false
  mcpConfigured = false
  mcpRequestId = null
  broadcastToClients({ type: "system", event: "claude_disconnected" })

  // If process is still alive when WS drops, kill it (exited handler fires scheduleRespawn)
  if (isClaudeRunning()) {
    console.log("[bridge] Process still running after WS drop — killing...")
    claudeProcess!.kill()
    claudeProcess = null
    scheduleRespawn()
  }
}

// ─── Claude Message Routing ─────────────────────────────────

function handleClaudeLine(msg: any): void {
  // Extract session info from system init
  if (msg.type === "system" && msg.subtype === "init") {
    claudeSessionId = msg.session_id
    claudeModel = msg.model
    claudeReady = true
    console.log(`[bridge] Claude init — session: ${claudeSessionId}, model: ${claudeModel}`)

    // Configure MCP servers now that Claude is ready
    configureMcpServers()

    // Notify clients
    broadcastToClients({ type: "system", event: "claude_connected" })
    return
  }

  // Handle control requests (permission gating, etc.)
  if (msg.type === "control_request") {
    handleControlRequest(msg)
    return // Don't forward control requests to clients
  }

  // Absorb control responses (acks from mcp_set_servers, etc.) — don't leak to clients
  if (msg.type === "control_response") {
    handleControlResponse(msg)
    return
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
    isClaudeConnected: () => isClaudeConnected(),
  }

  processEnvelope(envelope, handlerContext).catch((err) => {
    console.error("[bridge] Claude→client handler error:", err)
  })
}

// ─── Control Requests ───────────────────────────────────────

function handleControlRequest(msg: any): void {
  const subtype = msg.request?.subtype

  if (subtype === "can_use_tool") {
    // Auto-approve tool use — MCP tools are dispatched via the bridge
    console.log(`[bridge] Auto-approving tool: ${msg.request?.tool_name || "unknown"}`)
    sendRawToCli({
      type: "control_response",
      request_id: msg.request_id,
      response: { approved: true },
    })
    return
  }

  console.log(`[bridge] Unhandled control request: ${subtype}`)
}

function handleControlResponse(msg: any): void {
  if (msg.request_id === mcpRequestId) {
    mcpConfigured = true
    mcpRequestId = null
    console.log("[bridge] MCP servers configured — bridge fully ready")
    flushPending()
    return
  }

  console.log(`[bridge] control_response for request: ${msg.request_id}`)
}

/** Flush pending user messages to Claude once fully ready (WS + init + MCP). */
function flushPending(): void {
  if (pendingForCli.length === 0 || !cliSocket) return
  console.log(`[bridge] Flushing ${pendingForCli.length} pending messages to Claude`)
  for (const m of pendingForCli) {
    cliSocket.send(m)
  }
  pendingForCli = []
}

function configureMcpServers(): void {
  console.log("[bridge] Configuring MCP servers via control request...")

  const thisDir = dirname(fileURLToPath(import.meta.url))
  const repoRoot = resolve(thisDir, "../../../")

  mcpRequestId = randomUUID()
  sendRawToCli({
    type: "control_request",
    request_id: mcpRequestId,
    request: {
      subtype: "mcp_set_servers",
      servers: {
        "atlas-browser": {
          type: "stdio",
          command: "bun",
          args: ["run", resolve(repoRoot, "packages/bridge/src/tools/mcp-server.ts")],
        },
      },
    },
  })
}

// ─── Client → Claude Translation ────────────────────────────

function sendToClaude(clientMessage: any): void {
  if (!isClaudeConnected() && !isClaudeRunning()) {
    console.warn("[bridge] Cannot send — Claude not running")
    return
  }

  if (!claudeReady || !mcpConfigured) {
    console.log("[bridge] Claude not fully ready — queuing message")
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
      parent_tool_use_id: null,
      session_id: "",
    }
  } else {
    // Pass through any other message types as-is
    claudeMessage = clientMessage
  }

  const ndjson = JSON.stringify(claudeMessage) + "\n"
  console.log(`[bridge] → Claude: type=${claudeMessage.type} (${ndjson.length} bytes)`)

  if (cliSocket) {
    cliSocket.send(ndjson)
  } else {
    pendingForCli.push(ndjson)
  }
}

/** Send a raw message to CLI without translation (control messages, etc.) */
function sendRawToCli(msg: any): void {
  const ndjson = JSON.stringify(msg) + "\n"

  if (cliSocket) {
    cliSocket.send(ndjson)
  } else {
    pendingForCli.push(ndjson)
  }
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
      isClaudeConnected: () => isClaudeConnected(),
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

  // WebSocket upgrade for /client (Chrome extension)
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

  // WebSocket upgrade for /ws/cli/:sessionId (Claude Code connects back)
  const cliMatch = url.pathname.match(/^\/ws\/cli\/([a-f0-9-]+)$/)
  if (cliMatch) {
    const sessionId = cliMatch[1]

    if (sessionId !== expectedCliSessionId) {
      console.warn(`[bridge] Unexpected CLI session: ${sessionId} (expected ${expectedCliSessionId})`)
      return new Response("Invalid session", { status: 403 })
    }

    const upgraded = server.upgrade(req, {
      data: { id: "claude-ws", role: "claude" as const } satisfies WsData,
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
      claude: isClaudeConnected() ? "connected" : isClaudeRunning() ? "connecting" : "disconnected",
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
      if (ws.data.role === "claude") {
        // Claude Code connected back via --sdk-url
        handleCliOpen(ws)
      } else {
        // Chrome extension client connected
        addConnection(ws)

        // Send current Claude status
        ws.send(JSON.stringify({
          type: "system",
          event: isClaudeConnected() ? "claude_connected" : "claude_disconnected",
          data: {
            session_id: claudeSessionId,
            model: claudeModel,
          },
        }))
      }
    },

    message(ws: ServerWebSocket<WsData>, message: string | Buffer) {
      if (ws.data.role === "claude") {
        handleCliMessage(message)
      } else {
        handleClientMessage(ws, message)
      }
    },

    close(ws: ServerWebSocket<WsData>, code: number, reason: string) {
      if (ws.data.role === "claude") {
        handleCliClose()
      } else {
        removeConnection(ws.data.id)
      }
    },

    ping() {
      // Bun handles pong automatically
    },
  },
})

startHealthChecks()

// ─── Identity Hydration ──────────────────────────────────────
// Resolve bridge.soul + bridge.goals from Notion and hydrate the system preamble
// BEFORE spawning Claude. ADR-001: Notion governs all prompts.
// ADR-008: Identity resolution failure is a hard error.

async function hydrateBridgeIdentity(): Promise<void> {
  try {
    const result = await composeBridgePrompt()
    hydrateSystemPreamble(result.prompt)
    if (result.warnings.length > 0) {
      console.warn("[bridge] Identity hydration warnings:", result.warnings)
    }
    console.log(
      `[bridge] Bridge identity hydrated — ` +
      `soul: ${result.components.soul ? "OK" : "MISSING"}, ` +
      `user: ${result.components.user ? "OK" : "skipped"}, ` +
      `memory: ${result.components.memory ? "OK" : "skipped"}, ` +
      `goals: ${result.components.goals ? "OK" : "skipped"} ` +
      `(${result.tokenCount} tokens)`,
    )

    // Run staleness detection if goals loaded successfully
    if (result.components.goals) {
      try {
        // Extract goals content from the prompt (between "## Active Goals" and next "---")
        const goalsMatch = result.prompt.match(/## Active Goals & Projects\n([\s\S]*?)(?=\n---\n|$)/)
        if (goalsMatch) {
          const report = await detectStaleness(goalsMatch[1])
          if (report.hasStaleProjects) {
            console.log(
              `[bridge] Staleness check: ${report.staleProjects.length} stale project(s) detected ` +
              `out of ${report.totalChecked} checked`,
            )
            for (const sp of report.staleProjects) {
              console.log(`[bridge]   ${sp.severity === "consider_archive" ? "⚠️" : "ℹ️"} ${sp.nudgeText}`)
            }
          } else {
            console.log(`[bridge] Staleness check: all ${report.totalChecked} projects active`)
          }
        }
      } catch (stalenessErr) {
        // Staleness is advisory — don't block startup on failure
        console.warn("[bridge] Staleness check failed (non-blocking):", stalenessErr)
      }
    }
  } catch (err) {
    console.error("[bridge] FATAL: Bridge identity hydration failed:", err)
    console.error("[bridge] Cannot start without identity. Check Notion System Prompts DB.")
    process.exit(1)
  }
}

// Startup sequence: validate databases → hydrate identity → spawn Claude
async function startBridge(): Promise<void> {
  // 1. Validate database access (ADR-008: fail fast)
  const dbReport = await runBridgeHealthCheck()
  if (!dbReport.allCriticalPassed) {
    console.error("[bridge] FATAL: Critical databases unreachable. Cannot start.")
    process.exit(1)
  }

  // 2. Hydrate identity from Notion
  await hydrateBridgeIdentity()

  // 3. Spawn Claude Code
  spawnClaude()
}

startBridge()

console.log(`
  ╔══════════════════════════════════════════════════╗
  ║         Atlas Bridge v0.6.0 (SDK URL)            ║
  ║──────────────────────────────────────────────────║
  ║  Client WS : ws://localhost:${PORT}/client          ║
  ║  CLI WS    : ws://localhost:${PORT}/ws/cli/:id      ║
  ║  Status    : http://localhost:${PORT}/status         ║
  ║  Spawn     : POST http://localhost:${PORT}/spawn     ║
  ║  Kill      : POST http://localhost:${PORT}/kill      ║
  ║  Tools     : POST http://localhost:${PORT}/tool-dispatch ║
  ╚══════════════════════════════════════════════════╝

  Claude Code connects via --sdk-url WebSocket.
  MCP servers configured after init via control request.
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
