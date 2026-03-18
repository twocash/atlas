/**
 * Unified Conversation State Manager
 *
 * Single source of truth for all per-chat session state.
 * Replaces three independent stores (approval-session, dialogue-session,
 * socratic-session) that had different TTLs, cancellation rules, and
 * no shared context — causing 5 systemic bugs (STAB-003b).
 *
 * Bugs fixed:
 *   1. Post-approval re-processing (stored assessment never reused)
 *   2. URL context loss (prefetchedUrlContent in Socratic only)
 *   3. Over-gating (single-step moderate proposals trigger approval)
 *   4. Double triage (quality retry causes 2x Haiku calls)
 *   5. Pillar drift (re-triage on decontextualized text overrides correct pillar)
 *
 * Sprint: SESSION-STATE-FOUNDATION
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { logger } from '../logger';
import { reportFailure } from '@atlas/shared/error-escalation';
import type { RequestAssessment, AssessmentContext } from '../assessment/types';
import type { ApproachProposal } from '../assessment/types';
import type { DialogueState } from '../dialogue/types';
import type { SocraticQuestion, ContextSignals } from '../socratic';
import type { GoalContext, ContentAnalysis as GoalContentAnalysis, GoalTracker } from '../goal';
import type { ResolvedContext } from '../socratic';
import type { TriageResult } from '../cognitive/triage-skill';
import type { ActionApprovalContext } from './action-approval';
import type { UrlContent, PendingContent } from './types';

/**
 * Deferred execution context stored when goal needs clarification.
 * Contains everything needed to call handleResolved() once goal is complete.
 */
export interface GoalDeferredExecution {
  resolved: ResolvedContext;
  content: string;
  contentType: 'url' | 'text' | 'media';
  title: string;
  answerContext?: string;
}

// ─── Types ──────────────────────────────────────────────

/**
 * Content context preserved across conversation turns.
 * Solves Bug #2: URL context loss when follow-up text has no URL.
 */
export interface ContentContext {
  /** The URL that was shared */
  url: string;
  /** Smart title from triage or extraction */
  title: string;
  /** Haiku pre-read summary */
  preReadSummary?: string;
  /** Pre-fetched URL content (avoids redundant re-fetch) */
  prefetchedUrlContent?: UrlContent;
  /** When the content was captured */
  capturedAt: number;
}

/**
 * Approval state within the conversation.
 * Previously lived in approval-session.ts as PendingApprovalSession.
 */
export interface ApprovalState {
  /** Message ID of the proposal message */
  proposalMessageId: number;
  /** The approach proposal awaiting approval */
  proposal: ApproachProposal;
  /** Refined request from dialogue (if dialogue preceded approval) */
  refinedRequest?: string;
  /** Original message text */
  originalMessage: string;
  /** Assessment that generated the proposal */
  assessment: RequestAssessment;
  /** Assessment context for re-assessment on ambiguous reply */
  assessmentContext: AssessmentContext;
}

/**
 * Dialogue state within the conversation.
 * Previously lived in dialogue-session.ts as PendingDialogueSession.
 */
export interface DialogueSessionState {
  /** Message ID of the last dialogue question */
  questionMessageId: number;
  /** Current dialogue state from the engine */
  dialogueState: DialogueState;
  /** Original assessment that triggered dialogue */
  assessment: RequestAssessment;
  /** Assessment context for continuing dialogue */
  assessmentContext: AssessmentContext;
  /** Original message that triggered dialogue */
  originalMessage: string;
}

/**
 * Socratic session state within the conversation.
 * Previously lived in socratic-session.ts as PendingSocraticSession.
 */
export interface SocraticSessionState {
  /** Engine session ID (for engine.answer()) */
  sessionId: string;
  /** Message ID of the question message */
  questionMessageId: number;
  /** The questions the engine asked */
  questions: SocraticQuestion[];
  /** Which question index we're on (0-based) */
  currentQuestionIndex: number;
  /** Original content that triggered the flow */
  content: string;
  /** Content type */
  contentType: 'url' | 'text' | 'media';
  /** Title for the content */
  title: string;
  /** Original triage result (if available) */
  triageResult?: TriageResult;
  /** Original context signals */
  signals: ContextSignals;
  /** Request ID for pending content */
  requestId?: string;
  /** Pre-fetched URL content */
  prefetchedUrlContent?: UrlContent;
}

