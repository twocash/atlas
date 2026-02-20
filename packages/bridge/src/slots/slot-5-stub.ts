/**
 * Slot 5 Stub — Diagnostic Telemetry (Unavailable)
 *
 * Returns an explicit "unavailable" status per ADR-008 (fail fast, fail loud).
 * Bridge Claude references this note if Jim asks about system health —
 * says "I don't have diagnostic access right now" rather than hallucinating.
 *
 * Full wiring deferred to DevTools Panel sprint.
 */

export interface Slot5Result {
  status: 'available' | 'unavailable';
  degradedNote?: string;
  content?: string;
}

/**
 * Returns the Slot 5 stub — always unavailable until DevTools Panel ships.
 */
export function getSlot5(): Slot5Result {
  return {
    status: 'unavailable',
    degradedNote:
      'Diagnostic telemetry not available — DevTools Panel not yet wired. ' +
      'Cannot report selector health, console errors, or pipeline diagnostics.',
  };
}
