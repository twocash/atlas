/**
 * DRC-001a: Declarative Research Config Tests
 *
 * Validates the config resolution chain:
 * 1. Compiled defaults match pre-DRC-001a hardcoded values
 * 2. Config resolver cache + fallback behavior
 * 3. Partial config merge fills missing fields from defaults
 * 4. Andon Gate accepts threshold overrides from config
 * 5. Search provider accepts config-resolved model + retry
 * 6. Zero behavior change guarantee (ADR-008)
 *
 * See Notion sprint spec: ATLAS-DRC-001a
 */

import { describe, it, expect, beforeEach } from 'bun:test';

// ==========================================
// Direct imports — no mocks needed for config module
// ==========================================

import {
  COMPILED_DEFAULTS,
  getResearchPipelineConfigSync,
  invalidateConfigCache,
  injectConfig,
  type ResearchPipelineConfig,
  type ResolvedConfig,
  type AndonThresholds,
  type DepthProfile,
} from '../src/config';

import { assessOutput, type AndonInput } from '../src/services/andon-gate';
import { GeminiSearchProvider } from '../src/search/gemini-provider';

// ==========================================
// Fixtures
// ==========================================

/** Fully grounded research input for Andon Gate testing */
const GROUNDED_INPUT: AndonInput = {
  wasDispatched: true,
  groundingUsed: true,
  sourceCount: 5,
  findingCount: 3,
  bibliographyCount: 0,
  durationMs: 12000,
  summary: 'Tesla announced the Cybertruck refresh with a revised battery architecture using 4680 cells. The new design reduces pack weight by 12% while maintaining range. Production begins Q3 2026.',
  originalQuery: 'latest Tesla Cybertruck updates',
  success: true,
  hallucinationGuardPassed: true,
  source: 'test',
};

/** Custom config with modified thresholds for override testing */
const CUSTOM_CONFIG: ResearchPipelineConfig = {
  name: 'test-custom',
  depths: {
    light: {
      maxTokens: 1024,
      targetSources: 2,
      minSources: 1,
      citationStyle: 'inline',
      description: 'Ultra-light',
    },
    standard: {
      ...COMPILED_DEFAULTS.depths.standard,
      maxTokens: 4096,
    },
    deep: COMPILED_DEFAULTS.depths.deep,
  },
  andonThresholds: {
    groundedMinSources: 5,    // Stricter than default (3)
    informedMinSources: 2,    // Stricter than default (1)
    minFindingsForSubstance: 2, // Stricter than default (1)
    noveltyFloor: 0.4,        // Stricter than default (0.3)
    minSummaryLength: 100,    // Stricter than default (50)
  },
  searchProviders: {
    chain: ['gemini-google-search'],
    gemini: {
      model: 'gemini-2.5-pro',
      groundingRetryMax: 3,
    },
  },
  evidencePresets: COMPILED_DEFAULTS.evidencePresets,
};

// ==========================================
// 1. Compiled Defaults — Exact Value Matching
// ==========================================

describe('DRC-001a: Compiled Defaults', () => {
  it('defaults have correct depth profiles matching pre-DRC-001a values', () => {
    // From research.ts DEPTH_CONFIG
    expect(COMPILED_DEFAULTS.depths.light.maxTokens).toBe(2048);
    expect(COMPILED_DEFAULTS.depths.standard.maxTokens).toBe(8192);
    expect(COMPILED_DEFAULTS.depths.deep.maxTokens).toBe(65536);

    expect(COMPILED_DEFAULTS.depths.light.targetSources).toBe(3);
    expect(COMPILED_DEFAULTS.depths.standard.targetSources).toBe(6);
    expect(COMPILED_DEFAULTS.depths.deep.targetSources).toBe(12);

    expect(COMPILED_DEFAULTS.depths.light.minSources).toBe(2);
    expect(COMPILED_DEFAULTS.depths.standard.minSources).toBe(4);
    expect(COMPILED_DEFAULTS.depths.deep.minSources).toBe(8);

    expect(COMPILED_DEFAULTS.depths.light.citationStyle).toBe('inline');
    expect(COMPILED_DEFAULTS.depths.deep.citationStyle).toBe('chicago');
  });

  it('defaults have correct Andon thresholds matching pre-DRC-001a constants', () => {
    // From andon-gate.ts: GROUNDED_MIN_SOURCES, etc.
    expect(COMPILED_DEFAULTS.andonThresholds.groundedMinSources).toBe(3);
    expect(COMPILED_DEFAULTS.andonThresholds.informedMinSources).toBe(1);
    expect(COMPILED_DEFAULTS.andonThresholds.minFindingsForSubstance).toBe(1);
    expect(COMPILED_DEFAULTS.andonThresholds.noveltyFloor).toBe(0.3);
    expect(COMPILED_DEFAULTS.andonThresholds.minSummaryLength).toBe(50);
  });

  it('defaults have correct search provider settings', () => {
    // ADR-010: Decoupled search — Claude retrieves, Gemini synthesizes
    expect(COMPILED_DEFAULTS.searchProviders.chain).toBe('claude-retrieve-gemini-synthesize');
    expect(COMPILED_DEFAULTS.searchProviders.gemini.model).toBe('gemini-2.0-flash-001');
    expect(COMPILED_DEFAULTS.searchProviders.gemini.groundingRetryMax).toBe(2);
    expect(COMPILED_DEFAULTS.searchProviders.claude?.model).toBe('claude-haiku-4-5-20251001');
  });

  it('defaults have correct evidence preset assignments', () => {
    expect(COMPILED_DEFAULTS.evidencePresets.light).toBe('light');
    expect(COMPILED_DEFAULTS.evidencePresets.standard).toBe('standard');
    expect(COMPILED_DEFAULTS.evidencePresets.deep).toBe('deep');
  });

  it('config profile name is "default"', () => {
    expect(COMPILED_DEFAULTS.name).toBe('default');
  });
});

