/**
 * Context Assembler — populates the 6 context slots for orchestration.
 *
 * Slot 1: Intent — triage result + structured context     (WIRED)
 * Slot 2: Domain RAG — semantic search over corpus        (STUBBED)
 * Slot 3: POV — epistemic position documents              (STUBBED)
 * Slot 4: Voice — prompt composition output               (WIRED)
 * Slot 5: Browser — current page context from extension   (WIRED)
 * Slot 6: Output — landing surface + format instructions  (WIRED)
 */

import { triageMessage, type TriageResult } from "../../../../apps/telegram/src/cognitive/triage-skill"
import { composeFromStructuredContext } from "../../../../packages/agents/src/services/prompt-composition"
import type { StructuredCompositionInput } from "../../../../packages/agents/src/services/prompt-composition/types"
import type {
  OrchestrationRequest,
  BrowserContext,
  LandingSurface,
  ComplexityTier,
  SlotId,
} from "../types/orchestration"
import { TIER_ROUTES } from "../types/orchestration"
import type { ContextSlot } from "../types/orchestration"
import {
  createSlot,
  createEmptySlot,
  enforceTokenBudget,
  totalTokens,
  populatedSlotIds,
} from "./slots"

// ─── Assembly Result ──────────────────────────────────────

export interface AssemblyResult {
  /** All 6 context slots (populated or empty) */
  slots: ContextSlot[]

  /** The triage result from the intent slot */
  triage: TriageResult

  /** Complexity tier from triage */
  tier: ComplexityTier

  /** Where to route this message */
  route: "local" | "claude_code"

  /** Which slots were populated */
  slotsUsed: SlotId[]

  /** Total tokens consumed */
  totalContextTokens: number

  /** Triage latency in ms */
  triageLatencyMs: number

  /** Determined landing surface */
  landingSurface: LandingSurface

  /** Voice prompt text (if composed) */
  voicePrompt?: string
}

// ─── Intent Slot ──────────────────────────────────────────

function buildIntentContent(triage: TriageResult, messageText: string): string {
  const lines: string[] = [
    `Intent: ${triage.intent}`,
    `Complexity: Tier ${triage.complexityTier}`,
    `Pillar: ${triage.pillar}`,
    `Type: ${triage.requestType}`,
  ]

  if (triage.confidence < 1) {
    lines.push(`Confidence: ${(triage.confidence * 100).toFixed(0)}%`)
  }
  if (triage.keywords.length > 0) {
    lines.push(`Keywords: ${triage.keywords.join(", ")}`)
  }
  if (triage.title) {
    lines.push(`Title: ${triage.title}`)
  }
  if (triage.command) {
    lines.push(`Command: ${triage.command.name}`)
    if (triage.command.args) {
      lines.push(`Args: ${triage.command.args}`)
    }
  }
  if (triage.isCompound && triage.subIntents?.length) {
    lines.push(`Sub-intents: ${triage.subIntents.map((s) => s.intent).join(", ")}`)
  }

  lines.push("", `User message: ${messageText}`)
  return lines.join("\n")
}

async function assembleIntentSlot(
  messageText: string,
): Promise<{ slot: ContextSlot; triage: TriageResult; latencyMs: number }> {
  const start = Date.now()
  const triage = await triageMessage(messageText)
  const latencyMs = Date.now() - start

  const content = buildIntentContent(triage, messageText)
  const slot = createSlot({
    id: "intent",
    source: `triage-${triage.source}`,
    content,
  })

  return { slot, triage, latencyMs }
}

// ─── Voice Slot ───────────────────────────────────────────

async function assembleVoiceSlot(
  triage: TriageResult,
  messageText: string,
): Promise<ContextSlot> {
  try {
    const input: StructuredCompositionInput = {
      intent: mapTriageIntentToComposition(triage.intent),
      depth: mapComplexityToDepth(triage.complexityTier),
      audience: "personal",
      source_type: "text",
      format: "markdown",
      voice_hint: null,
      content: messageText,
      title: triage.title,
      pillar: triage.pillar,
    }

    const result = await composeFromStructuredContext(input)
    if (result.prompt) {
      return createSlot({
        id: "voice",
        source: "prompt-composition",
        content: result.prompt,
      })
    }
  } catch (err) {
    console.warn("[assembler] Voice slot composition failed:", (err as Error).message)
  }

  return createEmptySlot("voice", "prompt-composition")
}

/** Map triage intent → composition IntentType
 *
 * Triage intents:    command, capture, query, clarify
 * Composition types: research, draft, save, analyze, capture, engage
 */
function mapTriageIntentToComposition(intent: TriageResult["intent"]): string {
  const map: Record<string, string> = {
    command: "analyze",
    capture: "capture",
    query: "research",
    clarify: "research",
  }
  return map[intent] ?? "research"
}

