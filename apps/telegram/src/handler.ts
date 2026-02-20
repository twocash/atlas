/**
 * Atlas Telegram Bot - Message Handler
 * 
 * Orchestrates the full spark processing flow:
 * 1. Extract URL (if present)
 * 2. Fetch URL content
 * 3. Classify using Claude + SPARKS.md
 * 4. Generate clarification (if needed)
 * 5. Handle user response
 * 6. Create Notion items
 * 
 * @see IMPLEMENTATION.md for full requirements
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
  ActionDataTriage,
} from "./types";
import { extractFirstUrl, getUrlDomain } from "./url";
import { extractContent, toUrlContent } from "./conversation/content-extractor";
import { classifySpark } from "./classifier";
import { classifyWithClaude } from "./claude";
import {
  generateClarificationQuestion,
  buildClarificationKeyboard,
  parseCallbackData,
  formatConfirmationMessage,
  generatePillarChangeOptions,
  generateIntentChangeOptions
} from "./clarify";
import { createFeedItem, createWorkItem, createActionFeedEntry } from "./notion";
import { logger } from "./logger";
import { audit } from "./audit";

// Use Claude for classification (set to false to use simple heuristics)
const USE_CLAUDE = process.env.USE_CLAUDE !== "false";

// In-memory store for pending clarifications
// In production, this should be persisted
const pendingClarifications = new Map<number, PendingClarification>();

interface PendingClarification {
  spark: Spark;
  classification: ClassificationResult;
  urlContent?: UrlContent;
  question: string;
  createdAt: Date;
}

/**
 * Handle an incoming text message
 */
