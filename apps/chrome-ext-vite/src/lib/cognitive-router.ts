/**
 * Cognitive Router — Gate 1.6
 *
 * Maps interaction tier + task complexity + Bridge connectivity
 * to the appropriate LLM backend. Gives tier classification a
 * second job: routing key for backend selection.
 *
 * ~80% of replies (general + recruiting) → Haiku (FAST)
 * ~20% (grove + consulting with active Bridge) → Claude Code
 *
 * Pure function `resolveRoute()` has zero side effects.
 * Thin wrapper `resolveRouteWithBridgeStatus()` reads live
 * Bridge status from the singleton monitor.
 */

import type { InteractionTier } from "~src/types/classification"
import type {
  CognitiveRouterInput,
  RoutingDecision,
  RoutingBackend,
  TaskComplexity,
  BridgeStatus,
} from "~src/types/routing"
import { getStatus } from "./bridge-status"

// ─── Helpers ──────────────────────────────────────────────

function bridgeIsReady(status: BridgeStatus): boolean {
  return status.bridge === "connected" && status.claude === "connected"
}

function decision(
  backend: RoutingBackend,
  rationale: string,
  taskTier: "fast" | "smart",
  resolvedTier: InteractionTier,
  fallbackChain: RoutingBackend[] = [],
  fallbackReason?: string,
): RoutingDecision {
  return { backend, rationale, taskTier, resolvedTier, fallbackChain, fallbackReason }
}

// ─── Pure Routing Function ────────────────────────────────

/**
 * Resolve the optimal backend for a given request.
 * Pure function — no side effects, fully testable.
 *
 * Routing matrix (from contract):
 *
 * | Tier        | Bridge | Task            | Backend        | TaskTier |
 * |-------------|--------|-----------------|----------------|----------|
 * | grove       | Yes    | Any             | claude_code    | smart    |
 * | grove       | No     | Any             | haiku          | smart    |
 * | consulting  | Yes    | draft           | claude_code    | smart    |
 * | consulting  | No     | draft           | haiku          | smart    |
 * | consulting  | Either | classification  | haiku          | fast     |
 * | consulting  | Either | socratic_q      | haiku          | fast     |
 * | recruiting  | Either | Any             | haiku          | fast     |
 * | general     | Either | Any             | haiku          | fast     |
 * | Any         | Either | status_write    | deterministic  | fast     |
 * | Any         | Either | socratic_q      | haiku          | fast     |
 */
export function resolveRoute(input: CognitiveRouterInput): RoutingDecision {
  const tier: InteractionTier = input.tier ?? "general"
  const task = input.taskComplexity
  const bridge = input.bridgeStatus

  // ── Deterministic tasks need no LLM ─────────────────────
  if (task === "status_write") {
    return decision(
      "template_fallback",
      "Status writes are deterministic — no LLM needed",
      "fast",
      tier,
    )
  }

  // ── Socratic questions are always lightweight ───────────
  if (task === "socratic_question") {
    return decision(
      "haiku",
      "Socratic questions are bounded — Haiku is sufficient",
      "fast",
      tier,
    )
  }

  // ── Classification tasks are always lightweight ─────────
  if (task === "classification") {
    return decision(
      "haiku",
      "Classification is a lightweight task — Haiku FAST",
      "fast",
      tier,
    )
  }

  // ── Draft routing: tier × bridge ────────────────────────

  if (tier === "grove") {
    if (bridgeIsReady(bridge)) {
      return decision(
        "claude_code",
        "Grove tier + Bridge connected → full cognitive stack",
        "smart",
        tier,
        ["haiku", "template_fallback"],
      )
    }
    return decision(
      "haiku",
      "Grove tier but Bridge unavailable → Sonnet fallback",
      "smart",
      tier,
      ["template_fallback"],
      `Bridge ${bridge.bridge}, Claude ${bridge.claude}`,
    )
  }

  if (tier === "consulting") {
    if (bridgeIsReady(bridge)) {
      return decision(
        "claude_code",
        "Consulting tier + Bridge connected → MCP tool access for client-facing work",
        "smart",
        tier,
        ["haiku", "template_fallback"],
      )
    }
    return decision(
      "haiku",
      "Consulting tier but Bridge unavailable → Sonnet fallback",
      "smart",
      tier,
      ["template_fallback"],
      `Bridge ${bridge.bridge}, Claude ${bridge.claude}`,
    )
  }

  if (tier === "recruiting") {
    return decision(
      "haiku",
      "Recruiting tier → lightweight engagement, Haiku FAST",
      "fast",
      tier,
    )
  }

  // general (default)
  return decision(
    "haiku",
    "General tier → acknowledgment-level reply, Haiku FAST",
    "fast",
    tier,
  )
}

// ─── Live Wrapper ─────────────────────────────────────────

/**
 * Resolve route using live Bridge status from the singleton monitor.
 * Convenience wrapper for production use — calls resolveRoute() internally.
 */
export function resolveRouteWithBridgeStatus(
  tier: InteractionTier | undefined,
  taskComplexity: TaskComplexity,
): RoutingDecision {
  const bridgeStatus = getStatus()
  const result = resolveRoute({ tier, taskComplexity, bridgeStatus })
  console.log(
    `[Atlas Router] ${result.resolvedTier}/${taskComplexity} → ${result.backend} (${result.rationale})`,
  )
  return result
}
