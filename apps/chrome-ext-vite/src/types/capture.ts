/**
 * Capture Types — Gate 1.8
 *
 * Defines the simplified capture model:
 * Single "Capture with Atlas" → context extraction → domain-based routing.
 *
 * Replaces the 4-level hierarchical menu (Root → Pillar → Action → Voice)
 * with automatic pillar classification based on URL domain patterns.
 */

import type { InteractionTier } from "./classification"
import type { RoutingDecision } from "./routing"

// ─── Capture Pillars ────────────────────────────────────

/** Content pillars for capture routing (matches existing Pillar type) */
export type CapturePillar = "the-grove" | "consulting" | "personal" | "home-garage"

export const PILLAR_LABELS: Record<CapturePillar, string> = {
  "the-grove": "The Grove",
  consulting: "Consulting",
  personal: "Personal",
  "home-garage": "Home/Garage",
}

// ─── Domain Classification ──────────────────────────────

/** How a domain was classified into a pillar */
export type DomainClassification = "pattern_match" | "socratic" | "fallback"

/** Domain patterns → pillar mapping for auto-classification */
export interface DomainPattern {
  /** Regex or substring patterns to match against domain */
  patterns: string[]
  /** The pillar this domain maps to */
  pillar: CapturePillar
  /** The interaction tier this domain maps to (for cognitive router) */
  tier: InteractionTier
}

// ─── Capture Context ────────────────────────────────────

/** Page context extracted from the active tab + content script */
export interface CaptureContext {
  /** Full URL of the captured page */
  url: string
  /** Extracted domain (e.g., "github.com") */
  domain: string
  /** Page title from document.title */
  title: string
  /** User-selected text, if any */
  selectedText?: string
  /** Meta description from <meta name="description"> */
  metaDescription?: string
  /** Open Graph title from <meta property="og:title"> */
  ogTitle?: string
  /** Canonical URL from <link rel="canonical"> */
  canonicalUrl?: string
}

// ─── Capture Router Result ──────────────────────────────

/** Result from the capture-specific router */
export interface CaptureRouterResult {
  /** Resolved pillar from domain classification */
  pillar: CapturePillar
  /** How the pillar was determined */
  classifiedBy: DomainClassification
  /** Cognitive routing decision (wraps Gate 1.6 router) */
  routingDecision: RoutingDecision
  /** Socratic question to ask if domain is ambiguous */
  socraticQuestion?: string
  /** Human-readable rationale for the routing */
  rationale: string
}

// ─── Capture Dispatch ───────────────────────────────────

/** Payload sent to background for capture processing */
export interface CaptureDispatchPayload {
  /** Extracted page context */
  context: CaptureContext
  /** Routing result from capture router */
  routing: CaptureRouterResult
}