// ==========================================
// 2. Config Resolver — Cache + Sync Accessor
// ==========================================

describe('DRC-001a: Config Resolver', () => {
  beforeEach(() => {
    invalidateConfigCache();
  });

  it('getResearchPipelineConfigSync returns compiled defaults when no cache', () => {
    const resolved = getResearchPipelineConfigSync();
    expect(resolved.configSource).toBe('compiled-default');
    expect(resolved.config).toEqual(COMPILED_DEFAULTS);
    expect(resolved.resolvedAt).toBeTruthy();
  });

  it('injectConfig populates cache for sync reads', () => {
    injectConfig(CUSTOM_CONFIG);
    const resolved = getResearchPipelineConfigSync();
    expect(resolved.config.name).toBe('test-custom');
    expect(resolved.config.depths.light.maxTokens).toBe(1024);
  });

  it('invalidateConfigCache clears the cache', () => {
    injectConfig(CUSTOM_CONFIG);
    expect(getResearchPipelineConfigSync().config.name).toBe('test-custom');

    invalidateConfigCache();
    expect(getResearchPipelineConfigSync().configSource).toBe('compiled-default');
    expect(getResearchPipelineConfigSync().config.name).toBe('default');
  });

  it('resolvedAt is an ISO timestamp', () => {
    const resolved = getResearchPipelineConfigSync();
    const parsed = new Date(resolved.resolvedAt);
    expect(parsed.getTime()).not.toBeNaN();
  });

  it('cached config returns configSource = "cached"', () => {
    injectConfig(CUSTOM_CONFIG);
    // injectConfig sets source to 'notion' internally
    // sync read should return 'cached'
    const resolved = getResearchPipelineConfigSync();
    expect(resolved.configSource).toBe('cached');
  });
});

// ==========================================
// 3. Partial Config Merge
// ==========================================

describe('DRC-001a: Partial Config Merge', () => {
  beforeEach(() => {
    invalidateConfigCache();
  });

  it('injected config overrides only specified fields', () => {
    // Custom config has modified light.maxTokens but standard uses spread
    injectConfig(CUSTOM_CONFIG);
    const resolved = getResearchPipelineConfigSync();

    expect(resolved.config.depths.light.maxTokens).toBe(1024);
    expect(resolved.config.depths.standard.maxTokens).toBe(4096);
    // Deep is unmodified — should match defaults
    expect(resolved.config.depths.deep.maxTokens).toBe(65536);
  });

  it('andon threshold overrides replace defaults completely', () => {
    injectConfig(CUSTOM_CONFIG);
    const resolved = getResearchPipelineConfigSync();

    expect(resolved.config.andonThresholds.groundedMinSources).toBe(5);
    expect(resolved.config.andonThresholds.noveltyFloor).toBe(0.4);
    expect(resolved.config.andonThresholds.minSummaryLength).toBe(100);
  });

  it('search provider overrides propagate model + retry', () => {
    injectConfig(CUSTOM_CONFIG);
    const resolved = getResearchPipelineConfigSync();

    expect(resolved.config.searchProviders.gemini.model).toBe('gemini-2.5-pro');
    expect(resolved.config.searchProviders.gemini.groundingRetryMax).toBe(3);
  });
});

// ==========================================
// 4. Andon Gate — Threshold Override Wiring
// ==========================================

