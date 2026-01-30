/**
 * Atlas Telegram Bot - Bot Setup & Message Handling
 * 
 * Initializes grammy bot, sets up middleware, and routes messages to handler.
 * 
 * @see IMPLEMENTATION.md Sprint 1.2 for requirements
 */

import { Bot, InlineKeyboard } from "grammy";
import { logger } from "./logger";
import { audit } from "./audit";
import { routeMessage, routeCallback, cleanupAll, clearUserSession } from "./handlers";
import { getModelOverride, setModelOverride, MODEL_SHORTCUTS, getModelDisplayName, clearSession } from "./session";
import type { AtlasContext } from "./types";

// Environment configuration
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
const ALLOWED_USERS = process.env.TELEGRAM_ALLOWED_USERS!
  .split(",")
  .map((id) => parseInt(id.trim(), 10));

/**
 * Create and configure the bot instance
 */
export function createBot(): Bot<AtlasContext> {
  const bot = new Bot<AtlasContext>(TELEGRAM_BOT_TOKEN);

  // Middleware: Check if user is allowed
  bot.use(async (ctx, next) => {
    const userId = ctx.from?.id;
    
    if (!userId || !ALLOWED_USERS.includes(userId)) {
      // Silent rejection - don't respond to unauthorized users
      logger.warn("Unauthorized access attempt", { userId });
      return;
    }

    // Log the interaction
    audit.log({
      userId,
      username: ctx.from?.username,
      messageType: ctx.message?.text ? "text" : ctx.callbackQuery ? "callback" : "other",
      content: ctx.message?.text || ctx.callbackQuery?.data || "[non-text message]",
      timestamp: new Date(),
    });

    await next();
  });

  // Handle text messages - route based on intent
  bot.on("message:text", async (ctx) => {
    try {
      await routeMessage(ctx);
    } catch (error) {
      logger.error("Error handling message", { error });
      await ctx.reply("Something went wrong. Please try again.");
    }
  });

  // Handle callback queries (inline keyboard button presses)
  bot.on("callback_query:data", async (ctx) => {
    try {
      await routeCallback(ctx);
    } catch (error) {
      logger.error("Error handling callback", { error });
      await ctx.answerCallbackQuery({ text: "Error processing. Try again." });
    }
  });

  // Handle commands
  bot.command("start", async (ctx) => {
    await ctx.reply(
      "Atlas is running.\n\n" +
      "What I can do:\n" +
      "- Share a URL to capture\n" +
      "- \"what's in my inbox?\" to see items\n" +
      "- \"status\" for overview\n" +
      "- \"find [term]\" to search\n" +
      "- \"mark [item] as done\" to update\n\n" +
      "Commands:\n" +
      "/start - Show this\n" +
      "/status - Bot health\n" +
      "/model - Set AI model\n" +
      "/new - Clear session"
    );
  });

  bot.command("status", async (ctx) => {
    const { testNotionConnection } = await import("./notion");
    const { testClaudeConnection } = await import("./claude");

    await ctx.replyWithChatAction("typing");

    const notionOk = await testNotionConnection();
    const claudeOk = await testClaudeConnection();

    await ctx.reply(
      "✅ Atlas Bot Status\n\n" +
      `User: ${ctx.from?.username || ctx.from?.id}\n` +
      `Notion: ${notionOk ? "✓ Connected" : "✗ Disconnected"}\n` +
      `Claude: ${claudeOk ? "✓ Connected" : "✗ Disconnected"}\n` +
      `Session: Active`
    );
  });

  bot.command("new", async (ctx) => {
    const userId = ctx.from!.id;
    clearUserSession(userId);
    clearSession(userId);
    cleanupAll(0); // Clear all pending
    await ctx.reply("Session cleared.");
  });

  // Model override command
  bot.command("model", async (ctx) => {
    const userId = ctx.from!.id;
    const args = ctx.message?.text?.split(" ").slice(1).join(" ").toLowerCase().trim();

    if (!args) {
      // Show current setting and options
      const current = getModelOverride(userId);
      const options = Object.keys(MODEL_SHORTCUTS).join(", ");
      await ctx.reply(
        `Current model: ${getModelDisplayName(current)}\n\n` +
        `Usage: /model <name>\n` +
        `Options: ${options}\n\n` +
        `Examples:\n` +
        `/model auto - Let router decide\n` +
        `/model haiku - Force Haiku (fast)\n` +
        `/model sonnet - Force Sonnet (powerful)`
      );
      return;
    }

    const model = MODEL_SHORTCUTS[args];
    if (!model) {
      const options = Object.keys(MODEL_SHORTCUTS).join(", ");
      await ctx.reply(`Unknown model. Options: ${options}`);
      return;
    }

    setModelOverride(userId, model);
    await ctx.reply(`Model set to: ${getModelDisplayName(model)}`);
    logger.info("Model override set", { userId, model });
  });

  // Error handler
  bot.catch((err) => {
    logger.error("Bot error", { error: err.error, ctx: err.ctx });
  });

  // Periodic cleanup of stale operations
  setInterval(() => cleanupAll(30), 5 * 60 * 1000);

  return bot;
}

/**
 * Start the bot (long polling)
 */
export async function startBot(bot: Bot<AtlasContext>): Promise<void> {
  logger.info("Starting bot with long polling...");
  
  // Delete webhook to ensure we're using polling
  await bot.api.deleteWebhook();
  
  // Start polling
  await bot.start({
    onStart: (botInfo) => {
      logger.info(`Bot started as @${botInfo.username}`);
      console.log(`\n🤖 Atlas Bot is running as @${botInfo.username}\n`);
    },
  });
}

/**
 * Helper: Create inline keyboard for clarification
 */
export function createClarificationKeyboard(
  options: Array<{ text: string; data: string }>
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  
  options.forEach((option, index) => {
    keyboard.text(option.text, option.data);
    // New row every 2 buttons
    if ((index + 1) % 2 === 0) {
      keyboard.row();
    }
  });

  return keyboard;
}
