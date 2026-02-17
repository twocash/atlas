/**
 * BridgeStatusMonitor — Singleton for Bridge WebSocket status.
 *
 * Gate 1.6: Extracted from useClaudeCode() hook so the cognitive
 * router can read Bridge connectivity outside React context.
 *
 * The hook writes status here; the router reads it. Read-only
 * for router consumers, writable only via update methods.
 */

import type { BridgeConnectionState, BridgeStatus } from "~src/types/claude-sdk"

// ─── Singleton State ──────────────────────────────────────

let bridgeState: BridgeConnectionState = "disconnected"
let claudeState: "connected" | "disconnected" = "disconnected"

type StatusChangeCallback = (status: BridgeStatus) => void
const listeners: Set<StatusChangeCallback> = new Set()

function notifyListeners(): void {
  const status = getStatus()
  for (const cb of listeners) {
    try { cb(status) } catch { /* listener errors are non-fatal */ }
  }
}

// ─── Public API ───────────────────────────────────────────

/**
 * Get current Bridge + Claude connection status.
 * Safe to call from any context (React, background, content script).
 */
export function getStatus(): BridgeStatus {
  return { bridge: bridgeState, claude: claudeState }
}

/**
 * True when both Bridge WebSocket AND Claude CLI session are connected.
 * This is the check the cognitive router uses for claude_code routing.
 */
export function isFullyConnected(): boolean {
  return bridgeState === "connected" && claudeState === "connected"
}

/**
 * Subscribe to status changes. Returns unsubscribe function.
 */
export function onStatusChange(cb: StatusChangeCallback): () => void {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

// ─── Write API (for useClaudeCode hook only) ──────────────

export function updateBridgeState(state: BridgeConnectionState): void {
  if (bridgeState === state) return
  bridgeState = state
  // If bridge disconnects, claude is also disconnected
  if (state !== "connected") {
    claudeState = "disconnected"
  }
  notifyListeners()
}

export function updateClaudeState(state: "connected" | "disconnected"): void {
  if (claudeState === state) return
  claudeState = state
  notifyListeners()
}
