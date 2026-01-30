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

  // Action callbacks
  if (data.startsWith("action_")) {
    await handleActionCallback(ctx, data);
    return;
  }

  // Spark callbacks (default)
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
};
