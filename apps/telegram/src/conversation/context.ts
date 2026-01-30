/**
 * Atlas Telegram Bot - Conversation Context
 *
 * Manages conversation state, loading/saving conversation history.
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { logger } from '../logger';

const DATA_DIR = join(__dirname, '../../data');
const CONVERSATIONS_DIR = join(DATA_DIR, 'conversations');
const MAX_MESSAGES = 20; // Context window size

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  metadata?: {
    pillar?: string;
    requestType?: string;
    feedId?: string;
    workQueueId?: string;
    toolsUsed?: string[];  // Track which tools were invoked
  };
}

export interface ConversationState {
  userId: number;
  messages: ConversationMessage[];
  lastUpdated: string;
  sessionStarted: string;
}

/**
 * Get conversation state for a user
 */
export async function getConversation(userId: number): Promise<ConversationState> {
  const filePath = join(CONVERSATIONS_DIR, `${userId}.json`);

  try {
    const data = await readFile(filePath, 'utf-8');
    const state = JSON.parse(data) as ConversationState;

    // Trim to max messages
    if (state.messages.length > MAX_MESSAGES) {
      state.messages = state.messages.slice(-MAX_MESSAGES);
    }

    return state;
  } catch {
    // New conversation
    return {
      userId,
      messages: [],
      lastUpdated: new Date().toISOString(),
      sessionStarted: new Date().toISOString(),
    };
  }
}

/**
 * Save conversation state
 */
export async function saveConversation(state: ConversationState): Promise<void> {
  const filePath = join(CONVERSATIONS_DIR, `${state.userId}.json`);

  try {
    await mkdir(CONVERSATIONS_DIR, { recursive: true });

    // Trim to max messages before saving
    if (state.messages.length > MAX_MESSAGES) {
      state.messages = state.messages.slice(-MAX_MESSAGES);
    }

    state.lastUpdated = new Date().toISOString();
    await writeFile(filePath, JSON.stringify(state, null, 2));
  } catch (error) {
    logger.error('Failed to save conversation', { userId: state.userId, error });
  }
}

/**
 * Add a message to conversation and save
 */
export async function updateConversation(
  userId: number,
  userMessage: string,
  assistantResponse: string,
  metadata?: ConversationMessage['metadata']
): Promise<void> {
  const state = await getConversation(userId);

  state.messages.push({
    role: 'user',
    content: userMessage,
    timestamp: new Date().toISOString(),
    metadata,
  });

  state.messages.push({
    role: 'assistant',
    content: assistantResponse,
    timestamp: new Date().toISOString(),
    metadata,
  });

  await saveConversation(state);
}

/**
 * Clear conversation for a user
 */
export async function clearConversation(userId: number): Promise<void> {
  const state: ConversationState = {
    userId,
    messages: [],
    lastUpdated: new Date().toISOString(),
    sessionStarted: new Date().toISOString(),
  };

  await saveConversation(state);
  logger.info('Conversation cleared', { userId });
}

/**
 * Build messages array for Claude API from conversation state
 */
export function buildMessages(
  conversation: ConversationState,
  currentMessage: string
): Array<{ role: 'user' | 'assistant'; content: string }> {
  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  // Add history (filter out empty messages)
  for (const msg of conversation.messages) {
    // Skip empty messages - Claude API rejects them
    if (!msg.content || msg.content.trim().length === 0) {
      continue;
    }
    messages.push({
      role: msg.role,
      content: msg.content,
    });
  }

  // Add current message (only if non-empty)
  const trimmedCurrent = currentMessage?.trim() || '';
  if (trimmedCurrent.length > 0) {
    messages.push({
      role: 'user',
      content: trimmedCurrent,
    });
  }

  return messages;
}
