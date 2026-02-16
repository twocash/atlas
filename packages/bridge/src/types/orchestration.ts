/**
 * Orchestration types — context slots, triage routing, and
 * request/response envelopes for the cognitive orchestration layer.
 *
 * Phase 5: Bridge Phase 5 — Cognitive Orchestration Layer
 */

// ─── Complexity Tiers ──────────────────────────────────────

/**
 * Tier 0: Pattern cache hit — no API call needed.
 * Tier 1: Haiku handled — simple triage, quick response.
 * Tier 2: Sonnet needed — long content, multi-step, ambiguous.
 * Tier 3: Opus/Gemini — research, code gen, deep synthesis.
 */
export type ComplexityTier = 0 | 1 | 2 | 3

/** Map tier to routing destination */
export type TierRoute = "local" | "claude_code"

export const TIER_ROUTES: Record<ComplexityTier, TierRoute> = {
  0: "local",
  1: "local",
  2: "claude_code",
  3: "claude_code",
}

// ─── Context Slots ──────────────────────────────────────────

/**
 * A context slot represents one source of information injected into
 * the orchestration prompt. The interface is intentionally broad
 * to support future RAG/POV sources without rearchitecting.
 *
 * Slot 1: Intent — triage result + structured context (WIRED)
 * Slot 2: Domain RAG — semantic search over corpus (STUBBED)
 * Slot 3: POV Library — epistemic position documents (STUBBED)
 * Slot 4: Voice — prompt composition output (WIRED)
 * Slot 5: Browser — current page context from extension (WIRED)
 * Slot 6: Output — landing surface + format instructions (WIRED)
 */
export type SlotId = "intent" | "domain_rag" | "pov" | "voice" | "browser" | "output"

export interface ContextSlot {
  /** Which slot this represents */
  id: SlotId

  /** Human-readable source label (e.g. "triage-skill", "notion-rag") */
  source: string

  /** The assembled text content for this slot */
  content: string

  /** Estimated token count for budget enforcement */
  tokens: number

  /** Priority for trim ordering (higher = keep longer, lower = trim first) */
  priority: number

  /** Whether this slot was actually populated with real data */
  populated: boolean
}

/** Default token budgets per slot (configurable) */
export const SLOT_TOKEN_BUDGETS: Record<SlotId, number> = {
  intent: 500,
  domain_rag: 2000,
  pov: 1500,
  voice: 1000,
  browser: 1500,
  output: 500,
}

/** Trim priority ordering — higher number = trim last (keep) */
export const SLOT_PRIORITIES: Record<SlotId, number> = {
  output: 100,    // Always keep — tells Claude where to put the result
  intent: 90,     // Always keep — what the user wants
  voice: 70,      // Important — how to sound
  browser: 50,    // Helpful — page context
  pov: 30,        // Nice-to-have — epistemic stance
  domain_rag: 20, // Nice-to-have — corpus knowledge
}

/** Total token budget for all slots combined */
export const TOTAL_CONTEXT_BUDGET = 8000

// ─── Orchestration Request / Response ────────────────────────

export interface OrchestrationRequest {
  /** The original user message text */
  messageText: string

  /** Which surface sent this (chrome_extension, telegram, cli) */
  surface: string

  /** Session ID for multi-turn context */
  sessionId: string

  /** Connection ID of the sending client */
  sourceConnectionId: string

  /** Browser context from extension (if available) */
  browserContext?: BrowserContext

  /** Timestamp when the bridge received this message */
  timestamp: string
}

export interface BrowserContext {
  /** Current page URL */
  url?: string
  /** Page title */
  title?: string
  /** Selected text on page */
  selectedText?: string
  /** Active LinkedIn post/comment context */
  linkedInContext?: {
    postAuthor?: string
    postText?: string
    commentCount?: number
  }
}

export interface OrchestrationResult {
  /** How the message was handled */
  route: TierRoute

  /** The complexity tier assigned */
  tier: ComplexityTier

  /** If local: the response text to send back to the client */
  localResponse?: string

  /** If claude_code: the assembled instruction sent to Claude */
  claudeInstruction?: string

  /** Which context slots were populated */
  slotsUsed: SlotId[]

  /** Total tokens consumed by context */
  totalContextTokens: number

  /** Triage latency in ms */
  triageLatencyMs: number

  /** Landing surface for the response */
  landingSurface: LandingSurface
}

// ─── Landing Surfaces ────────────────────────────────────────

/**
 * Where Claude Code's output should be delivered.
 */
export type LandingSurface = "chat" | "notion_feed" | "notion_work_queue" | "notion_page"

export interface LandingSurfaceConfig {
  surface: LandingSurface
  /** Notion database ID (if applicable) */
  notionDatabaseId?: string
  /** Additional properties to set on the Notion page */
  notionProperties?: Record<string, unknown>
  /** Format hint for Claude Code (markdown, json, etc.) */
  formatHint?: string
}

// ─── Extended BridgeEnvelope Metadata ────────────────────────

/**
 * Cognitive metadata attached to a BridgeEnvelope after triage.
 * Extends the base envelope without modifying its type (composition).
 */
export interface CognitiveMetadata {
  /** Complexity tier from triage */
  complexityTier: ComplexityTier
  /** Primary intent from triage */
  intent: "command" | "capture" | "query" | "clarify" | "chat"
  /** Context slots that were populated */
  contextSlots: SlotId[]
  /** Triage source */
  triageSource: "pattern_cache" | "haiku" | "profiler"
  /** Processing route */
  route: TierRoute
}
