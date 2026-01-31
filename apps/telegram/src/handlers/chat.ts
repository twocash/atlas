/**
 * Atlas Telegram Bot - Chat Handler
 *
 * Handles chat intent: conversational, unclear, general chat
 * Now with optional cognitive router integration.
 */

import type { Context } from "grammy";
import type { IntentDetectionResult } from "../types";
import type { ModelId } from "../cognitive/models";
import { generateResponse, generateResponseWithTools } from "../claude";
import { supervise, getQuickResponse as cognitiveQuickResponse } from "../cognitive";
import { getModelOverride } from "../session";
import { logger } from "../logger";
import { audit } from "../audit";

// Feature flag for cognitive router (enable when ready)
const USE_COGNITIVE_ROUTER = process.env.USE_COGNITIVE_ROUTER === "true";

// Simple conversation history per user (in-memory)
const conversationHistory = new Map<number, Array<{ role: "user" | "assistant"; content: string }>>();

/**
 * Handle chat intent - conversational response
 */
export async function handleChatIntent(
  ctx: Context,
  _intentResult: IntentDetectionResult
): Promise<void> {
  const userId = ctx.from!.id;
  const text = ctx.message?.text || "";

  logger.info("Processing chat intent", { userId, text: text.substring(0, 100) });

  await ctx.replyWithChatAction("typing");

  // Check for quick responses first (no LLM needed)
  const quickResponse = getQuickResponse(text);
  if (quickResponse) {
    await ctx.reply(quickResponse);
    audit.logResponse(userId, quickResponse);
    return;
  }

  try {
    let response: string;

    if (USE_COGNITIVE_ROUTER) {
      // Use cognitive router for intelligent model selection
      response = await handleWithCognitiveRouter(text, userId);
    } else {
      // Use existing tool-aware response
      response = await handleWithLegacyRouter(text, userId);
    }

    // Update conversation history
    const history = conversationHistory.get(userId) || [];
    history.push({ role: "user", content: text });
    history.push({ role: "assistant", content: response });

    // Keep only last 10 exchanges
    if (history.length > 20) {
      history.splice(0, history.length - 20);
    }
    conversationHistory.set(userId, history);

    await ctx.reply(response);
    audit.logResponse(userId, response);
  } catch (error) {
    logger.error("Chat response failed", { error });
    await ctx.reply("I'm here. What do you need?");
  }
}

/**
 * Handle chat with cognitive router
 */
async function handleWithCognitiveRouter(text: string, userId: number): Promise<string> {
  const history = conversationHistory.get(userId) || [];

  // Check for session model override
  const modelOverride = getModelOverride(userId);
  const forceModel = modelOverride !== "auto" ? modelOverride as ModelId : undefined;

  const result = await supervise({
    input: text,
    conversationHistory: history,
    userId,
    forceModel,
  });

  if (result.needsReview) {
    // Return the review reason to user
    return result.reviewReason || "This action requires approval.";
  }

  if (!result.success) {
    logger.warn("Cognitive router returned failure", {
      taskId: result.taskId,
      content: result.content,
    });
    return result.content || "Something went wrong. Try again?";
  }

  // Log token usage
  if (result.totalCost > 0) {
    logger.debug("Cognitive router cost", {
      taskId: result.taskId,
      cost: result.totalCost.toFixed(6),
      latency: result.totalLatencyMs,
    });
  }

  return result.content;
}

/**
 * Handle chat with legacy router (existing implementation)
 */
async function handleWithLegacyRouter(text: string, userId: number): Promise<string> {
  const history = conversationHistory.get(userId) || [];

  // Detect if this might need tools (looks like a data query)
  const mightNeedTools = /\b(feed|queue|work|status|tasks?|items?|what'?s|show|list|urgent|p0|priority|focus|should|blocked|atlas|how'?s)\b/i.test(text);

  // Use tool-aware response if message hints at needing data
  return mightNeedTools
    ? await generateResponseWithTools(text, history)
    : await generateResponse(text, history);
}

/**
 * Get quick response for common messages
 */
function getQuickResponse(text: string): string | null {
  // Try cognitive router's quick response first
  const cognitiveResponse = cognitiveQuickResponse(text);
  if (cognitiveResponse) {
    return cognitiveResponse;
  }

  const lowerText = text.toLowerCase().trim();

  // Help
  if (/^(help|help me|\?)$/.test(lowerText)) {
    return `I can help with:
- Share a URL to capture
- "what's in my feed?" to see items
- "status" for overview
- "find [term]" to search
- "mark [item] as done" to update`;
  }

  return null;
}

/**
 * Clear conversation history for a user
 */
export function clearConversationHistory(userId: number): void {
  conversationHistory.delete(userId);
  logger.debug("Cleared conversation history", { userId });
}
