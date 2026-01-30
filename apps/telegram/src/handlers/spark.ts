/**
 * Atlas Telegram Bot - Spark Handler
 *
 * Handles spark intent: URL capture, classification, and Notion routing.
 * Refactored from handler.ts to support intent routing.
 */

import type { Context } from "grammy";
import type {
  Spark,
  ClassificationResult,
  UrlContent,
  ClarificationExchange,
  Decision,
  Pillar,
  Intent,
  IntentDetectionResult,
} from "../types";
import { extractFirstUrl, fetchUrlContent, getUrlDomain } from "../url";
import { classifyWithClaude } from "../claude";
import {
  generateClarificationQuestion,
  buildClarificationKeyboard,
  parseCallbackData,
  formatConfirmationMessage,
  generatePillarChangeOptions,
  generateIntentChangeOptions,
} from "../clarify";
import { createInboxItem, createWorkItem } from "../notion";
import { logger } from "../logger";
import { audit } from "../audit";
import { updateState, getState, logUpdate } from "../atlas-system";

// Use Claude for classification
const USE_CLAUDE = process.env.USE_CLAUDE !== "false";

// In-memory store for pending clarifications
export const pendingSparkClarifications = new Map<number, PendingSparkClarification>();

export interface PendingSparkClarification {
  spark: Spark;
  classification: ClassificationResult;
  urlContent?: UrlContent;
  question: string;
  createdAt: Date;
}

/**
 * Handle spark intent - capture URL/content to Notion
 */
export async function handleSparkIntent(
  ctx: Context,
  intentResult: IntentDetectionResult
): Promise<void> {
  const userId = ctx.from!.id;
  const text = ctx.message?.text || "";

  logger.info("Processing spark intent", { userId, text: text.substring(0, 100) });

  // Create spark object
  const spark: Spark = {
    id: `spark_${Date.now()}`,
    source: "Telegram",
    content: text,
    receivedAt: new Date(),
  };

  // Check for URL (may already be in entities)
  const url = intentResult.entities?.url || extractFirstUrl(text);
  let urlContent: UrlContent | undefined;

  if (url) {
    spark.url = url;

    // Fetch URL content
    await ctx.replyWithChatAction("typing");
    urlContent = await fetchUrlContent(url);
    spark.urlContent = urlContent;

    if (!urlContent.success) {
      // URL fetch failed - offer to capture anyway
      await ctx.reply(
        `Couldn't fetch ${getUrlDomain(url)} (${urlContent.error}).\n\nCapture link anyway?`,
        {
          reply_markup: buildClarificationKeyboard([
            { text: "Yes, capture", data: "spark_capture_anyway" },
            { text: "No, skip", data: "spark_dismiss" },
          ]),
        }
      );

      pendingSparkClarifications.set(userId, {
        spark,
        classification: {
          pillar: "The Grove",
          intent: "Reference",
          confidence: 40,
          reasoning: "URL fetch failed",
          tags: [],
          suggestedTitle: url,
        },
        urlContent,
        question: "capture_anyway",
        createdAt: new Date(),
      });

      return;
    }
  }

  // Classify the spark
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

  // Generate clarification or confirm
  const { question, options } = generateClarificationQuestion(classification, urlContent);

  // Store pending clarification
  pendingSparkClarifications.set(userId, {
    spark,
    classification,
    urlContent,
    question,
    createdAt: new Date(),
  });

  // Send clarification question
  await ctx.reply(question, {
    reply_markup: buildClarificationKeyboard(options),
  });

  audit.logResponse(userId, question);
}

/**
 * Handle spark callback (button press during spark flow)
 */