/**
 * Which sub-state is currently active.
 * Only ONE can be active at a time — they are mutually exclusive.
 */
export type ActivePhase = 'idle' | 'socratic' | 'dialogue' | 'approval' | 'goal-clarification' | 'pending-action';

/**
 * Unified conversation state for a single chat.
 *
 * Contains all the context that was previously scattered across
 * three independent session stores. One state per chat, 15-min TTL.
 */
export interface ConversationState {
  /** Chat where this conversation is happening */
  chatId: number;
  /** User who owns this conversation */
  userId: number;
  /** Which sub-state is currently active */
  phase: ActivePhase;

  // ── Preserved context (survives phase transitions) ──

  /** Content context from URL shares (Bug #2 fix) */
  contentContext?: ContentContext;
  /** Last classification/triage result (Bug #4, #5 fix) */
  lastTriage?: TriageResult;
  /** Jim's Socratic answer — persisted for research context injection (ATLAS-RCI-001).
   * Previously a local var in socratic-adapter that died at function scope. */
  lastSocraticAnswer?: string;
  /** Last assessment result (Bug #1 fix — reused after approval) */
  lastAssessment?: RequestAssessment;
  /** Last assessment context */
  lastAssessmentContext?: AssessmentContext;

  // ── Phase-specific state (only one active at a time) ──

  /** Socratic interview state (when phase === 'socratic') */
  socratic?: SocraticSessionState;
  /** Dialogue exploration state (when phase === 'dialogue') */
  dialogue?: DialogueSessionState;
  /** Approval gate state (when phase === 'approval') */
  approval?: ApprovalState;

  // ── Goal-First Capture (ATLAS-GOAL-FIRST-001) ──

  /** Pending goal context (when phase === 'goal-clarification') */
  pendingGoal?: GoalContext;
  /** How many clarification rounds we've done (max 2) */
  goalClarificationRound?: number;
  /** Content analysis for goal clarification questions */
  goalContentAnalysis?: GoalContentAnalysis;
  /** The target field being clarified */
  goalTargetField?: string;
  /** Deferred execution context — everything needed to resume after clarification */
  goalDeferredExecution?: GoalDeferredExecution;
  /** Telemetry tracker — accumulates across clarification rounds */
  goalTracker?: GoalTracker;

  // ── Action Approval (Sprint: ACTION-INTENT) ──

  /** Pending action awaiting confirmation (when phase === 'pending-action') */
  pendingAction?: ActionApprovalContext;

  // ── Session Telemetry (Sprint: SESSION-TELEMETRY) ──

  /** Stable session ID (uuid, persists across turns within TTL window) */
  sessionId: string;
  /** Turn count within this session (1-based, incremented on each message) */
  turnCount: number;
  /** Intent hash from the most recent turn (for drift detection) */
  lastIntentHash?: string;

  // ── Timestamps ──

  /** When this state was created */
  createdAt: number;
  /** Last activity (any update resets TTL) */
  lastActivity: number;
}

// ─── State Manager ──────────────────────────────────────

/** Unified TTL: 15 minutes. Longer than any single phase. */
const STATE_TTL_MS = 15 * 60 * 1000;

/**
 * In-memory store: chatId -> conversation state.
 * Only one state per chat (latest wins).
 */
const states = new Map<number, ConversationState>();

// ─── Disk Persistence (Sprint: STATE-PERSIST) ────────────

const STATE_FILE = join(process.cwd(), 'data', 'conversation-state.json');
const SAVE_DEBOUNCE_MS = 2000;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let rehydrated = false;
let lastWriteFailureAt = 0;
const WRITE_FAILURE_COOLDOWN_MS = 5 * 60 * 1000;

interface PersistedStore {
  version: 1;
  states: Record<string, ConversationState>;
  pendingContent: Record<string, PendingContent>;
  savedAt: string;
}

/**
 * JSON replacer: strip non-serializable fields (Buffer).
 */
function persistReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Buffer || (value && typeof value === 'object' && (value as Record<string, unknown>).type === 'Buffer')) {
    return undefined;
  }
  return value;
}

/**
 * Schedule a debounced write to disk after any mutation.
 * First write failure → reportFailure(). Subsequent within 5min → logger.warn().
 */
