/**
 * Atlas Telegram Bot - Agent Command Handler
 *
 * Handles /agent commands for spawning and managing specialist agents.
 * Wires Research Agent execution to Telegram notifications.
 */

import type { Context } from "grammy";
import { logger } from "./logger";

// Import from @atlas/agents package (relative path for now until package is linked)
import {
  AgentRegistry,
  runResearchAgent,
  wireAgentToWorkQueue,
  type Agent,
  type AgentEvent,
  type ResearchConfig,
  type ResearchResult,
} from "../../../packages/agents/src";

// ==========================================
// Agent Registry Instance
// ==========================================

// Global registry for this bot instance
const registry = new AgentRegistry();

// Track Telegram contexts for notifications
const notificationContexts: Map<string, { chatId: number; bot: Context["api"] }> =
  new Map();

// ==========================================
// Test Work Queue Item ID
// ==========================================

const TEST_WORK_ITEM_ID = "2f8780a7-8eef-81cb-9aeb-ec26c5e039bc";

// ==========================================
// Agent Command Router
// ==========================================

/**
 * Handle /agent commands
 *
 * Syntax:
 *   /agent research "query" [--thorough] [--focus "area"]
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
        '  --thorough     More sources (5-8 vs 2-3)\n' +
        '  --focus "area" Narrow focus\n\n' +
        'Example:\n/agent research "AI coding assistant pricing" --thorough'
    );
    return;
  }

  const query = queryMatch[1] || queryMatch[2] || queryMatch[0];

  // Parse options
  const thorough = argsText.includes("--thorough");
  const focusMatch = argsText.match(/--focus\s+["']?([^"'\s]+)["']?/);
  const focus = focusMatch ? focusMatch[1] : undefined;

  // Build config
  const config: ResearchConfig = {
    query: query.trim(),
    depth: thorough ? "thorough" : "quick",
    focus,
  };

  // Acknowledge
  await ctx.reply(
    `🔬 Starting research agent...\n\n` +
      `Query: "${config.query}"\n` +
      `Depth: ${config.depth}\n` +
      `${focus ? `Focus: ${focus}\n` : ""}` +
      `\nWatch Notion for real-time updates.`
  );

  // Store context for notifications
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  try {
    // Spawn and run the research agent
    const { agent, result } = await runResearchAgentWithNotifications(
      config,
      chatId,
      ctx.api,
      TEST_WORK_ITEM_ID // Use test work item
    );

    // Send completion notification
    await sendCompletionNotification(ctx, agent, result);
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    logger.error("Research agent failed", { error });
    await ctx.reply(`❌ Research failed: ${errorMessage}`);
  }
}

/**
 * Run research agent with Telegram notifications
 */
async function runResearchAgentWithNotifications(
  config: ResearchConfig,
  chatId: number,
  api: Context["api"],
  workItemId?: string
): Promise<{ agent: Agent; result: any }> {
  // Spawn the agent
  const agent = await registry.spawn({
    type: "research",
    name: `Research: ${config.query.substring(0, 50)}`,
    instructions: JSON.stringify(config),
    priority: "P1",
    workItemId,
  });

  // Store notification context
  notificationContexts.set(agent.id, { chatId, bot: api });

  // Subscribe to progress events for Telegram updates
  const subscription = registry.subscribeToEvents(
    agent.id,
    ["progress"],
    async (event: AgentEvent) => {
      const data = event.data as { progress: number; activity?: string };
      // Only send updates at key milestones to avoid spam
      if (data.progress === 50 || data.progress === 90) {
        try {
          await api.sendMessage(
            chatId,
            `📊 Research ${data.progress}%: ${data.activity || "working..."}`
          );
        } catch (e) {
          // Ignore notification errors
        }
      }
    }
  );

  // Wire to Work Queue if we have an item ID
  if (workItemId) {
    try {
      await wireAgentToWorkQueue(agent, registry);
    } catch (error) {
      logger.warn("Failed to wire to Work Queue", { error });
      // Continue anyway - research can still run
    }
  }

  // Start and execute
  await registry.start(agent.id);

  try {
    // Import and run the actual research
    const { executeResearch } = await import(
      "../../../packages/agents/src/agents/research"
    );
    const result = await executeResearch(config, agent, registry);

    // Complete or fail
    if (result.success) {
      await registry.complete(agent.id, result);
    } else {
      await registry.fail(agent.id, result.summary || "Research failed", true);
    }

    // Cleanup
    subscription.unsubscribe();
    notificationContexts.delete(agent.id);

    const finalAgent = await registry.status(agent.id);
    return { agent: finalAgent || agent, result };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    await registry.fail(agent.id, errorMessage, true);
    subscription.unsubscribe();
    notificationContexts.delete(agent.id);

    const finalAgent = await registry.status(agent.id);
    return {
      agent: finalAgent || agent,
      result: { success: false, summary: errorMessage },
    };
  }
}

