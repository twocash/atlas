/**
 * Bridge-specific types — message envelopes, connection state,
 * and handler interfaces for the middleware chain.
 */

import type { ServerWebSocket } from "bun"
import type { ClientToClaudeMessage, ClaudeToClientMessage } from "./sdk-protocol"

// ─── Connection Types ────────────────────────────────────────

export type ConnectionRole = "claude" | "client"

export interface ConnectionInfo {
  id: string
  role: ConnectionRole
  connectedAt: string
  lastActivity: string
}

export type ConnectionState = "disconnected" | "connecting" | "connected" | "error"

export interface BridgeStatus {
  claude: ConnectionState
  clients: number
  uptime: number
  startedAt: string
}

// ─── Message Envelope ────────────────────────────────────────

/**
 * Every message flowing through the bridge is wrapped in an envelope
 * with metadata the routing layer (Phase 5) will need.
 */
export interface BridgeEnvelope {
  /** The raw message from client or Claude Code */
  message: ClientToClaudeMessage | ClaudeToClientMessage

  /** Which surface sent this (chrome_extension, telegram, cli, etc.) */
  surface: string

  /** Session identifier for multi-turn conversations */
  sessionId: string

  /** ISO timestamp when the bridge received this message */
  timestamp: string

  /** Direction of the message */
  direction: "client_to_claude" | "claude_to_client"

  /** The connection that sent this message */
  sourceConnectionId: string
}

// ─── Handler Chain (Middleware Pattern) ──────────────────────

/**
 * A handler function in the middleware chain.
 * Process the envelope and optionally call next() to pass downstream.
 *
 * Phase 3: single handler (relay passthrough)
 * Phase 5: triage handler inserted before relay
 */
export type HandlerFn = (
  envelope: BridgeEnvelope,
  context: HandlerContext,
  next: () => void,
) => void | Promise<void>

export interface HandlerContext {
  /** Send a message to Claude Code */
  sendToClaude: (message: ClientToClaudeMessage) => void

  /** Send a message to a specific client */
  sendToClient: (connectionId: string, message: ClaudeToClientMessage) => void

  /** Send a message to all connected clients */
  broadcastToClients: (message: ClaudeToClientMessage) => void

  /** Check if Claude Code is connected */
  isClaudeConnected: () => boolean
}

// ─── WebSocket Data ──────────────────────────────────────────

/** Attached to each Bun WebSocket for identification */
export interface WsData {
  id: string
  role: ConnectionRole
}
