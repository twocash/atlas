/**
 * TelegramSurface — AtlasSurface Implementation for Telegram
 *
 * Wraps Grammy's Context into the universal AtlasSurface contract.
 * Telegram provides:
 *   - Delivery: reply, typing, reactions (≤4096 chars, no streaming, HTML format)
 *   - Context: message history, reply chain
 *   - Device tools: none (phone can't act on desktop)
 *
 * This surface NEVER constrains compute. Atlas always has the full desk.
 * Telegram only limits HOW responses are delivered (message length, no streaming).
 *
 * NOTE: This file must NOT import Grammy directly — it takes a pre-bound
 * set of delivery functions from the app-layer adapter (handler.ts).
 * Grammy is app-level; AtlasSurface is package-level.
 *
 * Sprint: ARCH-CPE-001 Phase 6 — Unified Cognitive Architecture
 */

import { logger } from '../../logger';
import type {
  AtlasSurface,
  DeliveryConstraints,
  SurfaceContext,
  SurfaceReplyOptions,
  DeviceToolDefinition,
  ToolRequest,
  ToolResult,
} from '../surface';

// ─── Delivery Bindings ──────────────────────────────────
// Injected by the app-layer adapter (handler.ts).
// These are pre-bound to a Grammy Context instance.

export interface TelegramDeliveryBindings {
  reply(text: string, options?: { format?: string; replyToId?: number }): Promise<void>;
  sendTyping(): Promise<void>;
  setReaction(emoji: string): Promise<void>;
  /** Recent message history for context */
  getMessageHistory?(): Promise<string[]>;
  /** Reply chain text (if replying to a message) */
  getReplyChain?(): Promise<string | undefined>;
}

// ─── Implementation ──────────────────────────────────────

export class TelegramSurface implements AtlasSurface {
  readonly surfaceId = 'telegram';

  readonly deliveryConstraints: DeliveryConstraints = {
    supportsStreaming: false,
    maxResponseLength: 4096,
    supportsRichFormatting: true,    // HTML subset
    supportsFileAttachment: true,    // Telegram supports file sends
  };

  private readonly bindings: TelegramDeliveryBindings;

  constructor(bindings: TelegramDeliveryBindings) {
    this.bindings = bindings;
  }

  // ─── Delivery Primitives ──────────────────────────────

  async reply(text: string, options?: SurfaceReplyOptions): Promise<void> {
    await this.bindings.reply(text, {
      format: options?.format,
      replyToId: options?.replyToId,
    });
  }

  async sendTyping(): Promise<void> {
    await this.bindings.sendTyping();
  }

  async acknowledge(emoji: string): Promise<void> {
    await this.bindings.setReaction(emoji);
  }

  // acquireMedia not implemented — Telegram file downloads
  // go through the bot API (ctx.getFile), but this is wired
  // through the orchestrator's media pipeline, not the surface.

  // ─── Environmental Context ────────────────────────────

  async getContext(): Promise<SurfaceContext> {
    const history = this.bindings.getMessageHistory
      ? await this.bindings.getMessageHistory()
      : undefined;

    const replyChain = this.bindings.getReplyChain
      ? await this.bindings.getReplyChain()
      : undefined;

    return {
      messageHistory: history,
      replyChain,
      // Telegram has no browser context
    };
  }

  // ─── Device Tools ─────────────────────────────────────
  // Telegram has no device tools — Jim's phone can't act on
  // his desktop. All tools are desk-level (system).

  getDeviceTools(): DeviceToolDefinition[] {
    return [];
  }

  async executeDeviceTool(request: ToolRequest): Promise<ToolResult> {
    logger.warn('Telegram has no device tools', { tool: request.name });
    return {
      id: request.id,
      content: `Telegram surface has no device tools. "${request.name}" is not available from mobile.`,
      isError: true,
    };
  }
}
