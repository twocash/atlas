/**
 * Phase 5 Integration Tests — handler chain with mocked assembler.
 *
 * Tests the full middleware pipeline:
 *   triageHandler → relayHandler → responseRouterHandler
 *
 * Mocks the context assembler (no API calls) to test handler chain logic.
 */

import { describe, it, expect, mock } from "bun:test"
import type { AssemblyResult } from "../src/context/assembler"
import type { ComplexityTier } from "../src/types/orchestration"

// ─── Mock assembler + profiler BEFORE importing handlers ───────

const mockAssemblyResult: AssemblyResult = {
  slots: [
    { id: "intent", source: "triage-haiku", content: "Intent: query\nComplexity: Tier 2\nPillar: Personal\n\nUser message: What is the meaning of life?", tokens: 20, priority: 90, populated: true },
    { id: "domain_rag", source: "rag-stub", content: "", tokens: 0, priority: 20, populated: false },
    { id: "pov", source: "pov-stub", content: "", tokens: 0, priority: 30, populated: false },
    { id: "voice", source: "prompt-composition", content: "Be concise and helpful.", tokens: 5, priority: 70, populated: true },
    { id: "browser", source: "extension", content: "", tokens: 0, priority: 50, populated: false },
    { id: "output", source: "landing-surface", content: "Landing surface: chat\n\nRespond directly in the chat. Use markdown formatting. Be concise but complete.", tokens: 10, priority: 100, populated: true },
  ],
  triage: {
    intent: "query",
    confidence: 0.9,
    pillar: "Personal",
    requestType: "Research",
    keywords: ["philosophy"],
    complexityTier: 2 as ComplexityTier,
    source: "haiku",
  } as any,
  tier: 2 as ComplexityTier,
  route: "claude_code",
  slotsUsed: ["intent", "voice", "output"],
  totalContextTokens: 35,
  triageLatencyMs: 150,
  landingSurface: "chat",
  voicePrompt: "Be concise and helpful.",
}

// Mock at the assembler level — this avoids needing to mock cross-package imports
mock.module("../src/context/assembler", () => ({
  assembleContext: async () => ({ ...mockAssemblyResult }),
}))

// Mock the profiler (imported by triage handler)
const resolvedProfilerPath = require.resolve("../../../../apps/telegram/src/cognitive/profiler", {
  paths: [process.cwd() + "/packages/bridge/src/handlers"],
})
mock.module(resolvedProfilerPath, () => ({
  profileTask: (input: string) => ({
    taskId: "test",
    input,
    complexity: /^(hey|hi|hello|yo|sup)!?$/i.test(input.trim()) ? "trivial" : "moderate",
    detectedTools: [],
    requiredContext: [],
    estimatedInputTokens: 50,
    estimatedOutputTokens: 50,
    latencySensitive: true,
    costSensitive: true,
    requiresReasoning: false,
    requiresCode: false,
    requiresStructuredOutput: false,
    requiresCreativity: false,
    requiresLongContext: false,
    touchesFilesystem: false,
    touchesAuth: false,
    executesCode: false,
    mutatesExternal: false,
  }),
  canSkipLLM: (profile: any) => profile.complexity === "trivial" && profile.detectedTools.length === 0,
  getQuickResponse: (text: string) => {
    if (text === "hi" || text === "hello") return "Hey there! How can I help?"
    return null
  },
}))

// ─── Now import handlers (after mocks) ────────────────────────

import { processEnvelope } from "../src/handlers"
import type { BridgeEnvelope, HandlerContext } from "../src/types/bridge"

// ─── Test Helpers ─────────────────────────────────────────────

function makeEnvelope(overrides?: Partial<BridgeEnvelope>): BridgeEnvelope {
  return {
    message: {
      type: "user_message",
      content: [{ type: "text", text: "What is the meaning of life?" }],
    } as any,
    surface: "chrome_extension",
    sessionId: "test-session-1",
    timestamp: new Date().toISOString(),
    direction: "client_to_claude",
    sourceConnectionId: "client-123",
    ...overrides,
  }
}

function makeContext() {
  const sent: { to: string; msg: any }[] = []
  const claudeMessages: any[] = []
  const broadcasts: any[] = []

  const context: HandlerContext = {
    sendToClaude: (msg) => claudeMessages.push(msg),
    sendToClient: (connId, msg) => sent.push({ to: connId, msg }),
    broadcastToClients: (msg) => broadcasts.push(msg),
    isClaudeConnected: () => true,
  }

  return { context, sent, claudeMessages, broadcasts }
}

// ═══════════════════════════════════════════════════════════════
// Group 1: Client → Claude (triage intercept)
// ═══════════════════════════════════════════════════════════════

