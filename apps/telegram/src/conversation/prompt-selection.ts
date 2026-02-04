/**
 * Prompt Selection State Management
 *
 * Manages pending prompt selection flows for the Telegram adapter.
 * Uses in-memory Map with TTL for automatic cleanup.
 */

import type {
  PromptSelectionState,
  Pillar,
  ActionType,
} from '../../../../packages/agents/src/services/prompt-composition';

// ==========================================
// Configuration
// ==========================================

/** TTL for pending selections (5 minutes) - mobile users don't wait */
const SELECTION_TTL_MS = 5 * 60 * 1000;

// ==========================================
// State Storage
// ==========================================

/**
 * In-memory storage for pending selections
 * Key: requestId (UUID)
 * Value: PromptSelectionState
 */
const pendingSelections = new Map<string, PromptSelectionState>();

/**
 * Timeout handles for automatic cleanup
 */
const cleanupTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

// ==========================================
// Public API
// ==========================================

/**
 * Generate a unique request ID for a new selection flow
 */
export function generateRequestId(): string {
  return crypto.randomUUID().slice(0, 8); // Short ID for callback data
}

/**
 * Create and store a new prompt selection state
 *
 * @param params - Initial state parameters
 * @returns The stored state with requestId
 */
export function createSelection(params: {
  chatId: number;
  userId: number;
  content: string;
  contentType: 'url' | 'text';
  title?: string;
  messageId?: number;
}): PromptSelectionState {
  const requestId = generateRequestId();
  const now = Date.now();

  const state: PromptSelectionState = {
    requestId,
    chatId: params.chatId,
    userId: params.userId,
    messageId: params.messageId,
    content: params.content,
    contentType: params.contentType,
    title: params.title,
    step: 'pillar',
    timestamp: now,
    expiresAt: now + SELECTION_TTL_MS,
  };

  storeSelection(state);
  return state;
}

/**
 * Store a selection state with automatic TTL cleanup
 */
export function storeSelection(state: PromptSelectionState): void {
  // Clear any existing timeout for this requestId
  const existingTimeout = cleanupTimeouts.get(state.requestId);
  if (existingTimeout) {
    clearTimeout(existingTimeout);
  }

  // Update expiration
  state.expiresAt = Date.now() + SELECTION_TTL_MS;

  // Store the state
  pendingSelections.set(state.requestId, state);

  // Set up auto-cleanup
  const timeout = setTimeout(() => {
    pendingSelections.delete(state.requestId);
    cleanupTimeouts.delete(state.requestId);
  }, SELECTION_TTL_MS);

  cleanupTimeouts.set(state.requestId, timeout);
}

/**
 * Get a selection state by requestId
 *
 * @returns The state or undefined if not found/expired
 */
export function getSelection(requestId: string): PromptSelectionState | undefined {
  const state = pendingSelections.get(requestId);

  // Check if expired
  if (state && state.expiresAt < Date.now()) {
    removeSelection(requestId);
    return undefined;
  }

  return state;
}

/**
 * Update a selection state
 *
 * @param requestId - The selection to update
 * @param updates - Partial state updates
 * @returns The updated state or undefined if not found
 */
export function updateSelection(
  requestId: string,
  updates: Partial<Pick<PromptSelectionState,
    'step' | 'pillar' | 'action' | 'voice' | 'messageId' |
    'suggestedAction' | 'suggestedVoice' | 'acceptedShortcut'
  >>
): PromptSelectionState | undefined {
  const state = getSelection(requestId);
  if (!state) {
    return undefined;
  }

  // Apply updates
  Object.assign(state, updates);

  // Refresh TTL by re-storing
  storeSelection(state);

  return state;
}

/**
 * Update pillar selection and advance to action step
 */
export function selectPillar(
  requestId: string,
  pillar: Pillar
): PromptSelectionState | undefined {
  return updateSelection(requestId, {
    pillar,
    step: 'action',
  });
}

/**
 * Update action selection and advance to voice step
 */
export function selectAction(
  requestId: string,
  action: ActionType
): PromptSelectionState | undefined {
  return updateSelection(requestId, {
    action,
    step: 'voice',
  });
}

/**
 * Update voice selection and advance to confirm step
 */
export function selectVoice(
  requestId: string,
  voice: string
): PromptSelectionState | undefined {
  return updateSelection(requestId, {
    voice,
    step: 'confirm',
  });
}

/**
 * Remove a selection state (cancel or complete)
 */
export function removeSelection(requestId: string): boolean {
  const existed = pendingSelections.delete(requestId);

  // Clear timeout
  const timeout = cleanupTimeouts.get(requestId);
  if (timeout) {
    clearTimeout(timeout);
    cleanupTimeouts.delete(requestId);
  }

  return existed;
}

/**
 * Check if a selection exists and is valid
 */
export function hasSelection(requestId: string): boolean {
  return getSelection(requestId) !== undefined;
}

/**
 * Get all pending selections (for debugging/admin)
 */
export function getAllSelections(): PromptSelectionState[] {
  const now = Date.now();
  const valid: PromptSelectionState[] = [];

  for (const [id, state] of pendingSelections) {
    if (state.expiresAt > now) {
      valid.push(state);
    } else {
      // Clean up expired
      removeSelection(id);
    }
  }

  return valid;
}

/**
 * Get count of pending selections
 */
export function getPendingCount(): number {
  return pendingSelections.size;
}

/**
 * Clean up all expired selections
 * Called periodically or on demand
 */
export function cleanupExpired(): number {
  const now = Date.now();
  let cleaned = 0;

  for (const [id, state] of pendingSelections) {
    if (state.expiresAt < now) {
      removeSelection(id);
      cleaned++;
    }
  }

  return cleaned;
}

/**
 * Clear all pending selections (for testing/reset)
 */
export function clearAllSelections(): void {
  // Clear all timeouts
  for (const timeout of cleanupTimeouts.values()) {
    clearTimeout(timeout);
  }

  pendingSelections.clear();
  cleanupTimeouts.clear();
}
