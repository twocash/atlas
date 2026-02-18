/**
 * Context Transparency — degraded context indicators.
 *
 * When any enrichment slot fails or returns empty, this utility
 * produces a concise note for injection into the system prompt so
 * the LLM knows it's operating with partial context.
 */

import type { SlotResult } from './types/slot-result';
import { SLOT_DISPLAY_NAMES } from './types/slot-result';

/**
 * Builds a consolidated degraded-context note from slot results.
 *
 * Returns `null` when all slots are ok — no note is needed.
 * When one or more slots are degraded or failed, returns a single
 * human-readable string suitable for injection into the system prompt.
 *
 * @example
 *   // Two degraded slots
 *   buildDegradedContextNote(results)
 *   // => "⚠️ Context Note: Domain RAG unavailable (AnythingLLM timeout). Voice unavailable (No voice match). Responses may lack domain specificity and tone calibration."
 *
 *   // All ok
 *   buildDegradedContextNote(results)
 *   // => null
 */
export function buildDegradedContextNote(
  slotResults: SlotResult[],
): string | null {
  const nonOk = slotResults.filter((s) => s.status !== 'ok');

  if (nonOk.length === 0) return null;

  const details = nonOk
    .map((s) => {
      const label = SLOT_DISPLAY_NAMES[s.slotName] ?? s.slotName;
      const suffix = s.reason ? ` (${s.reason})` : '';
      return `${label} unavailable${suffix}`;
    })
    .join('. ');

  return `⚠️ Context Note: ${details}. Responses may lack specificity in affected areas.`;
}
