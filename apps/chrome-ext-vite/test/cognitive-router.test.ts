/**
 * Cognitive Router — Gate 1.6 Unit Tests
 *
 * Exhaustive coverage of the routing matrix:
 *   tier × taskComplexity × bridgeStatus → backend + taskTier + fallbackChain
 *
 * Every cell in the contract routing table is tested.
 * Missing tier defaults to "general". Bridge disconnected states
 * are tested with both "disconnected" and "error" variants.
 *
 * LOUD FAILURES: Tests use descriptive names so any regression
 * screams exactly which routing path broke.
 */
import { describe, it, expect } from "bun:test"
import { resolveRoute } from "../src/lib/cognitive-router"
import type { CognitiveRouterInput, BridgeStatus, TaskComplexity } from "../src/types/routing"
import type { InteractionTier } from "../src/types/classification"

// ─── Fixtures ────────────────────────────────────────────────

const BRIDGE_UP: BridgeStatus = { bridge: "connected", claude: "connected" }
const BRIDGE_DOWN: BridgeStatus = { bridge: "disconnected", claude: "disconnected" }
const BRIDGE_PARTIAL: BridgeStatus = { bridge: "connected", claude: "disconnected" }
const BRIDGE_ERROR: BridgeStatus = { bridge: "error", claude: "disconnected" }

function route(
  tier: InteractionTier | undefined,
  task: TaskComplexity,
  bridge: BridgeStatus = BRIDGE_DOWN,
): ReturnType<typeof resolveRoute> {
  return resolveRoute({ tier, taskComplexity: task, bridgeStatus: bridge })
}

// ─── 1. Deterministic Tasks (status_write) ───────────────────

describe("status_write → template_fallback regardless of tier/bridge", () => {
  const tiers: (InteractionTier | undefined)[] = ["grove", "consulting", "recruiting", "general", undefined]
  const bridges = [BRIDGE_UP, BRIDGE_DOWN, BRIDGE_PARTIAL, BRIDGE_ERROR]

  for (const tier of tiers) {
    for (const bridge of bridges) {
      it(`tier=${tier ?? "undefined"}, bridge=${bridge.bridge}/${bridge.claude}`, () => {
        const r = route(tier, "status_write", bridge)
        expect(r.backend).toBe("template_fallback")
        expect(r.taskTier).toBe("fast")
      })
    }
  }
})

// ─── 2. Socratic Questions → haiku FAST ─────────────────────

describe("socratic_question → haiku FAST regardless of tier/bridge", () => {
  const tiers: (InteractionTier | undefined)[] = ["grove", "consulting", "recruiting", "general", undefined]
  const bridges = [BRIDGE_UP, BRIDGE_DOWN, BRIDGE_PARTIAL, BRIDGE_ERROR]

  for (const tier of tiers) {
    for (const bridge of bridges) {
      it(`tier=${tier ?? "undefined"}, bridge=${bridge.bridge}/${bridge.claude}`, () => {
        const r = route(tier, "socratic_question", bridge)
        expect(r.backend).toBe("haiku")
        expect(r.taskTier).toBe("fast")
      })
    }
  }
})

// ─── 3. Classification → haiku FAST ─────────────────────────

describe("classification → haiku FAST regardless of tier/bridge", () => {
  const tiers: (InteractionTier | undefined)[] = ["grove", "consulting", "recruiting", "general", undefined]
  const bridges = [BRIDGE_UP, BRIDGE_DOWN]

  for (const tier of tiers) {
    for (const bridge of bridges) {
      it(`tier=${tier ?? "undefined"}, bridge=${bridge.bridge}/${bridge.claude}`, () => {
        const r = route(tier, "classification", bridge)
        expect(r.backend).toBe("haiku")
        expect(r.taskTier).toBe("fast")
      })
    }
  }
})

// ─── 4. Grove Tier — Draft Routing ──────────────────────────

