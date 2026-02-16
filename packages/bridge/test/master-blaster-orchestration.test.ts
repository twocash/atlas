/**
 * Master Blaster — Bridge Phase 5 Orchestration Proof
 *
 * Real-world proof-of-performance tests exercising the actual handler chain,
 * real triage handler, real context assembler, and real profiler.
 *
 * Only external dependencies are mocked:
 *   - triageMessage (Haiku API call)
 *   - composeFromStructuredContext (Notion/file reads)
 *   - logger (suppress noisy output)
 *
 * Test 1: Triage Routing Proof — 4 real-world messages through the chain
 * Test 2: Context Assembly Proof — LinkedIn fixture through all 6 slots
 */

import { describe, it, expect, mock, beforeAll, afterAll } from "bun:test"
import type { ComplexityTier } from "../src/types/orchestration"

// ═══════════════════════════════════════════════════════════════
// Module Mocks (BEFORE any imports)
// ═══════════════════════════════════════════════════════════════

// Resolve absolute paths from the importing modules' directories
const assemblerDir = process.cwd() + "/packages/bridge/src/context"
const handlerDir = process.cwd() + "/packages/bridge/src/handlers"

const triageSkillPath = require.resolve(
  "../../../../apps/telegram/src/cognitive/triage-skill",
  { paths: [assemblerDir] },
)
const compositionPath = require.resolve(
  "../../../../packages/agents/src/services/prompt-composition",
  { paths: [assemblerDir] },
)
const compositionTypesPath = require.resolve(
  "../../../../packages/agents/src/services/prompt-composition/types",
  { paths: [assemblerDir] },
)
const profilerPath = require.resolve(
  "../../../../apps/telegram/src/cognitive/profiler",
  { paths: [handlerDir] },
)
const loggerPath = require.resolve(
  "../logger",
  { paths: [process.cwd() + "/apps/telegram/src/cognitive"] },
)

// ─── Triage Message Mock ──────────────────────────────────────
// Returns realistic triage results based on message content.
// This replaces the Haiku API call with deterministic responses.

interface MockTriageResult {
  intent: string
  confidence: number
  pillar: string
  requestType: string
  keywords: string[]
  complexityTier: ComplexityTier
  source: string
  title?: string
  command?: { name: string; args?: string }
  isCompound?: boolean
  subIntents?: any[]
}

function mockTriageForMessage(text: string): MockTriageResult {
  const lower = text.toLowerCase()

  // Simple greetings / chat
  if (/^(hey|hi|hello|sup|yo)\b/i.test(lower)) {
    return {
      intent: "clarify",
      confidence: 0.95,
      pillar: "Personal",
      requestType: "Chat",
      keywords: [],
      complexityTier: 0,
      source: "pattern_cache",
    }
  }

  // Simple factual questions
  if (/what time|weather|what day/i.test(lower)) {
    return {
      intent: "query",
      confidence: 0.9,
      pillar: "Personal",
      requestType: "Answer",
      keywords: ["time"],
      complexityTier: 1,
      source: "haiku",
      title: "Simple Factual Query",
    }
  }

  // Research requests
  if (/research|analyze|summarize|investigate|enforcement/i.test(lower)) {
    return {
      intent: "query",
      confidence: 0.85,
      pillar: "The Grove",
      requestType: "Research",
      keywords: ["research", "AI", "policy"],
      complexityTier: 3,
      source: "haiku",
      title: "Research: EU AI Act Enforcement",
    }
  }

  // Draft / creative requests
  if (/draft|write|compose|thinkpiece|linkedin/i.test(lower)) {
    return {
      intent: "capture",
      confidence: 0.88,
      pillar: "The Grove",
      requestType: "Draft",
      keywords: ["linkedin", "infrastructure", "AI"],
      complexityTier: 2,
      source: "haiku",
      title: "LinkedIn: Distributed AI Training Infrastructure",
    }
  }

  // Default: moderate query
  return {
    intent: "query",
    confidence: 0.7,
    pillar: "Personal",
    requestType: "Answer",
    keywords: [],
    complexityTier: 2,
    source: "haiku",
    title: "General Query",
  }
}

mock.module(triageSkillPath, () => ({
  triageMessage: async (text: string) => mockTriageForMessage(text),
  createCachedTriageResult: () => null,
  classifyWithFallback: async (text: string) => mockTriageForMessage(text),
  triageForAudit: async (text: string) => mockTriageForMessage(text),
}))

// ─── Prompt Composition Mock ─────────────────────────────────
// Returns a voice prompt string. Simulates the real composition
// system without Notion/file reads.

