/**
 * BridgeClient — Standalone WebSocket client for Bridge communication.
 *
 * Gate 1.7: Framework-agnostic Bridge client usable from both the
 * useClaudeCode() React hook (sidepanel) and background script.
 *
 * Each JS context (sidepanel, background) gets its own singleton.
 * The Bridge server handles multiple concurrent clients.
 *
 * The hook delegates connect/send to this client.
 * The background uses it for CLAUDE_CODE_DISPATCH one-shot messages.
 */

import type { ContentBlock, BridgeConnectionState } from "../types/claude-sdk"
import {
  updateBridgeState as monitorUpdateBridge,
  updateClaudeState as monitorUpdateClaude,
  getStatus,
} from "./bridge-status"

// ─── Config ──────────────────────────────────────────────

const DEFAULT_BRIDGE_WS_URL = "ws://localhost:3848/client"
const BRIDGE_URL_STORAGE_KEY = "atlas:bridge-url"
const RECONNECT_BASE = 2000
const RECONNECT_MAX = 30000
const RECONNECT_BACKOFF = 1.5

async function getBridgeUrl(): Promise<string> {
  try {
    const result = await chrome.storage.local.get(BRIDGE_URL_STORAGE_KEY)
    const stored = result[BRIDGE_URL_STORAGE_KEY]
    if (stored && typeof stored === "string" && stored.startsWith("ws")) return stored
  } catch { /* storage unavailable */ }
  return DEFAULT_BRIDGE_WS_URL
}

// ─── Types ───────────────────────────────────────────────

export type MessageHandler = (raw: string) => void

// ─── Singleton Client ────────────────────────────────────

let ws: WebSocket | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let reconnectDelay = RECONNECT_BASE
let active = false

const messageHandlers = new Set<MessageHandler>()

/** Register a handler for raw incoming WebSocket messages. Returns unsubscribe. */
export function onMessage(handler: MessageHandler): () => void {
  messageHandlers.add(handler)
  return () => { messageHandlers.delete(handler) }
}

/** Connect to Bridge WebSocket. Safe to call multiple times. */
export async function connect(): Promise<void> {
  if (ws?.readyState === WebSocket.OPEN) return
  if (ws?.readyState === WebSocket.CONNECTING) return

  active = true
  monitorUpdateBridge("connecting")

  const url = await getBridgeUrl()
  console.log(`[bridge-client] Connecting: ${url}`)
  const socket = new WebSocket(url)

  socket.onopen = () => {
    if (!active) return
    monitorUpdateBridge("connected")
    reconnectDelay = RECONNECT_BASE
    console.log("[bridge-client] Connected")
  }

  socket.onclose = () => {
    if (!active) return
    monitorUpdateBridge("disconnected")
    scheduleReconnect()
  }

  socket.onerror = () => {
    if (!active) return
    monitorUpdateBridge("error")
  }

  socket.onmessage = (event) => {
    if (!active) return
    const raw = event.data as string
    for (const handler of messageHandlers) {
      try { handler(raw) } catch (e) {
        console.warn("[bridge-client] Handler error:", e)
      }
    }
  }

  ws = socket
}

/** Disconnect and stop reconnecting. */
export function disconnect(): void {
  active = false
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  if (ws) {
    ws.onclose = null // prevent reconnect
    ws.close()
    ws = null
  }
  monitorUpdateBridge("disconnected")
}

/** Send a UserMessage with ContentBlock[] to Bridge. Returns false if not connected. */
export function send(contentBlocks: ContentBlock[]): boolean {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.warn("[bridge-client] Cannot send — not connected")
    return false
  }

  const payload = {
    type: "user_message",
    content: contentBlocks,
  }
  ws.send(JSON.stringify(payload))
  return true
}

/** Send raw JSON string to Bridge. Used by hook for tool responses. */
export function sendRaw(json: string): boolean {
  if (!ws || ws.readyState !== WebSocket.OPEN) return false
  ws.send(json)
  return true
}

/** Check if WebSocket is currently open. */
export function isConnected(): boolean {
  return ws?.readyState === WebSocket.OPEN
}

/** Notify monitor of Claude CLI status (called by hook on system events). */
export function setClaudeStatus(state: "connected" | "disconnected"): void {
  monitorUpdateClaude(state)
}

// ─── Internal ────────────────────────────────────────────

function scheduleReconnect(): void {
  if (!active) return
  if (reconnectTimer) clearTimeout(reconnectTimer)
  reconnectTimer = setTimeout(() => {
    if (active) {
      reconnectDelay = Math.min(reconnectDelay * RECONNECT_BACKOFF, RECONNECT_MAX)
      connect()
    }
  }, reconnectDelay)
}

// Re-export for backward compatibility
export { BRIDGE_URL_STORAGE_KEY, DEFAULT_BRIDGE_WS_URL }
