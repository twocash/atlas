/**
 * Dispatch Router — evaluates Work Queue items against dispatch rules.
 *
 * P0: Hardcoded rules array (explicit temporary exception to Constraint 1).
 * P1: Notion-driven rules via BRIDGE_DISPATCH_RULES_NOTION=true.
 *
 * Default-safe: anything unmatched escalates to Jim.
 * Pattern from: apps/telegram/src/skills/zone-classifier.ts (allowlist-based)
 */

import type {
  DispatchWebhookPayload,
  DispatchRule,
  DispatchRuleMatch,
  DispatchDecision,
} from "../types/dispatch"

// ─── Config ──────────────────────────────────────────────────

const DEFAULT_MODEL = process.env.BRIDGE_DISPATCH_MODEL || "sonnet"
const DEFAULT_TIMEOUT = parseInt(process.env.BRIDGE_DISPATCH_TIMEOUT_SECONDS || "600", 10)
const DEFAULT_MAX_TURNS = 25

// ─── P0 Hardcoded Rules ─────────────────────────────────────
// Ordered by priority. First match wins.

const P0_RULES: DispatchRule[] = [
  // P0 escalation MUST come first — safety override
  {
    id: "rule-p0-escalate",
    name: "P0 Items Always Escalate",
    matches: (p) => p.priority === "P0",
    decision: "escalate",
    promptTemplate: () => "",
  },
  {
    id: "rule-build-active-grove",
    name: "Active Grove Build Tasks",
    matches: (p) =>
      p.type === "Build" &&
      p.status === "Active" &&
      p.pillar === "The Grove" &&
      (p.assignee === "Agent" || p.assignee === "Atlas"),
    decision: "dispatch",
    promptTemplate: (p) =>
      `You are working on a Build task from the Atlas Work Queue.\n\n` +
      `**Task:** ${p.title}\n` +
      `**Priority:** ${p.priority}\n` +
      `**Pillar:** ${p.pillar}\n` +
      (p.notes ? `**Notes:** ${p.notes}\n` : "") +
      (p.url ? `**Reference:** ${p.url}\n` : "") +
      `\nInstructions:\n` +
      `1. Read the CLAUDE.md for project context\n` +
      `2. Understand the task requirements from the title and notes\n` +
      `3. Implement the fix/feature\n` +
      `4. Run relevant tests to verify\n` +
      `5. Commit your changes with a descriptive message\n\n` +
      `If you cannot complete the task, explain what's blocking you.`,
    model: DEFAULT_MODEL,
    maxTurns: DEFAULT_MAX_TURNS,
    timeoutSeconds: DEFAULT_TIMEOUT,
  },
  {
    id: "rule-build-active-any",
    name: "Active Build Tasks (Any Pillar)",
    matches: (p) =>
      p.type === "Build" &&
      p.status === "Active" &&
      (p.assignee === "Agent" || p.assignee === "Atlas"),
    decision: "dispatch",
    promptTemplate: (p) =>
      `You are working on a Build task from the Atlas Work Queue.\n\n` +
      `**Task:** ${p.title}\n` +
      `**Priority:** ${p.priority}\n` +
      `**Pillar:** ${p.pillar}\n` +
      (p.notes ? `**Notes:** ${p.notes}\n` : "") +
      (p.url ? `**Reference:** ${p.url}\n` : "") +
      `\nInstructions:\n` +
      `1. Read the CLAUDE.md for project context\n` +
      `2. Understand the task requirements\n` +
      `3. Implement the change\n` +
      `4. Run relevant tests\n` +
      `5. Commit with a descriptive message\n\n` +
      `If you cannot complete the task, explain what's blocking you.`,
    model: DEFAULT_MODEL,
    maxTurns: DEFAULT_MAX_TURNS,
    timeoutSeconds: DEFAULT_TIMEOUT,
  },
]

// ─── Default Rule (always last) ─────────────────────────────

const DEFAULT_RULE: DispatchRuleMatch = {
  decision: "escalate",
  ruleId: "rule-default-escalate",
  ruleName: "Default Escalation",
  reason: "No dispatch rule matched — escalating to Jim",
  prompt: "",
  model: DEFAULT_MODEL,
  maxTurns: 0,
  timeoutSeconds: 0,
}

// ─── Evaluate ────────────────────────────────────────────────

/**
 * Evaluate a webhook payload against dispatch rules.
 * Returns the first matching rule's decision, or default escalation.
 */
export function evaluate(payload: DispatchWebhookPayload): DispatchRuleMatch {
  for (const rule of P0_RULES) {
    if (rule.matches(payload)) {
      return {
        decision: rule.decision,
        ruleId: rule.id,
        ruleName: rule.name,
        reason: `Matched rule: ${rule.name}`,
        prompt: rule.decision === "dispatch" ? rule.promptTemplate(payload) : "",
        model: rule.model || DEFAULT_MODEL,
        maxTurns: rule.maxTurns || DEFAULT_MAX_TURNS,
        timeoutSeconds: rule.timeoutSeconds || DEFAULT_TIMEOUT,
      }
    }
  }

  return DEFAULT_RULE
}

/** Expose rule count for testing/diagnostics. */
export function getRuleCount(): number {
  return P0_RULES.length
}