mock.module(compositionPath, () => ({
  composeFromStructuredContext: async (input: any) => ({
    prompt: `You are Atlas, Jim's cognitive co-pilot. ${
      input.intent === "capture"
        ? "Draft in Jim's voice: clear, direct, technically informed."
        : input.intent === "query" || input.intent === "action"
          ? "Respond concisely. Use structured formatting for complex answers."
          : "Be helpful and conversational."
    }`,
    temperature: input.depth === "deep" ? 0.3 : 0.7,
    maxTokens: input.depth === "deep" ? 8192 : 4096,
    metadata: { action: input.intent, voice: "atlas-default" },
  }),
}))

// Stub the types module (only exports types, but needs to resolve)
mock.module(compositionTypesPath, () => ({}))

// ─── Profiler: Use REAL profiler (pure logic, no API) ─────────
// We do NOT mock the profiler. The real profileTask, canSkipLLM,
// and getQuickResponse are used, testing actual heuristic classification.
// However, we need to suppress the logger import inside profiler.ts.

mock.module(loggerPath, () => ({
  logger: {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  },
}))

// ═══════════════════════════════════════════════════════════════
// Imports (AFTER mocks)
// ═══════════════════════════════════════════════════════════════

import { processEnvelope } from "../src/handlers"
import type { BridgeEnvelope, HandlerContext } from "../src/types/bridge"

// ═══════════════════════════════════════════════════════════════
// Test Infrastructure
// ═══════════════════════════════════════════════════════════════

function makeEnvelope(text: string, extra?: Partial<BridgeEnvelope>): BridgeEnvelope {
  return {
    message: {
      type: "user_message",
      content: [{ type: "text", text }],
      ...(extra?.message as any || {}),
    } as any,
    surface: "chrome_extension",
    sessionId: `mb-session-${Date.now()}`,
    timestamp: new Date().toISOString(),
    direction: "client_to_claude",
    sourceConnectionId: "client-mb-001",
    ...extra,
  }
}

function makeEnvelopeWithBrowser(
  text: string,
  browserContext: Record<string, any>,
): BridgeEnvelope {
  return {
    message: {
      type: "user_message",
      content: [{ type: "text", text }],
      browserContext,
    } as any,
    surface: "chrome_extension",
    sessionId: `mb-session-${Date.now()}`,
    timestamp: new Date().toISOString(),
    direction: "client_to_claude",
    sourceConnectionId: "client-mb-002",
  }
}

interface TestCapture {
  claudeMessages: any[]
  clientResponses: { to: string; msg: any }[]
  broadcasts: any[]
  context: HandlerContext
}

function makeCapture(): TestCapture {
  const claudeMessages: any[] = []
  const clientResponses: { to: string; msg: any }[] = []
  const broadcasts: any[] = []

  const context: HandlerContext = {
    sendToClaude: (msg) => claudeMessages.push(msg),
    sendToClient: (connId, msg) => clientResponses.push({ to: connId, msg }),
    broadcastToClients: (msg) => broadcasts.push(msg),
    isClaudeConnected: () => true,
  }

  return { claudeMessages, clientResponses, broadcasts, context }
}

// Ensure triage is enabled
let origBridgeTriage: string | undefined
beforeAll(() => {
  origBridgeTriage = process.env.BRIDGE_TRIAGE
  delete process.env.BRIDGE_TRIAGE // Default = enabled
})
afterAll(() => {
  if (origBridgeTriage !== undefined) {
    process.env.BRIDGE_TRIAGE = origBridgeTriage
  }
})

// ═══════════════════════════════════════════════════════════════
// TEST 1: Triage Routing Proof
// ═══════════════════════════════════════════════════════════════