export async function handleSparkCallback(ctx: Context): Promise<void> {
  const userId = ctx.from!.id;
  const data = ctx.callbackQuery?.data || "";

  logger.info("Processing spark callback", { userId, data });

  const pending = pendingSparkClarifications.get(userId);
  if (!pending) {
    await ctx.answerCallbackQuery({ text: "Session expired. Please try again." });
    return;
  }

  const parsed = parseCallbackData(data);

  // Handle special capture_anyway case
  if (data === "spark_capture_anyway" || data === "capture_anyway") {
    await handleSparkConfirm(
      ctx,
      pending,
      pending.classification.pillar,
      pending.classification.intent
    );
    return;
  }

  // Handle dismiss
  if (data === "spark_dismiss" || data === "dismiss") {
    await handleSparkDismiss(ctx, pending);
    return;
  }

  // Handle based on action
  switch (parsed.action) {
    case "confirm":
      await handleSparkConfirm(
        ctx,
        pending,
        parsed.pillar || pending.classification.pillar,
        parsed.intent || pending.classification.intent
      );
      break;

    case "change":
    case "change_pillar": {
      const pillarOpts = generatePillarChangeOptions();
      await ctx.editMessageText(pillarOpts.question, {
        reply_markup: buildClarificationKeyboard(pillarOpts.options),
      });
      await ctx.answerCallbackQuery();
      break;
    }

    case "change_intent": {
      const intentOpts = generateIntentChangeOptions();
      await ctx.editMessageText(intentOpts.question, {
        reply_markup: buildClarificationKeyboard(intentOpts.options),
      });
      await ctx.answerCallbackQuery();
      break;
    }

    case "set_pillar":
      if (parsed.pillar) {
        pending.classification.pillar = parsed.pillar;
        const intentOpts = generateIntentChangeOptions();
        await ctx.editMessageText(`Pillar: ${parsed.pillar}\n\n${intentOpts.question}`, {
          reply_markup: buildClarificationKeyboard(intentOpts.options),
        });
      }
      await ctx.answerCallbackQuery();
      break;

    case "set_intent":
      if (parsed.intent) {
        await handleSparkConfirm(ctx, pending, pending.classification.pillar, parsed.intent);
      }
      break;

    default:
      await ctx.answerCallbackQuery({ text: "Unknown action" });
  }
}

/**
 * Handle spark confirmation - create Notion items
 */
async function handleSparkConfirm(
  ctx: Context,
  pending: PendingSparkClarification,
  pillar: Pillar,
  intent: Intent
): Promise<void> {
  const userId = ctx.from!.id;

  await ctx.answerCallbackQuery({ text: "Processing..." });

  pending.classification.pillar = pillar;
  pending.classification.intent = intent;
  pending.classification.confidence = 100;

  const shouldRoute = ["Build", "Task", "Research"].includes(intent);
  const decision: Decision = shouldRoute ? "Route to Work" : "Archive";

  const clarification: ClarificationExchange = {
    question: pending.question,
    response: `Confirmed: ${pillar} / ${intent}`,
    respondedAt: new Date(),
  };
  pending.spark.clarification = clarification;

  try {
    const inboxPageId = await createInboxItem(
      pending.spark,
      pending.classification,
      decision,
      clarification
    );

    let workPageId: string | undefined;
    if (shouldRoute) {
      workPageId = await createWorkItem(inboxPageId, pending.spark, pending.classification);
    }

    const confirmMsg = formatConfirmationMessage(pillar, intent, shouldRoute);
    await ctx.editMessageText(confirmMsg);

    audit.logResponse(userId, confirmMsg, inboxPageId);
    logger.info("Spark captured", { inboxPageId, workPageId, pillar, intent });

    // Track capture in Atlas state
    const state = getState();
    updateState({
      stats: {
        ...state.stats,
        sparksCaptured: state.stats.sparksCaptured + 1,
      }
    });
    logUpdate(`SPARK: Captured "${pending.classification.suggestedTitle}" to ${pillar}`);
  } catch (error) {
    logger.error("Failed to create Notion items", { error });
    await ctx.editMessageText("Error saving to Notion. Please try again.");
  }

  pendingSparkClarifications.delete(userId);
}

/**
 * Handle spark dismissal
 */
async function handleSparkDismiss(
  ctx: Context,
  pending: PendingSparkClarification
): Promise<void> {
  const userId = ctx.from!.id;

  await ctx.answerCallbackQuery({ text: "Dismissed" });
  await ctx.editMessageText("Dismissed");

  audit.logResponse(userId, "Dismissed");
  logger.info("Spark dismissed", { sparkId: pending.spark.id });

  pendingSparkClarifications.delete(userId);
}

/**
 * Clean up old pending spark clarifications
 */
export function cleanupPendingSparkClarifications(maxAgeMinutes: number = 30): void {
  const now = new Date();
  const maxAge = maxAgeMinutes * 60 * 1000;

  for (const [userId, pending] of pendingSparkClarifications.entries()) {
    const age = now.getTime() - pending.createdAt.getTime();
    if (age > maxAge) {
      pendingSparkClarifications.delete(userId);
      logger.debug("Cleaned up stale spark clarification", { userId });
    }
  }
}
