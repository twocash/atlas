/**
 * Conversation Context Manager
 *
 * Manages injected context for conversations - allows Notion pages,
 * documents, and other content to be added to the conversation context
 * for Claude to reference.
 */

import { logger } from '../logger';

/**
 * A context message to inject into conversation
 */
export interface ContextMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  source?: string;  // Where this context came from
  timestamp?: number;
}

/**
 * User's conversation context
 */
interface UserContext {
  messages: ContextMessage[];
  lastAccessed: number;
}

// Store context per user (in-memory, cleared on restart)
const userContexts = new Map<number, UserContext>();

// Max context messages per user (to prevent memory bloat)
const MAX_CONTEXT_MESSAGES = 10;

// Context TTL (2 hours)
const CONTEXT_TTL = 2 * 60 * 60 * 1000;

/**
 * Add a message to user's conversation context
 */
export function addToConversationContext(
  userId: number,
  message: ContextMessage
): void {
  let context = userContexts.get(userId);

  if (!context) {
    context = { messages: [], lastAccessed: Date.now() };
    userContexts.set(userId, context);
  }

  // Add timestamp if not provided
  message.timestamp = message.timestamp || Date.now();

  // Add to context
  context.messages.push(message);
  context.lastAccessed = Date.now();

  // Trim if over limit (keep most recent)
  if (context.messages.length > MAX_CONTEXT_MESSAGES) {
    context.messages = context.messages.slice(-MAX_CONTEXT_MESSAGES);
  }

  logger.debug('Added to conversation context', {
    userId,
    role: message.role,
    source: message.source,
    contentLength: message.content.length,
    totalMessages: context.messages.length,
  });
}

/**
 * Get all context messages for a user
 */
export function getConversationContext(userId: number): ContextMessage[] {
  const context = userContexts.get(userId);
  if (!context) return [];

  // Update last accessed
  context.lastAccessed = Date.now();

  return context.messages;
}

/**
 * Get context as a formatted string for injection into prompts
 */
export function getFormattedContext(userId: number): string {
  const messages = getConversationContext(userId);
  if (messages.length === 0) return '';

  return messages
    .map(m => m.content)
    .join('\n\n---\n\n');
}

/**
 * Clear context for a user
 */
export function clearConversationContext(userId: number): void {
  userContexts.delete(userId);
  logger.debug('Cleared conversation context', { userId });
}

/**
 * Check if user has any injected context
 */
export function hasConversationContext(userId: number): boolean {
  const context = userContexts.get(userId);
  return context !== undefined && context.messages.length > 0;
}

/**
 * Clean up expired contexts (called periodically)
 */
export function cleanupExpiredContexts(): number {
  const cutoff = Date.now() - CONTEXT_TTL;
  let cleaned = 0;

  for (const [userId, context] of userContexts) {
    if (context.lastAccessed < cutoff) {
      userContexts.delete(userId);
      cleaned++;
    }
  }

  if (cleaned > 0) {
    logger.info('Cleaned up expired conversation contexts', { cleaned });
  }

  return cleaned;
}

/**
 * Get context stats (for debugging)
 */
export function getContextStats(): {
  totalUsers: number;
  totalMessages: number;
} {
  let totalMessages = 0;
  for (const context of userContexts.values()) {
    totalMessages += context.messages.length;
  }

  return {
    totalUsers: userContexts.size,
    totalMessages,
  };
}