/** Map complexity tier → depth level */
function mapComplexityToDepth(tier: ComplexityTier): string {
  if (tier <= 1) return "quick"
  if (tier === 2) return "standard"
  return "deep"
}

// ─── Browser Slot ─────────────────────────────────────────

function assembleBrowserSlot(browserContext?: BrowserContext): ContextSlot {
  if (!browserContext) {
    return createEmptySlot("browser", "extension")
  }

  const lines: string[] = []
  if (browserContext.url) lines.push(`URL: ${browserContext.url}`)
  if (browserContext.title) lines.push(`Page: ${browserContext.title}`)
  if (browserContext.selectedText) {
    lines.push(`Selected text: ${browserContext.selectedText}`)
  }
  if (browserContext.linkedInContext) {
    const li = browserContext.linkedInContext
    if (li.postAuthor) lines.push(`Post author: ${li.postAuthor}`)
    if (li.postText) lines.push(`Post: ${li.postText}`)
    if (li.commentCount != null) lines.push(`Comments: ${li.commentCount}`)
  }

  if (lines.length === 0) {
    return createEmptySlot("browser", "extension")
  }

  return createSlot({
    id: "browser",
    source: "extension",
    content: lines.join("\n"),
  })
}

// ─── Output Slot ──────────────────────────────────────────

function determineLandingSurface(
  triage: TriageResult,
  surface: string,
): LandingSurface {
  // Commands and chat intents → reply in chat
  if (triage.intent === "command" || triage.intent === "clarify") {
    return "chat"
  }

  // Capture intent → Feed 2.0
  if (triage.intent === "capture") {
    return "notion_feed"
  }

  // Query intent: Tier 0-1 stays local (chat), Tier 2-3 depends on complexity
  if (triage.complexityTier <= 1) {
    return "chat"
  }

  // Complex queries → chat (Claude Code will respond through the bridge)
  return "chat"
}

function assembleOutputSlot(landingSurface: LandingSurface): ContextSlot {
  const instructions: Record<LandingSurface, string> = {
    chat: "Respond directly in the chat. Use markdown formatting. Be concise but complete.",
    notion_feed:
      "Create a Feed 2.0 entry in Notion. Use the create_feed_entry tool. " +
      "Include: title, pillar, type, and full content body.",
    notion_work_queue:
      "Create a Work Queue 2.0 entry in Notion. Use the create_work_queue_entry tool. " +
      "Include: title, pillar, type, priority, and description.",
    notion_page:
      "Create or update a Notion page. Use the appropriate Notion tool. " +
      "Use rich markdown formatting with headers and sections.",
  }

  return createSlot({
    id: "output",
    source: "landing-surface",
    content: `Landing surface: ${landingSurface}\n\n${instructions[landingSurface]}`,
  })
}

// ─── Stubbed Slots ────────────────────────────────────────

function assembleDomainRagSlot(): ContextSlot {
  return createEmptySlot("domain_rag", "rag-stub")
}

function assemblePovSlot(): ContextSlot {
  return createEmptySlot("pov", "pov-stub")
}

// ─── Main Assembler ───────────────────────────────────────

/**
 * Assemble all 6 context slots from an orchestration request.
 *
 * Steps:
 * 1. Triage the message (intent slot)
 * 2. Compose voice (voice slot) — parallel with browser
 * 3. Wire browser context (browser slot)
 * 4. Determine landing surface (output slot)
 * 5. Stub domain_rag and pov slots
 * 6. Enforce total token budget
 */
export async function assembleContext(
  request: OrchestrationRequest,
): Promise<AssemblyResult> {
  // Step 1: Triage (must happen first — downstream slots depend on it)
  const { slot: intentSlot, triage, latencyMs } = await assembleIntentSlot(
    request.messageText,
  )

  const tier = triage.complexityTier as ComplexityTier
  const route = TIER_ROUTES[tier]

  // Step 2-5: Assemble remaining slots (voice can be parallel with browser/output)
  const [voiceSlot, browserSlot] = await Promise.all([
    assembleVoiceSlot(triage, request.messageText),
    Promise.resolve(assembleBrowserSlot(request.browserContext)),
  ])

  const landingSurface = determineLandingSurface(triage, request.surface)
  const outputSlot = assembleOutputSlot(landingSurface)
  const domainRagSlot = assembleDomainRagSlot()
  const povSlot = assemblePovSlot()

  // Step 6: Enforce budget
  const rawSlots: ContextSlot[] = [
    intentSlot,
    domainRagSlot,
    povSlot,
    voiceSlot,
    browserSlot,
    outputSlot,
  ]

  const slots = enforceTokenBudget(rawSlots)

  return {
    slots,
    triage,
    tier,
    route,
    slotsUsed: populatedSlotIds(slots),
    totalContextTokens: totalTokens(slots),
    triageLatencyMs: latencyMs,
    landingSurface,
    voicePrompt: voiceSlot.populated ? voiceSlot.content : undefined,
  }
}
