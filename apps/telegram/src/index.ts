/**
 * Atlas Telegram Bot - Entry Point
 * 
 * Initializes the bot and starts listening for messages.
 * 
 * @see IMPLEMENTATION.md Sprint 1.2 for requirements
 */

import dotenv from "dotenv";
dotenv.config({ override: true });
import { createBot, startBot } from "./bot";
import { logger } from "./logger";
import { initAtlasSystem, updateHeartbeat, logUpdate } from "./atlas-system";
import { healthCheckOrDie } from "./health";

async function main() {
  logger.info("Starting Atlas Telegram Bot...");

  // Run health checks (exits if critical failures)
  await healthCheckOrDie();

  // Initialize Atlas system directory
  initAtlasSystem();
  updateHeartbeat({ status: "healthy", telegramConnected: true });
  logUpdate("STARTUP: Atlas initialized");

  // Create and start the bot
  const bot = createBot();
  
  // Graceful shutdown handlers
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down gracefully...`);
    await bot.stop();
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  // Start the bot
  await startBot(bot);
}

main().catch((error) => {
  logger.error("Fatal error starting bot", { error });
  process.exit(1);
});
