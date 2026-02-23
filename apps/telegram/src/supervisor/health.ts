/**
 * Self-Model Health — Supervisor integration for self-model status.
 *
 * Provides a supervisor-consumable view of the self-model's current state:
 * cache status, layer counts, degraded capabilities, and TTL remaining.
 *
 * Used by the supervisor dashboard to surface self-model health
 * without importing the full assembler/matcher pipeline.
 *
 * Sprint: CONV-ARCH-001 (Post-Sprint Addendum)
 */

import { getCachedModel } from "../../../../packages/agents/src/self-model"
import { SELF_MODEL_DEFAULTS } from "../../../../packages/agents/src/self-model/types"

// ─── Types ───────────────────────────────────────────────

export interface SelfModelHealth {
  /** Overall self-model status */
  status: "healthy" | "degraded" | "critical" | "unavailable"
  /** When the model was last assembled (ISO 8601), or null */
  lastRefresh: string | null
  /** Milliseconds remaining before cache expires, or 0 if expired/unavailable */
  ttlRemaining: number
  /** Layer counts */
  counts: {
    skills: number
    /** Skills with successRate >= 0.8 */
    highSuccess: number
    mcpConnected: number
    mcpTotal: number
    ragWorkspaces: number
  }
  /** List of degraded capability identifiers */
  degraded: string[]
  /** Error message if self-model is broken */
  error?: string
}

// ─── Health Function ─────────────────────────────────────

/**
 * Get the current self-model health from the cached capability model.
 *
 * Does NOT trigger a new assembly — reads from cache only.
 * Returns "unavailable" status if no model has been assembled yet.
 */
export function getSelfModelHealth(): SelfModelHealth {
  try {
    const model = getCachedModel()

    if (!model) {
      return {
        status: "unavailable",
        lastRefresh: null,
        ttlRemaining: 0,
        counts: { skills: 0, highSuccess: 0, mcpConnected: 0, mcpTotal: 0, ragWorkspaces: 0 },
        degraded: [],
      }
    }

    // Compute TTL remaining
    const assembledTime = new Date(model.assembledAt).getTime()
    const elapsed = Date.now() - assembledTime
    const ttlRemaining = Math.max(0, SELF_MODEL_DEFAULTS.cacheTtlMs - elapsed)

    // Count high-success skills (>= 0.8 success rate)
    const highSuccess = model.skills.filter(
      (s) => s.available && s.successRate !== undefined && s.successRate >= 0.8,
    ).length

    // Count connected MCP servers
    const mcpConnected = model.mcpTools.filter((m) => m.connected).length

    // Count available RAG workspaces
    const ragWorkspaces = model.knowledge.filter((k) => k.available).length

    return {
      status: model.health.status,
      lastRefresh: model.assembledAt,
      ttlRemaining,
      counts: {
        skills: model.skills.filter((s) => s.available).length,
        highSuccess,
        mcpConnected,
        mcpTotal: model.mcpTools.length,
        ragWorkspaces,
      },
      degraded: model.health.degradedCapabilities,
    }
  } catch (err) {
    return {
      status: "unavailable",
      lastRefresh: null,
      ttlRemaining: 0,
      counts: { skills: 0, highSuccess: 0, mcpConnected: 0, mcpTotal: 0, ragWorkspaces: 0 },
      degraded: [],
      error: (err as Error).message,
    }
  }
}
