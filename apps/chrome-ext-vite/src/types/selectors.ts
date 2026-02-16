/**
 * Types for the self-healing DOM selector system.
 *
 * SelectorRegistry uses multi-layer strategies:
 *   Layer 1 — Semantic (ARIA roles, data-testid)
 *   Layer 2 — Structural (CSS/XPath by DOM position)
 *   Layer 3 — Heuristic (content pattern matching)
 *
 * When all layers fail, a RepairPacket captures diagnostic
 * data for rapid selector updates.
 */

// ─── Selector Layers ──────────────────────────────────────

export type SelectorType = "css" | "xpath" | "heuristic"

export interface SelectorLayer {
  type: SelectorType
  selector: string
  /** Human-readable description for diagnostics / repair packets */
  description: string
}

// ─── Selector Entries ─────────────────────────────────────

export interface SelectorEntry {
  /** Unique key: "comment-container", "commenter-name", etc. */
  name: string
  /** Ordered layers: semantic → structural → heuristic */
  layers: SelectorLayer[]
  /** ISO timestamp of last successful extraction using this entry */
  lastVerified?: string
  /** If true, this entry is used as a page-health canary */
  canary: boolean
}

// ─── Registry ─────────────────────────────────────────────

export type SelectorRegistry = Record<string, SelectorEntry>

// ─── Extraction Results ───────────────────────────────────

export interface SelectorMatch {
  /** Which layer succeeded */
  layer: SelectorLayer
  /** The matched DOM elements */
  elements: Element[]
}

export interface HealthCheckResult {
  /** The canary entry that was tested */
  entry: SelectorEntry
  /** Whether the canary found its expected element */
  passed: boolean
  /** Which layer matched (if any) */
  matchedLayer?: SelectorLayer
  /** ISO timestamp of the check */
  checkedAt: string
}

// ─── Diagnostics / Repair ─────────────────────────────────

export interface RepairPacket {
  /** Which selector entry failed */
  selectorName: string
  /** ISO timestamp of the failure */
  failedAt: string
  /** URL of the page where extraction failed */
  pageUrl: string
  /** outerHTML of the container where elements should be */
  containerHtml: string
  /** All visible class names found in the container */
  visibleClasses: string[]
  /** All data-* attributes found in the container */
  dataAttributes: string[]
  /** All ARIA roles/labels found in the container */
  ariaAttributes: string[]
  /** Human-readable description of what was expected */
  expectedDescription: string
}

// ─── Messaging Protocol (sidepanel ↔ content script) ──────

export interface ExtractCommentsMessage {
  type: "EXTRACT_COMMENTS"
  postUrl?: string
}

export interface CheckPostReadyMessage {
  type: "CHECK_POST_READY"
}

export interface ExtractionResultMessage {
  type: "EXTRACTION_RESULT"
  comments: import("./comments").LinkedInComment[]
  postUrl: string
  warnings: string[]
  extractedCount: number
  repairPackets?: RepairPacket[]
}

export interface PostReadyMessage {
  type: "POST_READY"
  ready: boolean
  postUrl: string
}

export interface ExtractionErrorMessage {
  type: "EXTRACTION_ERROR"
  error: string
  repairPacket?: RepairPacket
}

export type ExtractionMessage =
  | ExtractCommentsMessage
  | CheckPostReadyMessage
  | ExtractionResultMessage
  | PostReadyMessage
  | ExtractionErrorMessage