function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      const dir = join(process.cwd(), 'data');
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

      const store: PersistedStore = {
        version: 1,
        states: Object.fromEntries(states),
        pendingContent: Object.fromEntries(pendingContentStore),
        savedAt: new Date().toISOString(),
      };
      writeFileSync(STATE_FILE, JSON.stringify(store, persistReplacer, 2), 'utf-8');
    } catch (error) {
      const now = Date.now();
      if (now - lastWriteFailureAt > WRITE_FAILURE_COOLDOWN_MS) {
        lastWriteFailureAt = now;
        reportFailure('conversation-state-persist', error, {
          suggestedFix: 'Check data/ directory exists and is writable',
        });
      } else {
        logger.warn('[ConversationState] Write failed (cooldown)', { error });
      }
    }
  }, SAVE_DEBOUNCE_MS);
}

/**
 * Lazy rehydration from disk on first read.
 * Prunes expired entries, re-establishes PendingContent expiry timers.
 */
function rehydrateFromDisk(): void {
  if (rehydrated) return;
  rehydrated = true;

  if (!existsSync(STATE_FILE)) return;

  try {
    const raw = readFileSync(STATE_FILE, 'utf-8');
    const store = JSON.parse(raw) as PersistedStore;

    if (store.version !== 1) {
      logger.warn('[ConversationState] Unknown version, skipping rehydration', { version: store.version });
      return;
    }

    const now = Date.now();
    let loaded = 0;
    let pruned = 0;

    // Rehydrate conversation states
    for (const [key, state] of Object.entries(store.states)) {
      if (now - state.lastActivity > STATE_TTL_MS) {
        pruned++;
        continue;
      }
      states.set(Number(key), state);
      loaded++;
    }

    // Rehydrate pending content + re-establish expiry timers
    let pendingLoaded = 0;
    for (const [key, content] of Object.entries(store.pendingContent ?? {})) {
      const age = now - content.timestamp;
      if (age > PENDING_CONTENT_EXPIRY_MS) continue;

      // Strip mediaBuffer if it somehow survived serialization
      const { mediaBuffer: _, ...safeContent } = content as PendingContent & { mediaBuffer?: unknown };
      pendingContentStore.set(key, safeContent as PendingContent);

      // Re-establish expiry timer for remaining TTL
      const remainingMs = PENDING_CONTENT_EXPIRY_MS - age;
      setTimeout(() => {
        if (pendingContentStore.has(key)) {
          pendingContentStore.delete(key);
          logger.debug('Expired rehydrated pending content', { requestId: key });
        }
      }, remainingMs);
      pendingLoaded++;
    }

    if (loaded > 0 || pendingLoaded > 0) {
      logger.info('[ConversationState] Rehydrated from disk', {
        states: loaded,
        pruned,
        pendingContent: pendingLoaded,
      });
    }
  } catch (error) {
    logger.warn('[ConversationState] Failed to rehydrate from disk, starting fresh', { error });
  }
}

/**
 * Get or create a conversation state for a chat.
 * If an existing state is expired, creates a fresh one.
 */
export function getOrCreateState(chatId: number, userId: number): ConversationState {
  rehydrateFromDisk();
  const existing = states.get(chatId);
  if (existing && !isExpired(existing)) {
    return existing;
  }

  const state: ConversationState = {
    chatId,
    userId,
    phase: 'idle',
    sessionId: crypto.randomUUID(),
    turnCount: 0,
    createdAt: Date.now(),
    lastActivity: Date.now(),
  };
  states.set(chatId, state);
  scheduleSave();
  return state;
}

/**
 * Get a conversation state by chat ID. Returns undefined if not found or expired.
 */
export function getState(chatId: number): ConversationState | undefined {
  rehydrateFromDisk();
  const state = states.get(chatId);
  if (!state) return undefined;
  if (isExpired(state)) {
    states.delete(chatId);
    return undefined;
  }
  return state;
}

/**
 * Get a conversation state by user ID. Searches all states.
 */
export function getStateByUserId(userId: number): ConversationState | undefined {
  rehydrateFromDisk();
  for (const state of states.values()) {
    if (state.userId === userId) {
      if (isExpired(state)) {
        states.delete(state.chatId);
        continue;
      }
      return state;
    }
  }
  return undefined;
}

/**
 * Update a conversation state. Merges partial updates and refreshes lastActivity.
 */
