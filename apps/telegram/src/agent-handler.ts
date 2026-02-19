/**
 * Atlas Telegram Bot - Agent Command Handler
 *
 * Handles /agent commands for spawning and managing specialist agents.
 * Wires Research Agent execution to Telegram notifications.
 */

import type { Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { logger } from "./logger";
import { listVoices, loadVoice } from "./voice-manager";
import { store } from "./pending-research";
import {
  registry,
  runResearchAgentWithNotifications,
  sendCompletionNotification,
} from "./services/research-executor";

// Import from @atlas/agents package (relative path for now until package is linked)
import {
  createResearchWorkItem,
  type ResearchConfig,
  type ResearchDepth,
} from "../../../packages/agents/src";


// ==========================================
// Agent Command Router
// ==========================================

/**
 * Handle /agent commands
 *
 * Syntax:
 *   /agent research "query" [--light|--standard|--deep] [--focus "area"]
 *   /agent status
 *   /agent cancel <id>
 */
export async function handleAgentCommand(ctx: Context): Promise<void> {
  const text = ctx.message?.text || "";
  const args = text.replace(/^\/agent\s*/i, "").trim();

  if (!args) {
    await sendAgentHelp(ctx);
    return;
  }

  // Parse subcommand
  const [subcommand, ...rest] = args.split(/\s+/);
  const restText = rest.join(" ");

  switch (subcommand.toLowerCase()) {
    case "research":
      await handleResearchCommand(ctx, restText);
      break;

    case "status":
      await handleStatusCommand(ctx);
      break;

    case "cancel":
      await handleCancelCommand(ctx, restText);
      break;

    case "test":
      await handleTestCommand(ctx);
      break;

    default:
      await ctx.reply(
        `Unknown agent command: ${subcommand}\n\nUse /agent for help.`
      );
  }
}

// ==========================================
// Research Command
// ==========================================

/**
 * Handle /agent research "query"
 */
async function handleResearchCommand(
  ctx: Context,
  argsText: string
): Promise<void> {
  // Parse query from quotes or rest of text
  const queryMatch = argsText.match(/"([^"]+)"|'([^']+)'/) ||
    argsText.match(/^(.+?)(?:\s+--|\s*$)/);

  if (!queryMatch) {
    await ctx.reply(
      'Usage: /agent research "your query here"\n\n' +
        "Options:\n" +
        "  --light        Quick overview (2-3 sources, ~2k tokens)\n" +
        "  --standard     Thorough analysis (5-8 sources, ~8k tokens) [default]\n" +
        "  --deep         Academic rigor (10+ sources, ~25k tokens, Chicago citations)\n" +
        '  --focus "area" Narrow focus\n' +
        "  --voice <id>   Writing voice (grove, consulting, linkedin, personal)\n\n" +
        'Example:\n/agent research "AI coding assistant pricing" --deep --voice grove'
    );
    return;
  }

  const query = queryMatch[1] || queryMatch[2] || queryMatch[0];

  // Parse depth option
  // Normalize dashes: mobile keyboards often convert -- to em-dash (—) or en-dash (–)
  const normalizedArgs = argsText
    .replace(/—/g, "--")  // em-dash → --
    .replace(/–/g, "--")  // en-dash → --
    .replace(/-(?=[a-z])/g, "--"); // single dash before word → -- (e.g., -deep → --deep)

  let depth: ResearchDepth = "standard"; // default
  if (normalizedArgs.includes("--light")) {
    depth = "light";
  } else if (normalizedArgs.includes("--deep")) {
    depth = "deep";
  } else if (normalizedArgs.includes("--standard")) {
    depth = "standard";
  }

  // Parse focus option (use normalized args)
  const focusMatch = normalizedArgs.match(/--focus\s+["']?([^"'\s]+)["']?/);
  const focus = focusMatch ? focusMatch[1] : undefined;

  // Parse voice option
  const voiceMatch = normalizedArgs.match(/--voice\s+["']?([^"'\s]+)["']?/);
  const requestedVoice = voiceMatch?.[1]?.toLowerCase();

  // Store context for notifications
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const userId = ctx.from?.id || 0;

  // If no voice specified, show interactive selection
  if (!requestedVoice) {
    logger.info("No voice specified, loading voice profiles...");
    const voices = await listVoices();
    logger.info("Voice profiles loaded", { count: voices.length, voices: voices.map(v => v.id) });
    if (voices.length > 0) {
      // Generate unique request ID
      const requestId = crypto.randomUUID().slice(0, 8);

      // Store pending research request
      store(requestId, {
        chatId,
        userId,
        query: query.trim(),
        depth,
        focus,
        timestamp: Date.now(),
      });

      // Build inline keyboard with voice options
      const keyboard = new InlineKeyboard();
      voices.forEach((v, i) => {
        keyboard.text(v.name, `voice:${requestId}:${v.id}`);
        if ((i + 1) % 2 === 0) keyboard.row(); // 2 buttons per row
      });
      keyboard.row().text("❌ Cancel", `voice:${requestId}:cancel`);

      await ctx.reply(
        `🎙️ Select a voice for this research:\n\n` +
          `Query: "${query.trim()}"\n` +
          `Depth: ${depth}` +
          `${focus ? `\nFocus: ${focus}` : ""}`,
        { reply_markup: keyboard }
      );
      return; // Wait for callback
    }
  }

  // Voice specified (or no voice files exist) - proceed with execution
  let voiceInstructions: string | undefined;
  if (requestedVoice) {
    const loaded = await loadVoice(requestedVoice);
    voiceInstructions = loaded ?? undefined; // Convert null to undefined
    if (!voiceInstructions) {
      await ctx.reply(`⚠️ Voice '${requestedVoice}' not found. Using default.`);
    }
  }

  // Build config
  const config: ResearchConfig = {
    query: query.trim(),
    depth,
    focus,
    voice: voiceInstructions ? "custom" : undefined,
    voiceInstructions,
  };

  // Depth descriptions for user feedback
  const depthDescriptions: Record<ResearchDepth, string> = {
    light: "Quick overview (~2k tokens, 2-3 sources)",
    standard: "Thorough analysis (~8k tokens, 5-8 sources)",
    deep: "Academic rigor (~25k tokens, 10+ sources, Chicago citations)",
  };

  try {
    // Create a new Work Queue item for this research
    const { pageId: workItemId, url: notionUrl } = await createResearchWorkItem({
      query: config.query,
      depth,
      focus,
    });

    // Acknowledge with Notion link
    const voiceLabel = requestedVoice ? ` with <b>${requestedVoice}</b> voice` : "";
    await ctx.reply(
      `🔬 Starting research agent${voiceLabel}...\n\n` +
        `Query: "${config.query}"\n` +
        `Depth: ${depth} — ${depthDescriptions[depth]}\n` +
        `${focus ? `Focus: ${focus}\n` : ""}` +
        `\n📝 Notion: ${notionUrl}`,
      { parse_mode: "HTML" }
    );

    // Spawn and run the research agent
    const { agent, result } = await runResearchAgentWithNotifications(
      config,
      chatId,
      ctx.api,
      workItemId,
      'agent-command'
    );

    // Send completion notification with Notion link
    await sendCompletionNotification(ctx.api, chatId, agent, result, notionUrl, 'agent-command');
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    logger.error("Research agent failed", { error });
    await ctx.reply(`❌ Research failed: ${errorMessage}`);
  }
}