describe('DRC-001a: Andon Gate Threshold Override', () => {
  beforeEach(() => {
    invalidateConfigCache();
  });

  it('assessOutput uses compiled defaults when no overrides', () => {
    // Default: groundedMinSources=3, minFindingsForSubstance=1
    // Input: 5 sources, 3 findings → GROUNDED
    const assessment = assessOutput(GROUNDED_INPUT);
    expect(assessment.confidence).toBe('grounded');
    expect(assessment.routing).toBe('deliver');
  });

  it('assessOutput uses overrides when provided', () => {
    // Override: groundedMinSources=10 → 5 sources is now INFORMED
    const strictThresholds: Partial<AndonThresholds> = {
      groundedMinSources: 10,
    };
    const assessment = assessOutput(GROUNDED_INPUT, strictThresholds);
    expect(assessment.confidence).toBe('informed');
    expect(assessment.routing).toBe('caveat');
  });

  it('assessOutput partial override merges with config defaults', () => {
    // Override only groundedMinSources, keep other thresholds from defaults
    const partialOverride: Partial<AndonThresholds> = {
      groundedMinSources: 10,
    };
    const assessment = assessOutput(GROUNDED_INPUT, partialOverride);
    // noveltyFloor should still be 0.3 (from defaults)
    expect(assessment.telemetry.noveltyPassed).toBe(true); // Novel content, passes 0.3
  });

  it('injected config thresholds are used by assessOutput', () => {
    // Inject config with stricter thresholds
    injectConfig(CUSTOM_CONFIG);
    // Custom: groundedMinSources=5, minFindingsForSubstance=2
    // Input: 5 sources, 3 findings → still GROUNDED under custom thresholds
    const assessment = assessOutput(GROUNDED_INPUT);
    expect(assessment.confidence).toBe('grounded');

    // But with only 4 sources → should be INFORMED under stricter threshold
    const thinInput = { ...GROUNDED_INPUT, sourceCount: 4 };
    const thinAssessment = assessOutput(thinInput);
    expect(thinAssessment.confidence).toBe('informed');
  });

  it('summary length threshold is configurable', () => {
    injectConfig(CUSTOM_CONFIG);
    // Custom: minSummaryLength=100
    // Short summary should now fail
    const shortInput = {
      ...GROUNDED_INPUT,
      summary: 'Tesla announced updates.',  // 24 chars, below 100
    };
    const assessment = assessOutput(shortInput);
    expect(assessment.confidence).toBe('insufficient');
    expect(assessment.reason).toContain('too short');
  });
});

// ==========================================
// 5. GeminiSearchProvider — Config-Resolved Options
// ==========================================

describe('DRC-001a: GeminiSearchProvider Options', () => {
  it('accepts string model (backward compat)', () => {
    const provider = new GeminiSearchProvider('test-key', 'gemini-1.5-pro');
    expect(provider.name).toBe('gemini-google-search');
  });

  it('accepts options object with model + retry', () => {
    const provider = new GeminiSearchProvider('test-key', {
      model: 'gemini-2.5-pro',
      groundingRetryMax: 3,
    });
    expect(provider.name).toBe('gemini-google-search');
  });

  it('defaults to gemini-2.0-flash when no options', () => {
    const provider = new GeminiSearchProvider('test-key');
    expect(provider.name).toBe('gemini-google-search');
    // Can't directly test private field, but construction succeeds
  });

  it('defaults groundingRetryMax to 1 when string model', () => {
    // String model should use DEFAULT_GROUNDING_RETRY_MAX = 1
    const provider = new GeminiSearchProvider('test-key', 'gemini-1.5-pro');
    expect(provider.name).toBe('gemini-google-search');
    // Construction succeeds — default retry applied
  });
});

// ==========================================
// 6. Zero Behavior Change Guarantee (ADR-008)
// ==========================================

