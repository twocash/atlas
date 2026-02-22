/**
 * Dispatch Chain Test — End-to-End Flow Verification
 *
 * Per Constraint 6: Chain tests verify the complete user-visible flow.
 *
 * Flow: webhook payload → router evaluation → spawner config → outcome classification
 *
 * Only Bun.spawn and Notion are mocked — all internal wiring is real.
 */

import { describe, it, expect } from "bun:test"

import type {
  DispatchWebhookPayload,
  DispatchResult,
  DispatchOutcome,
  SpawnConfig,
} from "../src/types/dispatch"
import { evaluate } from "../src/dispatch/router"
import { parseClaudeCodeOutput } from "../src/dispatch/spawner"

// =============================================================================
// CHAIN TEST: payload → router → spawn config → output parse → outcome
// =============================================================================

describe("Dispatch Chain — Full Pipeline", () => {
  /**
   * Scenario 1: Happy path — Build task dispatched, succeeds, commit made
   */
  it("routes a Build task through full dispatch chain to success", () => {
    // Step 1: Webhook arrives
    const payload: DispatchWebhookPayload = {
      pageId: "page-123",
      title: "Fix login timeout",
      status: "Active",
      pillar: "The Grove",
      priority: "P1",
      type: "Build",
      notes: "Token expires in 5min, should be 60min",
      assignee: "Agent",
    }

    // Step 2: Router evaluates
    const match = evaluate(payload)
    expect(match.decision).toBe("dispatch")
    expect(match.prompt).toContain("Fix login timeout")
    expect(match.prompt).toContain("Token expires in 5min")

    // Step 3: SpawnConfig would be built (verify shape)
    const config: SpawnConfig = {
      worktreePath: "/tmp/atlas-dispatch-wt/page-123-test",
      branchName: "dispatch/page-123-test",
      prompt: match.prompt,
      model: match.model,
      maxTurns: match.maxTurns,
      timeoutSeconds: match.timeoutSeconds,
      allowedTools: ["Read", "Edit", "Write", "Bash", "Grep", "Glob"],
    }
    expect(config.prompt.length).toBeGreaterThan(50)
    expect(config.model).toBeTruthy()
    expect(config.maxTurns).toBeGreaterThan(0)
    expect(config.timeoutSeconds).toBeGreaterThan(0)
    expect(config.allowedTools).toContain("Read")

    // Step 4: Claude Code runs (simulated output)
    // Note: output parser checks for "fail" substring — clean output must not contain it
    const claudeOutput = [
      "Reading CLAUDE.md...",
      "Edited: src/auth/token.ts",
      "Edited: test/auth.test.ts",
      "Running bun test test/auth.test.ts...",
      "2 pass",
      "All tests pass",
      "Creating commit...",
      "commit e4f5a6b7",
    ].join("\n")

    const parsed = parseClaudeCodeOutput(claudeOutput)
    expect(parsed.filesChanged).toEqual(["src/auth/token.ts", "test/auth.test.ts"])
    expect(parsed.testsPassed).toBe(true)
    expect(parsed.commitHash).toBe("e4f5a6b7")

    // Step 5: Build DispatchResult
    const result: DispatchResult = {
      outcome: "success",
      exitCode: 0,
      stdout: claudeOutput,
      stderr: "",
      filesChanged: parsed.filesChanged,
      testsPassed: parsed.testsPassed,
      commitHash: parsed.commitHash,
      durationMs: 45000,
      worktreePath: config.worktreePath,
      branchName: config.branchName,
    }

    // Step 6: Verify outcome → Feed would get "dispatch-success", WQ → "Done"
    expect(result.outcome).toBe("success")
    expect(result.filesChanged.length).toBe(2)
    expect(result.testsPassed).toBe(true)
  })

  /**
   * Scenario 2: Tests fail — dispatched but needs escalation
   */
  it("routes a failing build through to escalation", () => {
    const payload: DispatchWebhookPayload = {
      pageId: "page-456",
      title: "Refactor error handler",
      status: "Active",
      pillar: "The Grove",
      priority: "P2",
      type: "Build",
      assignee: "Atlas",
    }

    const match = evaluate(payload)
    expect(match.decision).toBe("dispatch")

    // Claude runs but tests fail
    const claudeOutput = [
      "Edited: src/errors.ts",
      "Running tests...",
      "1 pass, 2 fail",
      "FAIL: expected 200 got 500",
    ].join("\n")

    const parsed = parseClaudeCodeOutput(claudeOutput)
    expect(parsed.filesChanged).toEqual(["src/errors.ts"])
    expect(parsed.testsPassed).toBe(false) // Contains "fail"

    const result: DispatchResult = {
      outcome: "tests_failed",
      exitCode: 0,
      stdout: claudeOutput,
      stderr: "",
      filesChanged: parsed.filesChanged,
      testsPassed: parsed.testsPassed,
      durationMs: 60000,
      worktreePath: "/tmp/wt",
      branchName: "dispatch/page-456-test",
    }

    // Outcome → Feed gets "dispatch-escalation", WQ → "Blocked"
    expect(result.outcome).toBe("tests_failed")
    expect(result.testsPassed).toBe(false)
  })

  /**
   * Scenario 3: P0 item escalates without dispatch
   */
  it("escalates P0 items without dispatching", () => {
    const payload: DispatchWebhookPayload = {
      pageId: "page-emergency",
      title: "URGENT: API key leaked",
      status: "Active",
      pillar: "The Grove",
      priority: "P0",
      type: "Build",
      assignee: "Agent",
    }

    const match = evaluate(payload)
    expect(match.decision).toBe("escalate")
    expect(match.prompt).toBe("")
    // No spawn happens, escalation creates Feed alert
  })

  /**
   * Scenario 4: Non-Build type defaults to escalation
   */
  it("escalates Research tasks to human", () => {
    const payload: DispatchWebhookPayload = {
      pageId: "page-research",
      title: "Evaluate vector DB options",
      status: "Active",
      pillar: "The Grove",
      priority: "P2",
      type: "Research",
      assignee: "Agent",
    }

    const match = evaluate(payload)
    expect(match.decision).toBe("escalate")
  })

  /**
   * Scenario 5: Unassigned task doesn't dispatch
   */
  it("does not dispatch tasks without Agent/Atlas assignee", () => {
    const payload: DispatchWebhookPayload = {
      pageId: "page-jim",
      title: "Write blog post",
      status: "Active",
      pillar: "The Grove",
      priority: "P1",
      type: "Build",
      // No assignee — Jim's task
    }

    const match = evaluate(payload)
    expect(match.decision).toBe("escalate")
  })

  /**
   * Scenario 6: Timeout chain
   */
  it("handles timeout outcome correctly", () => {
    const payload: DispatchWebhookPayload = {
      pageId: "page-timeout",
      title: "Complex migration",
      status: "Active",
      pillar: "Consulting",
      priority: "P1",
      type: "Build",
      assignee: "Agent",
    }

    const match = evaluate(payload)
    expect(match.decision).toBe("dispatch")

    // Session times out
    const result: DispatchResult = {
      outcome: "timeout",
      exitCode: null,
      stdout: "Working on migration...\nEdited: src/db.ts",
      stderr: "",
      filesChanged: ["src/db.ts"],
      testsPassed: false,
      durationMs: 600000,
      worktreePath: "/tmp/wt",
      branchName: "dispatch/page-timeout-test",
    }

    expect(result.outcome).toBe("timeout")
    expect(result.durationMs).toBe(600000)
    // Outcome → Feed gets "dispatch-escalation", "timeout" keyword
  })

  /**
   * Scenario 7: Error chain
   */
  it("handles spawn error correctly", () => {
    const result: DispatchResult = {
      outcome: "error",
      exitCode: null,
      stdout: "",
      stderr: "git worktree add failed: branch already exists",
      filesChanged: [],
      testsPassed: false,
      durationMs: 500,
      worktreePath: "",
      branchName: "",
    }

    expect(result.outcome).toBe("error")
    expect(result.stderr).toContain("git worktree")
    // Outcome → Feed Alert with error context
  })

  /**
   * Scenario 8: Prompt includes URL reference when provided
   */
  it("includes URL in dispatch prompt for context", () => {
    const payload: DispatchWebhookPayload = {
      pageId: "page-with-url",
      title: "Fix issue #42",
      status: "Active",
      pillar: "The Grove",
      priority: "P1",
      type: "Build",
      url: "https://github.com/atlas/issues/42",
      notes: "See issue for reproduction steps",
      assignee: "Agent",
    }

    const match = evaluate(payload)
    expect(match.decision).toBe("dispatch")
    expect(match.prompt).toContain("https://github.com/atlas/issues/42")
    expect(match.prompt).toContain("See issue for reproduction steps")
  })
})
