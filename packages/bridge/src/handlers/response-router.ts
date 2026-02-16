/**
 * Response Router — handles Claude Code output routing.
 *
 * After Claude Code processes the orchestrated prompt, its response
 * flows back through the bridge. The response router:
 *
 * 1. Inspects the response for landing-surface metadata
 * 2. Routes to the appropriate destination:
 *    - "chat": forward to the requesting client (default)
 *    - "notion_feed": create Feed 2.0 entry (future)
 *    - "notion_work_queue": create Work Queue entry (future)
 *    - "notion_page": create/update Notion page (future)
 *
 * Phase 5.0: All responses route to chat (relay passthrough).
 * Phase 5.1: Notion landing surfaces will be wired.
 */

import type { HandlerFn } from "../types/bridge"
import type { LandingSurface } from "../types/orchestration"

// ─── Session Landing Surface Tracking ─────────────────────

/**
 * Map sessionId → landing surface, set by triage handler.
 * Allows the response router to know where to send Claude's response.
 */
const sessionLandingSurfaces = new Map<string, LandingSurface>()

/** Set the landing surface for a session (called by triage handler). */
export function setSessionLandingSurface(sessionId: string, surface: LandingSurface): void {
  sessionLandingSurfaces.set(sessionId, surface)
}

/** Get the landing surface for a session. */
export function getSessionLandingSurface(sessionId: string): LandingSurface {
  return sessionLandingSurfaces.get(sessionId) ?? "chat"
}

/** Clear the landing surface after response is delivered. */
export function clearSessionLandingSurface(sessionId: string): void {
  sessionLandingSurfaces.delete(sessionId)
}

// ─── Response Router Handler ──────────────────────────────

/**
 * Response router middleware — appended AFTER relay in the handler chain.
 *
 * For claude→client direction:
 *   Checks if the session has a non-chat landing surface.
 *   If so, intercepts and routes to Notion (future).
 *   For now, all responses pass through to relay (chat).
 *
 * For client→claude direction: passes through (no-op).
 */
export const responseRouterHandler: HandlerFn = (envelope, context, next) => {
  // Only handle claude→client responses
  if (envelope.direction !== "claude_to_client") {
    next()
    return
  }

  const surface = getSessionLandingSurface(envelope.sessionId)

  if (surface === "chat") {
    // Default: let relay handler broadcast to clients
    next()
    return
  }

  // Future: Notion landing surfaces
  // For Phase 5.0, log and fall through to relay
  const msg = envelope.message as any
  if (msg.type === "result") {
    console.log(
      `[response-router] Session ${envelope.sessionId} has landing surface "${surface}" ` +
      `— Notion routing not yet implemented, falling through to chat`,
    )
    clearSessionLandingSurface(envelope.sessionId)
  }

  // Pass through to relay for now
  next()
}
