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

import { logger } from '../logger';
import type { RequestAssessment, AssessmentContext } from '../../../../packages/agents/src/assessment/types';
import type { ApproachProposal } from '../../../../packages/agents/src/assessment/types';
import type { DialogueState } from '../../../../packages/agents/src/dialogue/types';
import type { SocraticQuestion, ContextSignals } from '../../../../packages/agents/src/socratic';
import type { GoalContext, ContentAnalysis as GoalContentAnalysis, GoalTracker } from '../../../../packages/agents/src/goal';
import type { ResolvedContext } from '../../../../packages/agents/src/socratic';
import type { TriageResult } from '../cognitive/triage-skill';
import type { UrlContent } from '../types';

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
export type ActivePhase = 'idle' | 'socratic' | 'dialogue' | 'approval' | 'goal-clarification';

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

/**
 * Get or create a conversation state for a chat.
 * If an existing state is expired, creates a fresh one.
 */
export function getOrCreateState(chatId: number, userId: number): ConversationState {
  const existing = states.get(chatId);
  if (existing && !isExpired(existing)) {
    return existing;
  }

  const state: ConversationState = {
    chatId,
    userId,
    phase: 'idle',
    createdAt: Date.now(),
    lastActivity: Date.now(),
  };
  states.set(chatId, state);
  return state;
}

/**
 * Get a conversation state by chat ID. Returns undefined if not found or expired.
 */
export function getState(chatId: number): ConversationState | undefined {
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
  return state;
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
}

/**
 * Get content context for a chat. Returns undefined if not found or expired.
 */
export function getContentContext(chatId: number): ContentContext | undefined {
  const state = getState(chatId);
  return state?.contentContext;
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
    state.lastActivity = Date.now();
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
}

// ─── Internal ───────────────────────────────────────────

function isExpired(state: ConversationState): boolean {
  return Date.now() - state.lastActivity > STATE_TTL_MS;
}