export function updateState(chatId: number, updates: Partial<ConversationState>): ConversationState | undefined {
  const state = getState(chatId);
  if (!state) return undefined;

  Object.assign(state, updates, { lastActivity: Date.now() });
  scheduleSave();
  return state;
}

// ─── Session Telemetry ──────────────────────────────────

/**
 * Record a new conversation turn. Increments turnCount and stores
 * the current intent hash as lastIntentHash for the NEXT turn's
 * "prior intent hash" field.
 *
 * Call this once per incoming message, early in handleConversation().
 */
export function recordTurn(chatId: number, userId: number, intentHash?: string): {
  sessionId: string;
  turnNumber: number;
  priorIntentHash?: string;
} {
  const state = getOrCreateState(chatId, userId);
  const priorIntentHash = state.lastIntentHash;

  state.turnCount += 1;
  if (intentHash) {
    state.lastIntentHash = intentHash;
  }
  state.lastActivity = Date.now();
  scheduleSave();

  return {
    sessionId: state.sessionId,
    turnNumber: state.turnCount,
    priorIntentHash,
  };
}

// ─── Content Context (Bug #2 fix) ──────────────────────

/**
 * Store content context from a URL share.
 * This context survives phase transitions — follow-up messages
 * can access URL title, pre-read summary, and extracted content.
 */
export function storeContentContext(
  chatId: number,
  userId: number,
  context: ContentContext,
): void {
  const state = getOrCreateState(chatId, userId);
  state.contentContext = context;
  state.lastActivity = Date.now();

  logger.debug('Stored content context', {
    chatId,
    url: context.url,
    title: context.title,
    hasPreRead: !!context.preReadSummary,
    hasUrlContent: !!context.prefetchedUrlContent,
  });
  scheduleSave();
}

/**
 * Get content context for a chat. Returns undefined if not found or expired.
 */
export function getContentContext(chatId: number): ContentContext | undefined {
  const state = getState(chatId);
  return state?.contentContext;
}

// ─── Socratic Answer Persistence (ATLAS-RCI-001) ────────

/**
 * Store Jim's Socratic answer in unified state.
 * Previously a local var in socratic-adapter that died at function scope —
 * now persisted so research-executor can inject it into research context.
 */
export function storeSocraticAnswer(chatId: number, answer: string): void {
  const state = states.get(chatId);
  if (state && !isExpired(state)) {
    state.lastSocraticAnswer = answer;
    state.lastActivity = Date.now();

    logger.debug('Stored Socratic answer', {
      chatId,
      answerLength: answer.length,
    });
    scheduleSave();
  }
}

/**
 * Get the last Socratic answer for a chat.
 */
export function getSocraticAnswer(chatId: number): string | undefined {
  const state = getState(chatId);
  return state?.lastSocraticAnswer;
}

// ─── Triage & Assessment Caching (Bug #1, #4, #5 fix) ──

/**
 * Store triage result in conversation state.
 * Prevents double triage (Bug #4) and pillar drift (Bug #5).
 */
export function storeTriage(chatId: number, triage: TriageResult): void {
  const state = states.get(chatId);
  if (state && !isExpired(state)) {
    state.lastTriage = triage;
    state.lastActivity = Date.now();
    scheduleSave();
  }
}

/**
 * Store assessment result in conversation state.
 * Reused after approval to skip re-processing (Bug #1).
 */
export function storeAssessment(
  chatId: number,
  assessment: RequestAssessment,
  assessmentContext: AssessmentContext,
): void {
  const state = states.get(chatId);
  if (state && !isExpired(state)) {
    state.lastAssessment = assessment;
    state.lastAssessmentContext = assessmentContext;
    state.lastActivity = Date.now();
    scheduleSave();
  }
}

// ─── Phase Transitions ─────────────────────────────────

/**
 * Enter Socratic interview phase.
 */
export function enterSocraticPhase(
  chatId: number,
  userId: number,
  socratic: SocraticSessionState,
): void {
  const state = getOrCreateState(chatId, userId);
  state.phase = 'socratic';
  state.socratic = socratic;
  state.dialogue = undefined;
  state.approval = undefined;
  state.lastActivity = Date.now();

  logger.debug('Entered Socratic phase', {
    chatId,
    sessionId: socratic.sessionId,
    questionCount: socratic.questions.length,
  });
  scheduleSave();
}