// ==========================================
// Status Command
// ==========================================

/**
 * Handle /agent status
 */
async function handleStatusCommand(ctx: Context): Promise<void> {
  const counts = registry.getStatusCounts();
  const running = registry.getRunningAgents();

  let message = `🤖 Agent Status\n\n`;

  message += `Running: ${counts.running}\n`;
  message += `Pending: ${counts.pending}\n`;
  message += `Completed: ${counts.completed}\n`;
  message += `Failed: ${counts.failed}\n`;

  if (running.length > 0) {
    message += `\n📋 Active Agents:\n`;
    running.forEach((agent) => {
      message += `• ${agent.type}: ${agent.name}\n`;
      message += `  ID: ${agent.id.substring(0, 20)}...\n`;
      if (agent.progress !== undefined) {
        message += `  Progress: ${agent.progress}%\n`;
      }
      if (agent.currentActivity) {
        message += `  Activity: ${agent.currentActivity}\n`;
      }
    });
  } else {
    message += `\nNo agents currently running.`;
  }

  await ctx.reply(message);
}

// ==========================================
// Cancel Command
// ==========================================

/**
 * Handle /agent cancel <id>
 */
async function handleCancelCommand(
  ctx: Context,
  idPrefix: string
): Promise<void> {
  if (!idPrefix) {
    await ctx.reply("Usage: /agent cancel <agent-id>");
    return;
  }

  // Find agent by ID prefix
  const agents = await registry.list({ status: ["running", "pending", "paused"] });
  const agent = agents.find((a) => a.id.startsWith(idPrefix));

  if (!agent) {
    await ctx.reply(`No active agent found matching: ${idPrefix}`);
    return;
  }

  try {
    await registry.terminate(agent.id, "Cancelled via Telegram");
    await ctx.reply(
      `🛑 Agent cancelled\n\n` +
        `ID: ${agent.id}\n` +
        `Name: ${agent.name}\n` +
        `Work Queue updated to Paused.`
    );
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    await ctx.reply(`Failed to cancel agent: ${errorMessage}`);
  }
}

