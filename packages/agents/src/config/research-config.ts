/**
 * Research Pipeline Config Resolver
 *
 * ATLAS-DRC-001a: Notion → cache → compiled defaults resolution chain.
 *
 * Resolution strategy (same pattern as PromptManager, Socratic Config):
 * 1. Check in-memory cache (5-min TTL)
 * 2. Fetch from Notion Research Pipeline Config database
 * 3. Fall back to compiled defaults (ADR-008: log degraded warning)
 *
 * ADR-001: Notion as source of truth.
 * ADR-005: Zero surface imports.
 * ADR-008: Fail fast, fail loud — degraded fallback logged, not silent.
 */

import { Client } from '@notionhq/client';
import {
  COMPILED_DEFAULTS,
  type ResearchPipelineConfig,
  type ResolvedConfig,
  type ConfigSource,
  type DepthProfile,
  type AndonThresholds,
  type SearchProviderConfig,
  type EvidencePresetAssignment,
} from './types';

// ==========================================
// Constants
// ==========================================

/** Cache TTL in milliseconds (5 minutes) */
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Notion database ID for Research Pipeline Config.
 * Set via RESEARCH_PIPELINE_CONFIG_DB env var in ROOT .env (C:\github\atlas\.env).
 * ADR-005: This is a packages/agents concern, not a surface concern.
 * Do NOT put this in apps/telegram/.env or any surface-specific env file.
 * When empty, compiled defaults are used (expected before DB creation).
 */
const getDatabaseId = (): string | undefined =>
  process.env.RESEARCH_PIPELINE_CONFIG_DB || undefined;

// ==========================================
// Lazy Notion Client
// ==========================================

let _notionClient: Client | null = null;

function getNotionClient(): Client | null {
  if (_notionClient) return _notionClient;
  const key = process.env.NOTION_API_KEY;
  if (!key) return null;
  _notionClient = new Client({ auth: key });
  return _notionClient;
}

// ==========================================
// Cache
// ==========================================

interface CacheEntry {
  resolved: ResolvedConfig;
  expiresAt: number;
}

let _cache: CacheEntry | null = null;

// ==========================================
// Notion Fetch
// ==========================================

/**
 * Fetch config from Notion Research Pipeline Config database.
 * Reads a single row (filter: name = 'default') and parses the JSON config.
 *
 * Database schema expected:
 * - Name (title): config profile name
 * - Config (rich_text): JSON blob matching ResearchPipelineConfig shape
 * - Active (checkbox): whether this config is active
 */
async function fetchFromNotion(): Promise<ResearchPipelineConfig | null> {
  const dbId = getDatabaseId();
  if (!dbId) return null;

  const notion = getNotionClient();
  if (!notion) return null;

  const response = await notion.databases.query({
    database_id: dbId,
    filter: {
      and: [
        {
          property: 'Active',
          checkbox: { equals: true },
        },
      ],
    },
    page_size: 1,
  });

  if (response.results.length === 0) return null;

  const page = response.results[0] as any;

  // Extract JSON from Config rich_text property
  const configProp = page.properties?.Config;
  if (!configProp || configProp.type !== 'rich_text') return null;

  const jsonText = configProp.rich_text
    ?.map((t: any) => t.plain_text)
    .join('');

  if (!jsonText) return null;

  const parsed = JSON.parse(jsonText);
  return validateAndMerge(parsed);
}

// ==========================================
// Validation + Merge
// ==========================================

/**
 * Validate parsed config and merge with compiled defaults.
 * Partial configs are valid — missing fields fall back to defaults.
 * This ensures forward compatibility when new fields are added.
 */
