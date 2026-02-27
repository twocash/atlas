/**
 * Session Types — P0 SessionManager data contracts.
 *
 * These types are self-contained (zero surface imports) and
 * structurally compatible with bridge's SessionContext.
 *
 * Sprint: SESSION-TELEMETRY P0
 */

// ── Completion ──────────────────────────────────────────

export type CompletionType = 'natural' | 'timeout' | 'explicit';

// ── Turn Record ─────────────────────────────────────────

export interface TurnRecord {
  /** 1-based turn number within the session */
  turnNumber: number;
  /** ISO timestamp when this turn started */
  timestamp: string;
  /** The user's original message text */
  messageText: string;
  /** Intent hash (for drift detection) */
  intentHash?: string;
  /** Triage intent classification */
  intent?: string;
  /** Short preview of Atlas's response */
  responsePreview?: string;
  /** Compressed findings from this turn */
  findings?: string;
  /** Tools used during this turn */
  toolsUsed?: string[];
  /** Thesis hook (evolving argument thread) */
  thesisHook?: string;
}

// ── Session State ───────────────────────────────────────

export interface SessionState {
  /** Stable session ID (UUID) */
  id: string;
  /** Inferred topic from first turn */
  topic?: string;
  /** Pillar classification */
  pillar?: string;
  /** Which surface initiated this session */
  surface: string;
  /** Sequence of intents across turns */
  intentSequence: string[];
  /** All turns in this session */
  turns: TurnRecord[];
  /** Current turn count (1-based) */
  turnCount: number;
  /** Compressed prior findings (accumulated) */
  priorFindings?: string;
  /** Current research depth */
  currentDepth?: string;
  /** Thesis hook from most recent turn */
  thesisHook?: string;
  /** ISO timestamp when session was created */
  createdAt: string;
  /** Epoch ms of last activity (for TTL) */
  lastActivity: number;
  /** ISO timestamp when session completed (if completed) */
  completedAt?: string;
  /** How the session ended */
  completionType?: CompletionType;
}

// ── Session Artifact (RAG contract) ─────────────────────

export interface SessionArtifact {
  /** Schema version */
  version: '1.0';
  /** Session ID */
  sessionId: string;
  /** Inferred topic */
  topic?: string;
  /** Pillar */
  pillar?: string;
  /** Surface */
  surface: string;
  /** Intent sequence across all turns */
  intentSequence: string[];
  /** Final thesis hook */
  thesisHook?: string;
  /** All turns */
  turns: TurnRecord[];
  /** ISO timestamp of session start */
  startedAt: string;
  /** ISO timestamp of session end */
  completedAt: string;
  /** How the session ended */
  completionType: CompletionType;
  /** Total session duration in ms */
  totalDurationMs: number;
}

// ── Session Context (Slot 7 compatible) ─────────────────

/**
 * Context data for Slot 7 injection. Structurally compatible
 * with bridge's SessionContext — no cross-package imports needed.
 */
export interface SessionSlotContext {
  sessionId: string;
  turnNumber: number;
  priorIntentHash?: string;
  intentSequence: string[];
  priorFindings?: string;
  currentDepth?: string;
  thesisHook?: string;
  topic?: string;
}
