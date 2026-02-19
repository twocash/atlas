/**
 * Atlas Telegram Bot - Research Executor Service
 *
 * Shared service for running research agents with Telegram notifications.
 * Extracted from agent-handler.ts to avoid circular dependencies.
 */

import type { Api } from "grammy";
import { logger } from "../logger";
import { markdownToHtml } from "../formatting";
import { validateResearchOutput, type ResearchOutput } from "../agents/validation";
import { HallucinationError } from "../errors";
import { isFeatureEnabled } from "../config/features";
import { createActionFeedEntry } from "../notion";
import type { ActionDataReview } from "../types";
import { stashAgentResult } from "../conversation/context-manager";

// Import from @atlas/agents package
import {
  AgentRegistry,
  wireAgentToWorkQueue,
  appendDispatchNotes,
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
 *
 * @param source - Originating entry point for provenance tracing (e.g. 'content-confirm').
 *   Defaults to 'unknown' so existing callers don't break, but every call site MUST pass
 *   an explicit source identifier. 'unknown' is a loud signal that fingerprinting was missed.
 */
export async function runResearchAgentWithNotifications(
  config: ResearchConfig,
  chatId: number,
  api: Api,
  workItemId?: string,
  source = 'unknown'
): Promise<{ agent: Agent; result: any }> {
  // DEBUG: Log voice config being passed
  logger.info("Research config received", {
    query: config.query.substring(0, 50),
    depth: config.depth,
    voice: config.voice,
    hasVoiceInstructions: !!config.voiceInstructions,
    voiceInstructionsLength: config.voiceInstructions?.length || 0,
    source,
  });

  // Spawn the agent — source embedded in name for WQ spawn comment provenance
  const agent = await registry.spawn({
    type: "research",
    name: `Research [${source}]: ${config.query.substring(0, 50)}`,
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

    // Validate research output before accepting it
    if (result.success) {
      const researchOutput: ResearchOutput = {
        findings: result.output?.summary || result.summary || '',
        confidence: result.output?.groundingUsed !== false ? 1.0 : 0.0,
        toolExecutions: result.output?.sources?.length > 0
          ? result.output.sources.map((s: string) => ({ tool: 'google_search', result: s }))
          : [],
        sources: result.output?.sources,
      };
      validateResearchOutput(researchOutput);
    }

    // Complete or fail
    if (result.success) {
      logger.info("Marking agent as complete", { agentId: agent.id, hasSummary: !!result.summary, source });
      await registry.complete(agent.id, result);
      logger.info("Agent marked complete, event should fire", { agentId: agent.id, source });

      // Append dispatch source to WQ Notes for provenance tracing (non-fatal)
      if (workItemId) {
        appendDispatchNotes(workItemId, source, 'success').catch(() => {/* non-fatal, already warned inside */});
      }

      // P3 Review Card — FAIL-OPEN: card failure does NOT block delivery
      if (isFeatureEnabled('reviewProducer') && workItemId) {
        try {
          const reviewData: ActionDataReview = {
            wq_item_id: workItemId,
            wq_title: config.query.substring(0, 100),
          };
          await createActionFeedEntry(
            'Review',
            reviewData,
            'research-agent',
            `Review: ${config.query.substring(0, 80)}`,
            ['research-review']
          );
          logger.info("Review card created", { agentId: agent.id, workItemId });
        } catch (reviewError) {
          logger.warn("Review card creation failed (FAIL-OPEN)", { agentId: agent.id, error: reviewError });
        }
      }
    } else {
      logger.warn("Research failed, marking agent as failed", { agentId: agent.id, summary: result.summary, source });
      await registry.fail(agent.id, result.summary || "Research failed", true);

      // Append dispatch source to WQ Notes even on failure (non-fatal)
      if (workItemId) {
        appendDispatchNotes(workItemId, source, 'failure').catch(() => {/* non-fatal, already warned inside */});
      }
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

    // Detect hallucination errors — from research.ts throws or validateResearchOutput
    if (error instanceof HallucinationError || (error instanceof Error && error.message.includes('HALLUCINATION'))) {
      const hallError = error instanceof HallucinationError
        ? error
        : new HallucinationError(error.message, { agentId: agent.id, query: config.query });
      // Auto-logs to Dev Pipeline via constructor

      logger.error("Hallucination detected in research", {
        agentId: agent.id,
        error: hallError.message,
        source,
        workItemId,
      });

      try {
        await api.sendMessage(chatId,
          '⚠️ Research blocked: hallucination detected. No fabricated results were delivered. Auto-logged to Dev Pipeline.'
        );
      } catch { /* notification failure must not propagate */ }

      await registry.fail(agent.id, hallError.message, true);
      subscription.unsubscribe();
      notificationContexts.delete(agent.id);

      const finalAgent = await registry.status(agent.id);
      return { agent: finalAgent || agent, result: { success: false, summary: hallError.message } };
    }

    logger.error("Research execution threw exception", {
      agentId: agent.id,
      error: errorMessage,
      stack: errorStack,
      source,
      workItemId,
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
 *
 * @param source - Originating entry point, passed through for analytics logging.
 */
export async function sendCompletionNotification(
  api: Api,
  chatId: number,
  agent: Agent,
  result: any,
  notionUrl?: string,
  source = 'unknown'
): Promise<void> {
  logger.info("Sending completion notification", { agentId: agent.id, success: result.success, source });
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

    // Stash result for follow-on conversion detection (Bug A — Session Continuity)
    if (researchResult?.summary) {
      const topicMatch = agent.name?.match(/^Research \[[^\]]+\]:\s*(.+)$/);
      const topic = topicMatch?.[1] ?? agent.name ?? 'research';
      stashAgentResult(chatId, {
        topic: topic.substring(0, 200),
        resultSummary: researchResult.summary.substring(0, 500),
        source,
      });
    }
  } else {
    let errorMessage = `❌ Research failed\n\n` +
      `Error: ${result.summary || agent.error || "Unknown error"}`;

    if (notionUrl) {
      errorMessage += `\n\n📝 Details: ${notionUrl}`;
    }

    await api.sendMessage(chatId, errorMessage);
  }
}
