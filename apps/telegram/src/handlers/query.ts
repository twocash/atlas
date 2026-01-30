/**
 * Atlas Telegram Bot - Query Handler
 *
 * Handles query intent: "what's in my...", "show me...", "list..."
 */

import type { Context } from "grammy";
import type { IntentDetectionResult, Pillar, AtlasStatus } from "../types";
import { queryInbox, queryWorkQueue } from "../notion";
import { logger } from "../logger";
import { audit } from "../audit";
import { updateState, getState } from "../atlas-system";

/**
 * Handle query intent - list items from Notion databases
 */
export async function handleQueryIntent(
  ctx: Context,
  intentResult: IntentDetectionResult
): Promise<void> {
  const userId = ctx.from!.id;
  const text = ctx.message?.text || "";

  logger.info("Processing query intent", { userId, text: text.substring(0, 100) });

  await ctx.replyWithChatAction("typing");

  try {
    // Determine what to query based on message content
    const queryType = detectQueryType(text);
    const pillar = intentResult.entities?.pillar;

    let response: string;

    switch (queryType) {
      case "inbox":
        response = await formatInboxQuery(pillar);
        break;
      case "work":
        response = await formatWorkQueueQuery();
        break;
      case "pending":
        response = await formatPendingQuery(pillar);
        break;
      default:
        // Default to inbox summary
        response = await formatInboxQuery(pillar);
    }

    // Use plain text to avoid markdown parsing issues with special chars in titles
    await ctx.reply(response);
    audit.logResponse(userId, response);

    // Track query in Atlas state
    const state = getState();
    updateState({
      stats: {
        ...state.stats,
        queriesAnswered: state.stats.queriesAnswered + 1,
      }
    });
  } catch (error) {
    logger.error("Query failed", { error, message: error instanceof Error ? error.message : String(error) });
    await ctx.reply(`Query failed: ${error instanceof Error ? error.message : "Unknown error"}`);
  }
}

/**
 * Detect what type of query the user wants
 */
function detectQueryType(text: string): "inbox" | "work" | "pending" | "all" {
  const lowerText = text.toLowerCase();

  if (/\b(work|queue|tasks?)\b/.test(lowerText)) {
    return "work";
  }

  if (/\b(pending|new|unread)\b/.test(lowerText)) {
    return "pending";
  }

  if (/\b(inbox|sparks?|captured?)\b/.test(lowerText)) {
    return "inbox";
  }

  return "inbox"; // Default
}

/**
 * Format inbox query response
 */
async function formatInboxQuery(pillar?: Pillar): Promise<string> {
  const result = await queryInbox({
    pillar,
    limit: 10,
    sortBy: "created",
    sortDirection: "desc",
  });

  if (result.items.length === 0) {
    const pillarText = pillar ? ` for ${pillar}` : "";
    return `Inbox is empty${pillarText}. Nothing waiting.`;
  }

  // Count by status
  const newItems = result.items.filter(i => i.status === "New").length;

  let response = "";

  // Conversational opener based on what's there
  if (pillar) {
    response = `${pillar} inbox has ${result.total} item${result.total > 1 ? 's' : ''}:\n\n`;
  } else if (newItems > 0) {
    response = `${newItems} new in inbox:\n\n`;
  } else {
    response = `Inbox (${result.total} items):\n\n`;
  }

  for (const item of result.items) {
    const pillarNote = !pillar && item.pillar ? ` [${item.pillar}]` : "";
    response += `- ${item.title}${pillarNote}\n`;
  }

  if (result.hasMore) {
    response += `\n...and more`;
  }

  return response;
}

/**
 * Format work queue query response
 */
async function formatWorkQueueQuery(): Promise<string> {
  const result = await queryWorkQueue({
    limit: 10,
    sortBy: "priority",
    sortDirection: "asc",
  });

  if (result.items.length === 0) {
    return "Work queue is clear. Nothing queued right now.";
  }

  // Count by status
  const queued = result.items.filter(i => i.status === "Queued").length;
  const inProgress = result.items.filter(i => i.status === "In Progress").length;
  const done = result.items.filter(i => i.status === "Done").length;

  let response = "";

  // Conversational opener
  if (queued > 0 && inProgress === 0) {
    response = `You've got ${queued} item${queued > 1 ? 's' : ''} queued up:\n\n`;
  } else if (inProgress > 0) {
    response = `${inProgress} in progress, ${queued} waiting:\n\n`;
  } else if (done === result.items.length) {
    response = `All ${done} items done:\n\n`;
  } else {
    response = `Here's the queue (${result.total}):\n\n`;
  }

  for (const item of result.items) {
    const status = item.status === "Done" ? "done" : item.status === "In Progress" ? "active" : "";
    const statusNote = status ? ` (${status})` : "";
    response += `- ${item.title}${statusNote}\n`;
  }

  return response;
}

/**
 * Format pending items query
 */
async function formatPendingQuery(pillar?: Pillar): Promise<string> {
  const result = await queryInbox({
    pillar,
    status: "New" as AtlasStatus,
    limit: 10,
    sortBy: "created",
    sortDirection: "desc",
  });

  if (result.items.length === 0) {
    const pillarText = pillar ? ` in ${pillar}` : "";
    return `No pending items${pillarText}.`;
  }

  let response = `Pending (${result.total})\n\n`;

  for (const item of result.items) {
    const pillarTag = item.pillar ? `[${item.pillar}]` : "";
    response += `- ${item.title} ${pillarTag}\n`;
  }

  if (result.hasMore) {
    response += `\n_...and more_`;
  }

  return response;
}
