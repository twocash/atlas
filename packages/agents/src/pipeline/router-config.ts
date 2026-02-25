/**
 * RouterConfigCache — Hot-Cached Router Configuration from Notion
 *
 * The router NEVER hits the Notion API in the hot path.
 * Config is loaded at startup and refreshed via background polling.
 *
 * Preserves ADR-001 (Notion as truth) without violating
 * ADR-008 (fail fast) through latency-induced timeouts.
 *
 * Sprint: ARCH-CPE-001 Phase 6 — Unified Cognitive Architecture
 */

import { logger } from '../logger';
import type { CognitiveTier, ExecutionMode } from './system';

// ─── Router Config ───────────────────────────────────────

export interface ModelSelection {
  primary: string;
  fallback: string;
}

export interface RouterConfig {
  /** Tier → model mapping (from Notion, or compiled defaults) */
  tierModelMapping: Record<CognitiveTier, ModelSelection>;
  /** Tier → default execution mode */
  tierModeDefaults: Record<CognitiveTier, ExecutionMode>;
  /** Cognitive internal tier assignments */
  cognitiveInternalTiers: {
    triage: CognitiveTier;
    assessment: CognitiveTier;
    socratic: CognitiveTier;
    patternDetection: CognitiveTier;
  };
}

// ─── Compiled Defaults ───────────────────────────────────
// Fallback config when Notion is unreachable.
// These ship with the code and don't change at runtime.

export const COMPILED_DEFAULTS: RouterConfig = {
  tierModelMapping: {
    0: { primary: 'deterministic', fallback: 'deterministic' },
    1: { primary: 'claude-haiku-4-5-20251001', fallback: 'claude-haiku-4-5-20251001' },
    2: { primary: 'claude-sonnet-4-20250514', fallback: 'claude-haiku-4-5-20251001' },
    3: { primary: 'claude-sonnet-4-20250514', fallback: 'claude-sonnet-4-20250514' },
  },
  tierModeDefaults: {
    0: 'deterministic',
    1: 'conversational',
    2: 'conversational',
    3: 'agentic',
  },
  cognitiveInternalTiers: {
    triage: 1,
    assessment: 1,
    socratic: 1,
    patternDetection: 0,
  },
};

// ─── Config Cache ────────────────────────────────────────

export interface RouterConfigCache {
  /** Current config — always available (falls back to compiled defaults) */
  readonly config: RouterConfig;
  /** When config was last successfully refreshed */
  readonly lastRefreshed: Date;
  /** Whether config came from Notion or compiled defaults */
  readonly source: 'notion' | 'compiled-defaults';
  /** Start background polling for config updates */
  startPolling(intervalMs: number): void;
  /** Stop background polling */
  stopPolling(): void;
  /** Force a refresh (for testing or hot-reload) */
  forceRefresh(): Promise<void>;
}

// ─── Implementation ──────────────────────────────────────

export class RouterConfigCacheImpl implements RouterConfigCache {
  private _config: RouterConfig;
  private _lastRefreshed: Date;
  private _source: 'notion' | 'compiled-defaults';
  private _pollInterval: ReturnType<typeof setInterval> | null = null;
  private _staleAlertSent = false;

  /** Threshold after which a Feed 2.0 alert is emitted */
  private static readonly STALE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

  constructor() {
    this._config = { ...COMPILED_DEFAULTS };
    this._lastRefreshed = new Date();
    this._source = 'compiled-defaults';
    logger.info('Router config cache initialized with compiled defaults');
  }

  get config(): RouterConfig {
    return this._config;
  }

  get lastRefreshed(): Date {
    return this._lastRefreshed;
  }

  get source(): 'notion' | 'compiled-defaults' {
    return this._source;
  }

  startPolling(intervalMs: number = 60_000): void {
    if (this._pollInterval) {
      logger.warn('Router config polling already active');
      return;
    }

    // Initial load
    void this.refreshFromNotion();

    this._pollInterval = setInterval(() => {
      void this.refreshFromNotion();
      this.checkStaleness();
    }, intervalMs);

    logger.info('Router config polling started', { intervalMs });
  }

  stopPolling(): void {
    if (this._pollInterval) {
      clearInterval(this._pollInterval);
      this._pollInterval = null;
      logger.info('Router config polling stopped');
    }
  }

  async forceRefresh(): Promise<void> {
    await this.refreshFromNotion();
  }

  // ─── Internal ──────────────────────────────────────

  private async refreshFromNotion(): Promise<void> {
    try {
      // TODO: Step 9 — Wire to actual Notion page/database
      // For now, retain compiled defaults and log the attempt
      // const notionConfig = await fetchRouterConfigFromNotion();
      // this._config = notionConfig;
      // this._source = 'notion';
      // this._lastRefreshed = new Date();
      // this._staleAlertSent = false;
      // logger.info('Router config refreshed from Notion');

      // Placeholder: compiled defaults always used until Step 9
      this._lastRefreshed = new Date();
      logger.debug('Router config refresh (Notion not wired yet, using compiled defaults)');
    } catch (error) {
      // Keep last good config (ADR-008: don't silently degrade)
      logger.warn('Router config refresh failed, keeping last good config', {
        error: error instanceof Error ? error.message : String(error),
        lastRefreshed: this._lastRefreshed.toISOString(),
        source: this._source,
      });
    }
  }

  private checkStaleness(): void {
    const staleDuration = Date.now() - this._lastRefreshed.getTime();
    if (staleDuration > RouterConfigCacheImpl.STALE_THRESHOLD_MS && !this._staleAlertSent) {
      this._staleAlertSent = true;
      logger.error('Router config is STALE — Notion unreachable for >10min', {
        lastRefreshed: this._lastRefreshed.toISOString(),
        staleDurationMs: staleDuration,
      });
      // TODO: Step 9 — Emit Feed 2.0 alert
    }
  }
}

/** Singleton instance */
let _instance: RouterConfigCacheImpl | null = null;

export function getRouterConfigCache(): RouterConfigCache {
  if (!_instance) {
    _instance = new RouterConfigCacheImpl();
  }
  return _instance;
}