/**
 * Enter dialogue exploration phase.
 */
export function enterDialoguePhase(
  chatId: number,
  userId: number,
  dialogue: DialogueSessionState,
): void {
  const state = getOrCreateState(chatId, userId);
  state.phase = 'dialogue';
  state.dialogue = dialogue;
  state.socratic = undefined;
  state.approval = undefined;
  state.lastActivity = Date.now();

  logger.debug('Entered dialogue phase', {
    chatId,
    terrain: dialogue.dialogueState.terrain,
    turnCount: dialogue.dialogueState.turnCount,
  });
  scheduleSave();
}

/**
 * Enter approval gate phase.
 */
export function enterApprovalPhase(
  chatId: number,
  userId: number,
  approval: ApprovalState,
): void {
  const state = getOrCreateState(chatId, userId);
  state.phase = 'approval';
  state.approval = approval;
  state.socratic = undefined;
  state.dialogue = undefined;
  state.lastActivity = Date.now();

  logger.debug('Entered approval phase', {
    chatId,
    stepsCount: approval.proposal.steps.length,
    hasRefinedRequest: !!approval.refinedRequest,
  });
  scheduleSave();
}

/**
 * Enter goal-clarification phase (ATLAS-GOAL-FIRST-001).
 * The goal parser determined we need more info before executing.
 */
export function enterGoalClarificationPhase(
  chatId: number,
  userId: number,
  goal: GoalContext,
  contentAnalysis: GoalContentAnalysis,
  targetField: string,
  clarificationRound: number,
  deferredExecution?: GoalDeferredExecution,
  tracker?: GoalTracker,
): void {
  const state = getOrCreateState(chatId, userId);
  state.phase = 'goal-clarification';
  state.pendingGoal = goal;
  state.goalClarificationRound = clarificationRound;
  state.goalContentAnalysis = contentAnalysis;
  state.goalTargetField = targetField;
  state.goalDeferredExecution = deferredExecution;
  state.goalTracker = tracker || state.goalTracker; // Preserve existing tracker across rounds
  // Keep socratic/dialogue/approval cleared
  state.socratic = undefined;
  state.dialogue = undefined;
  state.approval = undefined;
  state.lastActivity = Date.now();

  logger.debug('Entered goal-clarification phase', {
    chatId,
    completeness: goal.completeness,
    targetField,
    clarificationRound,
  });
  scheduleSave();
}

/**
 * Enter pending-action phase (awaiting butler confirmation).
 * Sprint: ACTION-INTENT (Slice 3)
 */
export function enterPendingActionPhase(
  chatId: number,
  userId: number,
  action: ActionApprovalContext,
): void {
  const state = getOrCreateState(chatId, userId);
  state.phase = 'pending-action';
  state.pendingAction = action;
  state.socratic = undefined;
  state.dialogue = undefined;
  state.approval = undefined;
  state.lastActivity = Date.now();

  logger.debug('Entered pending-action phase', {
    chatId,
    destination: action.destination,
    task: action.task,
    zone: action.zone,
    patternKey: action.patternKey,
  });
  scheduleSave();
}

/**
 * Get pending action for a chat (if in pending-action phase).
 */
export function getPendingAction(chatId: number): ActionApprovalContext | undefined {
  const state = states.get(chatId);
  if (state && !isExpired(state) && state.phase === 'pending-action') {
    return state.pendingAction;
  }
  return undefined;
}

/**
 * Return to idle phase (clears active sub-state but preserves context).
 */
export function returnToIdle(chatId: number): void {
  const state = states.get(chatId);
  if (state && !isExpired(state)) {
    state.phase = 'idle';
    state.socratic = undefined;
    state.dialogue = undefined;
    state.approval = undefined;
    state.pendingGoal = undefined;
    state.goalClarificationRound = undefined;
    state.goalContentAnalysis = undefined;
    state.goalTargetField = undefined;
    state.goalDeferredExecution = undefined;
    state.goalTracker = undefined;
    state.pendingAction = undefined;
    state.lastActivity = Date.now();
    scheduleSave();
  }
}

// ─── Queries ────────────────────────────────────────────

/**
 * Check if a user has a pending session in any phase.
 */
export function hasActiveSession(userId: number): boolean {
  const state = getStateByUserId(userId);
  return !!state && state.phase !== 'idle';
}

