/**
 * Session module — public exports.
 *
 * Sprint: SESSION-TELEMETRY P0
 */

export { SessionManager, sessionManager } from './session-manager';
export type {
  SessionState,
  TurnRecord,
  SessionArtifact,
  SessionSlotContext,
  CompletionType,
} from './types';
export { writeJournal, ensureSessionDir, parseJournal, scanForIncompleteJournals } from './journal';
export { writeArtifact } from './artifact';
export { writeSessionFeedEntry } from './feed-writer';
