/**
 * Atlas Telegram Bot - Intent Router
 *
 * Routes messages to appropriate handlers based on detected intent.
 */

import type { Context } from "grammy";
import type { IntentDetectionResult } from "../types";
import { detectIntent } from "../intent";
import { handleSparkIntent, handleSparkCallback, cleanupPendingSparkClarifications } from "./spark";
import { handleQueryIntent } from "./query";
import { handleStatusIntent } from "./status";
import { handleLookupIntent } from "./lookup";
import { handleActionIntent, handleActionCallback, cleanupPendingActions } from "./action";
import { handleChatIntent, clearConversationHistory } from "./chat";
import { handleVoiceCallback } from "./voice-callback";
import { handleContentCallback } from "./content-callback";
import { handleIntentCallback } from "./intent-callback";
import { handleDispatchCallback } from "./dispatch-callback";
import { handleNotionCallback, handleNotionStatusUpdate } from "./notion-callback";
import { handleSkillCallback, isSkillCallback } from "./skill-callback";
import {
  handlePromptSelectionCallback,
  isPromptSelectionCallback,
  startPromptSelection,
} from "./prompt-selection-callback";
import { isContentCallback, isIntentCallback } from "../conversation/content-confirm";
import { isDispatchCallback } from "../conversation/dispatch-choice";
import { isNotionCallback } from "../conversation/notion-url";
import { logger } from "../logger";
import { audit } from "../audit";
import { updateState, getState, updateHeartbeat } from "../atlas-system";

/**
 * Route a message to the appropriate handler based on intent
 */
export async function routeMessage(ctx: Context): Promise<void> {
  const userId = ctx.from!.id;
  const text = ctx.message?.text || "";

  // Detect intent
  const intentResult = await detectIntent(text);

  logger.info("Routing intent", {
    userId,
    intent: intentResult.intent,
    confidence: intentResult.confidence,
    text: text.substring(0, 50),
  });

  // Log the routing decision
  audit.log({
    userId,
    username: ctx.from?.username,
    messageType: "intent_route",
    content: `${intentResult.intent} (${intentResult.confidence}%): ${text.substring(0, 100)}`,
    timestamp: new Date(),
  });

  // Route to appropriate handler
  await routeIntent(ctx, intentResult);

  // Update stats
  const state = getState();
  updateState({
    stats: {
      ...state.stats,
      messagesHandled: state.stats.messagesHandled + 1,
    }
  });
  updateHeartbeat({ status: "healthy", pendingWork: 0 });
}

/**
 * Route to handler based on intent result
 */
async function routeIntent(
  ctx: Context,
  intentResult: IntentDetectionResult
): Promise<void> {
  switch (intentResult.intent) {
    case "spark":
      await handleSparkIntent(ctx, intentResult);
      break;

    case "query":
      await handleQueryIntent(ctx, intentResult);
      break;

    case "status":
      await handleStatusIntent(ctx, intentResult);
      break;

    case "lookup":
      await handleLookupIntent(ctx, intentResult);
      break;

    case "action":
      await handleActionIntent(ctx, intentResult);
      break;

    case "chat":
    default:
      await handleChatIntent(ctx, intentResult);
      break;
  }
}

/**
 * Route callback queries to appropriate handler
 */
export async function routeCallback(ctx: Context): Promise<void> {
  const data = ctx.callbackQuery?.data || "";

  logger.debug("Routing callback", { data });

  // Prompt selection callbacks (V3 Pillar → Action → Voice flow)
  if (isPromptSelectionCallback(data)) {
    await handlePromptSelectionCallback(ctx);
    return;
  }

  // Voice selection callbacks
  if (data.startsWith("voice:")) {
    await handleVoiceCallback(ctx);
    return;
  }

  // Notion URL callbacks (object-aware handling)
  if (isNotionCallback(data)) {
    // Check if it's a status update (nested callback)
    if (data.includes(':status:')) {
      await handleNotionStatusUpdate(ctx);
    } else {
      await handleNotionCallback(ctx);
    }
    return;
  }

  // Intent-first capture callbacks (Phase 1)
  if (isIntentCallback(data)) {
    await handleIntentCallback(ctx);
    return;
  }

  // Content classification callbacks (Universal Content Analysis — legacy)
  if (isContentCallback(data)) {
    await handleContentCallback(ctx);
    return;
  }

  // Dispatch routing choice callbacks (low-confidence routing)
  if (isDispatchCallback(data)) {
    await handleDispatchCallback(ctx);
    return;
  }

  // Skill approval/rejection callbacks (Phase 3)
  if (isSkillCallback(data)) {
    await handleSkillCallback(ctx as any);
    return;
  }

  // Action callbacks
  if (data.startsWith("action_")) {
    await handleActionCallback(ctx, data);
    return;
  }

  // UNKNOWN CALLBACK - No handler matched
  // This used to fall back to handleSparkCallback, but V3 flow uses ps:* callbacks.
  // If we get here, it's either:
  // 1. A bug in callback routing (missing pattern)
  // 2. Stale UI with old callback format
  // 3. New callback pattern that needs handling
  logger.error("[CALLBACK] Unhandled callback - no routing pattern matched", {
    data,
    userId: ctx.from?.id,
    chatId: ctx.chat?.id,
  });

  // Invoke deprecated handler which will throw with full context
  await handleSparkCallback(ctx);
}

/**
 * Clean up all pending operations
 */
export function cleanupAll(maxAgeMinutes: number = 30): void {
  cleanupPendingSparkClarifications(maxAgeMinutes);
  cleanupPendingActions(Math.min(maxAgeMinutes, 5)); // Actions timeout faster
}

/**
 * Clear session for a user
 */
export function clearUserSession(userId: number): void {
  clearConversationHistory(userId);
  logger.info("Cleared user session", { userId });
}

// Re-export handlers for direct use if needed
export {
  handleSparkIntent,
  handleSparkCallback,
  handleQueryIntent,
  handleStatusIntent,
  handleLookupIntent,
  handleActionIntent,
  handleActionCallback,
  handleChatIntent,
  handleVoiceCallback,
  handleContentCallback,
  handleIntentCallback,
  handlePromptSelectionCallback,
  startPromptSelection,
};
