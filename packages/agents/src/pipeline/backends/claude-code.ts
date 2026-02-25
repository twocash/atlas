/**
 * ClaudeCodeBackend — Claude Code Subprocess Execution
 *
 * Wraps Claude Code CLI as an ExecutionBackend for Tier 3 (agentic) tasks.
 * Uses NDJSON stdio protocol for bidirectional communication.
 *
 * Claude Code provides:
 *   - Full filesystem access (Read, Write, Edit, Bash, Grep, Glob)
 *   - MCP tool integration (Notion, browser, etc.)
 *   - Multi-turn agentic execution with tool loops
 *   - Cost tracking and session management
 *
 * This backend is the "big gun" — only used when the router assigns
 * Tier 3 or when agentic mode is required.
 *
 * NOTE: Currently a seam. The Bridge's spawner.ts has the battle-tested
 * implementation. This backend will wire to that pattern in Step 7.
 *
 * Sprint: ARCH-CPE-001 Phase 6 — Unified Cognitive Architecture
 */

import { logger } from '../../logger';
import type {
  ExecutionBackend,
  ExecutionRequest,
  ExecutionChunk,
} from '../system';

// ─── Configuration ──────────────────────────────────────

export interface ClaudeCodeConfig {
  /** Path to Claude CLI binary (default: 'claude') */
  claudePath?: string;
  /** Working directory for Claude Code subprocess */
  cwd?: string;
  /** Max turns before forced stop */
  maxTurns?: number;
  /** Timeout in seconds */
  timeoutSeconds?: number;
  /** Allowed tools (whitelist) */
  allowedTools?: string[];
}

const DEFAULT_CONFIG: Required<ClaudeCodeConfig> = {
  claudePath: process.env.CLAUDE_PATH || 'claude',
  cwd: process.cwd(),
  maxTurns: 25,
  timeoutSeconds: 600,
  allowedTools: ['Read', 'Edit', 'Write', 'Bash', 'Grep', 'Glob'],
};

// ─── Backend Implementation ─────────────────────────────

export class ClaudeCodeBackend implements ExecutionBackend {
  readonly backendId = 'claude-code';
  readonly supportsToolUse = true;
  readonly supportsStreaming = true;

  private readonly config: Required<ClaudeCodeConfig>;

  constructor(config?: ClaudeCodeConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async *execute(request: ExecutionRequest): AsyncIterable<ExecutionChunk> {
    const startMs = Date.now();

    logger.info('ClaudeCodeBackend executing', {
      model: request.model,
      promptLength: request.prompt.length,
      maxTurns: this.config.maxTurns,
    });

    try {
      // Spawn Claude Code subprocess
      // Uses Bun.spawn with NDJSON stdio protocol
      // (mirrors packages/bridge/src/dispatch/spawner.ts pattern)

      const args = [
        '-p', request.prompt,
        '--model', request.model,
        '--dangerously-skip-permissions',
        '--max-turns', String(this.config.maxTurns),
        '--allowedTools', this.config.allowedTools.join(','),
        '--output-format', 'stream-json',
      ];

      if (request.system) {
        args.push('--system-prompt', request.system);
      }

      const proc = Bun.spawn({
        cmd: [this.config.claudePath, ...args],
        cwd: this.config.cwd,
        stdout: 'pipe',
        stderr: 'pipe',
      });

      // Set up timeout
      let timedOut = false;
      const timeoutTimer = setTimeout(() => {
        timedOut = true;
        proc.kill();
        logger.warn('ClaudeCodeBackend timed out', {
          timeoutSeconds: this.config.timeoutSeconds,
        });
      }, this.config.timeoutSeconds * 1000);

      // Read stdout as NDJSON stream
      const reader = proc.stdout.getReader();
      let buffer = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += new TextDecoder().decode(value);
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            try {
              const msg = JSON.parse(trimmed);
              const chunk = parseNdjsonMessage(msg);
              if (chunk) yield chunk;
            } catch {
              logger.debug('Non-JSON line from Claude Code', { line: trimmed.slice(0, 100) });
            }
          }
        }
      } finally {
        reader.releaseLock();
      }

      // Await process exit
      const exitCode = await proc.exited;
      clearTimeout(timeoutTimer);

      const durationMs = Date.now() - startMs;

      if (timedOut) {
        yield {
          type: 'error',
          content: `Claude Code timed out after ${this.config.timeoutSeconds}s`,
          metadata: { duration_ms: durationMs, model: request.model },
        };
      } else if (exitCode !== 0) {
        // Capture stderr for error context
        let stderr = '';
        try {
          stderr = await new Response(proc.stderr).text();
        } catch { /* stderr may be closed */ }

        yield {
          type: 'error',
          content: `Claude Code exited with code ${exitCode}: ${stderr.slice(0, 500)}`,
          metadata: { duration_ms: durationMs, model: request.model },
        };
      } else {
        yield {
          type: 'complete',
          metadata: { duration_ms: durationMs, model: request.model },
        };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('ClaudeCodeBackend execution failed', {
        error: errorMessage,
        duration_ms: Date.now() - startMs,
      });

      yield {
        type: 'error',
        content: errorMessage,
        metadata: { duration_ms: Date.now() - startMs, model: request.model },
      };
    }
  }
}

// ─── NDJSON Message Parsing ─────────────────────────────

function parseNdjsonMessage(msg: Record<string, unknown>): ExecutionChunk | null {
  switch (msg.type) {
    case 'stream_event': {
      const event = msg.event as Record<string, unknown> | undefined;
      if (!event) return null;

      // Content block deltas → text chunks
      if (event.type === 'content_block_delta') {
        const delta = event.delta as Record<string, unknown> | undefined;
        if (delta?.type === 'text_delta') {
          return { type: 'text_delta', content: delta.text as string };
        }
      }
      return null;
    }

    case 'sdk_message': {
      // Final assembled message
      const message = msg.message as Record<string, unknown> | undefined;
      if (!message) return null;

      const content = message.content as Array<Record<string, unknown>> | undefined;
      if (!content) return null;

      const textBlock = content.find(b => b.type === 'text');
      if (textBlock) {
        return { type: 'text_delta', content: textBlock.text as string };
      }
      return null;
    }

    case 'system': {
      if (msg.event === 'error') {
        return { type: 'error', content: String(msg.data ?? 'Unknown system error') };
      }
      return null;
    }

    default:
      return null;
  }
}
