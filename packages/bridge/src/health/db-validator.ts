/**
 * Database Access Validator — Startup-time Notion DB access checks.
 *
 * Validates that the Notion integration token can reach each database
 * the bridge depends on. Classifies results by criticality:
 *   - critical: startup-blocking (Feed 2.0, Work Queue 2.0, System Prompts)
 *   - enrichment: degrade gracefully (POV Library, Contacts, etc.)
 *
 * Ported from Telegram's healthCheckOrDie() pattern (ADR-008: fail fast, fail loud).
 */

import { Client } from '@notionhq/client';
import {
  NOTION_DB,
  NOTION_DB_META,
  type DbCriticality,
  type DbSurface,
} from '@atlas/shared/config';

// ─── Types ───────────────────────────────────────────────

export interface DbValidationResult {
  key: string;
  label: string;
  dbId: string;
  criticality: DbCriticality;
  surfaces: DbSurface[];
  accessible: boolean;
  error?: string;
  latencyMs: number;
}

export interface ValidationReport {
  results: DbValidationResult[];
  criticalFailures: DbValidationResult[];
  enrichmentFailures: DbValidationResult[];
  allCriticalPassed: boolean;
  totalChecked: number;
  totalPassed: number;
  checkedAt: string;
}

// ─── Validator ───────────────────────────────────────────

/**
 * Validate access to a single Notion database.
 *
 * Uses `databases.retrieve()` which requires only the integration
 * to have been shared with the database — no query needed.
 */
async function validateDatabase(
  notion: Client,
  key: string,
  dbId: string,
): Promise<DbValidationResult> {
  const meta = NOTION_DB_META[key as keyof typeof NOTION_DB_META];
  const start = Date.now();

  try {
    await notion.databases.retrieve({ database_id: dbId });
    return {
      key,
      label: meta?.label ?? key,
      dbId,
      criticality: meta?.criticality ?? 'enrichment',
      surfaces: meta?.surfaces ?? [],
      accessible: true,
      latencyMs: Date.now() - start,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      key,
      label: meta?.label ?? key,
      dbId,
      criticality: meta?.criticality ?? 'enrichment',
      surfaces: meta?.surfaces ?? [],
      accessible: false,
      error: message,
      latencyMs: Date.now() - start,
    };
  }
}

/**
 * Validate access to all Notion databases relevant to a surface.
 *
 * @param surface - Filter to databases used by this surface. Pass 'bridge'
 *   to check bridge-specific + shared databases.
 * @param notionToken - Explicit token override (for testing). Falls back to env.
 */
export async function validateDatabases(
  surface: DbSurface = 'bridge',
  notionToken?: string,
): Promise<ValidationReport> {
  const token = notionToken || process.env.NOTION_API_KEY || process.env.NOTION_TOKEN;
  if (!token) {
    // No token at all — everything fails
    const results: DbValidationResult[] = Object.entries(NOTION_DB).map(([key, dbId]) => {
      const meta = NOTION_DB_META[key as keyof typeof NOTION_DB_META];
      return {
        key,
        label: meta?.label ?? key,
        dbId,
        criticality: meta?.criticality ?? 'enrichment',
        surfaces: meta?.surfaces ?? [],
        accessible: false,
        error: 'NOTION_API_KEY not configured',
        latencyMs: 0,
      };
    });

    return buildReport(results);
  }

  const notion = new Client({ auth: token });

  // Filter to databases relevant to this surface (or 'shared')
  const relevantEntries = Object.entries(NOTION_DB).filter(([key]) => {
    const meta = NOTION_DB_META[key as keyof typeof NOTION_DB_META];
    if (!meta) return false;
    return meta.surfaces.includes(surface) || meta.surfaces.includes('shared');
  });

  // Validate all in parallel
  const results = await Promise.all(
    relevantEntries.map(([key, dbId]) => validateDatabase(notion, key, dbId)),
  );

  return buildReport(results);
}

function buildReport(results: DbValidationResult[]): ValidationReport {
  const criticalFailures = results.filter((r) => !r.accessible && r.criticality === 'critical');
  const enrichmentFailures = results.filter((r) => !r.accessible && r.criticality === 'enrichment');

  return {
    results,
    criticalFailures,
    enrichmentFailures,
    allCriticalPassed: criticalFailures.length === 0,
    totalChecked: results.length,
    totalPassed: results.filter((r) => r.accessible).length,
    checkedAt: new Date().toISOString(),
  };
}
