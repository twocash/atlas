/**
 * SystemCapabilities — The Full Desk
 *
 * Defines what Atlas always has available regardless of which
 * surface Jim is calling from. Backends, desk tools, knowledge,
 * and state are all SYSTEM-LEVEL.
 *
 * The cognitive router selects from these capabilities based on
 * the task — never constrained by which surface the request came from.
 *
 * Sprint: ARCH-CPE-001 Phase 6 — Unified Cognitive Architecture
 */

import type { ToolDefinition, ToolRequest, ToolResult } from './surface';

// ─── Cognitive Tiers ─────────────────────────────────────
// The router assigns tiers based on task complexity.
// Tier → model → backend mapping lives in Notion (cached in memory).

export type CognitiveTier = 0 | 1 | 2 | 3;
// Tier 0: Deterministic (no model call — pattern cache, regex)
// Tier 1: Lightweight model (Haiku, or local in future)
// Tier 2: Standard model (Sonnet)
// Tier 3: Agentic (Sonnet via Claude Code, or Opus)

// ─── Execution Backends ──────────────────────────────────
// System-level compute strategies. NOT per-surface.

export interface ExecutionRequest {
  prompt: string;
  model: string;
  tools: ToolDefinition[];
  toolExecutor: import('./surface').ToolExecutor;
  maxTokens?: number;
  temperature?: number;
  system?: string;
}

export interface ExecutionChunk {
  type: 'text_delta' | 'tool_use' | 'tool_result' | 'complete' | 'error';
  content?: string;
  toolRequest?: import('./surface').ToolRequest;
  toolResult?: import('./surface').ToolResult;
  metadata?: {
    cost_usd?: number;
    duration_ms?: number;
    model?: string;
    inputTokens?: number;
    outputTokens?: number;
  };
}

export interface ExecutionBackend {
  readonly backendId: string;
  readonly supportsToolUse: boolean;
  readonly supportsStreaming: boolean;

  execute(request: ExecutionRequest): AsyncIterable<ExecutionChunk>;
}

// ─── Execution Strategy ──────────────────────────────────
// The router's output: which backend, model, mode, tools, and delivery.

export type ExecutionMode = 'deterministic' | 'conversational' | 'agentic';

export interface ExecutionStrategy {
  tier: CognitiveTier;
  model: string;
  mode: ExecutionMode;
  backend: ExecutionBackend;
  tools: ToolDefinition[];
  deliveryMode: 'stream' | 'batch';
}

// ─── Context Check ───────────────────────────────────────
// Router verifies the surface can provide needed context.
// Missing context → explicit message, NOT silent degradation.

export interface ContextCheck {
  sufficient: boolean;
  missingContext?: string[];
  userMessage?: string;
}

// ─── Desk Tool Handler ───────────────────────────────────
// System-level tool execution (Notion MCP, filesystem, research, etc.)

export interface DeskToolHandler {
  execute(request: ToolRequest): Promise<ToolResult>;
}

// ─── System Capabilities ─────────────────────────────────
// The full workstation. Always available, from every surface.

export interface SystemCapabilities {
  /** Available execution backends (Claude API, Claude Code, local model seam) */
  backends: ExecutionBackend[];

  /** System-level desk tools (Notion MCP, filesystem, research agents, etc.) */
  deskTools: ToolDefinition[];

  /** Handlers for desk tool execution */
  deskToolHandlers: Map<string, DeskToolHandler>;
}
