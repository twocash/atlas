/**
 * Dispatch Spawner — worktree management + Claude Code execution.
 *
 * Three responsibilities:
 *   A. Git worktree create/remove (with Windows fallback)
 *   B. Claude Code spawn via `claude -p` (fire-and-forget)
 *   C. Concurrency + rate limiting (reused from swarm-dispatch.ts)
 *
 * Architecture: Bun.spawn (consistent with bridge runtime), not child_process.
 */

import { spawn } from "bun"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"
import { randomUUID } from "crypto"
import type {
  SpawnConfig,
  DispatchResult,
  DispatchOutcome,
  ActiveDispatchSession,
  DispatchStats,
} from "../types/dispatch"

// ─── Config ──────────────────────────────────────────────────

const MAX_CONCURRENT = parseInt(process.env.BRIDGE_DISPATCH_MAX_CONCURRENT || "2", 10)
const MAX_PER_HOUR = parseInt(process.env.BRIDGE_DISPATCH_MAX_PER_HOUR || "5", 10)
const CLAUDE_CMD = process.env.CLAUDE_PATH || "claude"

const __thisDir = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__thisDir, "../../../../")
const WORKTREE_BASE = resolve(REPO_ROOT, "..", "atlas-dispatch-wt")

// ─── Rate Limiting (pattern from swarm-dispatch.ts:87-109) ───

const dispatchTimestamps: number[] = []

function cleanTimestamps(): void {
  const oneHourAgo = Date.now() - 60 * 60 * 1000
  while (dispatchTimestamps.length > 0 && dispatchTimestamps[0] < oneHourAgo) {
    dispatchTimestamps.shift()
  }
}

export function canDispatch(): boolean {
  cleanTimestamps()
  return (
    activeSessions.size < MAX_CONCURRENT &&
    dispatchTimestamps.length < MAX_PER_HOUR
  )
}

function recordDispatch(): void {
  dispatchTimestamps.push(Date.now())
}

// ─── Active Session Tracking ─────────────────────────────────

const activeSessions = new Map<string, ActiveDispatchSession>()

export function getDispatchStats(): DispatchStats {
  cleanTimestamps()
  return {
    enabled: process.env.BRIDGE_DISPATCH === "true",
    activeSessions: activeSessions.size,
    sessionsThisHour: dispatchTimestamps.length,
    maxConcurrent: MAX_CONCURRENT,
    maxPerHour: MAX_PER_HOUR,
    sessions: Array.from(activeSessions.values()),
  }
}

// ─── Worktree Management ────────────────────────────────────

/**
 * Create a git worktree for an isolated dispatch session.
 * Returns the worktree path and branch name.
 */
export async function createWorktree(
  pageId: string,
): Promise<{ worktreePath: string; branchName: string }> {
  const shortId = pageId.slice(0, 8)
  const timestamp = Date.now()
  const branchName = `dispatch/${shortId}-${timestamp}`
  const worktreePath = resolve(WORKTREE_BASE, `${shortId}-${timestamp}`)

  console.log(`[dispatch] Creating worktree: ${worktreePath} (branch: ${branchName})`)

  const proc = spawn({
    cmd: ["git", "worktree", "add", "-b", branchName, worktreePath, "master"],
    cwd: REPO_ROOT,
    stdout: "pipe",
    stderr: "pipe",
  })

  const exitCode = await proc.exited

  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text()
    throw new Error(`git worktree add failed (exit ${exitCode}): ${stderr}`)
  }

  // bun install in worktree (node_modules is gitignored)
  console.log(`[dispatch] Running bun install in worktree...`)
  const installProc = spawn({
    cmd: ["bun", "install"],
    cwd: worktreePath,
    stdout: "pipe",
    stderr: "pipe",
  })

  const installExit = await installProc.exited
  if (installExit !== 0) {
    const stderr = await new Response(installProc.stderr).text()
    console.warn(`[dispatch] bun install warning (exit ${installExit}): ${stderr}`)
    // Non-fatal — some installs produce warnings but still work
  }

  return { worktreePath, branchName }
}

