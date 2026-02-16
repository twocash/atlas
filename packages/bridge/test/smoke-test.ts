#!/usr/bin/env bun
/**
 * Bridge Phase 5 — Smoke Test Suite
 *
 * Exercises the orchestration layer through the real handler chain.
 * No WebSocket or Claude Code process needed — tests the triage pipeline in isolation.
 *
 * Usage:
 *   bun run packages/bridge/test/smoke-test.ts
 *
 * Exit code 0 = all pass, 1 = failures
 */

// ─── Mock external dependencies BEFORE imports ──────────────

import { mock } from "bun:test"

const assemblerDir = process.cwd() + "/packages/bridge/src/context"
const handlerDir = process.cwd() + "/packages/bridge/src/handlers"

// Mock triageMessage (Haiku API call)
const triageSkillPath = require.resolve(
  "../../../../apps/telegram/src/cognitive/triage-skill",
  { paths: [assemblerDir] },
)
mock.module(triageSkillPath, () => ({
  triageMessage: async (text: string) => {
    const isGreeting = /^(hey|hi|hello|yo|sup)[\s!?,]*$/i.test(text.trim())
    const isSimple = text.split(" ").length <= 6
    const tier = isGreeting ? 0 : isSimple ? 1 : text.length > 60 ? 3 : 2
    return {
      intent: isGreeting ? "clarify" : text.toLowerCase().includes("draft") ? "capture" : "query",
      confidence: 0.92,
      pillar: text.toLowerCase().includes("ai") || text.toLowerCase().includes("linkedin") ? "The Grove" : "Personal",
      requestType: "Research",
      keywords: text.split(" ").slice(0, 3),
      complexityTier: tier,
      source: "haiku",
    }
  },
}))

// Mock prompt composition (reads Notion/files)
const compositionPath = require.resolve(
  "../../../../packages/agents/src/services/prompt-composition",
  { paths: [assemblerDir] },
)
mock.module(compositionPath, () => ({
  composeFromStructuredContext: async () => ({
    prompt: "Be concise, clear, and actionable. Write in Jim's voice.",
    temperature: 0.7,
    model: "sonnet",
  }),
}))

// Suppress logger noise
const loggerPath = require.resolve("../logger", {
  paths: [process.cwd() + "/apps/telegram/src/cognitive"],
})
mock.module(loggerPath, () => ({
  default: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}))

// ─── Now import the handler chain ───────────────────────────

import { processEnvelope } from "../src/handlers"
import type { BridgeEnvelope, HandlerContext } from "../src/types/bridge"

// ─── Test Helpers ───────────────────────────────────────────

interface TestResult {
  name: string
  pass: boolean
  detail: string
}

const results: TestResult[] = []

function makeEnvelope(text: string, browserContext?: any): BridgeEnvelope {
  return {
    message: {
      type: "user_message",
      content: [{ type: "text", text }],
      ...(browserContext ? { browserContext } : {}),
    } as any,
    surface: "chrome_extension",
    sessionId: "smoke-test",
    timestamp: new Date().toISOString(),
    direction: "client_to_claude",
    sourceConnectionId: "smoke-client-1",
  }
}

function makeContext() {
  const claudeMessages: any[] = []
  const clientMessages: { to: string; msg: any }[] = []
  const broadcasts: any[] = []

  const context: HandlerContext = {
    sendToClaude: (msg) => claudeMessages.push(msg),
    sendToClient: (connId, msg) => clientMessages.push({ to: connId, msg }),
    broadcastToClients: (msg) => broadcasts.push(msg),
    isClaudeConnected: () => true,
  }

  return { context, claudeMessages, clientMessages, broadcasts }
}

function assert(condition: boolean, msg: string): void {
  if (!condition) throw new Error(`Assertion failed: ${msg}`)
}

async function runTest(name: string, fn: () => Promise<void>) {
  try {
    await fn()
    results.push({ name, pass: true, detail: "OK" })
    console.log(`  ✓ ${name}`)
  } catch (err: any) {
    results.push({ name, pass: false, detail: err.message })
    console.log(`  ✗ ${name}`)
    console.log(`    → ${err.message}`)
  }
}