// ==========================================
// Test Command
// ==========================================

/**
 * Handle /agent test - runs the integration test
 */
async function handleTestCommand(ctx: Context): Promise<void> {
  // Run the test query
  const config: ResearchConfig = {
    query: "What are the top 3 AI coding assistants and their pricing?",
    depth: "light",
    focus: "pricing",
  };

  const chatId = ctx.chat?.id;
  if (!chatId) return;

  try {
    // Create a new Work Queue item for the test
    const { pageId: workItemId, url: notionUrl } = await createResearchWorkItem({
      query: config.query,
      depth: "light", // Hardcoded for test command
      focus: config.focus,
    });

    await ctx.reply(
      `🧪 Running integration test...\n\n` +
        `This will:\n` +
        `1. Spawn a Research Agent\n` +
        `2. Update Work Queue item in real-time\n` +
        `3. Report back when complete\n\n` +
        `📝 Notion: ${notionUrl}`
    );

    const { agent, result } = await runResearchAgentWithNotifications(
      config,
      chatId,
      ctx.api,
      workItemId,
      'agent-command'
    );

    await sendCompletionNotification(ctx.api, chatId, agent, result, notionUrl, 'agent-command');
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    logger.error("Test failed", { error });
    await ctx.reply(`❌ Test failed: ${errorMessage}`);
  }
}

// ==========================================
// Help
// ==========================================

/**
 * Send agent command help
 */
async function sendAgentHelp(ctx: Context): Promise<void> {
  await ctx.reply(
    `🤖 Agent Commands\n\n` +
      `Spawn agents:\n` +
      `/agent research "query"\n` +
      `/agent research "query" --light\n` +
      `/agent research "query" --deep\n` +
      `/agent research "query" --focus "pricing"\n` +
      `/agent research "query" --voice grove\n\n` +
      `Research depths:\n` +
      `  --light    Quick (2-3 sources)\n` +
      `  --standard Default (5-8 sources)\n` +
      `  --deep     Academic (10+ sources)\n\n` +
      `Voice options:\n` +
      `  --voice grove      Technical thought leadership\n` +
      `  --voice consulting Executive/recommendations\n` +
      `  --voice linkedin   Punchy, shareable\n` +
      `  --voice personal   Reflective, growth-focused\n` +
      `  (omit for interactive selection)\n\n` +
      `Manage agents:\n` +
      `/agent status - List running agents\n` +
      `/agent cancel <id> - Stop an agent\n\n` +
      `Test:\n` +
      `/agent test - Run integration test\n\n` +
      `Example:\n` +
      `/agent research "AI coding assistant pricing" --deep --voice grove`
  );
}

// ==========================================
// Export Registry for External Use
// ==========================================

export { registry };