/**
 * Remove a git worktree. Windows fallback: PowerShell Remove-Item + git worktree prune.
 * (Documented in MEMORY.md: git worktree remove often fails on Windows)
 */
export async function removeWorktree(worktreePath: string): Promise<void> {
  console.log(`[dispatch] Removing worktree: ${worktreePath}`)

  // Try git worktree remove --force first
  const proc = spawn({
    cmd: ["git", "worktree", "remove", "--force", worktreePath],
    cwd: REPO_ROOT,
    stdout: "pipe",
    stderr: "pipe",
  })

  const exitCode = await proc.exited

  if (exitCode === 0) return

  // Windows fallback: PowerShell Remove-Item + prune
  console.warn(`[dispatch] git worktree remove failed, trying PowerShell fallback...`)

  const rmProc = spawn({
    cmd: [
      "powershell", "-Command",
      `Remove-Item -Recurse -Force '${worktreePath}'`,
    ],
    cwd: REPO_ROOT,
    stdout: "pipe",
    stderr: "pipe",
  })
  await rmProc.exited

  const pruneProc = spawn({
    cmd: ["git", "worktree", "prune"],
    cwd: REPO_ROOT,
    stdout: "pipe",
    stderr: "pipe",
  })
  await pruneProc.exited
}

// ─── Claude Code Spawn ──────────────────────────────────────

/**
 * Spawn a Claude Code session in a worktree.
 * Adapted from swarm-dispatch.ts:316-433.
 *
 * Returns a DispatchResult after the session completes (or times out).
 */
export async function spawnClaudeCode(config: SpawnConfig): Promise<DispatchResult> {
  const startTime = Date.now()

  const args = [
    "-p", config.prompt,
    "--model", config.model,
    "--dangerously-skip-permissions",
    "--max-turns", String(config.maxTurns),
  ]

  if (config.allowedTools.length > 0) {
    args.push("--allowedTools", config.allowedTools.join(","))
  }

  console.log(`[dispatch] Spawning Claude Code in ${config.worktreePath}`)
  console.log(`[dispatch]   model=${config.model}, maxTurns=${config.maxTurns}, timeout=${config.timeoutSeconds}s`)

  const proc = spawn({
    cmd: [CLAUDE_CMD, ...args],
    cwd: config.worktreePath,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      PATH: process.env.PATH,
    },
  })

  let timedOut = false
  let stdout = ""
  let stderr = ""

  // Timeout handler
  const timeoutTimer = setTimeout(() => {
    timedOut = true
    console.warn(`[dispatch] Session timed out after ${config.timeoutSeconds}s — killing process`)
    proc.kill()
  }, config.timeoutSeconds * 1000)

  // Collect output
  try {
    stdout = await new Response(proc.stdout).text()
  } catch {
    // stdout closed early
  }

  try {
    stderr = await new Response(proc.stderr).text()
  } catch {
    // stderr closed early
  }

  const exitCode = await proc.exited
  clearTimeout(timeoutTimer)

  const durationMs = Date.now() - startTime

  if (timedOut) {
    return {
      outcome: "timeout",
      exitCode,
      stdout: stdout.slice(-5000),
      stderr: stderr.slice(-2000),
      filesChanged: [],
      testsPassed: false,
      durationMs,
      worktreePath: config.worktreePath,
      branchName: config.branchName,
    }
  }

  // Parse output (pattern from swarm-dispatch.ts:439-473)
  const parsed = parseClaudeCodeOutput(stdout)

  const outcome: DispatchOutcome =
    exitCode === 0 && parsed.testsPassed ? "success" :
    exitCode === 0 && !parsed.testsPassed ? "tests_failed" :
    "error"

  return {
    outcome,
    exitCode,
    stdout: stdout.slice(-5000),
    stderr: stderr.slice(-2000),
    filesChanged: parsed.filesChanged,
    testsPassed: parsed.testsPassed,
    commitHash: parsed.commitHash,
    durationMs,
    worktreePath: config.worktreePath,
    branchName: config.branchName,
  }
}