describe("grove + draft routing", () => {
  it("bridge UP → claude_code SMART with fallback chain", () => {
    const r = route("grove", "draft", BRIDGE_UP)
    expect(r.backend).toBe("claude_code")
    expect(r.taskTier).toBe("smart")
    expect(r.resolvedTier).toBe("grove")
    expect(r.fallbackChain).toEqual(["haiku", "template_fallback"])
    expect(r.fallbackReason).toBeUndefined()
  })

  it("bridge DOWN → haiku SMART (fallback)", () => {
    const r = route("grove", "draft", BRIDGE_DOWN)
    expect(r.backend).toBe("haiku")
    expect(r.taskTier).toBe("smart")
    expect(r.resolvedTier).toBe("grove")
    expect(r.fallbackChain).toEqual(["template_fallback"])
    expect(r.fallbackReason).toBeDefined()
  })

  it("bridge PARTIAL (WS connected, Claude disconnected) → haiku SMART", () => {
    const r = route("grove", "draft", BRIDGE_PARTIAL)
    expect(r.backend).toBe("haiku")
    expect(r.taskTier).toBe("smart")
    expect(r.fallbackReason).toContain("disconnected")
  })

  it("bridge ERROR → haiku SMART", () => {
    const r = route("grove", "draft", BRIDGE_ERROR)
    expect(r.backend).toBe("haiku")
    expect(r.taskTier).toBe("smart")
    expect(r.fallbackReason).toContain("error")
  })
})

// ─── 5. Consulting Tier — Draft Routing ─────────────────────

describe("consulting + draft routing", () => {
  it("bridge UP → claude_code SMART with fallback chain", () => {
    const r = route("consulting", "draft", BRIDGE_UP)
    expect(r.backend).toBe("claude_code")
    expect(r.taskTier).toBe("smart")
    expect(r.resolvedTier).toBe("consulting")
    expect(r.fallbackChain).toEqual(["haiku", "template_fallback"])
  })

  it("bridge DOWN → haiku SMART (fallback)", () => {
    const r = route("consulting", "draft", BRIDGE_DOWN)
    expect(r.backend).toBe("haiku")
    expect(r.taskTier).toBe("smart")
    expect(r.resolvedTier).toBe("consulting")
    expect(r.fallbackChain).toEqual(["template_fallback"])
    expect(r.fallbackReason).toBeDefined()
  })

  it("bridge PARTIAL → haiku SMART (fallback)", () => {
    const r = route("consulting", "draft", BRIDGE_PARTIAL)
    expect(r.backend).toBe("haiku")
    expect(r.taskTier).toBe("smart")
  })
})

// ─── 6. Recruiting Tier → Always haiku FAST ─────────────────

describe("recruiting → haiku FAST regardless of bridge/task", () => {
  it("draft + bridge UP → haiku FAST (not claude_code)", () => {
    const r = route("recruiting", "draft", BRIDGE_UP)
    expect(r.backend).toBe("haiku")
    expect(r.taskTier).toBe("fast")
    expect(r.resolvedTier).toBe("recruiting")
  })

  it("draft + bridge DOWN → haiku FAST", () => {
    const r = route("recruiting", "draft", BRIDGE_DOWN)
    expect(r.backend).toBe("haiku")
    expect(r.taskTier).toBe("fast")
  })
})

// ─── 7. General Tier → Always haiku FAST ────────────────────

describe("general → haiku FAST regardless of bridge/task", () => {
  it("draft + bridge UP → haiku FAST (not claude_code)", () => {
    const r = route("general", "draft", BRIDGE_UP)
    expect(r.backend).toBe("haiku")
    expect(r.taskTier).toBe("fast")
    expect(r.resolvedTier).toBe("general")
  })

  it("draft + bridge DOWN → haiku FAST", () => {
    const r = route("general", "draft", BRIDGE_DOWN)
    expect(r.backend).toBe("haiku")
    expect(r.taskTier).toBe("fast")
  })
})

// ─── 8. Missing Tier Defaults to General ────────────────────

