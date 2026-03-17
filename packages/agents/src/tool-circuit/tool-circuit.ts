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
import { logAction } from "../skills/action-log"

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
  logToolEvent(toolName, decision).catch((err) => {
    console.warn("[tool-circuit] Telemetry log failed:", (err as Error).message)
  })

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
      let approvalMessage = config?.approvalMessageTemplate || `CC wants to use ${toolName}. Allow? (yes / no / always)`
      // Replace {query} placeholder with tool name for now
      // (full input extraction is a follow-on — requires parsing tool_use input)
      approvalMessage = approvalMessage.replace("{query}", toolName)

      return {
        action: "hold",
        zone,
        approvalMessage,
        matched,
        toolPattern: config?.toolPattern,
      }
    }

    case "red": {
      const blockReason = config?.blockMessageTemplate || `Tool "${toolName}" is blocked. This action requires human decision.`
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

async function logToolEvent(toolName: string, decision: CircuitDecision): Promise<void> {
  try {
    await logAction({
      actionType: "tool",
      description: `Tool call: ${toolName} → ${decision.zone}/${decision.action}`,
      pillar: "The Grove",
      requestType: "Quick",
      metadata: {
        toolName,
        zone: decision.zone,
        action: decision.action,
        matched: decision.matched,
        toolPattern: decision.toolPattern || "default",
      },
    })
  } catch {
    // Telemetry failure is non-fatal — ADR-008 applies to tool blocking, not logging
  }
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
  try {
    await logAction({
      actionType: "tool",
      description: `Yellow approval: ${toolName} → ${outcome}${outcome === "always" ? " (promoting to Green)" : ""}`,
      pillar: "The Grove",
      requestType: "Quick",
      metadata: {
        toolName,
        zone: "yellow",
        action: outcome,
        toolPattern: toolPattern || "unknown",
        timestamp: new Date().toISOString(),
        surface: "telegram",
      },
    })
  } catch {
    // Non-fatal
  }
}

// ─── Exports for promotion ──────────────────────────────

export { invalidateZoneCache }
