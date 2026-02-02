/**
 * Atlas Telegram Bot - Research Executor Service
 *
 * Shared service for running research agents with Telegram notifications.
 * Extracted from agent-handler.ts to avoid circular dependencies.
 */

import type { Api } from "grammy";
import { logger } from "../logger";
import { markdownToHtml } from "../formatting";

// Import from @atlas/agents package
import {
  AgentRegistry,
  wireAgentToWorkQueue,
  type Agent,
  type AgentEvent,
  type ResearchConfig,
  type ResearchResult,
} from "../../../../packages/agents/src";

// ==========================================
// Shared Registry Instance
// ==========================================

/** Global registry for this bot instance */
export const registry = new AgentRegistry();

/** Track Telegram contexts for notifications */
const notificationContexts: Map<string, { chatId: number; bot: Api }> =
  new Map();

// ==========================================
// Research Execution
// ==========================================

/**
 * Run research agent with Telegram notifications
 */
export async function runResearchAgentWithNotifications(
  config: ResearchConfig,
  chatId: number,
  api: Api,
  workItemId?: string
): Promise<{ agent: Agent; result: any }> {
  // DEBUG: Log voice config being passed
  logger.info("Research config received", {
    query: config.query.substring(0, 50),
    depth: config.depth,
    voice: config.voice,
    hasVoiceInstructions: !!config.voiceInstructions,
    voiceInstructionsLength: config.voiceInstructions?.length || 0,
  });

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
      logger.info("Wiring agent to Work Queue", { agentId: agent.id, workItemId });
      await wireAgentToWorkQueue(agent, registry);
      logger.info("Work Queue wiring complete", { agentId: agent.id });
    } catch (error) {
      logger.error("Failed to wire to Work Queue", { error, agentId: agent.id, workItemId });
      // Continue anyway - research can still run
    }
  } else {
    logger.warn("No workItemId provided, skipping Work Queue wiring", { agentId: agent.id });
  }

  // Start and execute
  logger.info("Starting agent execution", { agentId: agent.id });
  await registry.start(agent.id);

  try {
    // Import and run the actual research
    logger.info("Importing research module...", { agentId: agent.id });
    const { executeResearch } = await import(
      "../../../../packages/agents/src/agents/research"
    );
    logger.info("Executing research...", { agentId: agent.id, query: config.query });
    const result = await executeResearch(config, agent, registry);
    logger.info("Research execution complete", { agentId: agent.id, success: result.success });

    // Complete or fail
    if (result.success) {
      logger.info("Marking agent as complete", { agentId: agent.id, hasSummary: !!result.summary });
      await registry.complete(agent.id, result);
      logger.info("Agent marked complete, event should fire", { agentId: agent.id });
    } else {
      logger.warn("Research failed, marking agent as failed", { agentId: agent.id, summary: result.summary });
      await registry.fail(agent.id, result.summary || "Research failed", true);
    }

    // Cleanup
    subscription.unsubscribe();
    notificationContexts.delete(agent.id);

    const finalAgent = await registry.status(agent.id);
    logger.info("Agent final status", { agentId: agent.id, status: finalAgent?.status });
    return { agent: finalAgent || agent, result };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    const errorStack = error instanceof Error ? error.stack : undefined;
    logger.error("Research execution threw exception", {
      agentId: agent.id,
      error: errorMessage,
      stack: errorStack
    });
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

// ==========================================
// Completion Notification
// ==========================================

/**
 * Send completion notification to Telegram
 */
export async function sendCompletionNotification(
  api: Api,
  chatId: number,
  agent: Agent,
  result: any,
  notionUrl?: string
): Promise<void> {
  if (result.success) {
    const researchResult = result.output as ResearchResult | undefined;

    let message = `✅ Research complete!\n\n`;

    if (researchResult?.summary) {
      // Truncate summary for Telegram and convert markdown to HTML
      const rawSummary =
        researchResult.summary.length > 500
          ? researchResult.summary.substring(0, 500) + "..."
          : researchResult.summary;
      const summary = markdownToHtml(rawSummary);
      message += `📝 Summary:\n${summary}\n\n`;
    }

    if (researchResult?.findings && researchResult.findings.length > 0) {
      message += `🔍 Key Findings:\n`;
      researchResult.findings.slice(0, 5).forEach((f, i) => {
        const claim = markdownToHtml(f.claim);
        message += `${i + 1}. ${claim}\n   [${f.source}]\n`;
      });
      message += "\n";
    }

    if (researchResult?.sources && researchResult.sources.length > 0) {
      message += `📚 Sources: ${researchResult.sources.length} found\n`;
    }

    // Show bibliography count for deep research
    if (researchResult?.bibliography && researchResult.bibliography.length > 0) {
      message += `📖 Bibliography: ${researchResult.bibliography.length} citations (Chicago style)\n`;
    }

    if (result.metrics) {
      const duration = Math.round(result.metrics.durationMs / 1000);
      message += `\n⏱ Completed in ${duration}s`;
      if (result.metrics.tokensUsed) {
        message += ` (${result.metrics.tokensUsed} tokens)`;
      }
    }

    // Always include Notion link for easy access
    if (notionUrl) {
      message += `\n\n📝 Full results: ${notionUrl}`;
    }

    await api.sendMessage(chatId, message);
  } else {
    let errorMessage = `❌ Research failed\n\n` +
      `Error: ${result.summary || agent.error || "Unknown error"}`;

    if (notionUrl) {
      errorMessage += `\n\n📝 Details: ${notionUrl}`;
    }

    await api.sendMessage(chatId, errorMessage);
  }
}
