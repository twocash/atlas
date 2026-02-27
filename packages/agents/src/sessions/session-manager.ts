/**
 * SessionManager — cognitive session engine.
 *
 * In-memory Map<string, SessionState> with three output channels:
 *   1. Filesystem journal (crash-resilient, per-turn)
 *   2. Notion Feed 2.0 (rich completion entry)
 *   3. RAG artifact JSON (Tier 3.3 data contract)
 *
 * TTL: 15 min inactivity, 2 hour max, 10 max active sessions.
 * Rehydrates from incomplete journals on construction.
 *
 * Sprint: SESSION-TELEMETRY P0
 */

import { logger } from '../logger';
import type { SessionState, TurnRecord, CompletionType, SessionSlotContext } from './types';
import { writeJournal, scanForIncompleteJournals } from './journal';
import { writeArtifact } from './artifact';
import { writeSessionFeedEntry } from './feed-writer';

// ── Constants ───────────────────────────────────────────

const INACTIVITY_TTL_MS = 15 * 60 * 1000;    // 15 minutes
const MAX_SESSION_MS = 2 * 60 * 60 * 1000;    // 2 hours
const MAX_ACTIVE = 10;

// ── SessionManager ──────────────────────────────────────

export class SessionManager {
  private sessions = new Map<string, SessionState>();
  private rehydrated = false;

  /**
   * Rehydrate active sessions from filesystem journals.
   * Called lazily on first startTurn() — not in constructor
   * to avoid async constructor complications.
   */
  async rehydrateFromJournals(): Promise<void> {
    if (this.rehydrated) return;
    this.rehydrated = true;

    try {
      const states = await scanForIncompleteJournals();
      for (const state of states) {
        // Only rehydrate if within TTL
        const now = Date.now();
        const createdMs = new Date(state.createdAt).getTime();
        const age = now - createdMs;

        if (age > MAX_SESSION_MS) {
          // Too old — complete as timeout
          state.completedAt = new Date().toISOString();
          state.completionType = 'timeout';
          state.lastActivity = now;
          this.completeSessionOutputs(state);
          logger.info('Rehydrated session expired, completing as timeout', {
            sessionId: state.id,
            ageMs: age,
          });
          continue;
        }

        this.sessions.set(state.id, state);
        logger.info('Rehydrated active session', {
          sessionId: state.id,
          turns: state.turnCount,
          topic: state.topic,
        });
      }
    } catch (err) {
      logger.warn('Session rehydration failed (non-fatal)', {
        error: (err as Error).message,
      });
    }
  }

  /**
   * Start a new turn in a session.
   * Creates the session if it doesn't exist. Appends a TurnRecord.
   * Writes the journal to filesystem.
   *
   * Returns whether this is a new session and the session context for Slot 7.
   */
  async startTurn(
    sessionId: string,
    messageText: string,
    surface: string,
    opts?: {
      pillar?: string;
      intentHash?: string;
      intent?: string;
      topic?: string;
    },
  ): Promise<{ isNew: boolean; sessionContext: SessionSlotContext }> {
    // Lazy rehydration on first call
    await this.rehydrateFromJournals();

    // Lazy pruning (same pattern as conversation-state.ts)
    this.pruneExpired();

    let state = this.sessions.get(sessionId);
    const isNew = !state;

    if (!state) {
      // Enforce MAX_ACTIVE — prune oldest if at limit
      if (this.sessions.size >= MAX_ACTIVE) {
        this.pruneOldest();
      }

      state = {
        id: sessionId,
        surface,
        intentSequence: [],
        turns: [],
        turnCount: 0,
        createdAt: new Date().toISOString(),
        lastActivity: Date.now(),
      };
      this.sessions.set(sessionId, state);
    }

    // Update state with turn data
    state.turnCount += 1;
    state.lastActivity = Date.now();

    if (opts?.pillar && !state.pillar) {
      state.pillar = opts.pillar;
    }
    if (opts?.topic && !state.topic) {
      state.topic = opts.topic;
    }
    if (opts?.intent) {
      state.intentSequence.push(opts.intent);
    }

    // Create turn record
    const turn: TurnRecord = {
      turnNumber: state.turnCount,
      timestamp: new Date().toISOString(),
      messageText,
      intentHash: opts?.intentHash,
      intent: opts?.intent,
    };
    state.turns.push(turn);

    // Write journal (crash-resilient)
    writeJournal(state).catch(err => {
      logger.warn('Journal write failed in startTurn', {
        sessionId,
        error: (err as Error).message,
      });
    });

    return {
      isNew,
      sessionContext: this.buildSlotContext(state),
    };
  }

