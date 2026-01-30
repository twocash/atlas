/**
 * Atlas Telegram Bot - Lookup Handler
 *
 * Handles lookup intent: "find...", "search...", "what did we decide"
 */

import type { Context } from "grammy";
import type { IntentDetectionResult } from "../types";
import { searchNotion } from "../notion";
import { logger } from "../logger";
import { audit } from "../audit";

/**
 * Handle lookup intent - search Notion
 */
export async function handleLookupIntent(
  ctx: Context,
  intentResult: IntentDetectionResult
): Promise<void> {
  const userId = ctx.from!.id;
  const text = ctx.message?.text || "";

  logger.info("Processing lookup intent", { userId, text: text.substring(0, 100) });

  await ctx.replyWithChatAction("typing");

  // Extract search query from message
  const query = intentResult.entities?.query || extractSearchQuery(text);

  if (!query || query.length < 2) {
    await ctx.reply("What should I search for?");
    return;
  }

  try {
    const results = await searchNotion(query);

    if (results.length === 0) {
      await ctx.reply(`No results for "${query}"`);
      audit.logResponse(userId, `No results for: ${query}`);
      return;
    }

    let response = `Found ${results.length} result${results.length > 1 ? "s" : ""}\n\n`;

    for (const result of results.slice(0, 5)) {
      const typeTag = result.type !== "page" ? `[${result.type}]` : "";
      response += `- ${result.title} ${typeTag}\n`;
    }

    if (results.length > 5) {
      response += `\n_...and ${results.length - 5} more_`;
    }

    await ctx.reply(response);
    audit.logResponse(userId, response);
  } catch (error) {
    logger.error("Lookup failed", { error, query });
    await ctx.reply("Search failed. Try again?");
  }
}

/**
 * Extract search query from natural language
 */
function extractSearchQuery(text: string): string {
  // Remove common lookup words
  let query = text
    .replace(/^(find|search|search for|look for|looking for|where'?s?|what did we|what was)\s+/i, "")
    .replace(/\b(decide|discuss|talk|say)\s+(about|on)\s*/i, "")
    .replace(/\?+$/, "")
    .trim();

  // Remove filler words
  query = query
    .replace(/^(the|a|an|that|this)\s+/i, "")
    .replace(/\s+(thing|item|page|doc|document)$/i, "")
    .trim();

  return query;
}
