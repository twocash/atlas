/**
 * Atlas Telegram Bot - Action Handler
 *
 * Handles action intent: "mark X as...", "complete...", "archive..."
 */

import type { Context } from "grammy";
import { InlineKeyboard } from "grammy";
import type { IntentDetectionResult, NotionItemSummary } from "../types";
import { findItemByTitle, updateNotionPage } from "../notion";
import { logger } from "../logger";
import { audit } from "../audit";

// Store pending actions awaiting confirmation
const pendingActions = new Map<number, PendingAction>();

interface PendingAction {
  item: NotionItemSummary;
  actionType: "complete" | "archive" | "dismiss" | "defer";
  createdAt: Date;
}

/**
 * Handle action intent - modify Notion items
 */
export async function handleActionIntent(
  ctx: Context,
  intentResult: IntentDetectionResult
): Promise<void> {
  const userId = ctx.from!.id;
  const text = ctx.message?.text || "";

  logger.info("Processing action intent", { userId, text: text.substring(0, 100) });

  await ctx.replyWithChatAction("typing");

  // Extract action type and target
  const actionType = intentResult.entities?.actionType || extractActionType(text);
  const query = intentResult.entities?.query || extractActionTarget(text);

  if (!query || query.length < 2) {
    await ctx.reply("Which item? Give me a title or keyword.");
    return;
  }

  try {
    // Find the item
    const item = await findItemByTitle(query);

    if (!item) {
      await ctx.reply(`Couldn't find "${query}". Try a different search?`);
      return;
    }

    // Store pending action and ask for confirmation
    pendingActions.set(userId, {
      item,
      actionType: actionType || "complete",
      createdAt: new Date(),
    });

    const actionLabel = getActionLabel(actionType || "complete");
    const keyboard = new InlineKeyboard()
      .text(`Yes, ${actionLabel}`, `action_confirm`)
      .text("Cancel", "action_cancel");

    await ctx.reply(`${actionLabel} "${item.title}"?`, {
      reply_markup: keyboard,
    });
  } catch (error) {
    logger.error("Action intent failed", { error, query });
    await ctx.reply("Something went wrong. Try again?");
  }
}

/**
 * Handle action callback (confirmation/cancellation)
 */
export async function handleActionCallback(ctx: Context, data: string): Promise<void> {
  const userId = ctx.from!.id;

  logger.info("Processing action callback", { userId, data });

  const pending = pendingActions.get(userId);
  if (!pending) {
    await ctx.answerCallbackQuery({ text: "Session expired" });
    return;
  }

  if (data === "action_cancel") {
    await ctx.answerCallbackQuery({ text: "Cancelled" });
    await ctx.editMessageText("Cancelled");
    pendingActions.delete(userId);
    return;
  }

  if (data === "action_confirm") {
    await ctx.answerCallbackQuery({ text: "Processing..." });

    try {
      await updateNotionPage(pending.item.id, pending.actionType);

      const actionLabel = getActionLabel(pending.actionType);
      const confirmMsg = `Done: ${actionLabel} "${pending.item.title}"`;
      await ctx.editMessageText(confirmMsg);
      audit.logResponse(userId, confirmMsg);
      logger.info("Action completed", {
        itemId: pending.item.id,
        action: pending.actionType,
      });
    } catch (error) {
      logger.error("Action failed", { error });
      await ctx.editMessageText("Action failed. Try again?");
    }

    pendingActions.delete(userId);
    return;
  }
}

/**
 * Extract action type from text
 */
function extractActionType(
  text: string
): "complete" | "archive" | "dismiss" | "defer" | undefined {
  const lowerText = text.toLowerCase();

  if (/\b(complete|done|finish|mark.*(done|complete))\b/.test(lowerText)) {
    return "complete";
  }
  if (/\b(archive)\b/.test(lowerText)) {
    return "archive";
  }
  if (/\b(dismiss|remove|delete)\b/.test(lowerText)) {
    return "dismiss";
  }
  if (/\b(defer|later|postpone)\b/.test(lowerText)) {
    return "defer";
  }

  return "complete"; // Default
}

/**
 * Extract action target (item name) from text
 */
function extractActionTarget(text: string): string {
  // Remove action words and extract target
  let target = text
    .replace(
      /^(mark|complete|archive|dismiss|close|done|finish|defer)\s*/i,
      ""
    )
    .replace(/\s*(as\s*)?(done|complete|archived|dismissed|deferred)\s*$/i, "")
    .replace(/^(the|that|this)\s+/i, "")
    .trim();

  // Handle "mark X as done" pattern
  target = target.replace(/\s+as\s+.*$/i, "").trim();

  return target;
}

/**
 * Get human-readable action label
 */
function getActionLabel(actionType: string): string {
  switch (actionType) {
    case "complete":
      return "complete";
    case "archive":
      return "archive";
    case "dismiss":
      return "dismiss";
    case "defer":
      return "defer";
    default:
      return "update";
  }
}

/**
 * Clean up old pending actions
 */
export function cleanupPendingActions(maxAgeMinutes: number = 5): void {
  const now = new Date();
  const maxAge = maxAgeMinutes * 60 * 1000;

  for (const [userId, pending] of pendingActions.entries()) {
    const age = now.getTime() - pending.createdAt.getTime();
    if (age > maxAge) {
      pendingActions.delete(userId);
      logger.debug("Cleaned up stale action", { userId });
    }
  }
}
