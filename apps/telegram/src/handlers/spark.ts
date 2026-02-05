/**
 * Atlas Telegram Bot - Spark Handler
 *
 * Handles spark intent: URL capture, classification, and Notion routing.
 * Uses V3 Progressive Profiling (Pillar → Action → Voice) flow.
 *
 * MIGRATION NOTE (2026-02-05):
 * Old callback handlers (handleSparkCallback, handleSparkConfirm, handleSparkDismiss)
 * have been removed. All spark capture now uses the V3 prompt selection flow via
 * startPromptSelection() from prompt-selection-callback.ts.
 *
 * If you see errors about missing handleSparkCallback, update the calling code
 * to use the new V3 flow.
 */

import type { Context } from "grammy";
import type {
  Spark,
  ClassificationResult,
  UrlContent,
  IntentDetectionResult,
} from "../types";
import { extractFirstUrl, fetchUrlContent, getUrlDomain } from "../url";
import { classifyWithClaude } from "../claude";
import { logger } from "../logger";
import { audit } from "../audit";
import { startPromptSelection } from "./prompt-selection-callback";

// Use Claude for classification
const USE_CLAUDE = process.env.USE_CLAUDE !== "false";

/**
 * Handle spark intent - capture URL/content to Notion
 *
 * Flow:
 * 1. Extract URL if present
 * 2. Fetch URL content (if URL)
 * 3. Classify with Claude (optional)
 * 4. Start V3 prompt selection flow (Pillar → Action → Voice)
 */
export async function handleSparkIntent(
  ctx: Context,
  intentResult: IntentDetectionResult
): Promise<void> {
  const userId = ctx.from!.id;
  const text = ctx.message?.text || "";

  logger.info("Processing spark intent", { userId, text: text.substring(0, 100) });

  // Create spark object (for logging/tracking)
  const spark: Spark = {
    id: `spark_${Date.now()}`,
    source: "Telegram",
    content: text,
    receivedAt: new Date(),
  };

  // Check for URL (may already be in entities)
  const url = intentResult.entities?.url || extractFirstUrl(text);
  let urlContent: UrlContent | undefined;
  let title: string | undefined;

  if (url) {
    spark.url = url;

    // Fetch URL content
    await ctx.replyWithChatAction("typing");
    urlContent = await fetchUrlContent(url);
    spark.urlContent = urlContent;

    if (urlContent.success) {
      title = urlContent.title;
    } else {
      // URL fetch failed - still proceed with V3 flow, just note the failure
      logger.warn("URL fetch failed, proceeding with V3 flow", {
        url,
        error: urlContent.error,
      });
      title = `${getUrlDomain(url)} (fetch failed)`;
    }
  }

  // Classify the spark (optional, for suggested title)
  await ctx.replyWithChatAction("typing");

  let classification: ClassificationResult;
  if (USE_CLAUDE) {
    classification = await classifyWithClaude(text, urlContent);
  } else {
    // Simple fallback classification
    classification = {
      pillar: "The Grove",
      intent: "Reference",
      confidence: 50,
      reasoning: "Heuristic classification",
      tags: [],
      suggestedTitle: urlContent?.title || text.substring(0, 100),
    };
  }

  spark.classification = classification;

  // Use classification title if we don't have one from URL
  if (!title) {
    title = classification.suggestedTitle;
  }

  // V3 PROGRESSIVE PROFILING: Start the Pillar → Action → Voice flow
  const contentType = url ? 'url' : 'text';
  const content = url || text;

  await startPromptSelection(ctx, content, contentType, title);

  audit.logResponse(userId, `Started V3 progressive profiling for: ${title}`);
}

/**
 * @deprecated Old callback handler removed - V3 flow uses ps:* callbacks
 *
 * If you're seeing this error, the code path that called handleSparkCallback
 * needs to be updated to use the V3 prompt selection flow instead.
 *
 * The V3 flow uses callbacks with the ps:* prefix, handled by
 * handlePromptSelectionCallback in prompt-selection-callback.ts.
 */
export async function handleSparkCallback(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  const callbackData = ctx.callbackQuery?.data || "(no data)";
  const chatId = ctx.chat?.id;

  const errorMsg =
    `[DEPRECATED] handleSparkCallback received callback but V3 flow is active.\n` +
    `- Callback data: "${callbackData}"\n` +
    `- User ID: ${userId}\n` +
    `- Chat ID: ${chatId}\n` +
    `- This indicates stale code or an unhandled callback pattern.\n` +
    `- V3 flow uses ps:* prefix callbacks (handled by handlePromptSelectionCallback).\n` +
    `- Check handlers/index.ts routeCallback() to add handling for this callback pattern.`;

  logger.error("[SPARK] Deprecated callback handler invoked", {
    callbackData,
    userId,
    chatId,
  });

  // Try to respond to user so they're not left hanging
  try {
    await ctx.answerCallbackQuery({
      text: "Error: Unhandled callback. Please try again.",
      show_alert: true,
    });
  } catch {
    // Ignore if we can't answer
  }

  throw new Error(errorMsg);
}

/**
 * Clean up function - kept for interface compatibility but no-op now
 * V3 flow uses prompt-selection.ts which has its own TTL-based cleanup
 */
export function cleanupPendingSparkClarifications(_maxAgeMinutes: number = 30): void {
  // No-op: V3 flow manages its own state in prompt-selection.ts
  logger.debug("cleanupPendingSparkClarifications called (no-op in V3 flow)");
}