describe("Handler Chain: Client → Claude", () => {
  it("triage sends enriched prompt to Claude for Tier 2+", async () => {
    const { context, claudeMessages } = makeContext()
    await processEnvelope(makeEnvelope(), context)

    expect(claudeMessages.length).toBe(1)
    const msg = claudeMessages[0]
    expect(msg.type).toBe("user")
    expect(msg.message.role).toBe("user")
    expect(msg.message.content).toContain("Atlas")
    expect(msg.message.content).toContain("meaning of life")
  })

  it("quick-skip messages get local response without Claude", async () => {
    const { context, claudeMessages, sent } = makeContext()
    const envelope = makeEnvelope({
      message: {
        type: "user_message",
        content: [{ type: "text", text: "hi" }],
      } as any,
    })

    await processEnvelope(envelope, context)

    expect(claudeMessages.length).toBe(0)
    expect(sent.length).toBe(1)
    expect(sent[0].to).toBe("client-123")
    expect((sent[0].msg as any).message.content).toContain("Hey there")
  })

  it("non-user-message types pass through relay to Claude", async () => {
    const { context, claudeMessages } = makeContext()
    const envelope = makeEnvelope({
      message: { type: "tool_result", content: "ok" } as any,
    })

    await processEnvelope(envelope, context)

    // Triage skips non-user_message → relay forwards to Claude
    expect(claudeMessages.length).toBe(1)
  })
})

// ═══════════════════════════════════════════════════════════════
// Group 2: Claude → Client (response routing)
// ═══════════════════════════════════════════════════════════════

describe("Handler Chain: Claude → Client", () => {
  it("claude responses broadcast to all clients", async () => {
    const { context, broadcasts } = makeContext()
    const envelope = makeEnvelope({
      direction: "claude_to_client",
      message: { type: "assistant", message: { role: "assistant", content: "42" } } as any,
      sourceConnectionId: "claude",
    })

    await processEnvelope(envelope, context)

    expect(broadcasts.length).toBe(1)
  })
})

// ═══════════════════════════════════════════════════════════════
// Group 3: Enriched Prompt Structure
// ═══════════════════════════════════════════════════════════════

describe("Enriched Prompt Content", () => {
  it("includes Request section from intent slot", async () => {
    const { context, claudeMessages } = makeContext()
    await processEnvelope(makeEnvelope(), context)

    const prompt = claudeMessages[0].message.content
    expect(prompt).toContain("## Request")
    expect(prompt).toContain("Intent: query")
  })

  it("includes Voice section from voice slot", async () => {
    const { context, claudeMessages } = makeContext()
    await processEnvelope(makeEnvelope(), context)

    const prompt = claudeMessages[0].message.content
    expect(prompt).toContain("## Voice & Style")
    expect(prompt).toContain("concise and helpful")
  })

  it("includes Output Instructions section", async () => {
    const { context, claudeMessages } = makeContext()
    await processEnvelope(makeEnvelope(), context)

    const prompt = claudeMessages[0].message.content
    expect(prompt).toContain("## Output Instructions")
    expect(prompt).toContain("Landing surface: chat")
  })

  it("excludes unpopulated slots (domain_rag, pov, browser)", async () => {
    const { context, claudeMessages } = makeContext()
    await processEnvelope(makeEnvelope(), context)

    const prompt = claudeMessages[0].message.content
    expect(prompt).not.toContain("## Domain Knowledge")
    expect(prompt).not.toContain("## Epistemic Position")
    expect(prompt).not.toContain("## Browser Context")
  })

  it("uses correct section ordering: Request → Voice → Output", async () => {
    const { context, claudeMessages } = makeContext()
    await processEnvelope(makeEnvelope(), context)

    const prompt = claudeMessages[0].message.content
    const requestIdx = prompt.indexOf("## Request")
    const voiceIdx = prompt.indexOf("## Voice & Style")
    const outputIdx = prompt.indexOf("## Output Instructions")

    expect(requestIdx).toBeLessThan(voiceIdx)
    expect(voiceIdx).toBeLessThan(outputIdx)
  })
})

// ═══════════════════════════════════════════════════════════════
// Group 4: Kill Switch
// ═══════════════════════════════════════════════════════════════

describe("Kill Switch", () => {
  it("BRIDGE_TRIAGE=false falls through to relay (raw message)", async () => {
    const orig = process.env.BRIDGE_TRIAGE
    process.env.BRIDGE_TRIAGE = "false"

    try {
      const { context, claudeMessages } = makeContext()
      await processEnvelope(makeEnvelope(), context)

      // Relay sends the raw message (not enriched prompt)
      expect(claudeMessages.length).toBe(1)
      // The raw message should be the original user_message object
      const msg = claudeMessages[0]
      expect(msg.type).toBe("user_message")
    } finally {
      if (orig === undefined) {
        delete process.env.BRIDGE_TRIAGE
      } else {
        process.env.BRIDGE_TRIAGE = orig
      }
    }
  })
})

// ═══════════════════════════════════════════════════════════════
// Group 5: Error Resilience
// ═══════════════════════════════════════════════════════════════

describe("Error Resilience", () => {
  it("Claude not connected sends error to client (via relay)", async () => {
    const sent: { to: string; msg: any }[] = []
    const context: HandlerContext = {
      sendToClaude: () => {},
      sendToClient: (connId, msg) => sent.push({ to: connId, msg }),
      broadcastToClients: () => {},
      isClaudeConnected: () => false,
    }

    // Kill switch ON so triage is bypassed → relay handles it
    const orig = process.env.BRIDGE_TRIAGE
    process.env.BRIDGE_TRIAGE = "false"

    try {
      await processEnvelope(makeEnvelope(), context)

      expect(sent.length).toBe(1)
      expect(sent[0].msg.data.code).toBe("CLAUDE_NOT_CONNECTED")
    } finally {
      if (orig === undefined) {
        delete process.env.BRIDGE_TRIAGE
      } else {
        process.env.BRIDGE_TRIAGE = orig
      }
    }
  })
})
