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
import { handleAgentCommand } from "./agent-handler";
import { initBriefings, type BriefingSystem } from "./briefing";
import { getHelpText } from "./commands/help";
import { handleHealthCommand } from "./commands/health";
import { initWorker, runWorkerCycle, startPolling, stopPolling, formatWorkerStatus } from "./worker";
import { handleConversation, clearConversation } from "./conversation";
import { formatStatsMessage, detectPatterns } from "./conversation/stats";
import { handleSkillsCommand } from "./handlers/skill-callback";
import { requestStop } from "./skills";
import { registerTelegramSendCallback } from "./conversation/tools/core";
import type { AtlasContext } from "./types";

// Feature flag for conversational UX mode
// Defaults to true - set ATLAS_CONVERSATIONAL_UX=false to disable
const CONVERSATIONAL_UX_ENABLED = process.env.ATLAS_CONVERSATIONAL_UX !== 'false';

// Feature flag for content confirmation keyboard (Universal Content Analysis)
// Defaults to true - set ATLAS_CONTENT_CONFIRM=false to disable
const CONTENT_CONFIRM_ENABLED = process.env.ATLAS_CONTENT_CONFIRM !== 'false';

// Global briefing system instance
let briefingSystem: BriefingSystem | null = null;

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

  // ==========================================
  // Global default: HTML parse_mode for all messages
  // ==========================================
  const PARSE_MODE_METHODS = ['sendMessage', 'editMessageText', 'sendPhoto', 'sendDocument', 'sendVideo', 'sendAudio', 'sendVoice'];

  bot.api.config.use((prev, method, payload, signal) => {
    // Only add parse_mode for methods that support it and don't already have it
    if (PARSE_MODE_METHODS.includes(method)) {
      const p = payload as Record<string, unknown>;
      if (!('parse_mode' in p)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return prev(method, { ...p, parse_mode: 'HTML' } as any, signal);
      }
    }
    return prev(method, payload, signal);
  });

  // ==========================================
  // Middleware: Auth check (runs first)
  // ==========================================
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

  // ==========================================
  // Commands (MUST come before generic handlers)
  // ==========================================

  bot.command("start", async (ctx) => {
    await ctx.reply(
      "Atlas is running.\n\n" +
      "What I can do:\n" +
      "- Share a URL to capture\n" +
      "- \"what's in my work queue?\" to see items\n" +
      "- \"status\" for overview\n" +
      "- \"find [term]\" to search\n" +
      "- \"mark [item] as done\" to update\n\n" +
      "Type /help for all commands."
    );
  });

  bot.command("help", async (ctx) => {
    await ctx.reply(getHelpText());
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
    await clearConversation(userId);
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

  // Agent command - spawn and manage specialist agents
  bot.command("agent", async (ctx) => {
    try {
      await ctx.replyWithChatAction("typing");
      await handleAgentCommand(ctx);
    } catch (error) {
      logger.error("Error handling agent command", { error });
      await ctx.reply("Agent command failed. Check logs.");
    }
  });

  // Health command - comprehensive system health check
  bot.command("health", async (ctx) => {
    try {
      await handleHealthCommand(ctx);
    } catch (error) {
      logger.error("Error running health check", { error });
      await ctx.reply("Health check failed. Check logs.");
    }
  });

  // Work command - trigger worker to pick up tasks
  bot.command("work", async (ctx) => {
    const args = ctx.message?.text?.split(" ").slice(1).join(" ").toLowerCase().trim();

    try {
      if (args === "status") {
        await ctx.replyWithChatAction("typing");
        const status = await formatWorkerStatus();
        await ctx.reply(status, { parse_mode: "HTML" });
      } else if (args === "start") {
        await ctx.replyWithChatAction("typing");
        await ctx.reply("🚀 Starting worker polling...");
        const result = await startPolling();
        await ctx.reply(result, { parse_mode: "HTML" });
      } else if (args === "stop") {
        const result = stopPolling();
        await ctx.reply(result);
      } else {
        // Default: run one cycle
        await ctx.replyWithChatAction("typing");
        await ctx.reply("\u23F3 Running worker cycle...");
        const result = await runWorkerCycle();
        await ctx.reply(result, { parse_mode: "HTML" });
      }
    } catch (error) {
      logger.error("Error handling work command", { error });
      await ctx.reply("Work command failed. Check logs.");
    }
  });

  // Stats command - show usage and work queue stats
  bot.command("stats", async (ctx) => {
    try {
      await ctx.replyWithChatAction("typing");
      const statsMessage = await formatStatsMessage(7);
      await ctx.reply(statsMessage);

      // Check for patterns and suggest skills
      const patterns = await detectPatterns();
      if (patterns.length > 0) {
        let patternMsg = "\n💡 Patterns detected:\n";
        for (const p of patterns.slice(0, 3)) {
          patternMsg += `   • ${p.suggestion}\n`;
        }
        patternMsg += "\nWant me to create a skill for any of these?";
        await ctx.reply(patternMsg);
      }
    } catch (error) {
      logger.error("Error generating stats", { error });
      await ctx.reply("Stats generation failed. Check logs.");
    }
  });

  // Skills command - manage auto-generated skills (Phase 3)
  bot.command("skills", async (ctx) => {
    try {
      await ctx.replyWithChatAction("typing");
      await handleSkillsCommand(ctx);
    } catch (error) {
      logger.error("Error handling skills command", { error });
      await ctx.reply("Skills command failed. Check logs.");
    }
  });

  // Stop command - emergency stop for running skills
  bot.command("stop", async (ctx) => {
    const stopped = requestStop();
    if (stopped) {
      await ctx.reply("🛑 <b>Stop requested</b>\n\nThe current skill will stop after completing its current step.");
    } else {
      await ctx.reply("No skill is currently running.");
    }
  });

  // Briefing command - manual briefing control
  bot.command("briefing", async (ctx) => {
    const args = ctx.message?.text?.split(" ").slice(1).join(" ").toLowerCase().trim();

    if (!briefingSystem) {
      await ctx.reply("Briefing system not initialized.");
      return;
    }

    if (args === "now") {
      await ctx.replyWithChatAction("typing");
      try {
        await briefingSystem.sendNow();
      } catch (error) {
        logger.error("Failed to send manual briefing", { error });
        await ctx.reply("Failed to send briefing. Check logs.");
      }
    } else if (args === "status") {
      const status = briefingSystem.getStatus();
      const nextTime = status.nextBriefing
        ? status.nextBriefing.toLocaleString("en-US", { timeZone: "America/New_York" })
        : "Unknown";

      await ctx.reply(
        `📊 Briefing Status\n\n` +
        `Running: ${status.isRunning ? "Yes" : "No"}\n` +
        `Next briefing: ${nextTime} ET\n` +
        `Briefings sent: ${status.briefingsSent}\n` +
        `Last sent: ${status.lastSent ? status.lastSent.toLocaleString() : "Never"}`
      );
    } else {
      await ctx.reply(
        `📋 Briefing Commands\n\n` +
        `/briefing now    — Send briefing immediately\n` +
        `/briefing status — Show scheduler status\n\n` +
        `Scheduled: 7am, 12:30pm, 6pm ET`
      );
    }
  });

  // ==========================================
  // Generic handlers (AFTER commands)
  // ==========================================

  // Handle text messages
  bot.on("message:text", async (ctx) => {
    try {
      if (CONVERSATIONAL_UX_ENABLED) {
        // New: Claude as front door
        await handleConversation(ctx);
      } else {
        // Legacy: Router-based intent detection
        await routeMessage(ctx);
      }
    } catch (error) {
      logger.error("Error handling message", { error });
      await ctx.reply("Something went wrong. Please try again.");
    }
  });

  // Handle attachments (photos, documents, voice, etc.) - only in conversational mode
  if (CONVERSATIONAL_UX_ENABLED) {
    bot.on("message:photo", async (ctx) => {
      try {
        await handleConversation(ctx);
      } catch (error) {
        logger.error("Error handling photo", { error });
        await ctx.reply("Couldn't process that image. Try again?");
      }
    });

    bot.on("message:document", async (ctx) => {
      try {
        await handleConversation(ctx);
      } catch (error) {
        logger.error("Error handling document", { error });
        await ctx.reply("Couldn't process that document. Try again?");
      }
    });

    bot.on("message:voice", async (ctx) => {
      try {
        await handleConversation(ctx);
      } catch (error) {
        logger.error("Error handling voice", { error });
        await ctx.reply("Couldn't process that voice message. Try again?");
      }
    });

    bot.on("message:video", async (ctx) => {
      try {
        await handleConversation(ctx);
      } catch (error) {
        logger.error("Error handling video", { error });
        await ctx.reply("Couldn't process that video. Try again?");
      }
    });
  }

  // Handle callback queries (inline keyboard button presses)
  bot.on("callback_query:data", async (ctx) => {
    try {
      await routeCallback(ctx);
    } catch (error) {
      logger.error("Error handling callback", { error });
      await ctx.answerCallbackQuery({ text: "Error processing. Try again." });
    }
  });

  // ==========================================
  // Procedural UI (Dynamic Use Case Selection)
  // ==========================================

  // Register dynamic use case handlers for pillar-specific workflows
  // These enable dynamic keyboards based on prompts from Notion
  import("./features/procedural-ui").then(({ registerProceduralHandlers }) => {
    registerProceduralHandlers(bot);
  }).catch((err) => {
    logger.warn("Failed to register procedural UI handlers:", err);
  });

  // ==========================================
  // Error handling & cleanup
  // ==========================================

  // Error handler
  bot.catch((err) => {
    logger.error("Bot error", { error: err.error, ctx: err.ctx });
  });

  // Periodic cleanup of stale operations
  setInterval(() => cleanupAll(30), 5 * 60 * 1000);

  // Register telegram_send tool callback for skill notifications
  registerTelegramSendCallback(async (chatId: number, message: string) => {
    await bot.api.sendMessage(chatId, message, { parse_mode: 'HTML' });
  });

  return bot;
}

/**
 * Start the bot (long polling)
 */
export async function startBot(bot: Bot<AtlasContext>): Promise<void> {
  logger.info("Starting bot with long polling...");

  // Delete webhook to ensure we're using polling
  await bot.api.deleteWebhook();

  // Initialize briefing system (send to first allowed user)
  const primaryUserId = parseInt(process.env.TELEGRAM_ALLOWED_USERS!.split(",")[0].trim(), 10);
  briefingSystem = initBriefings(bot.api, primaryUserId);
  briefingSystem.start();
  logger.info("Briefing system initialized", { userId: primaryUserId });

  // Initialize worker integration (for /work command notifications)
  initWorker(bot.api, primaryUserId);
  logger.info("Worker integration initialized", { userId: primaryUserId });

  // Start polling
  await bot.start({
    onStart: (botInfo) => {
      logger.info(`Bot started as @${botInfo.username}`, {
        conversationalUX: CONVERSATIONAL_UX_ENABLED,
        contentConfirm: CONTENT_CONFIRM_ENABLED,
      });
      console.log(`\n🤖 Atlas Bot is running as @${botInfo.username}`);
      console.log(`📋 Briefings scheduled: 7am, 12:30pm, 6pm ET`);
      console.log(`💬 Conversational UX: ${CONVERSATIONAL_UX_ENABLED ? 'ENABLED' : 'disabled'}`);
      console.log(`🔗 Content Confirm: ${CONTENT_CONFIRM_ENABLED ? 'ENABLED' : 'disabled'}\n`);
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