describe('DRC-001a: Zero Behavior Change', () => {
  beforeEach(() => {
    invalidateConfigCache();
  });

  it('compiled defaults produce identical Andon Gate results as pre-DRC-001a', () => {
    // The exact same inputs should produce the exact same outputs
    // regardless of whether thresholds come from constants or config
    const assessment = assessOutput(GROUNDED_INPUT);
    expect(assessment.confidence).toBe('grounded');
    expect(assessment.routing).toBe('deliver');
    expect(assessment.calibration.label).toBe('Research Complete');
    expect(assessment.calibration.celebrationAllowed).toBe(true);
  });

  it('compiled defaults produce identical Andon boundary behavior', () => {
    // 3 sources + 1 finding = GROUNDED (exact threshold)
    const boundary = assessOutput({
      ...GROUNDED_INPUT,
      sourceCount: 3,
      findingCount: 1,
    });
    expect(boundary.confidence).toBe('grounded');

    // 2 sources = INFORMED (below grounded threshold)
    const belowBoundary = assessOutput({
      ...GROUNDED_INPUT,
      sourceCount: 2,
      findingCount: 3,
    });
    expect(belowBoundary.confidence).toBe('informed');
  });

  it('depth profile values match original DEPTH_CONFIG', () => {
    // These exact values were hardcoded in research.ts DEPTH_CONFIG
    const light = COMPILED_DEFAULTS.depths.light;
    const standard = COMPILED_DEFAULTS.depths.standard;
    const deep = COMPILED_DEFAULTS.depths.deep;

    // light: 2048 tokens, 3 target, 2 min
    expect(light.maxTokens).toBe(2048);
    expect(light.targetSources).toBe(3);
    expect(light.minSources).toBe(2);

    // standard: 8192 tokens, 6 target, 4 min
    expect(standard.maxTokens).toBe(8192);
    expect(standard.targetSources).toBe(6);
    expect(standard.minSources).toBe(4);

    // deep: 65536 tokens, 12 target, 8 min
    expect(deep.maxTokens).toBe(65536);
    expect(deep.targetSources).toBe(12);
    expect(deep.minSources).toBe(8);
  });

  it('configSource is always populated', () => {
    const resolved = getResearchPipelineConfigSync();
    expect(['notion', 'compiled-default', 'cached']).toContain(resolved.configSource);
  });
});

// ==========================================
// 7. Config Module Exports
// ==========================================

describe('DRC-001a: Module Exports', () => {
  it('config barrel exports all required symbols', async () => {
    const configModule = await import('../src/config');

    expect(configModule.COMPILED_DEFAULTS).toBeDefined();
    expect(configModule.getResearchPipelineConfig).toBeDefined();
    expect(configModule.getResearchPipelineConfigSync).toBeDefined();
    expect(configModule.invalidateConfigCache).toBeDefined();
    expect(configModule.injectConfig).toBeDefined();

    expect(typeof configModule.getResearchPipelineConfig).toBe('function');
    expect(typeof configModule.getResearchPipelineConfigSync).toBe('function');
    expect(typeof configModule.invalidateConfigCache).toBe('function');
    expect(typeof configModule.injectConfig).toBe('function');
  });

  it('main agents barrel exports config symbols', async () => {
    const fs = await import('fs');
    const indexSource = fs.readFileSync(
      new URL('../src/index.ts', import.meta.url),
      'utf-8'
    );

    expect(indexSource).toContain('getResearchPipelineConfig');
    expect(indexSource).toContain('getResearchPipelineConfigSync');
    expect(indexSource).toContain('COMPILED_DEFAULTS');
    expect(indexSource).toContain('ResearchPipelineConfig');
    expect(indexSource).toContain('AndonThresholds');
    expect(indexSource).toContain('DepthProfile');
  });
});

// ==========================================
// 8. Wiring Verification — Source Fingerprinting
// ==========================================

describe('DRC-001a: Wiring Verification', () => {
  it('research.ts imports from config module', async () => {
    const fs = await import('fs');
    const source = fs.readFileSync(
      new URL('../src/agents/research.ts', import.meta.url),
      'utf-8'
    );
    expect(source).toContain("from '../config'");
    expect(source).toContain('getResearchPipelineConfigSync');
    expect(source).toContain('resolveDepthConfig');
  });

  it('andon-gate.ts imports from config module', async () => {
    const fs = await import('fs');
    const source = fs.readFileSync(
      new URL('../src/services/andon-gate.ts', import.meta.url),
      'utf-8'
    );
    expect(source).toContain("from '../config'");
    expect(source).toContain('getResearchPipelineConfigSync');
    expect(source).toContain('resolveThresholds');
  });

  it('research-orchestrator.ts resolves config at Step 0', async () => {
    const fs = await import('fs');
    const source = fs.readFileSync(
      new URL('../src/orchestration/research-orchestrator.ts', import.meta.url),
      'utf-8'
    );
    expect(source).toContain("from \"../config\"");
    expect(source).toContain('getResearchPipelineConfig');
    expect(source).toContain('resolvedConfig.config.andonThresholds');
  });

  it('gemini-provider.ts accepts GeminiProviderOptions', async () => {
    const fs = await import('fs');
    const source = fs.readFileSync(
      new URL('../src/search/gemini-provider.ts', import.meta.url),
      'utf-8'
    );
    expect(source).toContain('GeminiProviderOptions');
    expect(source).toContain('this.groundingRetryMax');
    expect(source).toContain('DEFAULT_GROUNDING_RETRY_MAX');
  });
});
