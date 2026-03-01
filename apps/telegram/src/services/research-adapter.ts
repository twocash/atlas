/**
 * TelegramResearchAdapter — Delivery-only wrapper for research pipeline
 *
 * RPO-001: Zero business logic. All orchestration lives in packages/agents.
 * This file handles: Telegram notifications, message formatting, review cards.
 *
 * Contract: ≤150 LOC. If this file grows, business logic leaked into delivery.
 */

import type { Api } from "grammy";
import { logger } from "../logger";
import { markdownToHtml } from "../formatting";
import { validateResearchOutput, type ResearchOutput } from "../agents/validation";
import { isFeatureEnabled } from "../config/features";
import { createActionFeedEntry } from "../notion";
import type { ActionDataReview } from "../types";
import {
  AgentRegistry,
  type Agent,
  type ResearchConfig,
  type ResearchResult,
  assessOutput,
  type AndonInput,
  orchestrateResearch,
  type ProvenanceChain,
} from "../../../../packages/agents/src";
import { renderProvenanceTelegram } from "./provenance-render";

export const registry = new AgentRegistry();

export async function runResearchAgentWithNotifications(
  config: ResearchConfig,
  chatId: number,
  api: Api,
  workItemId?: string,
  source = 'unknown'
): Promise<{ agent: Agent; result: any }> {
  logger.info("Research adapter — delegating to orchestrator", {
    query: config.query.substring(0, 50),
    depth: config.depth,
    source,
  });

  const orchResult = await orchestrateResearch(
    { config, workItemId, source, sessionId: chatId },
    registry,
  );

  // Hallucination → Telegram notification
  if (orchResult.hallucinationDetected) {
    try {
      await api.sendMessage(chatId,
        '⚠️ Research blocked: hallucination detected. No fabricated results were delivered. Auto-logged to Dev Pipeline.'
      );
    } catch { /* notification failure must not propagate */ }
  }

  // Output validation (Telegram-specific wrapper)
  if (orchResult.result.success) {
    const out = orchResult.result.output as any;
    const researchOutput: ResearchOutput = {
      findings: out?.summary || orchResult.result.summary || '',
      confidence: out?.groundingUsed !== false ? 1.0 : 0.0,
      toolExecutions: out?.sources?.length > 0
        ? out.sources.map((s: string) => ({ tool: 'google_search', result: s }))
        : [],
      sources: out?.sources,
    };
    validateResearchOutput(researchOutput);

    // Review card — feature-gated, fail-open
    if (isFeatureEnabled('reviewProducer') && workItemId) {
      try {
        const reviewData: ActionDataReview = { wq_item_id: workItemId, wq_title: config.query.substring(0, 100) };
        await createActionFeedEntry('Review', reviewData, 'research-agent', `Review: ${config.query.substring(0, 80)}`, ['research-review']);
      } catch (e) { logger.warn("Review card failed (FAIL-OPEN)", { error: e }); }
    }
  }

  return { agent: orchResult.agent, result: orchResult.result };
}

export async function sendCompletionNotification(
  api: Api,
  chatId: number,
  agent: Agent,
  result: any,
  notionUrl?: string,
  source = 'unknown'
): Promise<void> {
  if (result.success) {
    const rr = result.output as ResearchResult | undefined;

    // Andon Gate — calibrate delivery framing
    const andonInput: AndonInput = {
      wasDispatched: true, groundingUsed: true,
      sourceCount: rr?.sources?.length ?? 0, findingCount: rr?.findings?.length ?? 0,
      bibliographyCount: rr?.bibliography?.length ?? 0, durationMs: result.metrics?.durationMs ?? 0,
      summary: rr?.summary ?? '', originalQuery: rr?.query ?? agent.name ?? '',
      success: true, hallucinationGuardPassed: true,
      contentMode: rr?.contentMode, hasProseContent: !!(rr as any)?.proseContent, source,
    };
    const assessment = assessOutput(andonInput);
    const { calibration } = assessment;

    let message = `${calibration.emoji} ${calibration.label}\n\n`;
    if (calibration.caveat) message += `${calibration.caveat}\n\n`;

    if (rr?.summary) {
      const raw = rr.summary.length > 500 ? rr.summary.substring(0, 500) + "..." : rr.summary;
      message += `📝 Summary:\n${markdownToHtml(raw)}\n\n`;
    }
    if (rr?.findings?.length) {
      message += `🔍 Key Findings:\n`;
      rr.findings.slice(0, 5).forEach((f, i) => { message += `${i + 1}. ${markdownToHtml(f.claim)}\n   [${f.source}]\n`; });
      message += "\n";
    }
    if (rr?.sources?.length) message += `📚 Sources: ${rr.sources.length} found\n`;
    if (rr?.bibliography?.length) message += `📖 Bibliography: ${rr.bibliography.length} citations (Chicago style)\n`;
    if (result.metrics) {
      const dur = Math.round(result.metrics.durationMs / 1000);
      message += `\n⏱ Completed in ${dur}s`;
      if (result.metrics.tokensUsed) message += ` (${result.metrics.tokensUsed} tokens)`;
    }
    message += `\n📊 Confidence: ${assessment.confidence}`;
    if (notionUrl) message += `\n\n📝 Full results: ${notionUrl}`;

    // Sprint A: Append provenance trace if available
    const provenanceChain = (result.output as any)?.provenanceChain as ProvenanceChain | undefined;
    if (provenanceChain) {
      message += `\n\n${renderProvenanceTelegram(provenanceChain)}`;
    }

    await api.sendMessage(chatId, message, { parse_mode: 'HTML' });
  } else {
    let errorMessage = `❌ Research failed\n\nError: ${result.summary || agent.error || "Unknown error"}`;
    if (notionUrl) errorMessage += `\n\n📝 Details: ${notionUrl}`;
    await api.sendMessage(chatId, errorMessage);
  }
}