  /**
   * Complete the current turn with response data.
   * Updates the last TurnRecord and rewrites the journal.
   */
  async completeTurn(
    sessionId: string,
    opts?: {
      findings?: string;
      responsePreview?: string;
      thesisHook?: string;
      toolsUsed?: string[];
    },
  ): Promise<void> {
    const state = this.sessions.get(sessionId);
    if (!state || state.turns.length === 0) return;

    const lastTurn = state.turns[state.turns.length - 1];
    if (opts?.findings) lastTurn.findings = opts.findings;
    if (opts?.responsePreview) lastTurn.responsePreview = opts.responsePreview;
    if (opts?.thesisHook) {
      lastTurn.thesisHook = opts.thesisHook;
      state.thesisHook = opts.thesisHook;
    }
    if (opts?.toolsUsed) lastTurn.toolsUsed = opts.toolsUsed;

    // Accumulate findings
    if (opts?.findings) {
      state.priorFindings = state.priorFindings
        ? `${state.priorFindings}\n${opts.findings}`
        : opts.findings;
    }

    state.lastActivity = Date.now();

    // Rewrite journal
    writeJournal(state).catch(err => {
      logger.warn('Journal write failed in completeTurn', {
        sessionId,
        error: (err as Error).message,
      });
    });
  }

  /**
   * Complete a session. Writes Feed entry + artifact. Removes from active map.
   */
  async completeSession(sessionId: string, type: CompletionType): Promise<void> {
    const state = this.sessions.get(sessionId);
    if (!state) return;

    state.completedAt = new Date().toISOString();
    state.completionType = type;
    state.lastActivity = Date.now();

    await this.completeSessionOutputs(state);
    this.sessions.delete(sessionId);
  }

  /**
   * Get session context for Slot 7 composition.
   * Returns null if session doesn't exist.
   */
  getSessionContext(sessionId: string): SessionSlotContext | null {
    const state = this.sessions.get(sessionId);
    if (!state) return null;
    return this.buildSlotContext(state);
  }

  /**
   * Check if a session exists and is active.
   */
  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  /**
   * Get count of active sessions (for diagnostics).
   */
  getActiveCount(): number {
    return this.sessions.size;
  }

  /**
   * Prune expired sessions. Completes them with type='timeout'.
   * Called lazily on startTurn().
   */
  pruneExpired(): void {
    const now = Date.now();

    for (const [id, state] of this.sessions) {
      const inactivityExpired = now - state.lastActivity > INACTIVITY_TTL_MS;
      const maxDurationExpired = now - new Date(state.createdAt).getTime() > MAX_SESSION_MS;

      if (inactivityExpired || maxDurationExpired) {
        state.completedAt = new Date().toISOString();
        state.completionType = 'timeout';
        this.completeSessionOutputs(state);
        this.sessions.delete(id);

        logger.info('Session expired and completed', {
          sessionId: id,
          reason: maxDurationExpired ? 'max_duration' : 'inactivity',
          turns: state.turnCount,
        });
      }
    }
  }

  // ── Private ─────────────────────────────────────────────

  private buildSlotContext(state: SessionState): SessionSlotContext {
    const lastTurn = state.turns[state.turns.length - 1];
    const prevTurn = state.turns.length > 1 ? state.turns[state.turns.length - 2] : undefined;

    return {
      sessionId: state.id,
      turnNumber: state.turnCount,
      priorIntentHash: prevTurn?.intentHash,
      intentSequence: state.intentSequence,
      priorFindings: state.priorFindings,
      currentDepth: state.currentDepth,
      thesisHook: state.thesisHook,
      topic: state.topic,
    };
  }

  /**
   * Write all completion outputs (journal, Feed, artifact).
   * Fire-and-forget — errors are logged but never thrown.
   */
  private completeSessionOutputs(state: SessionState): void {
    // Final journal write (with completion marker)
    writeJournal(state).catch(err => {
      logger.warn('Final journal write failed', {
        sessionId: state.id,
        error: (err as Error).message,
      });
    });

    // Feed 2.0 entry
    writeSessionFeedEntry(state).catch(err => {
      logger.warn('Session Feed entry failed', {
        sessionId: state.id,
        error: (err as Error).message,
      });
    });

    // RAG artifact
    writeArtifact(state).catch(err => {
      logger.warn('Session artifact write failed', {
        sessionId: state.id,
        error: (err as Error).message,
      });
    });
  }

  /**
   * Prune the oldest session when MAX_ACTIVE is exceeded.
   */
  private pruneOldest(): void {
    let oldest: SessionState | null = null;
    for (const state of this.sessions.values()) {
      if (!oldest || state.lastActivity < oldest.lastActivity) {
        oldest = state;
      }
    }
    if (oldest) {
      oldest.completedAt = new Date().toISOString();
      oldest.completionType = 'timeout';
      this.completeSessionOutputs(oldest);
      this.sessions.delete(oldest.id);

      logger.info('Oldest session pruned (MAX_ACTIVE exceeded)', {
        sessionId: oldest.id,
        turns: oldest.turnCount,
      });
    }
  }
}

// ── Singleton ─────────────────────────────────────────────

export const sessionManager = new SessionManager();
