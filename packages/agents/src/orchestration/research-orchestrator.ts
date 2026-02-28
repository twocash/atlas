/**
 * ResearchOrchestrator — Surface-agnostic research pipeline
 *
 * RPO-001: Extracted from apps/telegram/src/services/research-executor.ts.
 * All business logic lives here. Surface adapters handle delivery only.
 *
 * ADR-005: No Grammy, no Telegram, no surface-specific imports.
 */

import type { Agent, AgentResult } from "../types";
import type { ResearchConfig, ResearchResult } from "../agents/research";
import type { AgentRegistry } from "../registry";
import type { AndonAssessment, AndonInput } from "../services/andon-gate";
import type { ResearchConfigV2 } from "../types/research-v2";
import { wireAgentToWorkQueue, appendDispatchNotes } from "../workqueue";
import { assessOutput } from "../services/andon-gate";
import { isResearchConfigV2 } from "../types/research-v2";
import { composeResearchContext } from "../services/research-context";
import { getContentContext, getSocraticAnswer, getState } from "../conversation/conversation-state";
import { stashAgentResult } from "../conversation/context-manager";

// ==========================================
// Types
// ==========================================

export interface OrchestratorInput {
  /** Research configuration (V1 or V2) */
  config: ResearchConfig;

  /** Work Queue item ID for WQ wiring */
  workItemId?: string;

  /** Dispatch source for provenance tracing */
  source: string;

  /** Session ID for V2 context composition and result stashing.
   *  Maps to chatId for Telegram, could be anything for other surfaces. */
  sessionId?: number;
}

export interface OrchestratorResult {
  /** Final agent state */
  agent: Agent;

  /** Research execution result */
  result: AgentResult;

  /** Andon Gate assessment (null on failure) */
  assessment: AndonAssessment | null;

  /** True if research was blocked due to hallucination detection */
  hallucinationDetected: boolean;
}

// ==========================================
// Orchestrator
// ==========================================

/**
 * Execute a research task with full orchestration.
 *
 * Handles: agent lifecycle, Work Queue wiring, V2 context composition,
 * hallucination detection, Andon Gate assessment, result stashing.
 *
 * Does NOT handle: progress notifications, message formatting, review cards.
 * Those are surface adapter responsibilities.
 */
export async function orchestrateResearch(
  input: OrchestratorInput,
  registry: AgentRegistry,
): Promise<OrchestratorResult> {
  const { config, workItemId, source, sessionId } = input;

  // 1. Spawn agent — source embedded in name for WQ spawn comment provenance
  const agent = await registry.spawn({
    type: "research",
    name: `Research [${source}]: ${config.query.substring(0, 50)}`,
    instructions: JSON.stringify(config),
    priority: "P1",
    workItemId,
  });

  // 2. Wire to Work Queue (non-blocking)
  if (workItemId) {
    try {
      await wireAgentToWorkQueue(agent, registry);
    } catch (error) {
      console.warn("[ResearchOrchestrator] Work Queue wiring failed (non-blocking)", error);
    }
  }

  // 3. Start agent
  await registry.start(agent.id);

  try {
    // 4. V2 context composition from conversation state
    if (sessionId !== undefined && isResearchConfigV2(config)) {
      try {
        const contentCtx = getContentContext(sessionId);
        const socraticAnswer = getSocraticAnswer(sessionId);
        const convState = getState(sessionId);

        const sourceContext = composeResearchContext({
          preReaderSummary: contentCtx?.preReadSummary,
          preReaderContentType: contentCtx?.prefetchedUrlContent?.preReadContentType,
          extractedContent: contentCtx?.prefetchedUrlContent?.fullContent
            || contentCtx?.prefetchedUrlContent?.bodySnippet,
          socraticAnswer,
          sourceUrl: contentCtx?.url || config.sourceUrl,
          triageTitle: convState?.lastTriage?.title,
          triageConfidence: convState?.lastTriage?.confidence,
          triageKeywords: convState?.lastTriage?.keywords,
        });

        if (sourceContext) {
          (config as ResearchConfigV2).sourceContext = sourceContext;
          console.log('[ResearchOrchestrator] V2 context composed', {
            hasPreReader: sourceContext.preReaderAvailable,
            hasExtracted: !!sourceContext.extractedContent,
            contentType: sourceContext.contentType,
            estimatedTokens: sourceContext.estimatedTokens,
          });
        }
      } catch (contextError) {
        // Non-blocking — research proceeds without enrichment
        console.warn('[ResearchOrchestrator] Context composition failed (non-blocking)', contextError);
      }
    }

    // 5. Execute research
    const { executeResearch } = await import("../agents/research");
    const result = await executeResearch(config, agent, registry);

    // 6. Complete or fail agent
    let assessment: AndonAssessment | null = null;

    if (result.success) {
      await registry.complete(agent.id, result);

      // Append dispatch source for provenance (non-fatal)
      if (workItemId) {
        appendDispatchNotes(workItemId, source, 'success').catch(() => {});
      }

      // Andon Gate assessment — drives delivery calibration
      const researchResult = result.output as ResearchResult | undefined;
      const andonInput: AndonInput = {
        wasDispatched: true,
        groundingUsed: true, // Guaranteed: executeResearch throws on false
        sourceCount: researchResult?.sources?.length ?? 0,
        findingCount: researchResult?.findings?.length ?? 0,
        bibliographyCount: researchResult?.bibliography?.length ?? 0,
        durationMs: result.metrics?.durationMs ?? 0,
        summary: researchResult?.summary ?? '',
        originalQuery: researchResult?.query ?? agent.name ?? '',
        success: true,
        hallucinationGuardPassed: true,
        contentMode: researchResult?.contentMode,
        hasProseContent: !!(researchResult as any)?.proseContent,
        source,
      };
      assessment = assessOutput(andonInput);

      console.log("[ResearchOrchestrator] Andon assessment", {
        confidence: assessment.confidence,
        routing: assessment.routing,
        noveltyScore: assessment.noveltyScore,
        keyword: assessment.telemetry.keyword,
      });

      // Stash for follow-on conversion detection (Bug A — Session Continuity)
      if (sessionId !== undefined && researchResult?.summary) {
        const topicMatch = agent.name?.match(/^Research \[[^\]]+\]:\s*(.+)$/);
        const topic = topicMatch?.[1] ?? agent.name ?? 'research';
        stashAgentResult(sessionId, {
          topic: topic.substring(0, 200),
          resultSummary: researchResult.summary.substring(0, 500),
          source,
        });
      }
    } else {
      await registry.fail(agent.id, result.summary || "Research failed", true);
      if (workItemId) {
        appendDispatchNotes(workItemId, source, 'failure').catch(() => {});
      }
    }

    const finalAgent = await registry.status(agent.id);
    return {
      agent: finalAgent || agent,
      result,
      assessment,
      hallucinationDetected: false,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    const isHallucination = errorMessage.includes('HALLUCINATION');

    if (isHallucination) {
      console.error("[ResearchOrchestrator] Hallucination detected — research blocked", {
        agentId: agent.id,
        source,
        error: errorMessage,
      });
    } else {
      console.error("[ResearchOrchestrator] Research execution failed", {
        agentId: agent.id,
        source,
        error: errorMessage,
      });
    }

    await registry.fail(agent.id, errorMessage, true);

    const finalAgent = await registry.status(agent.id);
    return {
      agent: finalAgent || agent,
      result: {
        success: false,
        output: { error: errorMessage },
        summary: `Research failed: ${errorMessage}`,
      } as AgentResult,
      assessment: null,
      hallucinationDetected: isHallucination,
    };
  }
}