// ═════════════════════════════════════════════════════════════
// Smoke Tests
// ═════════════════════════════════════════════════════════════

console.log("\n╔══════════════════════════════════════════════════╗")
console.log("║  Bridge Phase 5 — Orchestration Smoke Test      ║")
console.log("╚══════════════════════════════════════════════════╝\n")

// ─── 1. Quick-Skip Path ─────────────────────────────────────

console.log("─── 1. Quick-Skip (trivial greetings) ───")

await runTest("\"hi\" → local response, no Claude", async () => {
  const { context, claudeMessages, clientMessages } = makeContext()
  await processEnvelope(makeEnvelope("hi"), context)

  assert(claudeMessages.length === 0, `Expected 0 Claude messages, got ${claudeMessages.length}`)
  assert(clientMessages.length === 1, `Expected 1 client message, got ${clientMessages.length}`)
  assert(
    (clientMessages[0].msg as any).message.content.includes("Hey"),
    `Expected greeting response, got: ${(clientMessages[0].msg as any).message.content}`,
  )
})

await runTest("\"hello\" → local response, no Claude", async () => {
  const { context, claudeMessages, clientMessages } = makeContext()
  await processEnvelope(makeEnvelope("hello"), context)

  assert(claudeMessages.length === 0, "Should not reach Claude")
  assert(clientMessages.length === 1, "Should get local response")
})

// ─── 2. Low Tier (Tier 0-1) ─────────────────────────────────

console.log("\n─── 2. Low Tier — enriched but local route ───")

await runTest("\"hey what's up\" → tier 0, enriched prompt to Claude", async () => {
  const { context, claudeMessages } = makeContext()
  await processEnvelope(makeEnvelope("hey what's up"), context)

  assert(claudeMessages.length === 1, `Expected 1 Claude message, got ${claudeMessages.length}`)
  const prompt = claudeMessages[0].message.content
  assert(prompt.includes("Atlas"), `Prompt missing Atlas preamble`)
  assert(prompt.includes("## Request"), `Prompt missing Request section`)
})

await runTest("\"what time is it\" → tier 1, enriched prompt to Claude", async () => {
  const { context, claudeMessages } = makeContext()
  await processEnvelope(makeEnvelope("what time is it"), context)

  assert(claudeMessages.length === 1, "Expected 1 Claude message")
  const prompt = claudeMessages[0].message.content
  assert(prompt.includes("## Voice & Style"), "Prompt missing Voice section")
  assert(prompt.includes("## Output Instructions"), "Prompt missing Output section")
})

// ─── 3. High Tier (Tier 2-3) ────────────────────────────────

console.log("\n─── 3. High Tier — full orchestration ───")

await runTest("EU AI Act research → tier 3, full enriched prompt", async () => {
  const { context, claudeMessages } = makeContext()
  await processEnvelope(
    makeEnvelope("research the latest EU AI Act enforcement actions and draft a summary"),
    context,
  )

  assert(claudeMessages.length === 1, "Expected 1 Claude message")
  const prompt = claudeMessages[0].message.content
  assert(prompt.includes("## Request"), "Missing Request section")
  assert(prompt.includes("## Voice & Style"), "Missing Voice section")
  assert(prompt.includes("## Output Instructions"), "Missing Output section")
  assert(prompt.length > 200, `Prompt too short (${prompt.length} chars)`)
})

await runTest("LinkedIn thinkpiece → tier 2, intent=capture", async () => {
  const { context, claudeMessages } = makeContext()
  await processEnvelope(
    makeEnvelope("draft a LinkedIn thinkpiece about distributed AI training infrastructure"),
    context,
  )

  assert(claudeMessages.length === 1, "Expected 1 Claude message")
  const prompt = claudeMessages[0].message.content
  assert(prompt.includes("capture") || prompt.includes("draft"), "Prompt should reflect draft/capture intent")
})

// ─── 4. Browser Context ─────────────────────────────────────

console.log("\n─── 4. Browser Context — LinkedIn fixture ───")