describe("Test 1: Triage Routing Proof", () => {
  // ─── Message A: "hey what's up" ──────────────────────────────
  // The real profiler's detectComplexity tests against:
  //   /^(hey|hi|hello|yo|sup|ok|okay|cool|nice|good|great|thanks?|thx|ty)!?$/i
  // "hey what's up" does NOT match (it has extra words after "hey").
  // So profiler returns complexity: "simple" (short, <20 tokens, no capabilities).
  // canSkipLLM → false (not trivial). Falls through to full triage.
  // Mock triage returns tier 0 → still gets forwarded with enriched prompt.

  describe("Message A: casual greeting ('hey what's up')", () => {
    it("routes through triage with tier 0 classification", async () => {
      const { context, claudeMessages, clientResponses } = makeCapture()
      await processEnvelope(makeEnvelope("hey what's up"), context)

      // Tier 0 → local route → but current implementation still forwards to Claude
      // with enriched prompt (per TODO in triage.ts)
      expect(claudeMessages.length).toBe(1)
      expect(clientResponses.length).toBe(0) // No direct client response for non-trivial
    })

    it("enriched prompt contains tier 0 intent classification", async () => {
      const { context, claudeMessages } = makeCapture()
      await processEnvelope(makeEnvelope("hey what's up"), context)

      const prompt = claudeMessages[0].message.content
      expect(prompt).toContain("Intent: clarify")
      expect(prompt).toContain("Tier 0")
    })

    it("no errors on the greeting path", async () => {
      const { context } = makeCapture()
      // Should complete without throwing
      await expect(processEnvelope(makeEnvelope("hey what's up"), context)).resolves.toBeUndefined()
    })
  })

  // ─── Message A2: bare "hi" (profiler quick-skip) ──────────────
  // "hi" matches the trivial regex exactly.
  // profileTask → complexity: "trivial", detectedTools: []
  // canSkipLLM(profile) → true
  // getQuickResponse("hi") → "Hey. What's up?"
  // → local response, no Claude

  describe("Message A2: bare greeting ('hi') — profiler quick-skip", () => {
    it("short-circuits to local response without Claude", async () => {
      const { context, claudeMessages, clientResponses } = makeCapture()
      await processEnvelope(makeEnvelope("hi"), context)

      expect(claudeMessages.length).toBe(0)
      expect(clientResponses.length).toBe(1)
    })

    it("returns canned greeting from real profiler", async () => {
      const { context, clientResponses } = makeCapture()
      await processEnvelope(makeEnvelope("hi"), context)

      const response = clientResponses[0].msg as any
      expect(response.message.content).toBe("Hey. What's up?")
      expect(response.metadata.route).toBe("local")
      expect(response.metadata.tier).toBe(0)
    })
  })

  // ─── Message B: "what time is it" ──────────────────────────────
  // Profiler: complexity "simple" (<20 tokens, no reasoning/code capabilities)
  // canSkipLLM → false (not trivial)
  // Mock triage: tier 1, intent=query
  // Route: local → forwards to Claude with enriched prompt

  describe("Message B: simple factual ('what time is it')", () => {
    it("routes through triage with tier 1 classification", async () => {
      const { context, claudeMessages } = makeCapture()
      await processEnvelope(makeEnvelope("what time is it"), context)

      expect(claudeMessages.length).toBe(1)
    })

    it("enriched prompt reflects tier 1 query intent", async () => {
      const { context, claudeMessages } = makeCapture()
      await processEnvelope(makeEnvelope("what time is it"), context)

      const prompt = claudeMessages[0].message.content
      expect(prompt).toContain("Intent: query")
      expect(prompt).toContain("Tier 1")
    })

    it("no errors on simple query path", async () => {
      const { context } = makeCapture()
      await expect(processEnvelope(makeEnvelope("what time is it"), context)).resolves.toBeUndefined()
    })
  })

  // ─── Message C: EU AI Act research ──────────────────────────────
  // Profiler: complexity "complex" or "moderate" (long text, reasoning + long-context)
  // canSkipLLM → false
  // Mock triage: tier 3, intent=query, pillar=The Grove, type=Research
  // Route: claude_code → enriched prompt with voice composition

  describe("Message C: research request (EU AI Act)", () => {
    const researchMsg = "research the latest EU AI Act enforcement actions and draft a summary"

    it("routes to Claude Code (tier 2-3)", async () => {
      const { context, claudeMessages } = makeCapture()
      await processEnvelope(makeEnvelope(researchMsg), context)

      expect(claudeMessages.length).toBe(1)
    })

    it("enriched prompt contains research intent at tier 3", async () => {
      const { context, claudeMessages } = makeCapture()
      await processEnvelope(makeEnvelope(researchMsg), context)

      const prompt = claudeMessages[0].message.content
      expect(prompt).toContain("Intent: query")
      expect(prompt).toContain("Tier 3")
      expect(prompt).toContain("The Grove")
      expect(prompt).toContain("Research")
    })

    it("enriched prompt includes voice composition", async () => {
      const { context, claudeMessages } = makeCapture()
      await processEnvelope(makeEnvelope(researchMsg), context)

      const prompt = claudeMessages[0].message.content
      expect(prompt).toContain("## Voice & Style")
      expect(prompt).toContain("Atlas")
    })

    it("enriched prompt includes output instructions", async () => {
      const { context, claudeMessages } = makeCapture()
      await processEnvelope(makeEnvelope(researchMsg), context)

      const prompt = claudeMessages[0].message.content
      expect(prompt).toContain("## Output Instructions")
    })

    it("has correct Claude stream-json structure", async () => {
      const { context, claudeMessages } = makeCapture()
      await processEnvelope(makeEnvelope(researchMsg), context)

      const msg = claudeMessages[0]
      expect(msg.type).toBe("user")
      expect(msg.message.role).toBe("user")
      expect(typeof msg.message.content).toBe("string")
    })
  })

  // ─── Message D: LinkedIn thinkpiece ──────────────────────────────
  // Profiler: complexity "moderate" (creativity + long-context capabilities)
  // Mock triage: tier 2, intent=capture, pillar=The Grove, type=Draft
  // Route: claude_code → enriched prompt with draft voice

  describe("Message D: LinkedIn draft (thinkpiece)", () => {
    const draftMsg = "draft a LinkedIn thinkpiece about distributed AI training infrastructure"

    it("routes to Claude Code (tier 2)", async () => {
      const { context, claudeMessages } = makeCapture()
      await processEnvelope(makeEnvelope(draftMsg), context)

      expect(claudeMessages.length).toBe(1)
    })

    it("enriched prompt contains capture intent at tier 2", async () => {
      const { context, claudeMessages } = makeCapture()
      await processEnvelope(makeEnvelope(draftMsg), context)

      const prompt = claudeMessages[0].message.content
      expect(prompt).toContain("Intent: capture")
      expect(prompt).toContain("Tier 2")
      expect(prompt).toContain("The Grove")
      expect(prompt).toContain("Draft")
    })

    it("voice composition reflects draft intent", async () => {
      const { context, claudeMessages } = makeCapture()
      await processEnvelope(makeEnvelope(draftMsg), context)

      const prompt = claudeMessages[0].message.content
      expect(prompt).toContain("## Voice & Style")
      expect(prompt).toContain("Draft in Jim's voice")
    })

    it("prompt has all three expected sections", async () => {
      const { context, claudeMessages } = makeCapture()
      await processEnvelope(makeEnvelope(draftMsg), context)

      const prompt = claudeMessages[0].message.content
      expect(prompt).toContain("## Request")
      expect(prompt).toContain("## Voice & Style")
      expect(prompt).toContain("## Output Instructions")
    })
  })
})

