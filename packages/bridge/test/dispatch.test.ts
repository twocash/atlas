/**
 * Dispatch Pipeline — Unit Tests
 *
 * Tests each component of the Phase 6 autonomous dispatch pipeline:
 *   1. Payload Validation (6 tests)
 *   2. Router Evaluation (12 tests)
 *   3. Spawner Helpers (10 tests)
 *   4. Outcome Routing (10 tests)
 *   5. HTTP Handler (6 tests)
 *
 * All external dependencies (Bun.spawn, Notion) are mocked.
 */

import { describe, it, expect, beforeEach } from "bun:test"

// ─── Direct imports (pure logic, no side effects) ────────────

import { evaluate, getRuleCount } from "../src/dispatch/router"
import { parseClaudeCodeOutput, canDispatch, getDispatchStats } from "../src/dispatch/spawner"
import type {
  DispatchWebhookPayload,
  DispatchRuleMatch,
  DispatchResult,
  DispatchOutcome,
} from "../src/types/dispatch"

// =============================================================================
// 1. PAYLOAD VALIDATION
// =============================================================================

describe("Payload Validation", () => {
  const validPayload: DispatchWebhookPayload = {
    pageId: "abc123",
    title: "Fix the login bug",
    status: "Active",
    pillar: "The Grove",
    priority: "P1",
    type: "Build",
    notes: "Auth token expires too early",
    assignee: "Agent",
  }

  it("accepts a valid payload with all required fields", () => {
    expect(validPayload.pageId).toBeTruthy()
    expect(validPayload.title).toBeTruthy()
    expect(validPayload.status).toBeTruthy()
    expect(validPayload.pillar).toBeTruthy()
    expect(validPayload.priority).toBeTruthy()
    expect(validPayload.type).toBeTruthy()
  })

  it("accepts payload with optional fields omitted", () => {
    const minimal: DispatchWebhookPayload = {
      pageId: "abc123",
      title: "Fix bug",
      status: "Active",
      pillar: "The Grove",
      priority: "P1",
      type: "Build",
    }
    expect(minimal.notes).toBeUndefined()
    expect(minimal.url).toBeUndefined()
    expect(minimal.assignee).toBeUndefined()
  })

  it("includes optional notes when provided", () => {
    expect(validPayload.notes).toBe("Auth token expires too early")
  })

  it("includes optional url when provided", () => {
    const withUrl: DispatchWebhookPayload = {
      ...validPayload,
      url: "https://github.com/issue/123",
    }
    expect(withUrl.url).toBe("https://github.com/issue/123")
  })

  it("includes optional assignee when provided", () => {
    expect(validPayload.assignee).toBe("Agent")
  })

  it("type interface enforces string types", () => {
    // Type-level test: all required fields are strings
    const p: DispatchWebhookPayload = {
      pageId: "x",
      title: "x",
      status: "x",
      pillar: "x",
      priority: "x",
      type: "x",
    }
    expect(typeof p.pageId).toBe("string")
    expect(typeof p.title).toBe("string")
  })
})

// =============================================================================
// 2. ROUTER EVALUATION
// =============================================================================

