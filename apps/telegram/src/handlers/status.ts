/**
 * Atlas Telegram Bot - Status Handler
 *
 * Handles status intent: "how's...", "status on...", "where are we"
 */

import type { Context } from "grammy";
import type { IntentDetectionResult } from "../types";
import { getStatusSummary } from "../notion";
import { getRoutingHealthSummary, getSessionSummary } from "../cognitive";
import { logger } from "../logger";
import { audit } from "../audit";

/**
 * Handle status intent - show dashboard summary
 */
export async function handleStatusIntent(
  ctx: Context,
  _intentResult: IntentDetectionResult
): Promise<void> {
  const userId = ctx.from!.id;

  logger.info("Processing status intent", { userId });

  await ctx.replyWithChatAction("typing");

  try {
    const summary = await getStatusSummary();

    const response = formatStatusSummary(summary);
    await ctx.reply(response);
    audit.logResponse(userId, response);
  } catch (error) {
    logger.error("Status fetch failed", { error });
    await ctx.reply("Couldn't get status. Try again?");
  }
}

/**
 * Format status summary for display
 */
function formatStatusSummary(summary: {
  feed: {
    total: number;
    byStatus: Record<string, number>;
    byPillar: Record<string, number>;
  };
  workQueue: {
    total: number;
    byStatus: Record<string, number>;
    byPriority: Record<string, number>;
  };
  lastUpdated: Date;
}): string {
  const newFeed = summary.feed.byStatus["New"] || 0;
  const queued = summary.workQueue.byStatus["Queued"] || 0;
  const inProgress = summary.workQueue.byStatus["In Progress"] || 0;
  const blocked = summary.workQueue.byStatus["Blocked"] || 0;
  const p0 = summary.workQueue.byPriority["P0"] || 0;

  // Start with a quick conversational summary
  let response = "";

  if (p0 > 0) {
    response = `Heads up: ${p0} P0 item${p0 > 1 ? 's' : ''} need attention.\n\n`;
  } else if (blocked > 0) {
    response = `${blocked} item${blocked > 1 ? 's' : ''} blocked.\n\n`;
  } else if (newFeed > 0 && queued > 0) {
    response = `${newFeed} new in feed, ${queued} queued for work.\n\n`;
  } else if (inProgress > 0) {
    response = `${inProgress} in progress right now.\n\n`;
  } else {
    response = `All clear.\n\n`;
  }

  // Details
  response += `Feed: ${summary.feed.total} total`;
  if (newFeed > 0) response += ` (${newFeed} new)`;
  response += `\n`;

  response += `Work: ${summary.workQueue.total} total`;
  if (inProgress > 0) response += ` (${inProgress} active)`;
  response += `\n`;

  // Pillar breakdown if multiple
  const activePillars = Object.entries(summary.feed.byPillar).filter(([_, count]) => count > 0);
  if (activePillars.length > 1) {
    response += `\nBy pillar: `;
    response += activePillars.map(([p, c]) => `${p} ${c}`).join(", ");
  }

  // Add cognitive router status if enabled
  const cognitiveEnabled = process.env.USE_COGNITIVE_ROUTER === "true";
  if (cognitiveEnabled) {
    response += `\n\n--- Router ---\n`;
    response += getSessionSummary();
  }

  return response;
}

/**
 * Get cognitive router health status
 */
export function getCognitiveRouterStatus(): string {
  const health = getRoutingHealthSummary();

  const lines = [
    `Router: ${health.healthy ? "healthy" : "degraded"}`,
    `  Anthropic: ${health.anthropic ? "yes" : "no"}`,
    `  OpenAI: ${health.openai ? "yes" : "no"}`,
    `  OpenRouter: ${health.openrouter ? "yes" : "no"}`,
  ];

  return lines.join("\n");
}
