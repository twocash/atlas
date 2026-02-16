/**
 * Connection Manager — tracks Claude Code (single) and client (multiple) WebSocket connections.
 *
 * Phase 3: simple Map-based tracking with ping/pong health checks.
 * Phase 5+: sessions, authentication, rate limiting.
 */

import type { ServerWebSocket } from "bun"
import type { ConnectionRole, ConnectionInfo, WsData } from "./types/bridge"

// ─── Connection Store ────────────────────────────────────────

const connections = new Map<string, ServerWebSocket<WsData>>()
let claudeConnectionId: string | null = null

// ─── Public API ──────────────────────────────────────────────

export function addConnection(ws: ServerWebSocket<WsData>): void {
  const { id, role } = ws.data

  if (role === "claude") {
    // Only one Claude Code connection at a time
    if (claudeConnectionId && connections.has(claudeConnectionId)) {
      const old = connections.get(claudeConnectionId)!
      console.log(`[bridge] Replacing existing Claude connection ${claudeConnectionId}`)
      old.close(1000, "replaced by new Claude connection")
      connections.delete(claudeConnectionId)
    }
    claudeConnectionId = id
  }

  connections.set(id, ws)
  console.log(`[bridge] ${role} connected: ${id} (total: ${connections.size})`)
}

export function removeConnection(id: string): void {
  const ws = connections.get(id)
  if (!ws) return

  const { role } = ws.data
  connections.delete(id)

  if (role === "claude" && claudeConnectionId === id) {
    claudeConnectionId = null
  }

  console.log(`[bridge] ${role} disconnected: ${id} (total: ${connections.size})`)
}

export function getConnection(id: string): ServerWebSocket<WsData> | undefined {
  return connections.get(id)
}

export function getClaudeConnection(): ServerWebSocket<WsData> | undefined {
  if (!claudeConnectionId) return undefined
  return connections.get(claudeConnectionId)
}

export function isClaudeConnected(): boolean {
  return claudeConnectionId !== null && connections.has(claudeConnectionId)
}

export function getClientConnections(): ServerWebSocket<WsData>[] {
  return Array.from(connections.values()).filter((ws) => ws.data.role === "client")
}

export function getConnectionCount(): { claude: number; clients: number } {
  let clients = 0
  for (const ws of connections.values()) {
    if (ws.data.role === "client") clients++
  }
  return {
    claude: claudeConnectionId && connections.has(claudeConnectionId) ? 1 : 0,
    clients,
  }
}

export function listConnections(): ConnectionInfo[] {
  const now = new Date().toISOString()
  return Array.from(connections.values()).map((ws) => ({
    id: ws.data.id,
    role: ws.data.role,
    connectedAt: now, // Phase 3: no per-connection timestamp tracking yet
    lastActivity: now,
  }))
}

// ─── Health Check ────────────────────────────────────────────

const PING_INTERVAL = 30_000 // 30s
let pingTimer: ReturnType<typeof setInterval> | null = null

export function startHealthChecks(): void {
  if (pingTimer) return

  pingTimer = setInterval(() => {
    for (const [id, ws] of connections) {
      try {
        ws.ping()
      } catch {
        console.log(`[bridge] Ping failed for ${id}, removing`)
        removeConnection(id)
      }
    }
  }, PING_INTERVAL)

  console.log(`[bridge] Health checks started (${PING_INTERVAL / 1000}s interval)`)
}

export function stopHealthChecks(): void {
  if (pingTimer) {
    clearInterval(pingTimer)
    pingTimer = null
  }
}
