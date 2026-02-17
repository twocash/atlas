/**
 * AI Classifier — batch classification of LinkedIn contacts into interaction tiers.
 *
 * Uses a single LLM call to classify multiple contacts, with:
 * - Cache-first lookup (7-day TTL)
 * - Confidence-based auto-assign vs. fallback
 * - Graceful degradation to rule-based classification
 *
 * The ClassificationProvider interface allows swapping LLM backends
 * (Anthropic today, AnythingLLM local in future).
 */

import type {
  InteractionTier,
  TierClassificationResult,
  ClassificationInput,
  ClassificationProvider,
  BatchClassificationResponse,
  CONFIDENCE_THRESHOLDS,
} from "~src/types/classification"
import {
  BATCH_CLASSIFICATION_SYSTEM,
  buildBatchClassificationPrompt,
} from "./classification-prompts"
import { getFromCache, setInCache } from "./classification-cache"
import { classifyContactByRules } from "./classification-rules"

// ─── Anthropic Provider ─────────────────────────────────

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages"
const CLASSIFICATION_MODEL = "claude-3-5-haiku-20241022" // Cheap: $0.25/$1.25 per MTok

export class AnthropicClassificationProvider implements ClassificationProvider {
  name = "Anthropic"

  constructor(private apiKey: string) {}

  async classifyBatch(
    contacts: ClassificationInput[],
  ): Promise<Record<string, TierClassificationResult>> {
    const prompt = buildBatchClassificationPrompt(
      contacts.map((c) => ({
        id: c.profileUrl,
        name: c.name,
        headline: c.headline,
        commentText: c.commentText,
        degree: c.degree,
      })),
    )

    const body = {
      model: CLASSIFICATION_MODEL,
      max_tokens: 2048,
      temperature: 0.1,  // Low temp for consistent classification
      system: BATCH_CLASSIFICATION_SYSTEM,
      messages: [{ role: "user", content: prompt }],
    }

    const response = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Classification API error ${response.status}: ${errorText.slice(0, 200)}`)
    }

    const data = await response.json()
    const textBlock = data.content?.find((c: { type: string }) => c.type === "text")
    const rawText = textBlock?.text || ""

    return parseClassificationResponse(rawText, data.model || CLASSIFICATION_MODEL)
  }
}

// ─── Response Parser ────────────────────────────────────

const VALID_TIERS = new Set<InteractionTier>(["grove", "consulting", "recruiting", "general"])

function parseClassificationResponse(
  rawText: string,
  model: string,
): Record<string, TierClassificationResult> {
  const results: Record<string, TierClassificationResult> = {}
  const now = new Date().toISOString()

  try {
    // Strip markdown fences if present
    const cleaned = rawText
      .replace(/^```json\s*/m, "")
      .replace(/```\s*$/m, "")
      .trim()

    const parsed = JSON.parse(cleaned)
    const classifications = parsed.classifications || parsed

    for (const [profileUrl, entry] of Object.entries(classifications)) {
      const e = entry as any
      const tier = (e.tier || "general").toLowerCase() as InteractionTier

      if (!VALID_TIERS.has(tier)) {
        console.warn(`[ai-classifier] Invalid tier "${e.tier}" for ${profileUrl}, defaulting to general`)
      }

      results[profileUrl] = {
        tier: VALID_TIERS.has(tier) ? tier : "general",
        confidence: Math.min(1, Math.max(0, Number(e.confidence) || 0.5)),
        reasoning: String(e.reasoning || "").slice(0, 200),
        method: "ai",
        model,
        classifiedAt: now,
      }
    }
  } catch (err) {
    console.error("[ai-classifier] Failed to parse classification response:", err)
    console.error("[ai-classifier] Raw text:", rawText.slice(0, 500))
    // Return empty — caller will fall back to rule-based
  }

  return results
}

// ─── Constants ───────────────────────────────────────────

/** Max contacts per AI batch call (keeps prompt size manageable) */
const MAX_BATCH_SIZE = 25

// ─── Batch Classifier (main entry point) ────────────────

/**
 * Classify a batch of contacts using cache + AI + rule-based fallback.
 *
 * Flow:
 * 1. Check cache for each contact
 * 2. Send uncached contacts to AI provider in batches of MAX_BATCH_SIZE
 * 3. For any AI failures or low-confidence results, fall back to rules
 * 4. Cache all results
 */
export async function classifyBatch(
  contacts: ClassificationInput[],
  provider: ClassificationProvider,
): Promise<BatchClassificationResponse> {
  const response: BatchClassificationResponse = {
    results: {},
    aiClassified: 0,
    cacheHits: 0,
    fallbacks: 0,
  }

  if (contacts.length === 0) return response

  // Step 1: Check cache
  const uncached: ClassificationInput[] = []

  for (const contact of contacts) {
    const cached = await getFromCache(contact.profileUrl)
    if (cached) {
      response.results[contact.profileUrl] = {
        ...cached,
        method: "cached",
      }
      response.cacheHits++
    } else {
      uncached.push(contact)
    }
  }

  if (uncached.length === 0) return response

  // Step 2: AI classification for uncached contacts (in batches)
  const batches: ClassificationInput[][] = []
  for (let i = 0; i < uncached.length; i += MAX_BATCH_SIZE) {
    batches.push(uncached.slice(i, i + MAX_BATCH_SIZE))
  }

  for (const batch of batches) {
    try {
      const aiResults = await provider.classifyBatch(batch)

      for (const contact of batch) {
        const aiResult = aiResults[contact.profileUrl]
        if (aiResult && aiResult.confidence >= 0.7) {
          // AI result with acceptable confidence
          response.results[contact.profileUrl] = aiResult
          response.aiClassified++
          await setInCache(contact.profileUrl, aiResult)
        } else if (aiResult) {
          // Low confidence — fall back to rule-based
          const ruleResult = classifyContactByRules(contact)
          response.results[contact.profileUrl] = ruleResult
          response.fallbacks++
          await setInCache(contact.profileUrl, ruleResult)
        } else {
          // AI didn't return a result for this contact
          const ruleResult = classifyContactByRules(contact)
          response.results[contact.profileUrl] = ruleResult
          response.fallbacks++
          await setInCache(contact.profileUrl, ruleResult)
        }
      }
    } catch (err) {
      // Batch failed — fall back to rules for remaining contacts in this batch
      console.error(`[ai-classifier] Batch classification failed (${batch.length} contacts):`, err)

      for (const contact of batch) {
        if (!response.results[contact.profileUrl]) {
          const ruleResult = classifyContactByRules(contact)
          response.results[contact.profileUrl] = ruleResult
          response.fallbacks++
          await setInCache(contact.profileUrl, ruleResult)
        }
      }
    }
  }

  return response
}