await runTest("Message with browser context → browser slot populated", async () => {
  const { context, claudeMessages } = makeContext()
  await processEnvelope(
    makeEnvelope("analyze this post and suggest a reply", {
      url: "https://www.linkedin.com/feed/update/urn:li:activity:7654321",
      title: "Sanjay Mehta on LinkedIn: Distributed AI Training",
      selectedText: "The future of AI training is distributed across edge nodes...",
      linkedInContext: {
        postAuthor: "Sanjay Mehta",
        postText: "The future of AI training is distributed across edge nodes, not centralized datacenters.",
        commentCount: 47,
      },
    }),
    context,
  )

  assert(claudeMessages.length === 1, "Expected 1 Claude message")
  const prompt = claudeMessages[0].message.content
  assert(prompt.includes("## Browser Context"), "Missing Browser Context section")
  assert(prompt.includes("linkedin.com"), "Browser context should include URL")
})

await runTest("Message WITHOUT browser context → still completes", async () => {
  const { context, claudeMessages } = makeContext()
  await processEnvelope(
    makeEnvelope("analyze something interesting about AI infrastructure"),
    context,
  )

  assert(claudeMessages.length === 1, "Should still produce enriched prompt")
  const prompt = claudeMessages[0].message.content
  assert(!prompt.includes("## Browser Context"), "Should NOT have Browser Context when not provided")
})

// ─── 5. Kill Switch ─────────────────────────────────────────

console.log("\n─── 5. Kill Switch — BRIDGE_TRIAGE=false ───")

await runTest("Kill switch disables triage → raw passthrough", async () => {
  const orig = process.env.BRIDGE_TRIAGE
  process.env.BRIDGE_TRIAGE = "false"

  try {
    const { context, claudeMessages } = makeContext()
    await processEnvelope(makeEnvelope("research something complex"), context)

    assert(claudeMessages.length === 1, "Should still forward to Claude")
    assert(
      claudeMessages[0].type === "user_message",
      `Expected raw passthrough (type=user_message), got type=${claudeMessages[0].type}`,
    )
  } finally {
    if (orig === undefined) delete process.env.BRIDGE_TRIAGE
    else process.env.BRIDGE_TRIAGE = orig
  }
})

// ─── 6. Non-user messages ───────────────────────────────────

console.log("\n─── 6. Non-user messages — relay passthrough ───")

await runTest("tool_result passes through without triage", async () => {
  const { context, claudeMessages } = makeContext()
  await processEnvelope(
    {
      message: { type: "tool_result", content: "file saved" } as any,
      surface: "chrome_extension",
      sessionId: "smoke",
      timestamp: new Date().toISOString(),
      direction: "client_to_claude",
      sourceConnectionId: "smoke-client-1",
    },
    context,
  )

  assert(claudeMessages.length === 1, "tool_result should pass through to Claude")
})

// ─── 7. Claude → Client direction ──────────────────────────

console.log("\n─── 7. Claude → Client — broadcast ───")

await runTest("Claude response broadcasts to all clients", async () => {
  const { context, broadcasts } = makeContext()
  await processEnvelope(
    {
      message: { type: "assistant", message: { role: "assistant", content: "42" } } as any,
      surface: "chrome_extension",
      sessionId: "smoke",
      timestamp: new Date().toISOString(),
      direction: "claude_to_client",
      sourceConnectionId: "claude",
    },
    context,
  )

  assert(broadcasts.length === 1, `Expected 1 broadcast, got ${broadcasts.length}`)
})

// ═════════════════════════════════════════════════════════════
// Summary
// ═════════════════════════════════════════════════════════════

const passed = results.filter((r) => r.pass).length
const failed = results.filter((r) => !r.pass).length

console.log("\n══════════════════════════════════════════════════")
console.log(`  Results: ${passed} passed, ${failed} failed out of ${results.length} tests`)
console.log("══════════════════════════════════════════════════")

if (failed > 0) {
  console.log("\nFailures:")
  for (const r of results.filter((r) => !r.pass)) {
    console.log(`  ✗ ${r.name}: ${r.detail}`)
  }
  process.exit(1)
} else {
  console.log("\n  All smoke tests passed. Bridge Phase 5 orchestration is go.\n")
  process.exit(0)
}
