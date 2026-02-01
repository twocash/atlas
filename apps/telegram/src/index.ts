/**
 * Atlas Telegram Bot - Entry Point
 *
 * Initializes the bot and starts listening for messages.
 *
 * @see IMPLEMENTATION.md Sprint 1.2 for requirements
 */

// MUST be first - loads .env before any other imports
// Uses override:true to ensure .env values take precedence over system env vars
import { config } from 'dotenv';
config({ override: true });

import { createBot, startBot } from "./bot";
import { logger } from "./logger";
import { initAtlasSystem, updateHeartbeat, logUpdate } from "./atlas-system";
import { healthCheckOrDie } from "./health";
import { verifySystemIntegrity } from "./health/integrity";
import { initScheduler, stopScheduler, type ScheduledTask } from "./scheduler";
import { initMcp, shutdownMcp } from "./mcp";

async function main() {
  logger.info("Starting Atlas Telegram Bot...");

  // Run health checks (exits if critical failures)
  await healthCheckOrDie();

  // Verify database schema integrity (exits if corrupted)
  const isSystemHealthy = await verifySystemIntegrity();
  if (!isSystemHealthy) {
    logger.error("Startup Aborted: System Integrity Check Failed.");
    logger.error("Fix the database schema in Notion before restarting.");
    process.exit(1);
  }

  // Initialize Atlas system directory
  initAtlasSystem();
  updateHeartbeat({ status: "healthy", telegramConnected: true });
  logUpdate("STARTUP: Atlas initialized");

  // Initialize MCP connections (non-blocking)
  await initMcp().catch(err => {
    logger.warn("MCP initialization failed (non-fatal)", { error: err.message });
  });

  // Create and start the bot
  const bot = createBot();
  
  // Graceful shutdown handlers
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down gracefully...`);
    stopScheduler();
    await shutdownMcp();
    await bot.stop();
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  // Start the bot
  await startBot(bot);

  // Initialize scheduler after bot is running
  await initScheduler(async (task: ScheduledTask) => {
    logger.info('Executing scheduled task', { id: task.id, action: task.action });

    // Send message to Jim's chat
    const jimChatId = process.env.TELEGRAM_ALLOWED_USERS?.split(',')[0];
    if (!jimChatId) return;

    try {
      switch (task.action) {
        case 'send_message':
          await bot.api.sendMessage(jimChatId, `⏰ Scheduled: ${task.target}`);
          break;
        case 'execute_skill':
          await bot.api.sendMessage(jimChatId, `⏰ Running skill: ${task.target}\n(Skill execution coming soon)`);
          break;
        case 'run_script':
          await bot.api.sendMessage(jimChatId, `⏰ Running script: ${task.target}\n(Script execution coming soon)`);
          break;
      }
    } catch (err) {
      logger.error('Failed to execute scheduled task', { id: task.id, error: err });
    }
  });
}

main().catch((error) => {
  logger.error("Fatal error starting bot", { error });
  process.exit(1);
});