function validateAndMerge(parsed: any): ResearchPipelineConfig {
  const defaults = COMPILED_DEFAULTS;

  const mergeDepth = (key: 'light' | 'standard' | 'deep'): DepthProfile => ({
    ...defaults.depths[key],
    ...(parsed.depths?.[key] ?? {}),
  });

  const andon: AndonThresholds = {
    ...defaults.andonThresholds,
    ...(parsed.andonThresholds ?? {}),
  };

  const search: SearchProviderConfig = {
    chain: parsed.searchProviders?.chain ?? defaults.searchProviders.chain,
    gemini: {
      ...defaults.searchProviders.gemini,
      ...(parsed.searchProviders?.gemini ?? {}),
    },
    claude: parsed.searchProviders?.claude
      ? { ...defaults.searchProviders.claude, ...parsed.searchProviders.claude }
      : defaults.searchProviders.claude,
  };

  const evidence: EvidencePresetAssignment = {
    ...defaults.evidencePresets,
    ...(parsed.evidencePresets ?? {}),
  };

  return {
    name: parsed.name ?? defaults.name,
    depths: {
      light: mergeDepth('light'),
      standard: mergeDepth('standard'),
      deep: mergeDepth('deep'),
    },
    andonThresholds: andon,
    searchProviders: search,
    evidencePresets: evidence,
  };
}

// ==========================================
// Public API
// ==========================================

/**
 * Get the current research pipeline config.
 *
 * Resolution: cache → Notion → compiled defaults.
 * ADR-008: Fetch failure logs degraded warning + returns defaults.
 */
export async function getResearchPipelineConfig(): Promise<ResolvedConfig> {
  // 1. Check cache
  if (_cache && _cache.expiresAt > Date.now()) {
    return { ..._cache.resolved, configSource: 'cached' };
  }

  // 2. Try Notion
  try {
    const notionConfig = await fetchFromNotion();
    if (notionConfig) {
      const resolved: ResolvedConfig = {
        config: notionConfig,
        configSource: 'notion',
        resolvedAt: new Date().toISOString(),
      };

      _cache = {
        resolved,
        expiresAt: Date.now() + CACHE_TTL_MS,
      };

      console.log('[ResearchPipelineConfig] Resolved from Notion', {
        name: notionConfig.name,
        configSource: 'notion',
      });

      return resolved;
    }
  } catch (error) {
    // ADR-008: Fail loud — log degraded warning, don't silently swallow
    console.warn('[ResearchPipelineConfig] Notion fetch failed — using compiled defaults (DEGRADED)', {
      error: error instanceof Error ? error.message : String(error),
      databaseId: getDatabaseId(),
    });
  }

  // 3. Compiled defaults
  const resolved: ResolvedConfig = {
    config: COMPILED_DEFAULTS,
    configSource: 'compiled-default',
    resolvedAt: new Date().toISOString(),
  };

  _cache = {
    resolved,
    expiresAt: Date.now() + CACHE_TTL_MS,
  };

  return resolved;
}

/**
 * Get config synchronously from cache or compiled defaults.
 * Use when async is not available (e.g., constructor initialization).
 * Does NOT fetch from Notion.
 */
export function getResearchPipelineConfigSync(): ResolvedConfig {
  if (_cache && _cache.expiresAt > Date.now()) {
    return { ..._cache.resolved, configSource: 'cached' };
  }

  return {
    config: COMPILED_DEFAULTS,
    configSource: 'compiled-default',
    resolvedAt: new Date().toISOString(),
  };
}

/**
 * Invalidate the config cache. Next call to getResearchPipelineConfig()
 * will re-fetch from Notion.
 */
export function invalidateConfigCache(): void {
  _cache = null;
}

/**
 * Inject a config for testing. Bypasses Notion fetch.
 */
export function injectConfig(config: ResearchPipelineConfig): void {
  _cache = {
    resolved: {
      config,
      configSource: 'notion',
      resolvedAt: new Date().toISOString(),
    },
    expiresAt: Date.now() + CACHE_TTL_MS,
  };
}

/** Reset Notion client (for testing) */
export function resetNotionClient(): void {
  _notionClient = null;
}
