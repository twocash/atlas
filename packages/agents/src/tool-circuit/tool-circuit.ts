/**
 * Tool Circuit — Autonomaton Pattern entry point for CC tool governance.
 *
 * Every tool call flows through here: classify → route → log.
 * Surface-agnostic: lives in packages/agents, callable from any surface.
 * Bridge provides a thin intercept hook and hands off immediately.
 *
 * ADR-005: orchestration layer. ADR-001: Notion governs all.
 * ADR-008: Red blocks are loud. No silent tool executions.
 */

import { classifyTool, invalidateZoneCache, type Zone, type ClassifyResult } from "./tool-zone-classifier"
import { logToolEvent } from "./telemetry"

// ─── Types ───────────────────────────────────────────────

export type CircuitAction = "approve" | "hold" | "block"

export interface CircuitDecision {
  action: CircuitAction
  zone: Zone
  /** For Yellow: approval message to show the user */
  approvalMessage?: string
  /** For Red: block reason returned to CC */
  blockReason?: string
  /** Whether this matched a specific config row */
  matched: boolean
  /** Tool pattern that matched (for telemetry) */
  toolPattern?: string
}

// ─── Circuit ─────────────────────────────────────────────

/**
 * Run the Autonomaton circuit for a tool call.
 *
 * Green → approve (execute immediately)
 * Yellow → hold (route to surface for approval)
 * Red → block (deny with explanation)
 *
 * Every call is logged to Feed 2.0 via logAction().
 */
export async function evaluateToolCall(toolName: string): Promise<CircuitDecision> {
  const classification = await classifyTool(toolName)
  const decision = routeByZone(toolName, classification)

  // Telemetry — log every tool call to Feed 2.0 (fire and forget)
  logCircuitDecision(toolName, decision)

  console.log(`[tool-circuit] ${toolName} → ${decision.zone} → ${decision.action}${decision.matched ? ` (pattern: ${decision.toolPattern})` : " (default)"}`)

  return decision
}

// ─── Zone Routing ────────────────────────────────────────

function routeByZone(toolName: string, classification: ClassifyResult): CircuitDecision {
  const { zone, config, matched } = classification

  switch (zone) {
    case "green":
      return {
        action: "approve",
        zone,
        matched,
        toolPattern: config?.toolPattern,
      }

    case "yellow": {
      // Build approval message from template or default
      let reason = config?.approvalMessageTemplate || `CC wants to use ${toolName}.`
      reason = reason.replace("{query}", toolName)
      // Strip any legacy "(yes / no / always)" suffix — we format with numbered options
      reason = reason.replace(/\s*\(yes\s*\/\s*no\s*\/\s*always\)\s*$/, "")

      // Jidoka: clear reason + Kaizen: numbered options
      const approvalMessage = `${reason}\n\n1. Yes\n2. No\n3. Always (auto-approve this pattern)`

      return {
        action: "hold",
        zone,
        approvalMessage,
        matched,
        toolPattern: config?.toolPattern,
      }
    }

    case "red": {
      // Jidoka: clear reason why blocked
      const reason = config?.blockMessageTemplate || `Tool "${toolName}" is blocked. This action requires human decision.`
      const blockReason = reason
      return {
        action: "block",
        zone,
        blockReason,
        matched,
        toolPattern: config?.toolPattern,
      }
    }
  }
}

// ─── Telemetry ───────────────────────────────────────────

function logCircuitDecision(toolName: string, decision: CircuitDecision): void {
  const actionLabel = decision.action === "approve" ? "auto-approved"
    : decision.action === "hold" ? "held"
    : "blocked"

  logToolEvent({
    toolName,
    zone: decision.zone,
    action: actionLabel,
    toolPattern: decision.toolPattern,
  }).catch((err) => {
    console.warn("[tool-circuit] Telemetry log failed:", (err as Error).message)
  })
}

// ─── Approval Outcome Logging ───────────────────────────

export type ApprovalOutcome = "approved" | "denied" | "always" | "timeout"

/**
 * Log the outcome of a Yellow zone approval request.
 * Called by Bridge after Jim replies to the approval prompt.
 */
export async function logApprovalOutcome(
  toolName: string,
  outcome: ApprovalOutcome,
  toolPattern?: string,
): Promise<void> {
  await logToolEvent({
    toolName,
    zone: "yellow",
    action: outcome,
    toolPattern,
    surface: "telegram",
  })
}

// ─── Exports for promotion ──────────────────────────────

export { invalidateZoneCache }