/**
 * Check if a user has a specific phase active.
 */
export function isInPhase(userId: number, phase: ActivePhase): boolean {
  const state = getStateByUserId(userId);
  return !!state && state.phase === phase;
}

// ─── Lifecycle ──────────────────────────────────────────

/**
 * Clear all state for a chat. Used when starting fresh.
 */
export function clearState(chatId: number): void {
  states.delete(chatId);
  scheduleSave();
}

/**
 * Prune all expired states. Called lazily on store operations.
 */
export function pruneExpired(): number {
  const now = Date.now();
  let pruned = 0;
  for (const [chatId, state] of states) {
    if (now - state.lastActivity > STATE_TTL_MS) {
      states.delete(chatId);
      pruned++;
    }
  }
  return pruned;
}

/**
 * Get count of active states (for monitoring).
 */
export function getStateCount(): number {
  pruneExpired();
  return states.size;
}

/**
 * Clear all states (for testing).
 */
export function clearAllStates(): void {
  states.clear();
  pendingContentStore.clear();
  scheduleSave();
}

// ─── Pending Content (co-located, keyed by requestId) ───

/**
 * In-memory store for pending content awaiting classification/dispatch.
 * Key: requestId (unique per confirmation flow).
 * Migrated from pending-content.ts — same semantics, co-located store.
 */
const pendingContentStore = new Map<string, PendingContent>();

const PENDING_CONTENT_EXPIRY_MS = 10 * 60 * 1000;

/**
 * Generate a unique request ID.
 */
export function generateRequestId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
}

/**
 * Store pending content for confirmation.
 */
export function storePendingContent(content: PendingContent): void {
  pendingContentStore.set(content.requestId, content);

  setTimeout(() => {
    if (pendingContentStore.has(content.requestId)) {
      pendingContentStore.delete(content.requestId);
      logger.debug('Expired pending content', { requestId: content.requestId });
    }
  }, PENDING_CONTENT_EXPIRY_MS);

  logger.debug('Stored pending content', {
    requestId: content.requestId,
    pillar: content.pillar,
    requestType: content.requestType,
  });
  scheduleSave();
}

/**
 * Retrieve pending content by request ID.
 */
export function getPendingContent(requestId: string): PendingContent | undefined {
  return pendingContentStore.get(requestId);
}

/**
 * Update pending content (after keyboard selection or Socratic answer).
 */
export function updatePendingContent(requestId: string, updates: Partial<PendingContent>): boolean {
  const existing = pendingContentStore.get(requestId);
  if (!existing) return false;
  pendingContentStore.set(requestId, { ...existing, ...updates });
  scheduleSave();
  return true;
}

/**
 * Remove pending content (after confirm/skip).
 */
export function removePendingContent(requestId: string): boolean {
  const deleted = pendingContentStore.delete(requestId);
  if (deleted) scheduleSave();
  return deleted;
}

/**
 * Get count of pending confirmations (for debugging).
 */
export function getPendingCount(): number {
  return pendingContentStore.size;
}

/**
 * Clear all pending content (for testing/reset).
 */
export function clearAllPending(): void {
  pendingContentStore.clear();
}

// ─── Internal ───────────────────────────────────────────

function isExpired(state: ConversationState): boolean {
  return Date.now() - state.lastActivity > STATE_TTL_MS;
}

// ─── Test Helpers (Sprint: STATE-PERSIST) ────────────────

/** Force rehydration from disk. For testing only. */
export function _rehydrateForTesting(): void {
  rehydrated = false;
  rehydrateFromDisk();
}

/** Flush pending save synchronously. For testing only. */
export function _flushForTesting(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  try {
    const dir = join(process.cwd(), 'data');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const store: PersistedStore = {
      version: 1,
      states: Object.fromEntries(states),
      pendingContent: Object.fromEntries(pendingContentStore),
      savedAt: new Date().toISOString(),
    };
    writeFileSync(STATE_FILE, JSON.stringify(store, persistReplacer, 2), 'utf-8');
  } catch (error) {
    logger.warn('[ConversationState] Test flush failed', { error });
  }
}

/** Reset rehydration flag. For testing only. */
export function _resetRehydrationFlag(): void {
  rehydrated = false;
}

/** Get the state file path. For testing only. */
export function _getStateFilePath(): string {
  return STATE_FILE;
}
