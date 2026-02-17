/**
 * Context Enrichment Types — Gate 1.7
 *
 * Defines the enrichment model for Claude Code dispatch:
 * contact page body + engagement records → ContentBlock[] for Bridge.
 *
 * Only used when cognitive router picks `claude_code` backend.
 */

import type { ContentBlock } from "./claude-sdk"
import type { ComposedPrompt } from "../lib/reply-prompts"
import type { RoutingDecision } from "./routing"

// ─── Context Sources ─────────────────────────────────────

/** Where an enrichment context piece came from */
export type ContextSource = "contact_page_body" | "engagement_records" | "composed_prompt"

// ─── Context Budget ──────────────────────────────────────

/** Character budget for enrichment context */
export interface ContextBudget {
  /** Max chars for contact page body (Notion blocks → text) */
  contactBodyMax: number
  /** Max chars for engagement records (200 chars × 5 records) */
  engagementMax: number
  /** Max total enrichment chars (contactBody + engagements) */
  totalMax: number
}

export const DEFAULT_CONTEXT_BUDGET: ContextBudget = {
  contactBodyMax: 2000,
  engagementMax: 1000,
  totalMax: 3000,
}

// ─── Enriched Context ────────────────────────────────────

/** Result of context enrichment for a Claude Code dispatch */
export interface EnrichedContext {
  /** Plain text from contact's Notion page body (truncated to budget) */
  contactBody: string
  /** Formatted engagement records (truncated to budget) */
  engagements: string
  /** Assembled ContentBlock[] ready for Bridge dispatch */
  contextBlocks: ContentBlock[]
  /** Whether a Notion contact was found */
  contactFound: boolean
  /** Total chars of enrichment context */
  totalChars: number
  /** Time taken for enrichment fetch (ms) */
  fetchTimeMs: number
}

// ─── Claude Code Dispatch Request ────────────────────────

/** Message payload for CLAUDE_CODE_DISPATCH background handler */
export interface ClaudeCodeDispatchRequest {
  /** Enriched context from Notion (contact + engagements) */
  enrichedContext: EnrichedContext
  /** Composed prompt from strategy pipeline */
  composedPrompt: ComposedPrompt
  /** Routing decision from cognitive router */
  routingDecision: RoutingDecision
}
