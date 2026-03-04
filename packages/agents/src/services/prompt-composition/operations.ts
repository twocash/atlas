/**
 * Operational Doctrine Composition Engine
 *
 * Resolves operational doctrine entries from Notion via PromptManager,
 * assembles them into a coherent block for system prompt injection.
 *
 * Tiered failure model (ADR-008):
 *   - Safety-critical (integrity, dispatch): HARD FAIL — throw, halt startup
 *   - Behavioral (tools, format, surface): GRACEFUL DEGRADATION — warn, continue
 *
 * Caching: PromptCache wraps the composed result (5-min TTL).
 * PromptManager has its own per-entry TTL cache internally.
 *
 * @module
 */

import { PromptManager } from '../prompt-manager';
import { promptCache } from './cache';

// ==========================================
// Types
// ==========================================

export interface OperationalDoctrineResult {
  /** The composed doctrine string for system prompt injection */
  content: string;
  /** Warnings from degraded (non-critical) entries */
  warnings: string[];
  /** Which entries resolved successfully */
  resolved: string[];
  /** Which entries were missing (non-critical only) */
  missing: string[];
}

// ==========================================
// Entry IDs — these match Notion System Prompts DB `ID` field
// ==========================================

/** Safety-critical: HARD FAIL if missing */
const CRITICAL_ENTRIES = [
  'ops.core.integrity',
  'ops.core.dispatch',
] as const;

/** Behavioral: graceful degradation if missing */
const BEHAVIORAL_ENTRIES = [
  'ops.core.tools',
  'ops.core.format',
] as const;

// ==========================================
// Composition Engine
// ==========================================

/**
 * Compose operational doctrine from Notion-governed entries.
 *
 * @param surface - 'telegram' | 'bridge' — determines which surface overlay to fetch
 * @returns Composed doctrine with content string, warnings, and resolution metadata
 * @throws Error if any CRITICAL entry (integrity, dispatch) is missing — ADR-008 hard fail
 */
export async function composeOperationalDoctrine(
  surface: 'telegram' | 'bridge',
): Promise<OperationalDoctrineResult> {
  const cacheKey = `ops-doctrine:${surface}`;

  // Check composed-result cache first (wraps PromptManager's per-entry cache)
  const cached = promptCache.get<OperationalDoctrineResult>(cacheKey);
  if (cached) {
    return cached;
  }

  const pm = PromptManager.getInstance();
  const warnings: string[] = [];
  const resolved: string[] = [];
  const missing: string[] = [];
  const sections: string[] = [];

  // ── Helper: fetch a single entry ──────────────────────────────
  async function fetchEntry(
    id: string,
    isCritical: boolean,
  ): Promise<string | null> {
    try {
      const content = await pm.getPromptById(id);

      if (!content) {
        if (isCritical) {
          throw new Error(
            `CRITICAL SAFETY FAILURE: Required operational doctrine '${id}' not found in Notion. ` +
            `This is a hard requirement (ADR-008). The system cannot operate without it. ` +
            `Verify the entry exists in the System Prompts DB with ID='${id}' and Active=true.`,
          );
        }
        warnings.push(`[Jidoka Warning] Non-critical operational doctrine '${id}' missing — degraded mode`);
        missing.push(id);
        return null;
      }

      resolved.push(id);
      return content;
    } catch (error) {
      if (isCritical) {
        // Re-throw critical errors — must halt
        throw error;
      }
      const msg = error instanceof Error ? error.message : String(error);
      warnings.push(`[Jidoka Warning] Failed to fetch '${id}': ${msg} — degraded mode`);
      missing.push(id);
      return null;
    }
  }

  // ── Fetch all entries ─────────────────────────────────────────
  // Critical entries — hard fail if missing
  const integrity = await fetchEntry('ops.core.integrity', true);
  const dispatch = await fetchEntry('ops.core.dispatch', true);

  // Behavioral entries — graceful degradation
  const tools = await fetchEntry('ops.core.tools', false);
  const format = await fetchEntry('ops.core.format', false);

  // Surface-specific overlay
  const surfaceEntry = await fetchEntry(`ops.surface.${surface}`, false);

  // ── Assemble sections ─────────────────────────────────────────
  sections.push('--- CORE OPERATIONAL DOCTRINE ---');

  // Critical entries are guaranteed non-null (fetchEntry throws otherwise)
  sections.push(integrity!);
  sections.push(dispatch!);

  // Behavioral entries — include if available
  if (tools) sections.push(tools);
  if (format) sections.push(format);

  // Surface overlay — falls back to core format if surface-specific is missing
  sections.push('--- PRESENTATION LAYER ---');
  if (surfaceEntry) {
    sections.push(surfaceEntry);
  } else if (format) {
    // Surface missing but core format exists — use it as fallback
    // (warning already logged by fetchEntry)
  }

  const result: OperationalDoctrineResult = {
    content: sections.join('\n\n'),
    warnings,
    resolved,
    missing,
  };

  // Cache the composed result
  promptCache.set(cacheKey, result);

  return result;
}