/**
 * Send completion notification to Telegram
 */
async function sendCompletionNotification(
  ctx: Context,
  agent: Agent,
  result: any
): Promise<void> {
  if (result.success) {
    const researchResult = result.output as ResearchResult | undefined;

    let message = `✅ Research complete!\n\n`;

    if (researchResult?.summary) {
      // Truncate summary for Telegram
      const summary =
        researchResult.summary.length > 500
          ? researchResult.summary.substring(0, 500) + "..."
          : researchResult.summary;
      message += `📝 Summary:\n${summary}\n\n`;
    }

    if (researchResult?.findings && researchResult.findings.length > 0) {
      message += `🔍 Key Findings:\n`;
      researchResult.findings.slice(0, 5).forEach((f, i) => {
        message += `${i + 1}. ${f.claim}\n   [${f.source}]\n`;
      });
      message += "\n";
    }

    if (researchResult?.sources && researchResult.sources.length > 0) {
      message += `📚 Sources: ${researchResult.sources.length} found\n`;
    }

    if (result.metrics) {
      const duration = Math.round(result.metrics.durationMs / 1000);
      message += `\n⏱ Completed in ${duration}s`;
      if (result.metrics.tokensUsed) {
        message += ` (${result.metrics.tokensUsed} tokens)`;
      }
    }

    await ctx.reply(message);
  } else {
    await ctx.reply(
      `❌ Research failed\n\n` +
        `Agent: ${agent.id}\n` +
        `Error: ${result.summary || agent.error || "Unknown error"}\n\n` +
        `Check Notion Work Queue for details.`
    );
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
  await ctx.reply(
    `🧪 Running integration test...\n\n` +
      `This will:\n` +
      `1. Spawn a Research Agent\n` +
      `2. Update Work Queue item in real-time\n` +
      `3. Report back when complete\n\n` +
      `Watch Notion: Work Queue 2.0 → "Test: Research Agent Integration"`
  );

  // Run the test query
  const config: ResearchConfig = {
    query: "What are the top 3 AI coding assistants and their pricing?",
    depth: "quick",
    focus: "pricing",
  };

  const chatId = ctx.chat?.id;
  if (!chatId) return;

  try {
    const { agent, result } = await runResearchAgentWithNotifications(
      config,
      chatId,
      ctx.api,
      TEST_WORK_ITEM_ID
    );

    await sendCompletionNotification(ctx, agent, result);
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
      `/agent research "query" --thorough\n` +
      `/agent research "query" --focus "pricing"\n\n` +
      `Manage agents:\n` +
      `/agent status - List running agents\n` +
      `/agent cancel <id> - Stop an agent\n\n` +
      `Test:\n` +
      `/agent test - Run integration test\n\n` +
      `Example:\n` +
      `/agent research "AI coding assistant pricing" --thorough`
  );
}

// ==========================================
// Export Registry for External Use
// ==========================================

export { registry };
