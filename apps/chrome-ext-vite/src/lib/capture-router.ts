/**
 * Capture Router — Gate 1.8
 *
 * Domain-based routing for the simplified capture flow.
 * Wraps the cognitive router (Gate 1.6) with capture-specific
 * domain → pillar classification.
 *
 * Decision matrix:
 * - Grove-aligned (github, arxiv, research)   → Auto-dispatch Grove
 * - Consulting-aligned (linkedin, business)    → Auto-dispatch Consulting
 * - Personal (amazon, shopping, social)        → Auto-dispatch Personal
 * - Home (homedepot, lowes, home improvement)  → Auto-dispatch Home/Garage
 * - Ambiguous (medium, substack, youtube)      → Socratic question
 * - Unknown                                    → Socratic with domain hint
 * - Error                                      → Quick Capture fallback
 */

import type { InteractionTier } from "~src/types/classification"
import type {
  CaptureContext,
  CaptureRouterResult,
  CapturePillar,
  DomainPattern,
} from "~src/types/capture"
import { resolveRouteWithBridgeStatus } from "./cognitive-router"

// ─── Domain Pattern Registry ────────────────────────────

const DOMAIN_PATTERNS: DomainPattern[] = [
  // Grove-aligned: AI, research, open source, developer tools
  {
    patterns: [
      "github.com", "gitlab.com", "arxiv.org", "huggingface.co",
      "papers.nips.cc", "openreview.net", "semanticscholar.org",
      "agentation.dev", "threads.com", "x.com", "twitter.com",
      "npmjs.com", "pypi.org", "crates.io", "docs.rs",
      "stackoverflow.com", "hackernews.com", "news.ycombinator.com",
    ],
    pillar: "the-grove",
    tier: "grove",
  },
  // Consulting-aligned: professional, business, enterprise
  {
    patterns: [
      "linkedin.com", "salesforce.com", "hubspot.com",
      "crunchbase.com", "pitchbook.com", "bloomberg.com",
      "ft.com", "wsj.com", "hbr.org", "mckinsey.com",
    ],
    pillar: "consulting",
    tier: "consulting",
  },
  // Personal: shopping, entertainment, lifestyle
  {
    patterns: [
      "amazon.com", "ebay.com", "etsy.com", "walmart.com",
      "target.com", "bestbuy.com", "newegg.com",
      "netflix.com", "spotify.com", "reddit.com",
      "instagram.com", "facebook.com", "tiktok.com",
    ],
    pillar: "personal",
    tier: "general",
  },
  // Home/Garage: home improvement, DIY, automotive
  {
    patterns: [
      "homedepot.com", "lowes.com", "menards.com",
      "acehardware.com", "harborfreight.com",
      "autozone.com", "rockauto.com", "summitracing.com",
    ],
    pillar: "home-garage",
    tier: "general",
  },
]

/** Domains that are ambiguous — could map to multiple pillars */
const AMBIGUOUS_DOMAINS = [
  "medium.com", "substack.com", "youtube.com",
  "notion.so", "docs.google.com", "drive.google.com",
  "wikipedia.org", "en.wikipedia.org",
]

// ─── Domain Classification ──────────────────────────────

interface ClassificationResult {
  pillar: CapturePillar
  tier: InteractionTier
  matched: boolean
  ambiguous: boolean
}

/**
 * Classify a domain into a pillar based on pattern matching.
 * Pure function, no side effects.
 */
export function classifyDomain(domain: string): ClassificationResult {
  // Check ambiguous domains first
  if (AMBIGUOUS_DOMAINS.some(d => domain === d || domain.endsWith(`.${d}`))) {
    return { pillar: "the-grove", tier: "general", matched: false, ambiguous: true }
  }

  // Check pattern registry
  for (const pattern of DOMAIN_PATTERNS) {
    for (const p of pattern.patterns) {
      if (domain === p || domain.endsWith(`.${p}`)) {
        return { pillar: pattern.pillar, tier: pattern.tier, matched: true, ambiguous: false }
      }
    }
  }

  // Unknown domain
  return { pillar: "personal", tier: "general", matched: false, ambiguous: false }
}

// ─── Capture Router ─────────────────────────────────────

/**
 * Route a capture request based on page context.
 * Wraps the cognitive router (Gate 1.6) with domain-based pillar classification.
 *
 * @param context - Extracted page context from capture-context-extractor
 * @returns Routing result with pillar, cognitive decision, and optional Socratic question
 */
export function routeCapture(context: CaptureContext): CaptureRouterResult {
  const classification = classifyDomain(context.domain)

  // Ambiguous domain → Socratic question
  if (classification.ambiguous) {
    const routingDecision = resolveRouteWithBridgeStatus(classification.tier, "draft")
    return {
      pillar: classification.pillar,
      classifiedBy: "socratic",
      routingDecision,
      socraticQuestion: `What pillar does this ${context.domain} content belong to?`,
      rationale: `Ambiguous domain ${context.domain} — asking user for pillar`,
    }
  }

  // Pattern match → auto-dispatch
  if (classification.matched) {
    const routingDecision = resolveRouteWithBridgeStatus(classification.tier, "draft")
    return {
      pillar: classification.pillar,
      classifiedBy: "pattern_match",
      routingDecision,
      rationale: `Domain ${context.domain} → ${classification.pillar} (pattern match)`,
    }
  }

  // Unknown domain → Socratic with domain hint
  const routingDecision = resolveRouteWithBridgeStatus("general", "draft")
  return {
    pillar: classification.pillar,
    classifiedBy: "socratic",
    routingDecision,
    socraticQuestion: `Unknown domain ${context.domain} — which pillar should this go to?`,
    rationale: `Unknown domain ${context.domain} — defaulting to personal with Socratic prompt`,
  }
}

/**
 * Quick capture fallback — skips domain classification.
 * Used when the user explicitly picks "Quick Capture" or an error occurs.
 */
export function routeQuickCapture(): CaptureRouterResult {
  const routingDecision = resolveRouteWithBridgeStatus("general", "draft")
  return {
    pillar: "personal",
    classifiedBy: "fallback",
    routingDecision,
    rationale: "Quick capture — personal pillar, no domain classification",
  }
}
