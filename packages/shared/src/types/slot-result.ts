/**
 * SlotResult — Transparency wrapper for context assembly slots.
 *
 * Replaces raw `string | null` returns with status + reason so the
 * system prompt can declare when context is degraded and the failure
 * reporter can escalate persistent slot outages.
 */

/** Slot health status */
export type SlotStatus = 'ok' | 'degraded' | 'failed';

/** The 6 context slot identifiers (mirrors bridge SlotId) */
export type SlotName =
  | 'intent'
  | 'domain_rag'
  | 'pov'
  | 'voice'
  | 'browser'
  | 'output';

/** Human-readable labels for slot names */
export const SLOT_DISPLAY_NAMES: Record<SlotName, string> = {
  intent: 'Triage',
  domain_rag: 'Domain RAG',
  pov: 'POV Library',
  voice: 'Voice',
  browser: 'Browser Context',
  output: 'Output Surface',
};

export interface SlotResult {
  /** Which slot this represents */
  slotName: SlotName;
  /** The assembled content (null when failed) */
  content: string | null;
  /** Health status */
  status: SlotStatus;
  /** Human-readable reason when degraded or failed */
  reason?: string;
}

/**
 * Wraps a raw slot output into a SlotResult.
 *
 * Mapping:
 *   - null/undefined content  → failed
 *   - empty string content    → degraded
 *   - non-empty content       → ok
 */
export function wrapSlotResult(
  slotName: SlotName,
  content: string | null | undefined,
  reason?: string,
): SlotResult {
  if (content == null) {
    return {
      slotName,
      content: null,
      status: 'failed',
      reason: reason ?? 'Slot returned no content',
    };
  }

  if (content.trim() === '') {
    return {
      slotName,
      content: '',
      status: 'degraded',
      reason: reason ?? 'Slot returned empty content',
    };
  }

  return { slotName, content, status: 'ok' };
}
