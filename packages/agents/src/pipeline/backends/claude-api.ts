/**
 * ClaudeAPIBackend — Direct Anthropic API Execution
 *
 * Extracts the embedded Claude API call pattern from the orchestrator
 * into a proper ExecutionBackend. Handles:
 *   - Message creation with system prompt, tools, and tool_choice
 *   - Streaming via async iteration of ExecutionChunks
 *   - Tool use loop (model requests tool → executor runs → result returned)
 *   - Token/cost accounting per request
 *
 * This backend handles Tier 1-3 requests via the Anthropic Messages API.
 * Tier 0 (deterministic) is handled by the orchestrator directly.
 *
 * Sprint: ARCH-CPE-001 Phase 6 — Unified Cognitive Architecture
 */

import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../../logger';
import type {
  ExecutionBackend,
  ExecutionRequest,
  ExecutionChunk,
} from '../system';

// ─── Constants ──────────────────────────────────────────

const MAX_TOOL_ITERATIONS = 10;

// ─── Backend Implementation ─────────────────────────────

export class ClaudeAPIBackend implements ExecutionBackend {
  readonly backendId = 'claude-api';
  readonly supportsToolUse = true;
  readonly supportsStreaming = true;

  private readonly client: Anthropic;

  constructor(client?: Anthropic) {
    this.client = client ?? new Anthropic();
  }

  async *execute(request: ExecutionRequest): AsyncIterable<ExecutionChunk> {
    const tools = request.tools.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.schema as Anthropic.Tool.InputSchema,
    }));

    const messages: Anthropic.MessageParam[] = [
      { role: 'user', content: request.prompt },
    ];

    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    const startMs = Date.now();

    try {
      let response = await this.client.messages.create({
        model: request.model,
        max_tokens: request.maxTokens ?? 4096,
        temperature: request.temperature ?? 0.4,
        ...(request.system && { system: request.system }),
        messages,
        ...(tools.length > 0 && { tools }),
      });

      totalInputTokens += response.usage.input_tokens;
      totalOutputTokens += response.usage.output_tokens;

      // Tool use loop
      let iterations = 0;
      while (response.stop_reason === 'tool_use' && iterations < MAX_TOOL_ITERATIONS) {
        iterations++;

        const toolUseBlocks = response.content.filter(
          (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
        );

        if (toolUseBlocks.length === 0) break;

        const toolResults: Anthropic.ToolResultBlockParam[] = [];

        for (const toolUse of toolUseBlocks) {
          // Emit tool_use chunk
          yield {
            type: 'tool_use',
            toolRequest: {
              id: toolUse.id,
              name: toolUse.name,
              input: toolUse.input as Record<string, unknown>,
            },
          };

          // Execute tool via the provided executor
          const result = await request.toolExecutor.execute({
            id: toolUse.id,
            name: toolUse.name,
            input: toolUse.input as Record<string, unknown>,
          });

          // Emit tool_result chunk
          yield {
            type: 'tool_result',
            toolResult: result,
          };

          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: result.content,
          });
        }

        // Continue conversation with tool results
        messages.push({ role: 'assistant', content: response.content });
        messages.push({ role: 'user', content: toolResults });

        response = await this.client.messages.create({
          model: request.model,
          max_tokens: request.maxTokens ?? 4096,
          temperature: request.temperature ?? 0.4,
          ...(request.system && { system: request.system }),
          messages,
          ...(tools.length > 0 && { tools }),
        });

        totalInputTokens += response.usage.input_tokens;
        totalOutputTokens += response.usage.output_tokens;
      }

      // Extract final text
      const textContent = response.content.find(
        (block): block is Anthropic.TextBlock => block.type === 'text'
      );

      const durationMs = Date.now() - startMs;

      yield {
        type: 'text_delta',
        content: textContent?.text ?? '',
      };

      yield {
        type: 'complete',
        metadata: {
          model: request.model,
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
          duration_ms: durationMs,
          cost_usd: estimateCost(request.model, totalInputTokens, totalOutputTokens),
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('ClaudeAPIBackend execution failed', {
        model: request.model,
        error: errorMessage,
      });

      yield {
        type: 'error',
        content: errorMessage,
        metadata: {
          model: request.model,
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
          duration_ms: Date.now() - startMs,
        },
      };
    }
  }
}

// ─── Cost Estimation ────────────────────────────────────

function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  // Approximate pricing per 1M tokens (as of 2025)
  const pricing: Record<string, { input: number; output: number }> = {
    'claude-haiku-4-5-20251001': { input: 0.80, output: 4.00 },
    'claude-sonnet-4-20250514': { input: 3.00, output: 15.00 },
  };

  const rates = pricing[model] ?? { input: 3.00, output: 15.00 };
  return (inputTokens * rates.input + outputTokens * rates.output) / 1_000_000;
}