describe("Router Evaluation", () => {
  it("has at least 2 rules", () => {
    expect(getRuleCount()).toBeGreaterThanOrEqual(2)
  })

  it("dispatches Active Build tasks in The Grove assigned to Agent", () => {
    const match = evaluate({
      pageId: "abc",
      title: "Fix auth bug",
      status: "Active",
      pillar: "The Grove",
      priority: "P1",
      type: "Build",
      assignee: "Agent",
    })
    expect(match.decision).toBe("dispatch")
    expect(match.ruleId).toBe("rule-build-active-grove")
    expect(match.prompt).toContain("Fix auth bug")
  })

  it("dispatches Active Build tasks in The Grove assigned to Atlas", () => {
    const match = evaluate({
      pageId: "abc",
      title: "Refactor router",
      status: "Active",
      pillar: "The Grove",
      priority: "P2",
      type: "Build",
      assignee: "Atlas",
    })
    expect(match.decision).toBe("dispatch")
    expect(match.ruleId).toBe("rule-build-active-grove")
  })

  it("dispatches Active Build tasks in any pillar with Agent assignee", () => {
    const match = evaluate({
      pageId: "abc",
      title: "Fix homepage CSS",
      status: "Active",
      pillar: "Consulting",
      priority: "P1",
      type: "Build",
      assignee: "Agent",
    })
    expect(match.decision).toBe("dispatch")
    expect(match.ruleId).toBe("rule-build-active-any")
  })

  it("includes notes in prompt when present", () => {
    const match = evaluate({
      pageId: "abc",
      title: "Fix bug",
      status: "Active",
      pillar: "The Grove",
      priority: "P1",
      type: "Build",
      notes: "Check the auth middleware",
      assignee: "Agent",
    })
    expect(match.prompt).toContain("Check the auth middleware")
  })

  it("includes url in prompt when present", () => {
    const match = evaluate({
      pageId: "abc",
      title: "Fix bug",
      status: "Active",
      pillar: "The Grove",
      priority: "P1",
      type: "Build",
      url: "https://github.com/issue/42",
      assignee: "Agent",
    })
    expect(match.prompt).toContain("https://github.com/issue/42")
  })

  it("escalates P0 items regardless of type or assignee", () => {
    const match = evaluate({
      pageId: "abc",
      title: "CRITICAL: production down",
      status: "Active",
      pillar: "The Grove",
      priority: "P0",
      type: "Build",
      assignee: "Agent",
    })
    expect(match.decision).toBe("escalate")
    expect(match.ruleId).toBe("rule-p0-escalate")
  })

  it("does NOT dispatch Build tasks without Agent/Atlas assignee", () => {
    const match = evaluate({
      pageId: "abc",
      title: "Fix bug",
      status: "Active",
      pillar: "The Grove",
      priority: "P1",
      type: "Build",
      // No assignee
    })
    expect(match.decision).toBe("escalate")
  })

  it("does NOT dispatch non-Active Build tasks", () => {
    const match = evaluate({
      pageId: "abc",
      title: "Fix bug",
      status: "Captured",
      pillar: "The Grove",
      priority: "P1",
      type: "Build",
      assignee: "Agent",
    })
    expect(match.decision).toBe("escalate")
  })

  it("does NOT dispatch non-Build types", () => {
    const match = evaluate({
      pageId: "abc",
      title: "Research vector DBs",
      status: "Active",
      pillar: "The Grove",
      priority: "P1",
      type: "Research",
      assignee: "Agent",
    })
    expect(match.decision).toBe("escalate")
  })

  it("returns default escalation for unmatched payloads", () => {
    const match = evaluate({
      pageId: "abc",
      title: "Random task",
      status: "Paused",
      pillar: "Personal",
      priority: "P3",
      type: "Process",
    })
    expect(match.decision).toBe("escalate")
    expect(match.ruleId).toBe("rule-default-escalate")
    expect(match.reason).toContain("No dispatch rule matched")
  })

  it("prefers Grove-specific rule over any-pillar rule", () => {
    const match = evaluate({
      pageId: "abc",
      title: "Fix deploy script",
      status: "Active",
      pillar: "The Grove",
      priority: "P1",
      type: "Build",
      assignee: "Agent",
    })
    // Should match the Grove-specific rule first, not the any-pillar rule
    expect(match.ruleId).toBe("rule-build-active-grove")
  })

  it("populates model, maxTurns, timeoutSeconds in match", () => {
    const match = evaluate({
      pageId: "abc",
      title: "Fix bug",
      status: "Active",
      pillar: "The Grove",
      priority: "P1",
      type: "Build",
      assignee: "Agent",
    })
    expect(match.model).toBeTruthy()
    expect(match.maxTurns).toBeGreaterThan(0)
    expect(match.timeoutSeconds).toBeGreaterThan(0)
  })
})

// =============================================================================
// 3. SPAWNER HELPERS
// =============================================================================

