/**
 * Pipeline Types — Surface-Agnostic Message Processing Contract
 *
 * Defines the boundary between cognitive pipeline (orchestrator) and
 * surface adapters (Telegram, Bridge, etc.). The orchestrator never
 * imports Grammy; adapters never make cognitive decisions.
 *
 * Sprint: ARCH-CPE-001 Phase 5 — Handler Decomposition
 */

import type { AttachmentInfo } from '../conversation/attachments';
import type { MediaContext, Pillar } from '../media/processor';
import type { TriageResult } from '../cognitive/triage-skill';

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

// ─── Reply Options ──────────────────────────────────────

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

// ─── Surface Hooks ──────────────────────────────────────

export interface PipelineSurfaceHooks {
  // Basic I/O
  reply(text: string, options?: ReplyOptions): Promise<number>;
  setReaction(emoji: string): Promise<void>;
  sendTyping(): Promise<void>;

  // Response formatting (surface-specific, e.g. Telegram HTML)
  formatResponse(text: string): string;

  // Delegation to surface adapters (these need the surface context object)
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

  // Dispatch choice (low-confidence routing — needs InlineKeyboard)
  handleLowConfidenceRouting(data: LowConfidenceRoutingData): Promise<void>;
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
