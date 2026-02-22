/**
 * Dispatch types — autonomous Work Queue → Claude Code pipeline.
 *
 * Phase 6 P0: webhook-driven dispatch with hardcoded rules.
 * Phase 6 P1: Notion-driven rules (Constraint 1 compliance).
 */

// ─── Webhook Payload ─────────────────────────────────────────

/** POST /dispatch request body — what triggers a dispatch evaluation. */
export interface DispatchWebhookPayload {
  pageId: string
  title: string
  status: string
  pillar: string
  priority: string
  type: string
  notes?: string
  url?: string
  assignee?: string
}

// ─── Router Output ───────────────────────────────────────────

export type DispatchDecision = "dispatch" | "queue" | "escalate"

export interface DispatchRuleMatch {
  decision: DispatchDecision
  ruleId: string
  ruleName: string
  reason: string
  prompt: string
  model: string
  maxTurns: number
  timeoutSeconds: number
}

/** Internal rule structure — P0 hardcoded, P1 from Notion. */
export interface DispatchRule {
  id: string
  name: string
  matches: (p: DispatchWebhookPayload) => boolean
  decision: DispatchDecision
  promptTemplate: (p: DispatchWebhookPayload) => string
  model?: string
  maxTurns?: number
  timeoutSeconds?: number
}

// ─── Spawn Config ────────────────────────────────────────────

export interface SpawnConfig {
  worktreePath: string
  branchName: string
  prompt: string
  model: string
  maxTurns: number
  timeoutSeconds: number
  allowedTools: string[]
}

// ─── Dispatch Result ─────────────────────────────────────────

export type DispatchOutcome = "success" | "tests_failed" | "timeout" | "error"

export interface DispatchResult {
  outcome: DispatchOutcome
  exitCode: number | null
  stdout: string
  stderr: string
  filesChanged: string[]
  testsPassed: boolean
  commitHash?: string
  prUrl?: string
  durationMs: number
  worktreePath: string
  branchName: string
}

// ─── Active Session Tracking ─────────────────────────────────

export interface ActiveDispatchSession {
  id: string
  pageId: string
  title: string
  startedAt: string
  worktreePath: string
  branchName: string
  pid: number | undefined
  status: "running" | "completed" | "failed" | "timeout"
}

// ─── Stats (for /status endpoint) ────────────────────────────

export interface DispatchStats {
  enabled: boolean
  activeSessions: number
  sessionsThisHour: number
  maxConcurrent: number
  maxPerHour: number
  sessions: ActiveDispatchSession[]
}
