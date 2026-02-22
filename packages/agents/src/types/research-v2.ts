/**
 * Research Intelligence v2 — Type Definitions
 *
 * Structured context composition for research prompts.
 * ResearchConfigV2 extends ResearchConfig for backward compatibility.
 *
 * Sprint: ATLAS-RESEARCH-INTEL-001
 */

import type { ResearchConfig, ResearchDepth, ResearchVoice } from '../agents/research';
import type { Pillar } from '../types';

// ─── Evidence Requirements ──────────────────────────────

/**
 * Explicit evidence standards by research depth.
 * Shapes the "what counts" section of research prompts.
 */
export interface EvidenceRequirements {
  depth: ResearchDepth;
  /** Minimum hard facts / data points required */
  minHardFacts: number;
  /** Must the output engage counter-arguments? */
  requireCounterArguments: boolean;
  /** Must findings cite primary / original sources? */
  requirePrimarySources: boolean;
  /** Must findings include quantitative data (numbers, not just claims)? */
  requireQuantitative: boolean;
  /** Max filler citations allowed (0 = Grove-grade, no academic padding) */
  maxAcademicPadding: number;
}

/**
 * Evidence requirement presets per depth level.
 *
 * | Depth    | Hard Facts | Counter-Args | Primary Sources | Quantitative | Padding |
 * |----------|-----------|--------------|-----------------|-------------|---------|
 * | light    | 0         | No           | No              | No          | ∞       |
 * | standard | 3-5       | Optional     | Preferred       | Preferred   | ≤5      |
 * | deep     | 5+        | Required     | Required        | Required    | 0       |
 */
export const EVIDENCE_PRESETS: Record<ResearchDepth, EvidenceRequirements> = {
  light: {
    depth: 'light',
    minHardFacts: 0,
    requireCounterArguments: false,
    requirePrimarySources: false,
    requireQuantitative: false,
    maxAcademicPadding: 999, // unlimited
  },
  standard: {
    depth: 'standard',
    minHardFacts: 4,
    requireCounterArguments: false, // optional
    requirePrimarySources: true,    // preferred
    requireQuantitative: true,      // preferred
    maxAcademicPadding: 5,
  },
  deep: {
    depth: 'deep',
    minHardFacts: 5,
    requireCounterArguments: true,
    requirePrimarySources: true,
    requireQuantitative: true,
    maxAcademicPadding: 0, // Grove-grade: zero filler
  },
};

// ─── POV Context ────────────────────────────────────────

/**
 * Structured fields from a POV Library entry.
 * Mirrors PovContent from packages/bridge/src/context/pov-fetcher.ts.
 */
export interface POVContext {
  /** POV entry title (e.g., "AI Infrastructure Concentration") */
  title: string;
  /** Core thesis statement — frames research findings */
  coreThesis: string;
  /** Evidence standards — what counts as evidence for this POV */
  evidenceStandards: string;
  /** Counter-arguments already addressed by this POV */
  counterArguments: string;
  /** Rhetorical patterns to employ */
  rhetoricalPatterns: string;
  /** Boundary conditions — where this thesis does NOT apply */
  boundaryConditions: string;
  /** Domain coverage tags from Notion */
  domainCoverage: string[];
}

// ─── Parsed Routing Signals ─────────────────────────────

/**
 * Routing signals parsed from a Socratic answer.
 * Extends what mapAnswerToRouting() produces today with
 * thesis_hook, intent, and focus_hints.
 */
export interface ParsedRouting {
  /** Pillar for routing (e.g., "The Grove") */
  pillar: Pillar;
  /** Research depth inferred from language signals */
  depth: ResearchDepth;
  /** Maps to POV Library entry (e.g., "epistemic_capture") */
  thesisHook?: string;
  /** What Jim wants to DO with the research */
  intent: ResearchIntent;
  /** Writing voice (if specified in answer) */
  voice?: ResearchVoice;
  /** Keywords extracted for focus narrowing */
  focusHints: string[];
  /** User's stated direction — goes to focus, never query */
  focusDirection?: string;
}

/** What the user wants to accomplish with the research */
export type ResearchIntent =
  | 'explore'     // Open-ended investigation
  | 'validate'    // Test a specific claim
  | 'challenge'   // Find counter-evidence
  | 'synthesize'  // Combine multiple sources into a position
  | 'compare';    // Compare approaches/products/ideas

/** Source type for context metadata */
export type SourceType =
  | 'threads' | 'twitter' | 'linkedin' | 'github'
  | 'youtube' | 'article' | 'notion' | 'command' | 'generic';

/** Quality floor for source filtering */
export type QualityFloor = 'any' | 'primary_sources' | 'grove_grade';

// ─── ResearchConfigV2 ──────────────────────────────────

/**
 * Extended research configuration with structured context composition.
 *
 * Extends ResearchConfig for backward compatibility — old callers still work.
 * V2 fields are all optional; the prompt builder degrades gracefully when
 * any are missing.
 */
export interface ResearchConfigV2 extends ResearchConfig {
  /** Maps to POV Library entry via thesis-hook scoring */
  thesisHook?: string;

  /** Source content type for metadata */
  sourceType?: SourceType;

  /** What Jim wants to do with the research */
  intent?: ResearchIntent;

  /** Explicit evidence standards (from EVIDENCE_PRESETS or custom) */
  evidenceRequirements?: EvidenceRequirements;

  /** POV Library context — shapes analytical lens */
  povContext?: POVContext;

  /** Minimum source quality threshold */
  qualityFloor?: QualityFloor;

  /** User's natural language direction (informs focus, not query) */
  userDirection?: string;
}

/**
 * Type guard: does this config have V2 fields?
 */
export function isResearchConfigV2(config: ResearchConfig): config is ResearchConfigV2 {
  return 'evidenceRequirements' in config
    || 'povContext' in config
    || 'thesisHook' in config;
}
