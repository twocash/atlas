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
import type { AndonAssessment, AndonInput, DiagnosticAssessment } from "../services/andon-gate";
import type { ResearchConfigV2 } from "../types/research-v2";
import { wireAgentToWorkQueue, appendDispatchNotes } from "../workqueue";
import { assessOutputWithDiagnostics } from "../services/andon-gate";
import { composeResearchContext } from "../services/research-context";
import { getContentContext, getSocraticAnswer, getState } from "../conversation/conversation-state";
import { stashAgentResult } from "../conversation/context-manager";
import { getResearchPipelineConfig } from "../config";
import type { ProvenanceChain } from "../types/provenance";
import { setResult as setProvenanceResult } from "../provenance";
import { logger } from '../logger';

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
// Helpers
// ==========================================

/**
 * Extract source title signals for Andon Gate relevance scoring.
 * Sprint B P1-2: Speculative Padding Guard.
 *
 * Combines finding source descriptions + domain/path tokens from source URLs.
 * This gives the Andon Gate enough signal to detect tangential sources
 * (e.g., query about "quantum 2026" returning sources about "quantum history").
 */
function extractSourceTitles(researchResult: ResearchResult | undefined): string[] {
  if (!researchResult) return [];
  const titles: string[] = [];

  // Finding source descriptions (e.g., "TechCrunch", "Anthropic Blog")
  if (researchResult.findings) {
    for (const f of researchResult.findings) {
      if (f.source) titles.push(f.source);
    }
  }

  // URL domain + path tokens (e.g., "arxiv.org/quantum-computing" → "arxiv quantum computing")
  if (researchResult.sources) {
    for (const url of researchResult.sources) {
      try {
        const parsed = new URL(url);
        // Domain minus common prefixes
        const domain = parsed.hostname.replace(/^www\./, '');
        // Path segments (strip extensions, IDs)
        const pathTokens = parsed.pathname
          .split('/')
          .filter(s => s.length > 2 && !/^\d+$/.test(s) && !/\.\w{2,4}$/.test(s))
          .join(' ');
        titles.push(`${domain} ${pathTokens}`);
      } catch {
        // Invalid URL — skip
      }
    }
  }

  return titles;
}

// ==========================================
// Output Validation (Sprint B P2-1: moved from adapter)
// ==========================================

/**
 * Validate research output post-execution.
 * Throws on hallucination indicators so the catch block handles it.
 *
 * Checks:
 *   1. Tool execution — did the agent produce sources? (no sources = no grounding)
 *   2. Notion URL fabrication — are embedded Notion URLs backed by actual sources?
 *
 * Moved from apps/telegram/src/agents/validation.ts (Sprint B P2-1)
 * to make validation surface-agnostic per ADR-005.
 */
