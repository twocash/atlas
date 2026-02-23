/**
 * Self-Model Dashboard Display — ASCII rendering for supervisor.
 *
 * Renders a compact health section for the supervisor dashboard
 * showing self-model status, layer counts, and degraded capabilities.
 *
 * Sprint: CONV-ARCH-001 (Post-Sprint Addendum)
 */

import { getSelfModelHealth } from "./health"
import type { SelfModelHealth } from "./health"

// ─── Status Icons ────────────────────────────────────────

const STATUS_ICON: Record<SelfModelHealth["status"], string> = {
  healthy: "[OK]",
  degraded: "[!!]",
  critical: "[XX]",
  unavailable: "[--]",
}

// ─── Formatting Helpers ──────────────────────────────────

function formatTtl(ms: number): string {
  if (ms <= 0) return "expired"
  const mins = Math.floor(ms / 60000)
  const secs = Math.floor((ms % 60000) / 1000)
  if (mins > 0) return `${mins}m ${secs}s`
  return `${secs}s`
}

function pad(str: string, width: number): string {
  return str.length >= width ? str.substring(0, width) : str + " ".repeat(width - str.length)
}

// ─── Dashboard Renderer ──────────────────────────────────

/**
 * Render the self-model health section for the supervisor dashboard.
 *
 * Returns an array of lines (without trailing newline) suitable for
 * console output or embedding in a larger dashboard.
 */
export function renderSelfModelDashboard(): string[] {
  const health = getSelfModelHealth()
  return renderFromHealth(health)
}

/**
 * Render from a pre-fetched health object (for testing).
 */
export function renderFromHealth(health: SelfModelHealth): string[] {
  const lines: string[] = []
  const W = 55 // inner width

  lines.push("+" + "-".repeat(W) + "+")
  lines.push("|" + pad("  SELF-MODEL", W) + "|")
  lines.push("+" + "-".repeat(W) + "+")

  if (health.status === "unavailable") {
    lines.push("|" + pad(`  Status: ${STATUS_ICON.unavailable} Not assembled`, W) + "|")
    if (health.error) {
      lines.push("|" + pad(`  Error:  ${health.error.substring(0, 42)}`, W) + "|")
    }
    lines.push("|" + pad("  (waiting for first request)", W) + "|")
    lines.push("+" + "-".repeat(W) + "+")
    return lines
  }

  // Status line
  const icon = STATUS_ICON[health.status]
  const ttl = formatTtl(health.ttlRemaining)
  lines.push("|" + pad(`  Status: ${icon} ${health.status.toUpperCase()}    TTL: ${ttl}`, W) + "|")

  // Layer counts
  const { skills, highSuccess, mcpConnected, mcpTotal, ragWorkspaces } = health.counts
  lines.push("|" + pad(`  Skills: ${skills} active (${highSuccess} high-success)`, W) + "|")
  lines.push("|" + pad(`  MCP:    ${mcpConnected}/${mcpTotal} connected`, W) + "|")
  lines.push("|" + pad(`  RAG:    ${ragWorkspaces} workspace(s)`, W) + "|")

  // Degraded section (only if not healthy)
  if (health.degraded.length > 0) {
    lines.push("|" + " ".repeat(W) + "|")
    lines.push("|" + pad("  Degraded:", W) + "|")
    for (const d of health.degraded.slice(0, 5)) {
      lines.push("|" + pad(`    - ${d}`, W) + "|")
    }
    if (health.degraded.length > 5) {
      lines.push("|" + pad(`    ... and ${health.degraded.length - 5} more`, W) + "|")
    }
  }

  lines.push("+" + "-".repeat(W) + "+")
  return lines
}

/**
 * Render a single-line compact status for inline display.
 */
export function renderSelfModelInline(): string {
  const health = getSelfModelHealth()
  const icon = STATUS_ICON[health.status]
  const { skills, mcpConnected, mcpTotal, ragWorkspaces } = health.counts
  return `Self-Model ${icon} skills=${skills} mcp=${mcpConnected}/${mcpTotal} rag=${ragWorkspaces}`
}