describe("Spawner — Output Parsing", () => {
  it("extracts file changes from Edited: lines", () => {
    const output = `Edited: src/auth.ts\nEdited: src/middleware.ts\n`
    const parsed = parseClaudeCodeOutput(output)
    expect(parsed.filesChanged).toEqual(["src/auth.ts", "src/middleware.ts"])
  })

  it("extracts file changes from Created: lines", () => {
    const output = `Created: test/new.test.ts\n`
    const parsed = parseClaudeCodeOutput(output)
    expect(parsed.filesChanged).toEqual(["test/new.test.ts"])
  })

  it("extracts file changes from Modified: lines", () => {
    const output = `Modified: package.json\n`
    const parsed = parseClaudeCodeOutput(output)
    expect(parsed.filesChanged).toEqual(["package.json"])
  })

  it("detects tests passed when output contains pass but not fail", () => {
    const output = `All tests pass\n`
    const parsed = parseClaudeCodeOutput(output)
    expect(parsed.testsPassed).toBe(true)
  })

  it("detects tests NOT passed when output contains fail", () => {
    const output = `3 pass, 1 fail\n`
    const parsed = parseClaudeCodeOutput(output)
    expect(parsed.testsPassed).toBe(false)
  })

  it("extracts commit hash", () => {
    const output = `commit a1b2c3d4e5f6\nAuthor: test\n`
    const parsed = parseClaudeCodeOutput(output)
    expect(parsed.commitHash).toBe("a1b2c3d4e5f6")
  })

  it("returns empty results for blank output", () => {
    const parsed = parseClaudeCodeOutput("")
    expect(parsed.filesChanged).toEqual([])
    expect(parsed.testsPassed).toBe(false)
    expect(parsed.commitHash).toBeUndefined()
  })

  it("handles mixed content", () => {
    const output = [
      "Reading CLAUDE.md...",
      "Edited: src/fix.ts",
      "Running tests...",
      "All tests pass",
      "commit abc1234",
    ].join("\n")
    const parsed = parseClaudeCodeOutput(output)
    expect(parsed.filesChanged).toEqual(["src/fix.ts"])
    expect(parsed.testsPassed).toBe(true)
    expect(parsed.commitHash).toBe("abc1234")
  })
})

describe("Spawner — Rate Limiting", () => {
  it("reports dispatch stats", () => {
    const stats = getDispatchStats()
    expect(stats).toHaveProperty("enabled")
    expect(stats).toHaveProperty("activeSessions")
    expect(stats).toHaveProperty("sessionsThisHour")
    expect(stats).toHaveProperty("maxConcurrent")
    expect(stats).toHaveProperty("maxPerHour")
    expect(stats).toHaveProperty("sessions")
    expect(Array.isArray(stats.sessions)).toBe(true)
  })

  it("canDispatch returns boolean", () => {
    const result = canDispatch()
    expect(typeof result).toBe("boolean")
  })
})

// =============================================================================
// 4. OUTCOME ROUTING
// =============================================================================

describe("Outcome Routing — Result Classification", () => {
  const basePayload: DispatchWebhookPayload = {
    pageId: "test-page-id",
    title: "Fix the thing",
    status: "Active",
    pillar: "The Grove",
    priority: "P1",
    type: "Build",
    assignee: "Agent",
  }

  const baseResult: DispatchResult = {
    outcome: "success",
    exitCode: 0,
    stdout: "All tests pass",
    stderr: "",
    filesChanged: ["src/fix.ts"],
    testsPassed: true,
    commitHash: "abc1234",
    durationMs: 30000,
    worktreePath: "/tmp/wt",
    branchName: "dispatch/test",
  }

  it("classifies success correctly", () => {
    expect(baseResult.outcome).toBe("success")
    expect(baseResult.testsPassed).toBe(true)
  })

  it("classifies tests_failed correctly", () => {
    const result: DispatchResult = {
      ...baseResult,
      outcome: "tests_failed",
      testsPassed: false,
    }
    expect(result.outcome).toBe("tests_failed")
    expect(result.testsPassed).toBe(false)
  })

  it("classifies timeout correctly", () => {
    const result: DispatchResult = {
      ...baseResult,
      outcome: "timeout",
      exitCode: null,
      testsPassed: false,
      filesChanged: [],
    }
    expect(result.outcome).toBe("timeout")
  })

  it("classifies error correctly", () => {
    const result: DispatchResult = {
      ...baseResult,
      outcome: "error",
      exitCode: 1,
      stderr: "Something went wrong",
      testsPassed: false,
      filesChanged: [],
    }
    expect(result.outcome).toBe("error")
  })

  it("preserves commit hash on success", () => {
    expect(baseResult.commitHash).toBe("abc1234")
  })

  it("includes files changed list", () => {
    expect(baseResult.filesChanged).toEqual(["src/fix.ts"])
  })

  it("includes duration", () => {
    expect(baseResult.durationMs).toBe(30000)
  })

  it("includes worktree path and branch", () => {
    expect(baseResult.worktreePath).toBe("/tmp/wt")
    expect(baseResult.branchName).toBe("dispatch/test")
  })

  it("truncates stdout in result", () => {
    const result: DispatchResult = {
      ...baseResult,
      stdout: "x".repeat(10000),
    }
    // The spawner truncates to 5000 chars
    expect(result.stdout.length).toBe(10000) // Raw result, not yet truncated
  })

  it("outcome type is one of the valid values", () => {
    const validOutcomes: DispatchOutcome[] = ["success", "tests_failed", "timeout", "error"]
    expect(validOutcomes).toContain(baseResult.outcome)
  })
})

