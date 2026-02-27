/**
 * Context Transparency — degraded context indicators.
 *
 * When any enrichment slot fails or returns empty, this utility
 * produces a concise note for injection into the system prompt so
 * the LLM knows it's operating with partial context.
 *
 * Constraint 4: Fail Fast, Fail Loud. These notes must be specific
 * and actionable, not vague. The user (Jim) should know exactly what's
 * missing and what that means for the response quality.
 */

import type { SlotResult, SlotName } from './types/slot-result';

/**
 * Slot-specific failure instructions for the LLM.
 *
 * Each entry tells the LLM exactly what to say to the user when
 * that slot fails. No vague language — explicit and actionable.
 */
const SLOT_FAILURE_INSTRUCTIONS: Record<SlotName, string> = {
  domain_rag: '[RAG offline — answering without client docs]. You MUST include this exact bracketed note at the START of your response when domain_rag is unavailable. Do NOT paraphrase it as "information gap" or "domain knowledge unavailable". Say it verbatim.',
  pov: 'POV Library unavailable — responding without strategic position context.',
  voice: 'Voice calibration unavailable — using default tone.',
  intent: 'Triage failed — intent classification may be inaccurate.',
  browser: 'No browser context available.',
  output: 'Output surface context unavailable.',
};

/**
 * Builds a consolidated degraded-context note from slot results.
 *
 * Returns `null` when all slots are ok — no note is needed.
 * When one or more slots are degraded or failed, returns a single
 * string suitable for injection into the system prompt with explicit
 * instructions for how the LLM should communicate the degradation.
 *
 * @example
 *   // RAG failed
 *   buildDegradedContextNote(results)
 *   // => "⚠️ DEGRADED CONTEXT — you are missing information sources:\n\n- [RAG offline — answering without client docs]..."
 */
export function buildDegradedContextNote(
  slotResults: SlotResult[],
): string | null {
  const nonOk = slotResults.filter((s) => s.status !== 'ok');

  if (nonOk.length === 0) return null;

  const instructions = nonOk
    .map((s) => {
      const instruction = SLOT_FAILURE_INSTRUCTIONS[s.slotName] ?? `${s.slotName} unavailable.`;
      const reason = s.reason ? ` (Reason: ${s.reason})` : '';
      return `- ${instruction}${reason}`;
    })
    .join('\n');

  return `⚠️ DEGRADED CONTEXT — you are missing information sources. Be transparent about this:\n\n${instructions}`;
}
