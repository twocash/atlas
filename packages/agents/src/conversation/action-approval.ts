/**
 * Action Approval — Butler-Style Jidoka
 *
 * Approval gate for action intents. Feels like a butler, not an alarm bell.
 * Yellow zone (default): one-line confirmation before execution.
 * Green zone (pattern confirmed N times): silent auto-execute.
 *
 * Sprint: ACTION-INTENT (Slice 3)
 */

import { generatePatternKey, getCachedTriage } from '../cognitive/triage-patterns';
import { logger } from '../logger';

// ─── Constants ──────────────────────────────────────────

/** Number of confirmations before pattern promotes to Green (auto-execute). */
const ACTION_GREEN_THRESHOLD = 5;

// ─── Types ──────────────────────────────────────────────

export interface ActionApprovalContext {
  /** Where the action targets (e.g., "gemini.google.com") */
  destination: string;
  /** What to do there (e.g., "ask it about X") */
  task: string;
  /** Normalized key for Flywheel/pattern lookup */
  patternKey: string;
  /** Permission zone based on pattern history */
  zone: 'green' | 'yellow';
  /** How many times this pattern has been confirmed */
  confirmationCount: number;
  /** The original message text (needed for recordTriageFeedback) */
  originalMessage: string;
}

// ─── Destination/Task Extraction ────────────────────────

/**
 * Extract destination and task from a message classified as action intent.
 *
 * Patterns:
 *   "go to gemini.google.com and ask it about X" → { dest: "gemini.google.com", task: "ask it about X" }
 *   "check my email" → { dest: "email", task: "check" }
 *   "open the Notion page" → { dest: "Notion", task: "open" }
 */
export function extractActionParts(messageText: string): { destination: string; task: string } {
  const text = messageText.trim();

  // Try URL extraction first
  const urlMatch = text.match(/https?:\/\/(?:www\.)?([^\/\s]+)/i);
  if (urlMatch) {
    const domain = urlMatch[1];
    // Everything after "and" or after the URL is the task
    const urlEnd = text.indexOf(urlMatch[0]) + urlMatch[0].length;
    const remainder = text.slice(urlEnd).replace(/^\s*and\s+/i, '').trim();
    return {
      destination: domain,
      task: remainder || 'visit',
    };
  }

  // Try "go to <destination>" pattern (no URL)
  const goToMatch = text.match(/(?:go\s+to|visit|open|navigate\s+to|pull\s+up|check)\s+(?:the\s+)?(.+?)(?:\s+and\s+(.+))?$/i);
  if (goToMatch) {
    return {
      destination: goToMatch[1].trim(),
      task: goToMatch[2]?.trim() || goToMatch[0].match(/^(\w+)/)?.[1] || 'open',
    };
  }

  // Fallback: first significant word is the verb, rest is destination
  const words = text.split(/\s+/);
  if (words.length >= 2) {
    return {
      destination: words.slice(1).join(' '),
      task: words[0],
    };
  }

  return { destination: text, task: 'execute' };
}

// ─── Zone Resolution ────────────────────────────────────

/**
 * Resolve the approval zone for an action pattern.
 *
 * Green: pattern has been confirmed >= ACTION_GREEN_THRESHOLD times.
 * Yellow: everything else (including first encounter).
 */
export function resolveActionZone(patternKey: string): { zone: 'green' | 'yellow'; confirmationCount: number } {
  const cached = getCachedTriage(patternKey);

  // getCachedTriage returns non-null only when threshold is met
  // (confirmCount >= 5 && correctionCount === 0, or confirmCount >= 10 with low correction ratio)
  if (cached) {
    return { zone: 'green', confirmationCount: ACTION_GREEN_THRESHOLD };
  }

  return { zone: 'yellow', confirmationCount: 0 };
}

/**
 * Build the full ActionApprovalContext from a message.
 */
export function buildActionApprovalContext(messageText: string): ActionApprovalContext {
  const { destination, task } = extractActionParts(messageText);
  const patternKey = generatePatternKey(messageText);
  const { zone, confirmationCount } = resolveActionZone(patternKey);

  return {
    destination,
    task,
    patternKey,
    zone,
    confirmationCount,
    originalMessage: messageText,
  };
}

// ─── Butler Message ─────────────────────────────────────

/**
 * Build the butler-style approval message.
 *
 * Returns null for Green zone (auto-execute, no message).
 * Returns a one-sentence confirmation for Yellow zone.
 */
export function buildActionApprovalMessage(ctx: ActionApprovalContext): string | null {
  if (ctx.zone === 'green') return null;

  const isRepeat = ctx.confirmationCount > 0;
  if (isRepeat) {
    return `Going to ${ctx.destination} again - ${ctx.task}. Reply 1 to confirm.`;
  }
  return `I can go to ${ctx.destination} and ${ctx.task}. Reply 1 to proceed.`;
}

// ─── Confirmation Check ─────────────────────────────────

/**
 * Check if a message is a confirmation reply to a pending action.
 */
export function isActionConfirmation(messageText: string): boolean {
  const trimmed = messageText.trim().toLowerCase();
  return trimmed === '1' || trimmed === 'yes' || trimmed === 'y' || trimmed === 'go';
}
