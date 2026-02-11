/**
 * Relay Handler — Phase 3 passthrough that forwards messages between
 * Claude Code and clients without modification.
 *
 * Phase 5: a triage handler will be inserted BEFORE this in the chain,
 * intercepting client→claude messages for cognitive routing.
 */

import type { HandlerFn } from "../types/bridge"

export const relayHandler: HandlerFn = (envelope, context, next) => {
  const { direction, message, sourceConnectionId } = envelope

  if (direction === "client_to_claude") {
    // Client → Claude Code: forward if connected
    if (context.isClaudeConnected()) {
      context.sendToClaude(message as any)
    } else {
      // Claude not connected — send error back to the client
      context.sendToClient(sourceConnectionId, {
        type: "system",
        event: "error",
        data: {
          code: "CLAUDE_NOT_CONNECTED",
          message: "Claude Code is not connected. Start it with: claude --sdk-url ws://localhost:3848/claude",
        },
      })
    }
  } else {
    // Claude Code → Client(s): broadcast to all connected clients
    context.broadcastToClients(message as any)
  }

  // Call next() to allow future middleware to observe (logging, metrics, etc.)
  next()
}
