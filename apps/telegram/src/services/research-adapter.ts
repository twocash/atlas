/**
 * TelegramResearchAdapter — Delivery-only wrapper for research pipeline
 *
 * RPO-001: Zero business logic. All orchestration lives in packages/agents.
 * Sprint B P2-1: Validation moved to orchestrator. Andon assessment deduped.
 *
 * This file handles ONLY: Telegram notifications, message formatting, review cards.
 */

import type { Api } from "grammy";
import { logger } from "../logger";
import { markdownToHtml } from "../formatting";
import { isFeatureEnabled } from "../config/features";
import { createActionFeedEntry } from "../notion";
import type { ActionDataReview } from "../types";
import {
  AgentRegistry,
  type Agent,
  type ResearchConfig,
  type ResearchResult,
  type AndonAssessment,
  assessOutput,
  type AndonInput,
  orchestrateResearch,
  type ProvenanceChain,
  updateFeedProvenance,
} from "../../../../packages/agents/src";
import { renderProvenanceTelegram } from "./provenance-render";

export const registry = new AgentRegistry();

export async function runResearchAgentWithNotifications(
  config: ResearchConfig,
  chatId: number,
  api: Api,
  workItemId?: string,
  source = 'unknown'
): Promise<{ agent: Agent; result: any; assessment: AndonAssessment | null }> {
  logger.info("Research adapter — delegating to orchestrator", {
    query: config.query.substring(0, 50),
    depth: config.depth,
    source,
  });

  const orchResult = await orchestrateResearch(
    { config, workItemId, source, sessionId: chatId },
    registry,
  );

  // Hallucination → Telegram notification (delivery only)
  if (orchResult.hallucinationDetected) {
    try {
      await api.sendMessage(chatId,
        '⚠️ Research blocked: hallucination detected. No fabricated results were delivered. Auto-logged to Dev Pipeline.'
      );
    } catch { /* notification failure must not propagate */ }
  }

  // Review card — feature-gated, fail-open (Telegram-specific delivery)
  if (orchResult.result.success && isFeatureEnabled('reviewProducer') && workItemId) {
    try {
      const reviewData: ActionDataReview = { wq_item_id: workItemId, wq_title: config.query.substring(0, 100) };
      await createActionFeedEntry('Review', reviewData, 'research-agent', `Review: ${config.query.substring(0, 80)}`, ['research-review']);
    } catch (e) { logger.warn("Review card failed (FAIL-OPEN)", { error: e }); }
  }

  return { agent: orchResult.agent, result: orchResult.result, assessment: orchResult.assessment };
}

export async function sendCompletionNotification(
  api: Api,
  chatId: number,
  agent: Agent,
  result: any,
  notionUrl?: string,
  source = 'unknown',
  precomputedAssessment?: AndonAssessment | null,
  feedId?: string,
): Promise<void> {
  if (result.success) {
    const rr = result.output as ResearchResult | undefined;

    // Use orchestrator's assessment if available, otherwise compute (backward compat)
    const assessment = precomputedAssessment ?? assessOutput({
      wasDispatched: true, groundingUsed: true,
      sourceCount: rr?.sources?.length ?? 0, findingCount: rr?.findings?.length ?? 0,
      bibliographyCount: rr?.bibliography?.length ?? 0, durationMs: result.metrics?.durationMs ?? 0,
      summary: rr?.summary ?? '', originalQuery: rr?.query ?? agent.name ?? '',
      success: true, hallucinationGuardPassed: true,
      contentMode: rr?.contentMode, hasProseContent: !!(rr as any)?.proseContent, source,
    } as AndonInput);
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

      // Sprint C: Post-hoc Feed provenance update (backfill citations + grade after research)
      if (feedId) {
        updateFeedProvenance(feedId, provenanceChain)
          .then(() => logger.info('Feed provenance backfilled', { feedId, citations: provenanceChain.result.citations.length }))
          .catch(err => logger.warn('Feed provenance update failed (non-fatal)', { feedId, error: (err as Error).message }));
      }
    }

    await api.sendMessage(chatId, message, { parse_mode: 'HTML' });
  } else {
    let errorMessage = `❌ Research failed\n\nError: ${result.summary || agent.error || "Unknown error"}`;
    if (notionUrl) errorMessage += `\n\n📝 Details: ${notionUrl}`;
    await api.sendMessage(chatId, errorMessage);
  }
}
