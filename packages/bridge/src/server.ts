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
import type { WsData, BridgeEnvelope, HandlerContext } from "./types/bridge"
import {
  addConnection,
  removeConnection,
  getClientConnections,
  getConnectionCount,
  startHealthChecks,
  stopHealthChecks,
} from "./connections"

// ─── Config ──────────────────────────────────────────────────

const PORT = parseInt(process.env.BRIDGE_PORT || "3848", 10)
const CLAUDE_CMD = process.env.CLAUDE_PATH || "claude"
const startedAt = new Date().toISOString()

// ─── Claude Process Management ───────────────────────────────

let claudeProcess: Subprocess | null = null
let claudeSessionId: string | null = null
let claudeModel: string | null = null
let stdoutBuffer = ""

function isClaudeRunning(): boolean {
  return claudeProcess !== null && claudeProcess.exitCode === null
}

async function spawnClaude(): Promise<{ ok: boolean; error?: string }> {
  if (isClaudeRunning()) {
    return { ok: true }
  }

  console.log("[bridge] Spawning Claude Code...")

  try {
    claudeProcess = spawn({
      cmd: [CLAUDE_CMD, "-p",
        "--input-format", "stream-json",
        "--output-format", "stream-json",
        "--verbose",
      ],
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
    broadcastToClients({ type: "system", event: "claude_disconnected" })
  }
}

async function readClaudeStdout(): Promise<void> {
  if (!claudeProcess?.stdout) return

  const reader = claudeProcess.stdout.getReader()
  const decoder = new TextDecoder()

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

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
    console.log(`[bridge] Claude init — session: ${claudeSessionId}, model: ${claudeModel}`)
  }

  // Forward everything to all connected clients
  const raw = JSON.stringify(msg)
  for (const ws of getClientConnections()) {
    ws.send(raw)
  }
}

// ─── Client → Claude Translation ────────────────────────────

function sendToClaude(clientMessage: any): void {
  if (!isClaudeRunning() || !claudeProcess?.stdin) {
    console.warn("[bridge] Cannot send — Claude not running")
    return
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

    if (!isClaudeRunning()) {
      ws.send(JSON.stringify({
        type: "system",
        event: "error",
        data: {
          code: "CLAUDE_NOT_RUNNING",
          message: "Claude Code is not running. Send POST /spawn to start it.",
        },
      }))
      return
    }

    sendToClaude(parsed)
  }
}

function broadcastToClients(msg: any): void {
  const raw = JSON.stringify(msg)
  for (const ws of getClientConnections()) {
    ws.send(raw)
  }
}

// ─── HTTP Handler ────────────────────────────────────────────

function handleHttpRequest(req: Request, server: any): Response | undefined {
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
  ╔══════════════════════════════════════════════╗
  ║         Atlas Bridge v0.2.0                  ║
  ║──────────────────────────────────────────────║
  ║  Client WS : ws://localhost:${PORT}/client      ║
  ║  Status    : http://localhost:${PORT}/status     ║
  ║  Spawn     : POST http://localhost:${PORT}/spawn ║
  ║  Kill      : POST http://localhost:${PORT}/kill  ║
  ╚══════════════════════════════════════════════╝

  Claude Code is managed as a child process.
  No separate terminal needed.
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