function validateResearchResult(output: ResearchResult | undefined): void {
  if (!output) return; // No output to validate

  // Check 1: Sources present (proxy for tool execution)
  const hasSources = output.sources && output.sources.length > 0;
  const hasFindings = output.findings && output.findings.length > 0;
  if (!hasSources && !hasFindings) {
    throw new Error(
      'HALLUCINATION: Research completed without producing sources or findings'
    );
  }

  // Check 2: No fabricated Notion URLs in summary
  if (output.summary) {
    const notionUrls = output.summary.match(
      /https:\/\/(?:www\.)?notion\.so\/[a-zA-Z0-9\-/]+/g
    ) || [];
    for (const url of notionUrls) {
      const pageIdMatch = url.match(/([a-f0-9]{32})$/i) || url.match(/([a-f0-9-]{36})$/i);
      if (pageIdMatch) {
        const pageId = pageIdMatch[1].replace(/-/g, '');
        const sourcesStr = JSON.stringify(output.sources || []);
        if (!sourcesStr.includes(pageId)) {
          throw new Error(
            `HALLUCINATION: Fabricated Notion URL in research output: ${url}`
          );
        }
      }
    }
  }
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

  // 0. Resolve Research Pipeline Config (DRC-001a)
  // Single resolution point — populates sync cache for downstream consumers
  const resolvedConfig = await getResearchPipelineConfig();
  logger.info('[ResearchOrchestrator] Config resolved', {
    configSource: resolvedConfig.configSource,
    name: resolvedConfig.config.name,
  });

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
      logger.warn("[ResearchOrchestrator] Work Queue wiring failed (non-blocking)", { error: error instanceof Error ? error.message : String(error) });
    }
  }

  // 3. Start agent
  await registry.start(agent.id);

  try {
    // 4. Context composition from conversation state
    // Always attempted when sessionId is present — V1/V2 guard removed.
    // composeResearchContext degrades gracefully when fields are missing.
    if (sessionId !== undefined) {
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
          sourceUrl: contentCtx?.url || (config as ResearchConfigV2).sourceUrl,
          triageTitle: convState?.lastTriage?.title,
          triageConfidence: convState?.lastTriage?.confidence,
          triageKeywords: convState?.lastTriage?.keywords,
        });

        if (sourceContext) {
          (config as ResearchConfigV2).sourceContext = sourceContext;
          logger.info('[ResearchOrchestrator] Context composed', {
            hasPreReader: sourceContext.preReaderAvailable,
            hasExtracted: !!sourceContext.extractedContent,
            contentType: sourceContext.contentType,
            estimatedTokens: sourceContext.estimatedTokens,
          });
        } else {
          logger.info('[ResearchOrchestrator] No upstream context available (command dispatch without prior URL/content)');
        }
      } catch (contextError) {
        // Non-blocking — research proceeds without enrichment
        logger.warn('[ResearchOrchestrator] Context composition failed (non-blocking)', { error: contextError instanceof Error ? contextError.message : String(contextError) });
      }
    } else {
      logger.warn('[ResearchOrchestrator] No sessionId — context composition skipped');
    }

    // 5. Execute research
    const { executeResearch } = await import("../agents/research");
    const result = await executeResearch(config, agent, registry);

    // 5b. Post-execution output validation (Sprint B P2-1: moved from adapter)
    if (result.success) {
      validateResearchResult(result.output as ResearchResult | undefined);
    }

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

      // Sprint B P1-2: Extract source titles for relevance scoring
      const sourceTitles = extractSourceTitles(researchResult);

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
        sourceTitles,
        claimFlags: (result.output as any)?.claimFlags,  // Sprint C
      };
      assessment = assessOutputWithDiagnostics(andonInput, resolvedConfig.config.andonThresholds, {
        query: config.query,
        source,
      });

      // Sprint A: Update provenance chain with Andon assessment
      const provenanceChain = (result.output as any)?.provenanceChain as ProvenanceChain | undefined;
      if (provenanceChain) {
        setProvenanceResult(provenanceChain, {
          andonGrade: assessment.confidence,        // Categorical: 'grounded' | 'informed' | 'speculative' | 'insufficient'
          andonConfidence: assessment.noveltyScore,  // Numeric: 0-1
        });
      }

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
    const isFidelityFailure = errorMessage.includes('HALLUCINATION:FIDELITY');

    if (isHallucination) {
      logger.error("[ResearchOrchestrator] Hallucination detected — research blocked", {
        agentId: agent.id,
        source,
        error: errorMessage,
        fidelityFailure: isFidelityFailure,
      });
    } else {
      logger.error("[ResearchOrchestrator] Research execution failed", {
        agentId: agent.id,
        source,
        error: errorMessage,
      });
    }

    await registry.fail(agent.id, errorMessage, true);

    // Extract Kaizen context for fidelity failures
    let kaizen: { type: string; phase1Topics: string[]; fidelityScore?: string } | undefined;
    if (isFidelityFailure) {
      const topicsMatch = errorMessage.match(/Phase 1 topics: (.+)$/);
      const scoreMatch = errorMessage.match(/fidelity (\d+)%/);
      kaizen = {
        type: 'fidelity',
        phase1Topics: topicsMatch ? topicsMatch[1].split(', ') : [],
        fidelityScore: scoreMatch ? scoreMatch[1] + '%' : undefined,
      };
    }

    const finalAgent = await registry.status(agent.id);
    return {
      agent: finalAgent || agent,
      result: {
        success: false,
        output: { error: errorMessage, kaizen },
        summary: `Research failed: ${errorMessage}`,
      } as AgentResult,
      assessment: null,
      hallucinationDetected: isHallucination,
    };
  }
}