// ═══════════════════════════════════════════════════════════════
// TEST 2: Context Assembly Proof
// ═══════════════════════════════════════════════════════════════

describe("Test 2: Context Assembly Proof", () => {
  // LinkedIn page fixture — realistic post about AI infrastructure
  const linkedInFixture = {
    url: "https://www.linkedin.com/feed/update/urn:li:activity:7298456123456789",
    title: "Sanjay Mehta on LinkedIn: The future of distributed AI training",
    selectedText: "",
    linkedInContext: {
      postAuthor: "Sanjay Mehta",
      postText:
        "The future of distributed AI training isn't about bigger GPUs — it's about " +
        "smarter orchestration. We're seeing 40% efficiency gains by moving to " +
        "hierarchical gradient aggregation across heterogeneous node clusters. " +
        "The infrastructure layer is the new moat.",
      commentCount: 47,
    },
  }

  // ─── All 4 wired slots populate ──────────────────────────────

  describe("Wired slots (with browser context)", () => {
    const complexMsg = "analyze this post and draft a response connecting it to our Grove research on agent orchestration"

    it("Slot 1 (Intent): contains structured triage context", async () => {
      const { context, claudeMessages } = makeCapture()
      await processEnvelope(
        makeEnvelopeWithBrowser(complexMsg, linkedInFixture),
        context,
      )

      const prompt = claudeMessages[0].message.content
      expect(prompt).toContain("## Request")
      expect(prompt).toContain("Intent:")
      expect(prompt).toContain("Pillar:")
      expect(prompt).toContain("Tier")
    })

    it("Slot 4 (Voice): resolved from composition system (not empty)", async () => {
      const { context, claudeMessages } = makeCapture()
      await processEnvelope(
        makeEnvelopeWithBrowser(complexMsg, linkedInFixture),
        context,
      )

      const prompt = claudeMessages[0].message.content
      expect(prompt).toContain("## Voice & Style")
      // The mock composition returns a non-empty voice prompt
      expect(prompt).toContain("Atlas")
    })

    it("Slot 5 (Browser): contains LinkedIn page fixture content", async () => {
      const { context, claudeMessages } = makeCapture()
      await processEnvelope(
        makeEnvelopeWithBrowser(complexMsg, linkedInFixture),
        context,
      )

      const prompt = claudeMessages[0].message.content
      expect(prompt).toContain("## Browser Context")
      expect(prompt).toContain("linkedin.com")
      expect(prompt).toContain("Sanjay Mehta")
      expect(prompt).toContain("distributed AI training")
      expect(prompt).toContain("47") // comment count
    })

    it("Slot 6 (Output): has landing surface specification", async () => {
      const { context, claudeMessages } = makeCapture()
      await processEnvelope(
        makeEnvelopeWithBrowser(complexMsg, linkedInFixture),
        context,
      )

      const prompt = claudeMessages[0].message.content
      expect(prompt).toContain("## Output Instructions")
      expect(prompt).toContain("Landing surface:")
    })

    it("all 4 wired slot sections present in prompt", async () => {
      const { context, claudeMessages } = makeCapture()
      await processEnvelope(
        makeEnvelopeWithBrowser(complexMsg, linkedInFixture),
        context,
      )

      const prompt = claudeMessages[0].message.content
      const sections = ["## Request", "## Voice & Style", "## Browser Context", "## Output Instructions"]
      for (const section of sections) {
        expect(prompt).toContain(section)
      }
    })
  })

  // ─── Stubbed slots (2 + 3) ──────────────────────────────────

  describe("Stubbed slots (domain_rag, pov)", () => {
    it("Domain RAG (Slot 2) does not appear in prompt", async () => {
      const { context, claudeMessages } = makeCapture()
      await processEnvelope(
        makeEnvelopeWithBrowser("analyze this post", linkedInFixture),
        context,
      )

      const prompt = claudeMessages[0].message.content
      expect(prompt).not.toContain("## Domain Knowledge")
    })

    it("POV Library (Slot 3) does not appear in prompt", async () => {
      const { context, claudeMessages } = makeCapture()
      await processEnvelope(
        makeEnvelopeWithBrowser("analyze this post", linkedInFixture),
        context,
      )

      const prompt = claudeMessages[0].message.content
      expect(prompt).not.toContain("## Epistemic Position")
    })

    it("empty stubs do not throw during assembly", async () => {
      const { context } = makeCapture()
      await expect(
        processEnvelope(makeEnvelopeWithBrowser("analyze this", linkedInFixture), context),
      ).resolves.toBeUndefined()
    })
  })

  // ─── Token budget enforcement ──────────────────────────────

  describe("Token budget enforcement", () => {
    it("assembly completes without crash on populated slots", async () => {
      const { context, claudeMessages } = makeCapture()
      const longMsg = "research ".repeat(50) + "the implications of federated learning for healthcare data privacy across the European Union member states"
      await processEnvelope(
        makeEnvelopeWithBrowser(longMsg, linkedInFixture),
        context,
      )

      expect(claudeMessages.length).toBe(1)
      expect(typeof claudeMessages[0].message.content).toBe("string")
      expect(claudeMessages[0].message.content.length).toBeGreaterThan(100)
    })
  })

  // ─── Graceful degradation: no browser context ──────────────

  describe("Graceful degradation (no browser context)", () => {
    it("assembly completes without browser context", async () => {
      const { context, claudeMessages } = makeCapture()
      await processEnvelope(
        makeEnvelope("draft a summary of our Q4 consulting pipeline"),
        context,
      )

      expect(claudeMessages.length).toBe(1)
    })

    it("browser section absent when no extension connected", async () => {
      const { context, claudeMessages } = makeCapture()
      await processEnvelope(
        makeEnvelope("draft a summary of our Q4 consulting pipeline"),
        context,
      )

      const prompt = claudeMessages[0].message.content
      expect(prompt).not.toContain("## Browser Context")
    })

    it("remaining slots still populated without browser", async () => {
      const { context, claudeMessages } = makeCapture()
      await processEnvelope(
        makeEnvelope("draft a summary of our Q4 consulting pipeline"),
        context,
      )

      const prompt = claudeMessages[0].message.content
      expect(prompt).toContain("## Request")
      expect(prompt).toContain("## Voice & Style")
      expect(prompt).toContain("## Output Instructions")
    })

    it("no errors when browserContext is undefined", async () => {
      const { context } = makeCapture()
      await expect(
        processEnvelope(makeEnvelope("just a normal message"), context),
      ).resolves.toBeUndefined()
    })
  })
})