// ─── Output Parsing (from swarm-dispatch.ts:439-473) ────────

interface ParsedOutput {
  filesChanged: string[]
  testsPassed: boolean
  commitHash?: string
}

export function parseClaudeCodeOutput(output: string): ParsedOutput {
  const filesChanged: string[] = []
  let testsPassed = false
  let commitHash: string | undefined

  // Extract file changes
  const filePattern = /(?:Edited|Created|Modified):\s*([^\n]+)/gi
  let match
  while ((match = filePattern.exec(output)) !== null) {
    filesChanged.push(match[1].trim())
  }

  // Check for test results
  if (output.includes("pass") && !output.includes("fail")) {
    testsPassed = true
  }

  // Extract commit hash if present
  const commitPattern = /commit\s+([a-f0-9]{7,40})/i
  const commitMatch = commitPattern.exec(output)
  if (commitMatch) {
    commitHash = commitMatch[1]
  }

  return { filesChanged, testsPassed, commitHash }
}

// ─── Dispatch Orchestrator ──────────────────────────────────

/**
 * Full dispatch lifecycle: worktree → spawn → cleanup tracking.
 * Called async from the HTTP handler (fire-and-forget).
 *
 * The outcome handler is called with the result — it handles Feed/WQ writes.
 */
export async function runDispatch(
  sessionId: string,
  pageId: string,
  title: string,
  prompt: string,
  model: string,
  maxTurns: number,
  timeoutSeconds: number,
  onComplete: (result: DispatchResult) => Promise<void>,
): Promise<void> {
  if (!canDispatch()) {
    console.error(`[dispatch] Cannot dispatch — at capacity (${activeSessions.size}/${MAX_CONCURRENT} active, ${dispatchTimestamps.length}/${MAX_PER_HOUR} this hour)`)
    return
  }

  recordDispatch()

  let worktreePath = ""
  let branchName = ""

  try {
    // Create worktree
    const wt = await createWorktree(pageId)
    worktreePath = wt.worktreePath
    branchName = wt.branchName

    // Track session
    const session: ActiveDispatchSession = {
      id: sessionId,
      pageId,
      title,
      startedAt: new Date().toISOString(),
      worktreePath,
      branchName,
      pid: undefined,
      status: "running",
    }
    activeSessions.set(sessionId, session)

    // Spawn Claude Code
    const config: SpawnConfig = {
      worktreePath,
      branchName,
      prompt,
      model,
      maxTurns,
      timeoutSeconds,
      allowedTools: ["Read", "Edit", "Write", "Bash", "Grep", "Glob"],
    }

    const result = await spawnClaudeCode(config)

    // Update session status
    session.status = result.outcome === "success" ? "completed" :
                     result.outcome === "timeout" ? "timeout" : "failed"

    console.log(
      `[dispatch] Session ${sessionId} completed: ${result.outcome} ` +
      `(${result.durationMs}ms, ${result.filesChanged.length} files changed)`,
    )

    // Call outcome handler
    await onComplete(result)
  } catch (err: any) {
    console.error(`[dispatch] Session ${sessionId} error:`, err)

    const errorResult: DispatchResult = {
      outcome: "error",
      exitCode: null,
      stdout: "",
      stderr: err.message || String(err),
      filesChanged: [],
      testsPassed: false,
      durationMs: 0,
      worktreePath,
      branchName,
    }

    const session = activeSessions.get(sessionId)
    if (session) session.status = "failed"

    await onComplete(errorResult)
  } finally {
    // Clean up session tracking (keep in map for stats, remove after 5min)
    setTimeout(() => {
      activeSessions.delete(sessionId)
    }, 5 * 60 * 1000)
  }
}
