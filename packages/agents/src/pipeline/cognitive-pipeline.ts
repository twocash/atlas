/**
 * CognitivePipeline — Unified Entry Point for Phase 6 Architecture
 *
 * This is the "new orchestrator" — the integration layer that wires
 * together all Phase 6 components:
 *
 *   1. Surface → context + device tools
 *   2. Triage → CognitiveTask
 *   3. Context assembler → AssemblyResult
 *   4. Router → ExecutionStrategy (tier, model, mode, backend)
 *   5. Tool executor → bidirectional desk/device routing
 *   6. Backend.execute() → response chunks
 *   7. Surface.reply() → delivery
 *
 * The Phase 5 orchestrator (orchestrator.ts) continues to handle the
 * legacy PipelineSurfaceHooks path. This pipeline runs in parallel
 * during migration, eventually replacing orchestrateMessage().
 *
 * Sprint: ARCH-CPE-001 Phase 6 — Unified Cognitive Architecture
 */

import { logger } from '../logger';
import type { TriageResult } from '../cognitive/triage-skill';
import type { AtlasSurface } from './surface';
import type { SystemCapabilities } from './system';
import type { RouterConfig } from './router-config';
import type { CognitiveTask, AssemblyResult } from './router';
import { route, checkContextRequirements } from './router';
import { OrchestratorToolExecutor } from './tool-executor';
import { mergeTools } from './tool-executor';
import type { ContextAssembler } from './context-assembly';

// ─── Pipeline Request ───────────────────────────────────

export interface PipelineRequest {
  /** The user's message text */
  message: string;
  /** User ID for session continuity */
  userId: number;
  /** Pre-computed triage result */
  triage: TriageResult;
  /** Whether this is a follow-on from a previous turn */
  isFollowOn?: boolean;
}

// ─── Pipeline Result ────────────────────────────────────

export interface PipelineResult {
  /** Final response text */
  responseText: string;
  /** Which tier was used */
  tier: number;
  /** Which model was used */
  model: string;
  /** Which backend executed the request */
  backendId: string;
  /** Execution mode */
  mode: string;
  /** Tools that were used */
  toolsUsed: string[];
  /** Context slots populated */
  slotsPopulated: string[];
  /** Total tokens consumed */
  totalTokens: number;
  /** Total latency */
  totalLatencyMs: number;
  /** Whether context was sufficient */
  contextSufficient: boolean;
  /** User message if context was insufficient */
  contextMessage?: string;
}

// ─── Pipeline ───────────────────────────────────────────

export class CognitivePipeline {
  private readonly system: SystemCapabilities;
  private readonly config: RouterConfig;
  private readonly assembler: ContextAssembler;

  constructor(
    system: SystemCapabilities,
    config: RouterConfig,
    assembler: ContextAssembler,
  ) {
    this.system = system;
    this.config = config;
    this.assembler = assembler;
  }

  /**
   * Process a message through the full cognitive pipeline.
   *
   * Flow:
   *   surface.getContext() → assembler.assemble() → router.route()
   *   → context check → backend.execute() → surface.reply()
   */
  async process(
    request: PipelineRequest,
    surface: AtlasSurface,
  ): Promise<PipelineResult> {
    const startMs = Date.now();
    const toolsUsed: string[] = [];

    // 1. Build cognitive task from triage
    const task: CognitiveTask = {
      message: request.message,
      triage: request.triage,
      userId: request.userId,
      isFollowOn: request.isFollowOn ?? false,
      requiresToolUse: request.triage.intent === 'command',
    };

    // 2. Get surface context
    const surfaceContext = await surface.getContext();

    // 3. Assemble context
    const assembly = await this.assembler.assemble({
      message: request.message,
      userId: request.userId,
      triage: request.triage,
      surfaceContext,
      surfaceId: surface.surfaceId,
    });

    // 4. Check context requirements
    const contextCheck = checkContextRequirements(task, assembly);
    if (!contextCheck.sufficient) {
      // Reply with the context requirement message and return
      if (contextCheck.userMessage) {
        await surface.reply(contextCheck.userMessage);
      }
      return {
        responseText: contextCheck.userMessage ?? 'Insufficient context.',
        tier: 0,
        model: 'none',
        backendId: 'none',
        mode: 'deterministic',
        toolsUsed: [],
        slotsPopulated: assembly.slotsPopulated,
        totalTokens: 0,
        totalLatencyMs: Date.now() - startMs,
        contextSufficient: false,
        contextMessage: contextCheck.userMessage,
      };
    }

    // 5. Merge desk + device tools
    const allTools = mergeTools(this.system.deskTools, surface);

    // 6. Route — select tier, model, mode, backend
    const strategy = route(
      task,
      assembly,
      allTools,
      surface.deliveryConstraints,
      this.config,
      this.system,
    );

    // 7. Build tool executor
    const toolExecutor = new OrchestratorToolExecutor({
      deskToolHandlers: this.system.deskToolHandlers,
      availableTools: allTools,
      surface,
    });

    // 8. Show typing indicator
    await surface.sendTyping();

    // 9. Execute via selected backend
    let responseText = '';

    const chunks = strategy.backend.execute({
      prompt: request.message,
      model: strategy.model,
      tools: strategy.tools,
      toolExecutor,
      system: assembly.enrichedContext || undefined,
      maxTokens: 4096,
      temperature: 0.4,
    });

    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    for await (const chunk of chunks) {
      switch (chunk.type) {
        case 'text_delta':
          responseText += chunk.content ?? '';
          break;

        case 'tool_use':
          if (chunk.toolRequest && !toolsUsed.includes(chunk.toolRequest.name)) {
            toolsUsed.push(chunk.toolRequest.name);
          }
          // Show working indicator
          if (surface.acknowledge) {
            await surface.acknowledge('⚡');
          }
          await surface.sendTyping();
          break;

        case 'complete':
          if (chunk.metadata) {
            totalInputTokens += chunk.metadata.inputTokens ?? 0;
            totalOutputTokens += chunk.metadata.outputTokens ?? 0;
          }
          break;

        case 'error':
          logger.error('Backend execution error', {
            backend: strategy.backend.backendId,
            error: chunk.content,
          });
          responseText = `I encountered an issue processing your request. ${chunk.content ?? ''}`.trim();
          break;
      }
    }

    // 10. Deliver response
    if (responseText) {
      await surface.reply(responseText);
    }

    // 11. Acknowledge completion
    if (surface.acknowledge) {
      const emoji = toolsUsed.length > 0 ? '👌' : '👍';
      await surface.acknowledge(emoji);
    }

    const totalLatencyMs = Date.now() - startMs;

    logger.info('Pipeline complete', {
      tier: strategy.tier,
      model: strategy.model,
      backend: strategy.backend.backendId,
      mode: strategy.mode,
      toolsUsed,
      slotsPopulated: assembly.slotsPopulated,
      totalInputTokens,
      totalOutputTokens,
      totalLatencyMs,
    });

    return {
      responseText,
      tier: strategy.tier,
      model: strategy.model,
      backendId: strategy.backend.backendId,
      mode: strategy.mode,
      toolsUsed,
      slotsPopulated: assembly.slotsPopulated,
      totalTokens: totalInputTokens + totalOutputTokens,
      totalLatencyMs,
      contextSufficient: true,
    };
  }
}