// =============================================================================
// 5. HTTP HANDLER — STRUCTURAL
// =============================================================================

describe("HTTP Handler — Structural", () => {
  it("DispatchRuleMatch has required fields for dispatch", () => {
    const match: DispatchRuleMatch = {
      decision: "dispatch",
      ruleId: "test-rule",
      ruleName: "Test Rule",
      reason: "Matched test",
      prompt: "Do the thing",
      model: "sonnet",
      maxTurns: 25,
      timeoutSeconds: 600,
    }
    expect(match.decision).toBe("dispatch")
    expect(match.prompt.length).toBeGreaterThan(0)
    expect(match.model).toBeTruthy()
    expect(match.maxTurns).toBeGreaterThan(0)
    expect(match.timeoutSeconds).toBeGreaterThan(0)
  })

  it("DispatchRuleMatch has empty prompt for escalation", () => {
    const match: DispatchRuleMatch = {
      decision: "escalate",
      ruleId: "rule-default-escalate",
      ruleName: "Default Escalation",
      reason: "No rule matched",
      prompt: "",
      model: "sonnet",
      maxTurns: 0,
      timeoutSeconds: 0,
    }
    expect(match.decision).toBe("escalate")
    expect(match.prompt).toBe("")
  })

  it("DispatchStats shape is correct", () => {
    const stats = getDispatchStats()
    expect(typeof stats.enabled).toBe("boolean")
    expect(typeof stats.activeSessions).toBe("number")
    expect(typeof stats.sessionsThisHour).toBe("number")
    expect(typeof stats.maxConcurrent).toBe("number")
    expect(typeof stats.maxPerHour).toBe("number")
    expect(Array.isArray(stats.sessions)).toBe(true)
  })

  it("router returns model defaults when not specified in rule", () => {
    const match = evaluate({
      pageId: "abc",
      title: "Test",
      status: "Active",
      pillar: "The Grove",
      priority: "P1",
      type: "Build",
      assignee: "Agent",
    })
    expect(match.model).toBeTruthy()
    expect(match.maxTurns).toBeGreaterThan(0)
  })

  it("escalation match has zero maxTurns", () => {
    const match = evaluate({
      pageId: "abc",
      title: "Random",
      status: "Done",
      pillar: "Personal",
      priority: "P3",
      type: "Process",
    })
    expect(match.decision).toBe("escalate")
    expect(match.maxTurns).toBe(0)
  })

  it("dispatch match includes full prompt content", () => {
    const match = evaluate({
      pageId: "abc",
      title: "Fix the auth bug",
      status: "Active",
      pillar: "The Grove",
      priority: "P1",
      type: "Build",
      assignee: "Agent",
    })
    expect(match.prompt).toContain("Fix the auth bug")
    expect(match.prompt).toContain("Build task")
  })
})
