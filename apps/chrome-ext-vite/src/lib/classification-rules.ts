/**
 * Rule-based classification fallback.
 *
 * Maps the existing keyword-based sector/alignment classification
 * from classification.ts into the 4-tier InteractionTier system.
 *
 * Used when:
 * - AI classification is unavailable (no API key, network error)
 * - AI confidence is below threshold
 * - Quick local classification without API call
 */

import type { InteractionTier, TierClassificationResult, ClassificationInput } from "~src/types/classification"
import { classifySector, classifyGroveAlignment } from "./classification"

/**
 * Classify a contact using rule-based keyword matching.
 * Maps existing sector + grove alignment into the 4-tier model.
 */
export function classifyContactByRules(contact: ClassificationInput): TierClassificationResult {
  const headline = contact.headline || ""
  const commentText = contact.commentText || ""

  const sector = classifySector(headline)
  const alignment = classifyGroveAlignment(headline, commentText, !!commentText, false)

  const tier = mapToTier(sector, alignment, headline, commentText)

  return {
    tier,
    confidence: 0.6, // Rule-based gets moderate confidence
    reasoning: `Rule-based: sector=${sector}, alignment=${alignment.split(" ")[0]}`,
    method: "rule_based",
    classifiedAt: new Date().toISOString(),
  }
}

/**
 * Map sector + alignment + signals to an InteractionTier.
 */
function mapToTier(
  sector: string,
  alignment: string,
  headline: string,
  commentText: string,
): InteractionTier {
  const hl = ` ${headline.toLowerCase()} `
  const ct = ` ${commentText.toLowerCase()} `
  const combined = hl + ct

  // Recruiting signals (check first — overrides sector)
  const recruitingKeywords = [
    "seeking", "looking for", "open to work", "job search",
    "available for", "actively looking", "career transition",
    "between roles", "open to opportunities",
  ]
  for (const kw of recruitingKeywords) {
    if (combined.includes(kw)) return "recruiting"
  }

  // Grove signals: strong alignment OR AI/ML specialist with alignment
  const isStrongAlignment = alignment.includes("Strong") || alignment.includes("Good")
  if (sector === "AI/ML Specialist" && isStrongAlignment) return "grove"
  if (alignment.includes("Strong")) return "grove"

  // Grove by sector: AI/ML with moderate+ alignment
  if (sector === "AI/ML Specialist" && alignment.includes("Moderate")) return "grove"

  // Consulting signals
  const consultingKeywords = [
    "enterprise", "saas", "b2b", "digital transformation",
    "client", "consulting", "advisory",
  ]
  if (sector === "Corporate" || sector === "Investor") {
    return "consulting"
  }
  for (const kw of consultingKeywords) {
    if (hl.includes(kw)) return "consulting"
  }

  // Tech sector with moderate alignment → grove
  if (sector === "Tech" && (isStrongAlignment || alignment.includes("Moderate"))) {
    return "grove"
  }

  // Academia with alignment → grove
  if (sector === "Academia" && (isStrongAlignment || alignment.includes("Moderate"))) {
    return "grove"
  }

  // Influencer → consulting (potential amplifier)
  if (sector === "Influencer") return "consulting"

  // Default
  return "general"
}
