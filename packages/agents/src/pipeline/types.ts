/**
 * Pipeline Types — Surface-Agnostic Message Processing Contract
 *
 * Phase 5: Defined the boundary between orchestrator and surface adapters.
 * Phase 6: Introduces AtlasSurface (4 delivery methods), SystemCapabilities
 *          (system-level compute), and CognitiveRouter (universal dispatch).
 *          PipelineSurfaceHooks (11 methods) deprecated → AtlasSurface (4).
 *
 * Sprint: ARCH-CPE-001 Phase 5 + Phase 6
 */

import type { AttachmentInfo } from '../conversation/attachments';
import type { MediaContext, Pillar } from '../media/processor';
import type { TriageResult } from '../cognitive/triage-skill';
import type { EmergenceProposal } from '../emergence/types';

// ─── Re-exports from Phase 6 modules ────────────────────

export type {
  AtlasSurface,
  DeliveryConstraints,
  SurfaceContext,
  SurfaceReplyOptions,
  ToolClassification,
  ToolDefinition,
  ToolRequest,
  ToolResult,
  ToolExecutor,
  DeviceToolDefinition,
} from './surface';

export type {
  CognitiveTier,
  ExecutionBackend,
  ExecutionRequest,
  ExecutionChunk,
  ExecutionStrategy,
  ExecutionMode,
  ContextCheck,
  SystemCapabilities,
  DeskToolHandler,
} from './system';

export type {
  CognitiveTask,
  AssemblyResult,
} from './router';

export type {
  RouterConfig,
  RouterConfigCache,
  ModelSelection,
} from './router-config';

export {
  OrchestratorToolExecutor,
  LegacyToolBridge,
  mergeTools,
  type OrchestratorToolExecutorConfig,
  type LegacyToolSystem,
} from './tool-executor';

export type {
  ContextAssembler,
  ContextAssemblyRequest,
  SlotStatus,
  SlotReport,
} from './context-assembly';

export { ClaudeAPIBackend } from './backends/claude-api';
export { ClaudeCodeBackend, type ClaudeCodeConfig } from './backends/claude-code';
export { LocalModelBackend } from './backends/local-model';

// ─── Message Input ──────────────────────────────────────

export interface MessageInput {
  text: string;
  userId: number;
  chatId: number;
  username: string;
  messageId?: number;
  /** Raw message object for detectAttachment (opaque to orchestrator) */
  rawMessage?: unknown;
}

// ─── Reply Options (Phase 5 — used by PipelineSurfaceHooks) ─────

export interface ReplyOptions {
  parseMode?: string;
  replyMarkup?: unknown;
  replyToMessageId?: number;
}

// ─── Low-Confidence Routing ─────────────────────────────

export interface LowConfidenceRoutingData {
  requestId: string;
  chatId: number;
  userId: number;
  messageId?: number;
  reasoning: string;
  title: string;
  description: string;
  priority: 'P0' | 'P1' | 'P2';
  requireReview: boolean;
  pillar: string;
  routingConfidence: number;
  suggestedCategory: string;
  alternativeCategory: string;
  timestamp: number;
}

// ─── Surface Hooks (Phase 5 — DEPRECATED) ───────────────
//
// HOOK MIGRATION MAP (Phase 6):
//
// | Phase 5 Hook                  | Phase 6 Destination           | Rationale           |
// |-------------------------------|-------------------------------|---------------------|
// | reply(text, options)          | AtlasSurface.reply()          | Delivery primitive  |
// | sendTyping()                  | AtlasSurface.sendTyping()     | Delivery primitive  |
// | setReaction(emoji)            | AtlasSurface.acknowledge()    | Delivery (optional) |
// | processMedia(attachment)      | AtlasSurface.acquireMedia()   | Delivery (optional) |
// | formatResponse(text)          | Orchestrator internal         | Format per delivery |
// | checkContentShare()           | Orchestrator internal         | Cognitive decision  |
// | handleSocraticAnswer(text)    | Orchestrator internal         | Cognitive decision  |
// | handleInstantClassification() | Orchestrator internal         | Cognitive decision  |
// | handleMediaConfirmation()     | Orchestrator internal         | Cognitive decision  |
// | executeResolvedGoal()         | Orchestrator internal         | Cognitive decision  |
// | handleLowConfidenceRouting()  | Orchestrator internal         | Cognitive decision  |
//
// 11 hooks → 4 delivery methods + orchestrator internals
// Surfaces deliver. The orchestrator decides.
//
// @deprecated Use AtlasSurface (from ./surface.ts) instead.
//   Phase 5 adapter (handler.ts) continues to use this during migration.
//   Will be removed once TelegramSurface implements AtlasSurface.

export interface PipelineSurfaceHooks {
  // Basic I/O → AtlasSurface delivery primitives
  reply(text: string, options?: ReplyOptions): Promise<number>;
  setReaction(emoji: string): Promise<void>;
  sendTyping(): Promise<void>;

  // Response formatting → orchestrator internal
  formatResponse(text: string): string;

  // Cognitive delegation → orchestrator internal
  checkContentShare(): Promise<boolean>;
  handleSocraticAnswer(text: string): Promise<boolean>;
  handleInstantClassification(attachment: AttachmentInfo): Promise<boolean>;
  handleMediaConfirmation(attachment: AttachmentInfo, media: MediaContext, pillar: Pillar): Promise<boolean>;
  executeResolvedGoal(
    resolved: unknown,
    content: string,
    contentType: string,
    title: string,
    answerContext?: unknown,
    urlContent?: unknown,
    triage?: TriageResult,
    goal?: unknown,
    tracker?: unknown,
  ): Promise<void>;
  processMedia(attachment: AttachmentInfo, pillar: Pillar): Promise<MediaContext | null>;

  // Dispatch choice → orchestrator internal
  handleLowConfidenceRouting(data: LowConfidenceRoutingData): Promise<void>;

  // Emergence delivery → surface adapter
  deliverEmergenceProposal(proposal: EmergenceProposal): Promise<number>;
}

// ─── Pipeline Config ────────────────────────────────────

export interface PipelineConfig {
  contentConfirmEnabled: boolean;
  domainAudienceEnabled: boolean;
  contextEnrichmentEnabled: boolean;
  selfModelEnabled: boolean;
  skillLoggingEnabled: boolean;
}

// ─── Reactions ──────────────────────────────────────────

export const REACTIONS = {
  READING: '👀',
  WORKING: '⚡',
  DONE: '👌',
  CHAT: '👍',
  ERROR: '💔',
} as const;
