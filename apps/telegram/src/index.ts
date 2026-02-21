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
import { validateEnvironment } from "./config/environment";
import { initAtlasSystem, updateHeartbeat, logUpdate } from "./atlas-system";
import { healthCheckOrDie } from "./health";
import { verifySystemIntegrity } from "./health/integrity";
import { runVoiceHealthCheck } from "./health/voice-check";
import { initScheduler, stopScheduler, type ScheduledTask } from "./scheduler";
import { initMcp, shutdownMcp } from "./mcp";
import { startStatusServer, stopStatusServer } from "./health/status-server";
import { initializeSkillRegistry } from "./skills";
import { startSelfImprovementListener, stopSelfImprovementListener } from "./listeners/self-improvement";
import { getPromptManager } from "../../../packages/agents/src/services/prompt-manager";
import { startHealthAlertProducer, stopHealthAlertProducer } from "./feed/alert-producer";
import { startApprovalListener, stopApprovalListener } from "./feed/approval-listener";
import { startReviewListener, stopReviewListener } from "./feed/review-listener";
import { existsSync, writeFileSync, unlinkSync, readFileSync } from "fs";
import { join } from "path";

// Process lock file to prevent multiple instances
const LOCK_FILE = join(process.cwd(), 'data', '.atlas.lock');

function acquireLock(): boolean {
  try {
    if (existsSync(LOCK_FILE)) {
      const content = readFileSync(LOCK_FILE, 'utf-8');
      const { pid, startedAt } = JSON.parse(content);

      // Check if the process is still running (Unix-style check won't work on Windows)
      // Instead, check if lock is stale (> 5 minutes old without update)
      const lockAge = Date.now() - new Date(startedAt).getTime();
      const STALE_THRESHOLD = 5 * 60 * 1000; // 5 minutes

      if (lockAge < STALE_THRESHOLD) {
        logger.error('Another Atlas instance is already running!', {
          existingPid: pid,
          startedAt,
          lockAge: `${Math.round(lockAge / 1000)}s`
        });
        return false;
      }

      logger.warn('Stale lock file found, overwriting', { existingPid: pid, lockAge: `${Math.round(lockAge / 1000)}s` });
    }

    // Write lock file
    writeFileSync(LOCK_FILE, JSON.stringify({
      pid: process.pid,
      startedAt: new Date().toISOString(),
    }));

    return true;
  } catch (err) {
    logger.error('Failed to acquire lock', { error: err });
    return false;
  }
}

function releaseLock(): void {
  try {
    if (existsSync(LOCK_FILE)) {
      unlinkSync(LOCK_FILE);
    }
  } catch (err) {
    logger.warn('Failed to release lock', { error: err });
  }
}

async function main() {
  logger.info("Starting Atlas Telegram Bot...");

  // Validate environment configuration (exits if production + fallbacks enabled)
  const envConfig = validateEnvironment();
  logger.info("Environment validated", {
    mode: envConfig.mode,
    enableFallbacks: envConfig.enableFallbacks,
    autoLogErrors: envConfig.autoLogErrors,
  });

  // Prevent multiple instances
  if (!acquireLock()) {
    logger.error('STARTUP ABORTED: Another instance is running. Kill it first with: taskkill /f /im bun.exe');
    process.exit(1);
  }

  // Run health checks (exits if critical failures)
  await healthCheckOrDie();

  // Verify database schema integrity (exits if corrupted)
  const isSystemHealthy = await verifySystemIntegrity();
  if (!isSystemHealthy) {
    logger.error("Startup Aborted: System Integrity Check Failed.");
    logger.error("Fix the database schema in Notion before restarting.");
    process.exit(1);
  }

  // Verify voice configuration (non-fatal, but warns loudly)
  await runVoiceHealthCheck();

  // Initialize Atlas system directory
  initAtlasSystem();
  updateHeartbeat({ status: "healthy", telegramConnected: true });
  logUpdate("STARTUP: Atlas initialized");

  // Initialize MCP connections (non-blocking)
  await initMcp().catch(err => {
    logger.warn("MCP initialization failed (non-fatal)", { error: err.message });
  });

  // Initialize skill registry (loads skills from data/skills)
  await initializeSkillRegistry().catch(err => {
    logger.warn("Skill registry initialization failed (non-fatal)", { error: err.message });
  });

  // Initialize PromptManager singleton (Sprint: Prompt Manager Wiring)
  // Warm-up validates Notion connectivity — LOUD fail if DB unreachable
  try {
    const pm = getPromptManager();
    const systemPrompt = await pm.getPromptById('system.general');
    if (systemPrompt) {
      logger.info("PromptManager initialized (System prompt loaded from Notion)");
    } else {
      logger.error("PROMPT MANAGER: System prompt not found at startup — hardcoded fallback will be used", {
        promptId: 'system.general',
        dbId: process.env.NOTION_PROMPTS_DB_ID || 'NOT SET',
        fix: [
          '1. Verify NOTION_PROMPTS_DB_ID is set in .env',
          '2. Run seed migration: bun run apps/telegram/data/migrations/seed-prompts.ts',
          '3. Confirm Notion DB contains a row with ID=system.general',
        ],
      });
    }
  } catch (err) {
    logger.error("PROMPT MANAGER: Warm-up failed — Notion prompt DB unreachable", {
      error: err,
      envVar: process.env.NOTION_PROMPTS_DB_ID ? 'SET' : 'MISSING',
      fix: [
        '1. Check NOTION_PROMPTS_DB_ID in .env (expected: 2fc780a78eef8196b29bdb4a6adfdc27)',
        '2. Verify NOTION_API_KEY is valid and has access to the prompts DB',
        '3. Check network connectivity to Notion API',
      ],
    });
  }

  // Start self-improvement listener (Sprint: Pit Stop)
  // Polls Feed 2.0 for self-improvement entries and auto-dispatches to pit crew
  try {
    startSelfImprovementListener();
  } catch (err) {
    logger.warn("Self-improvement listener failed to start (non-fatal)", { error: err });
  }

  // Start health alert producer (Sprint: Action Feed Producer Wiring)
  // Periodic health checks → Feed 2.0 Alert entries for Chrome extension + self-healing
  try {
    startHealthAlertProducer();
  } catch (err) {
    logger.warn("Health alert producer failed to start (non-fatal)", { error: err });
  }

  // Start approval listener (P2: Tier 2 skill permission gate)
  // Polls Feed 2.0 for Approval cards that have been Actioned/Dismissed
  try {
    startApprovalListener();
  } catch (err) {
    logger.warn("Approval listener failed to start (non-fatal)", { error: err });
  }

  // Start review listener (P3: Research quality gate)
  // Polls Feed 2.0 for Review cards with Accept/Revise/Reject disposition
  try {
    startReviewListener();
  } catch (err) {
    logger.warn("Review listener failed to start (non-fatal)", { error: err });
  }

  // Start status server for Chrome extension heartbeat
  try {
    startStatusServer(3847);
  } catch (err) {
    logger.warn("Status server failed to start (non-fatal)", { error: err });
  }

  // Create and start the bot
  const bot = createBot();
  
  // Graceful shutdown handlers
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down gracefully...`);
    stopScheduler();
    stopSelfImprovementListener();
    stopHealthAlertProducer();
    stopApprovalListener();
    stopReviewListener();
    stopStatusServer();
    await shutdownMcp();
    await bot.stop();
    releaseLock();
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
