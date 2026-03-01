/**
 * Research Pipeline Config — Type Definitions + Compiled Defaults
 *
 * ATLAS-DRC-001a: Externalizes hardcoded research infrastructure parameters
 * into a Notion-backed config database with in-memory caching.
 *
 * ADR-001: Notion as source of truth for infrastructure parameters.
 * ADR-008: Compiled defaults = identical behavior to pre-DRC-001a hardcoded values.
 *
 * What this owns: HOW the research infrastructure behaves.
 * What this does NOT own: WHAT the research says (PromptManager territory).
 */

// ==========================================
// Depth Profile
// ==========================================

export interface DepthProfile {
  /** Maximum output tokens for Gemini generation */
  maxTokens: number;

  /** Target number of sources to find */
  targetSources: number;

  /** Minimum sources required for quality threshold */
  minSources: number;

  /** Citation format */
  citationStyle: 'inline' | 'chicago';

  /** Human-readable depth description */
  description: string;
}

// ==========================================
// Andon Gate Thresholds
// ==========================================

export interface AndonThresholds {
  /** Sources needed for 'grounded' classification */
  groundedMinSources: number;

  /** Sources needed for 'informed' classification */
  informedMinSources: number;

  /** Findings needed to pass substance check */
  minFindingsForSubstance: number;

  /** Below this novelty score = Mirror Anti-Pattern */
  noveltyFloor: number;

  /** Minimum summary length (chars) to not be 'empty' */
  minSummaryLength: number;
}

// ==========================================
// Search Provider Config
// ==========================================

export interface SearchProviderConfig {
  /** Ordered fallback chain — provider names */
  chain: string[];

  /** Gemini-specific settings */
  gemini: {
    /** Model name for search-grounded generation */
    model: string;

    /** Max retries on grounding failure */
    groundingRetryMax: number;
  };
}

// ==========================================
// Evidence Preset References
// ==========================================

export interface EvidencePresetAssignment {
  /** Evidence preset name for light depth */
  light: string;

  /** Evidence preset name for standard depth */
  standard: string;

  /** Evidence preset name for deep depth */
  deep: string;
}

// ==========================================
// Top-Level Config
// ==========================================

export type ConfigSource = 'notion' | 'compiled-default' | 'cached';

export interface ResearchPipelineConfig {
  /** Config profile name — 'default' on day one */
  name: string;

  /** Depth profiles */
  depths: {
    light: DepthProfile;
    standard: DepthProfile;
    deep: DepthProfile;
  };

  /** Andon Gate thresholds */
  andonThresholds: AndonThresholds;

  /** Search provider configuration */
  searchProviders: SearchProviderConfig;

  /** Evidence preset assignment per depth */
  evidencePresets: EvidencePresetAssignment;
}

export interface ResolvedConfig {
  /** The resolved config */
  config: ResearchPipelineConfig;

  /** Where this config came from */
  configSource: ConfigSource;

  /** When this was resolved (ISO string) */
  resolvedAt: string;
}

// ==========================================
// Compiled Defaults
// ==========================================

/**
 * Compiled defaults match the exact hardcoded values from pre-DRC-001a code.
 * These are the fallback when Notion is unreachable or no database exists.
 *
 * Source files for each value:
 * - depths: packages/agents/src/agents/research.ts DEPTH_CONFIG
 * - andonThresholds: packages/agents/src/services/andon-gate.ts constants
 * - searchProviders: packages/agents/src/search/gemini-provider.ts
 * - evidencePresets: packages/agents/src/types/research-v2.ts EVIDENCE_PRESETS
 */
export const COMPILED_DEFAULTS: ResearchPipelineConfig = {
  name: 'default',

  depths: {
    light: {
      maxTokens: 2048,
      targetSources: 3,
      minSources: 2,
      citationStyle: 'inline',
      description: 'Quick overview with key facts',
    },
    standard: {
      maxTokens: 8192,
      targetSources: 6,
      minSources: 4,
      citationStyle: 'inline',
      description: 'Thorough analysis with multiple perspectives',
    },
    deep: {
      maxTokens: 65536,
      targetSources: 12,
      minSources: 8,
      citationStyle: 'chicago',
      description: 'Academic-grade research with rigorous citations',
    },
  },

  andonThresholds: {
    groundedMinSources: 3,
    informedMinSources: 1,
    minFindingsForSubstance: 1,
    noveltyFloor: 0.3,
    minSummaryLength: 50,
  },

  searchProviders: {
    chain: ['gemini-google-search'],
    gemini: {
      model: 'gemini-2.0-flash',
      groundingRetryMax: 1,
    },
  },

  evidencePresets: {
    light: 'light',
    standard: 'standard',
    deep: 'deep',
  },
};