describe("undefined tier defaults to general", () => {
  it("undefined tier + draft → haiku FAST (general behavior)", () => {
    const r = route(undefined, "draft", BRIDGE_UP)
    expect(r.backend).toBe("haiku")
    expect(r.taskTier).toBe("fast")
    expect(r.resolvedTier).toBe("general")
  })

  it("undefined tier + status_write → template_fallback", () => {
    const r = route(undefined, "status_write", BRIDGE_UP)
    expect(r.backend).toBe("template_fallback")
    expect(r.resolvedTier).toBe("general")
  })
})

// ─── 9. Fallback Chain Integrity ────────────────────────────

describe("fallback chain structure", () => {
  it("claude_code routes always have [haiku, template_fallback] fallback", () => {
    const groveUp = route("grove", "draft", BRIDGE_UP)
    const consultUp = route("consulting", "draft", BRIDGE_UP)
    expect(groveUp.fallbackChain).toEqual(["haiku", "template_fallback"])
    expect(consultUp.fallbackChain).toEqual(["haiku", "template_fallback"])
  })

  it("haiku fallback routes have [template_fallback] chain", () => {
    const groveDown = route("grove", "draft", BRIDGE_DOWN)
    const consultDown = route("consulting", "draft", BRIDGE_DOWN)
    expect(groveDown.fallbackChain).toEqual(["template_fallback"])
    expect(consultDown.fallbackChain).toEqual(["template_fallback"])
  })

  it("lightweight tasks have empty fallback chain", () => {
    const general = route("general", "draft", BRIDGE_DOWN)
    const recruiting = route("recruiting", "draft", BRIDGE_DOWN)
    const statusWrite = route("general", "status_write", BRIDGE_DOWN)
    expect(general.fallbackChain).toEqual([])
    expect(recruiting.fallbackChain).toEqual([])
    expect(statusWrite.fallbackChain).toEqual([])
  })
})

// ─── 10. Routing Decision Shape Validation ──────────────────

describe("RoutingDecision shape — all fields present", () => {
  it("every decision has backend, rationale, taskTier, resolvedTier, fallbackChain", () => {
    const inputs: CognitiveRouterInput[] = [
      { tier: "grove", taskComplexity: "draft", bridgeStatus: BRIDGE_UP },
      { tier: "consulting", taskComplexity: "classification", bridgeStatus: BRIDGE_DOWN },
      { tier: "recruiting", taskComplexity: "socratic_question", bridgeStatus: BRIDGE_UP },
      { tier: "general", taskComplexity: "status_write", bridgeStatus: BRIDGE_ERROR },
      { tier: undefined, taskComplexity: "draft", bridgeStatus: BRIDGE_PARTIAL },
    ]

    for (const input of inputs) {
      const r = resolveRoute(input)
      expect(r.backend).toBeDefined()
      expect(r.rationale).toBeDefined()
      expect(typeof r.rationale).toBe("string")
      expect(r.rationale.length).toBeGreaterThan(0)
      expect(r.taskTier).toMatch(/^(fast|smart)$/)
      expect(r.resolvedTier).toMatch(/^(grove|consulting|recruiting|general)$/)
      expect(Array.isArray(r.fallbackChain)).toBe(true)
    }
  })
})

// ─── 11. 80/20 Split Sanity Check ───────────────────────────

describe("80/20 routing split — majority goes to haiku", () => {
  it("only grove and consulting with bridge UP route to claude_code", () => {
    const allTiers: InteractionTier[] = ["grove", "consulting", "recruiting", "general"]
    let claudeCodeCount = 0
    let haikuCount = 0

    for (const tier of allTiers) {
      const r = route(tier, "draft", BRIDGE_UP)
      if (r.backend === "claude_code") claudeCodeCount++
      else if (r.backend === "haiku") haikuCount++
    }

    // grove + consulting = 2 → claude_code
    // recruiting + general = 2 → haiku
    expect(claudeCodeCount).toBe(2)
    expect(haikuCount).toBe(2)
  })
})
