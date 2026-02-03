/**
 * Dispatch Choice - Low-Confidence Routing Decision Keyboard
 *
 * When Atlas is uncertain about routing (< 85% confidence), presents
 * an inline keyboard for Jim to choose between:
 * - Pit Crew (engineering work: bugs, features)
 * - Work Queue (operational work: research, content)
 *
 * This prevents misrouting when the task type is ambiguous.
 */

import { InlineKeyboard } from 'grammy';
import { logger } from '../logger';

/**
 * Pending dispatch awaiting routing choice
 */
export interface PendingDispatch {
  requestId: string;
  chatId: number;
  userId: number;
  messageId?: number;        // Original message ID
  choiceMessageId?: number;  // Choice message ID (for editing)

  // Original submit_ticket parameters
  reasoning: string;
  title: string;
  description: string;
  priority: 'P0' | 'P1' | 'P2';
  requireReview: boolean;
  pillar: string;

  // Confidence info
  routingConfidence: number;
  suggestedCategory: string;
  alternativeCategory: string;

  // Metadata
  timestamp: number;
}

/**
 * In-memory store for pending dispatch choices
 * Key: requestId (unique per choice flow)
 */
const pendingDispatches = new Map<string, PendingDispatch>();

// Auto-expire pending choices after 5 minutes
const EXPIRY_MS = 5 * 60 * 1000;

/**
 * Generate a unique request ID for dispatch choice
 */
export function generateDispatchChoiceId(): string {
  return `dispatch-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
}

/**
 * Store pending dispatch for choice
 */
export function storePendingDispatch(dispatch: PendingDispatch): void {
  pendingDispatches.set(dispatch.requestId, dispatch);

  // Schedule auto-cleanup
  setTimeout(() => {
    if (pendingDispatches.has(dispatch.requestId)) {
      pendingDispatches.delete(dispatch.requestId);
      logger.debug('Expired pending dispatch choice', { requestId: dispatch.requestId });
    }
  }, EXPIRY_MS);

  logger.info('Stored pending dispatch for routing choice', {
    requestId: dispatch.requestId,
    confidence: dispatch.routingConfidence,
    suggested: dispatch.suggestedCategory,
    alternative: dispatch.alternativeCategory,
  });
}

/**
 * Retrieve pending dispatch by request ID
 */
export function getPendingDispatch(requestId: string): PendingDispatch | undefined {
  return pendingDispatches.get(requestId);
}

/**
 * Remove pending dispatch (after choice made)
 */
export function removePendingDispatch(requestId: string): boolean {
  return pendingDispatches.delete(requestId);
}

/**
 * Map category to destination description
 */
function getCategoryDescription(category: string): { icon: string; label: string; desc: string } {
  const map: Record<string, { icon: string; label: string; desc: string }> = {
    dev_bug: { icon: '🐛', label: 'Pit Crew (Bug)', desc: 'Fix broken functionality' },
    feature: { icon: '✨', label: 'Pit Crew (Feature)', desc: 'New capability' },
    research: { icon: '🔍', label: 'Work Queue (Research)', desc: 'Investigation task' },
    content: { icon: '📝', label: 'Work Queue (Content)', desc: 'Writing/drafting task' },
  };
  return map[category] || { icon: '📋', label: category, desc: '' };
}

/**
 * Format the routing choice message
 */
export function formatRoutingChoiceMessage(pending: PendingDispatch): string {
  const suggested = getCategoryDescription(pending.suggestedCategory);
  const alternative = getCategoryDescription(pending.alternativeCategory);

  let message = `⚠️ <b>Routing Confidence: ${pending.routingConfidence}%</b>\n\n`;
  message += `<b>Task:</b> ${pending.title}\n\n`;
  message += `I'm not confident about the best pipeline for this. Please choose:\n\n`;
  message += `${suggested.icon} <b>${suggested.label}</b>\n<i>${suggested.desc}</i>\n\n`;
  message += `${alternative.icon} <b>${alternative.label}</b>\n<i>${alternative.desc}</i>`;

  return message;
}

/**
 * Build the routing choice inline keyboard
 *
 * Layout:
 * [🐛 Pit Crew] [📋 Work Queue]
 * [❌ Cancel]
 */
export function buildRoutingChoiceKeyboard(
  requestId: string,
  suggestedCategory: string,
  alternativeCategory: string
): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  const suggested = getCategoryDescription(suggestedCategory);
  const alternative = getCategoryDescription(alternativeCategory);

  // Main choice row - show both options
  keyboard.text(`${suggested.icon} ${suggested.label}`, `dispatch:${requestId}:route:${suggestedCategory}`);
  keyboard.text(`${alternative.icon} ${alternative.label}`, `dispatch:${requestId}:route:${alternativeCategory}`);
  keyboard.row();

  // Cancel option
  keyboard.text('❌ Cancel', `dispatch:${requestId}:cancel`);

  return keyboard;
}

/**
 * Parse callback data from keyboard press
 */
export function parseDispatchCallbackData(data: string): {
  requestId: string;
  action: 'route' | 'cancel';
  category?: string;
} | null {
  if (!data.startsWith('dispatch:')) return null;

  const parts = data.split(':');
  if (parts.length < 3) return null;

  const [, requestId, action, category] = parts;

  if (!['route', 'cancel'].includes(action)) return null;

  return {
    requestId,
    action: action as 'route' | 'cancel',
    category,
  };
}

/**
 * Check if a callback query is for dispatch choice
 */
export function isDispatchCallback(data: string | undefined): boolean {
  return data?.startsWith('dispatch:') ?? false;
}

/**
 * Get count of pending dispatch choices (for debugging)
 */
export function getPendingDispatchCount(): number {
  return pendingDispatches.size;
}
