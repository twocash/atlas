/**
 * Atlas Bridge Server — Bun WebSocket relay between Chrome extension and Claude Code.
 *
 * Endpoints:
 *   ws://localhost:3848/claude  — Claude Code connects here (single connection)
 *   ws://localhost:3848/client  — Chrome extension side panel connects here (multiple)
 *
 * HTTP endpoints:
 *   GET /status — Bridge health check (JSON)
 *
 * Protocol: NDJSON (newline-delimited JSON) over WebSocket text frames.
 *
 * Usage:
 *   bun run packages/bridge/src/server.ts
 *   claude --sdk-url ws://localhost:3848/claude
 */

import type { ServerWebSocket } from "bun"
import type { WsData, BridgeEnvelope, HandlerContext } from "./types/bridge"
import type { ClientToClaudeMessage, ClaudeToClientMessage } from "./types/sdk-protocol"
import {
  addConnection,
  removeConnection,
  getClaudeConnection,
  getClientConnections,
  getConnectionCount,
  isClaudeConnected,
  startHealthChecks,
  stopHealthChecks,
} from "./connections"
import { processEnvelope } from "./handlers"

// ─── Config ──────────────────────────────────────────────────

const PORT = parseInt(process.env.BRIDGE_PORT || "3848", 10)
const startedAt = new Date().toISOString()

// ─── Handler Context (shared across all envelopes) ───────────

function createHandlerContext(): HandlerContext {
  return {
    sendToClaude(message: ClientToClaudeMessage) {
      const ws = getClaudeConnection()
      if (ws) {
        ws.send(JSON.stringify(message))
      }
    },

    sendToClient(connectionId: string, message: ClaudeToClientMessage) {
      const clients = getClientConnections()
      const target = clients.find((ws) => ws.data.id === connectionId)
      if (target) {
        target.send(JSON.stringify(message))
      }
    },

    broadcastToClients(message: ClaudeToClientMessage) {
      const raw = JSON.stringify(message)
      for (const ws of getClientConnections()) {
        ws.send(raw)
      }
    },

    isClaudeConnected,
  }
}

const handlerContext = createHandlerContext()

// ─── Message Processing ──────────────────────────────────────

function handleMessage(ws: ServerWebSocket<WsData>, raw: string | Buffer): void {
  const text = typeof raw === "string" ? raw : raw.toString()
  const { id, role } = ws.data

  // NDJSON: may contain multiple messages separated by newlines
  const lines = text.split("\n").filter((l) => l.trim())

  for (const line of lines) {
    let parsed: any
    try {
      parsed = JSON.parse(line)
    } catch {
      console.error(`[bridge] Invalid JSON from ${role}:${id}:`, line.slice(0, 100))
      continue
    }

    const envelope: BridgeEnvelope = {
      message: parsed,
      surface: role === "client" ? "chrome_extension" : "claude_code",
      sessionId: parsed.sessionId || "default",
      timestamp: new Date().toISOString(),
      direction: role === "client" ? "client_to_claude" : "claude_to_client",
      sourceConnectionId: id,
    }

    processEnvelope(envelope, handlerContext)
  }
}

// ─── HTTP Handler ────────────────────────────────────────────

function handleHttpRequest(req: Request, server: any): Response | undefined {
  const url = new URL(req.url)

  // WebSocket upgrade for /claude and /client
  if (url.pathname === "/claude" || url.pathname === "/client") {
    const role = url.pathname === "/claude" ? "claude" : "client"
    const id = `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    const upgraded = server.upgrade(req, {
      data: { id, role } satisfies WsData,
    })

    if (!upgraded) {
      return new Response("WebSocket upgrade failed", { status: 500 })
    }
    return undefined // Bun handles the upgrade
  }

  // GET /status — bridge health
  if (url.pathname === "/status" && req.method === "GET") {
    const counts = getConnectionCount()
    const body = {
      status: "ok",
      claude: isClaudeConnected() ? "connected" : "disconnected",
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

  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
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

      // Notify clients when Claude connects
      if (ws.data.role === "claude") {
        const notification = JSON.stringify({
          type: "system",
          event: "claude_connected",
        })
        for (const client of getClientConnections()) {
          client.send(notification)
        }
      }
    },

    message(ws: ServerWebSocket<WsData>, message: string | Buffer) {
      handleMessage(ws, message)
    },

    close(ws: ServerWebSocket<WsData>, code: number, reason: string) {
      const { role, id } = ws.data
      removeConnection(id)

      // Notify clients when Claude disconnects
      if (role === "claude") {
        const notification = JSON.stringify({
          type: "system",
          event: "claude_disconnected",
        })
        for (const client of getClientConnections()) {
          client.send(notification)
        }
      }
    },

    ping(ws: ServerWebSocket<WsData>) {
      // Bun handles pong automatically
    },
  },
})

startHealthChecks()

console.log(`
  ╔══════════════════════════════════════════════╗
  ║         Atlas Bridge v0.1.0                  ║
  ║──────────────────────────────────────────────║
  ║  WebSocket : ws://localhost:${PORT}             ║
  ║  Status    : http://localhost:${PORT}/status     ║
  ║──────────────────────────────────────────────║
  ║  Claude    : ws://localhost:${PORT}/claude       ║
  ║  Client    : ws://localhost:${PORT}/client       ║
  ╚══════════════════════════════════════════════╝

  Start Claude Code with:
    claude --sdk-url ws://localhost:${PORT}/claude
`)

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\n[bridge] Shutting down...")
  stopHealthChecks()
  server.stop()
  process.exit(0)
})

process.on("SIGTERM", () => {
  stopHealthChecks()
  server.stop()
  process.exit(0)
})