export async function handleMessage(ctx: Context): Promise<void> {
  const userId = ctx.from!.id;
  const text = ctx.message?.text || "";

  logger.info("Processing message", { userId, text: text.substring(0, 100) });

  // Create spark object
  const spark: Spark = {
    id: `spark_${Date.now()}`,
    source: "Telegram",
    content: text,
    receivedAt: new Date(),
  };

  // Check for URL
  const url = extractFirstUrl(text);
  let urlContent: UrlContent | undefined;

  if (url) {
    spark.url = url;
    
    // Extract URL content (tiered: HTTP or Jina Reader)
    await ctx.replyWithChatAction("typing");
    urlContent = toUrlContent(await extractContent(url));
    spark.urlContent = urlContent;

    if (!urlContent.success) {
      // URL fetch failed - offer to capture anyway
      await ctx.reply(
        `Couldn't fetch ${getUrlDomain(url)} (${urlContent.error}).\n\nCapture link anyway?`,
        {
          reply_markup: buildClarificationKeyboard([
            { text: "Yes, capture", data: "capture_anyway" },
            { text: "No, skip", data: "dismiss" },
          ]),
        }
      );
      
      pendingClarifications.set(userId, {
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
    classification = await classifySpark(text, urlContent);
  }
  
  spark.classification = classification;

  // Generate clarification or confirm
  const { question, options } = generateClarificationQuestion(classification, urlContent);

  // Store pending clarification
  pendingClarifications.set(userId, {
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

  // Log the interaction
  audit.logResponse(userId, question);
}

/**
 * Handle callback query (button press)
 */
export async function handleCallback(ctx: Context): Promise<void> {
  const userId = ctx.from!.id;
  const data = ctx.callbackQuery?.data || "";

  logger.info("Processing callback", { userId, data });

  // Get pending clarification
  const pending = pendingClarifications.get(userId);
  if (!pending) {
    await ctx.answerCallbackQuery({ text: "Session expired. Please try again." });
    return;
  }

  // Parse callback data
  const parsed = parseCallbackData(data);

  // Handle special capture_anyway case
  if (data === "capture_anyway") {
    await handleConfirm(ctx, pending, pending.classification.pillar, pending.classification.intent);
    return;
  }

  // Handle based on action
  switch (parsed.action) {
    case "confirm":
      await handleConfirm(
        ctx, 
        pending, 
        parsed.pillar || pending.classification.pillar,
        parsed.intent || pending.classification.intent
      );
      break;

    case "dismiss":
      await handleDismiss(ctx, pending);
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
        // Now ask for intent confirmation
        const intentOpts = generateIntentChangeOptions();
        await ctx.editMessageText(`Pillar: ${parsed.pillar}\n\n${intentOpts.question}`, {
          reply_markup: buildClarificationKeyboard(intentOpts.options),
        });
      }
      await ctx.answerCallbackQuery();
      break;

    case "set_intent":
      if (parsed.intent) {
        await handleConfirm(ctx, pending, pending.classification.pillar, parsed.intent);
      }
      break;

    default:
      await ctx.answerCallbackQuery({ text: "Unknown action" });
  }
}

/**
 * Handle confirmation - create Notion items
 */
async function handleConfirm(
  ctx: Context,
  pending: PendingClarification,
  pillar: Pillar,
  intent: Intent
): Promise<void> {
  const userId = ctx.from!.id;

  await ctx.answerCallbackQuery({ text: "Processing..." });

  // Update classification with confirmed values
  pending.classification.pillar = pillar;
  pending.classification.intent = intent;
  pending.classification.confidence = 100; // User confirmed

  // Determine decision
  const shouldRoute = ["Build", "Task", "Research"].includes(intent);
  const decision: Decision = shouldRoute ? "Route to Work" : "Archive";

  // Record clarification exchange
  const clarification: ClarificationExchange = {
    question: pending.question,
    response: `Confirmed: ${pillar} / ${intent}`,
    respondedAt: new Date(),
  };
  pending.spark.clarification = clarification;

  try {
    // Create feed item
    const feedPageId = await createFeedItem(
      pending.spark,
      pending.classification,
      decision,
      clarification
    );

    // Create work item if routing
    let workPageId: string | undefined;
    if (shouldRoute) {
      workPageId = await createWorkItem(
        feedPageId,
        pending.spark,
        pending.classification
      );
    }

    // Emit Triage card to Action Feed (non-blocking)
    try {
      const triageData: ActionDataTriage = {
        platform: 'Telegram',
        title: pending.classification.suggestedTitle,
        creator: ctx.from?.username || `user:${userId}`,
        url: pending.spark.url || '',
        pillar: pending.classification.pillar,
        wq_item_id: workPageId,
      };
      await createActionFeedEntry('Triage', triageData, 'Atlas [telegram]');
    } catch (triageError) {
      logger.error('Failed to create Triage card (non-blocking)', { error: triageError });
    }

    // Send confirmation
    const confirmMsg = formatConfirmationMessage(pillar, intent, shouldRoute);
    await ctx.editMessageText(confirmMsg);

    // Log success
    audit.logResponse(userId, confirmMsg, feedPageId);
    logger.info("Spark captured", { feedPageId, workPageId, pillar, intent });

  } catch (error) {
    logger.error("Failed to create Notion items", { error });
    await ctx.editMessageText("⚠️ Error saving to Notion. Please try again.");
  }

  // Clean up
  pendingClarifications.delete(userId);
}

/**
 * Handle dismissal
 */
async function handleDismiss(
  ctx: Context,
  pending: PendingClarification
): Promise<void> {
  const userId = ctx.from!.id;

  await ctx.answerCallbackQuery({ text: "Dismissed" });
  await ctx.editMessageText("✗ Dismissed");

  // Log dismissal
  audit.logResponse(userId, "Dismissed");
  logger.info("Spark dismissed", { sparkId: pending.spark.id });

  // Clean up
  pendingClarifications.delete(userId);
}

/**
 * Clean up old pending clarifications (call periodically)
 */
export function cleanupPendingClarifications(maxAgeMinutes: number = 30): void {
  const now = new Date();
  const maxAge = maxAgeMinutes * 60 * 1000;

  for (const [userId, pending] of pendingClarifications.entries()) {
    const age = now.getTime() - pending.createdAt.getTime();
    if (age > maxAge) {
      pendingClarifications.delete(userId);
      logger.debug("Cleaned up stale clarification", { userId });
    }
  }
}
