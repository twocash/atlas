/**
 * AI Classification types for the 4-tier interaction model.
 *
 * Tiers represent the primary business relationship context
 * for a LinkedIn contact, driving system prompt selection
 * and engagement strategy.
 */

// ─── Interaction Tiers ──────────────────────────────────

export type InteractionTier = "grove" | "consulting" | "recruiting" | "general"

export const TIER_LABELS: Record<InteractionTier, string> = {
  grove: "Grove",
  consulting: "Consulting",
  recruiting: "Recruiting",
  general: "General",
}

export const TIER_DESCRIPTIONS: Record<InteractionTier, string> = {
  grove: "AI infrastructure thesis, distributed systems, open source community",
  consulting: "Professional services clients, enterprise partnerships, B2B",
  recruiting: "Talent pipeline, potential hires, team building",
  general: "Broad network, social engagement, no specific business context",
}

// ─── Classification Results ─────────────────────────────

export interface TierClassificationResult {
  /** The assigned interaction tier */
  tier: InteractionTier
  /** Confidence score 0-1 from the LLM */
  confidence: number
  /** Brief reasoning from the LLM */
  reasoning: string
  /** Classification method used */
  method: "ai" | "rule_based" | "cached" | "fallback"
  /** Model that performed the classification (if AI) */
  model?: string
  /** Timestamp of classification */
  classifiedAt: string
}

// ─── Batch Classification ───────────────────────────────

export interface ClassificationInput {
  /** Profile URL (cache key) */
  profileUrl: string
  /** Display name */
  name: string
  /** LinkedIn headline / occupation */
  headline: string
  /** The comment text (provides intent signal) */
  commentText?: string
  /** LinkedIn connection degree */
  degree?: string
}

export interface BatchClassificationRequest {
  contacts: ClassificationInput[]
}

export interface BatchClassificationResponse {
  results: Record<string, TierClassificationResult>
  /** Number classified by AI in this batch */
  aiClassified: number
  /** Number served from cache */
  cacheHits: number
  /** Number that fell back to rule-based */
  fallbacks: number
}

// ─── Provider Interface ─────────────────────────────────

export interface ClassificationProvider {
  /** Human-readable name */
  name: string
  /** Classify a batch of contacts in a single LLM call */
  classifyBatch(contacts: ClassificationInput[]): Promise<Record<string, TierClassificationResult>>
}

// ─── Cache Entry ────────────────────────────────────────

export interface ClassificationCacheEntry {
  result: TierClassificationResult
  /** ISO timestamp of when this was cached */
  cachedAt: string
  /** ISO timestamp of when this expires */
  expiresAt: string
}

// ─── Confidence Thresholds ──────────────────────────────

export const CONFIDENCE_THRESHOLDS = {
  /** Auto-assign: high confidence, no human review needed */
  AUTO_ASSIGN: 0.9,
  /** Flag for review: moderate confidence */
  FLAG_FOR_REVIEW: 0.7,
  /** Below this → fall back to rule-based */
  FALLBACK: 0.7,
} as const

// ─── Cache Configuration ────────────────────────────────

export const CACHE_CONFIG = {
  /** Cache TTL in milliseconds (7 days) */
  TTL_MS: 7 * 24 * 60 * 60 * 1000,
  /** Storage key for classification cache */
  STORAGE_KEY: "atlas_classification_cache",
  /** Maximum cache entries before pruning */
  MAX_ENTRIES: 500,
} as const
