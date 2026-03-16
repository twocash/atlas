/**
 * Atlas Telegram Bot — Grammy Surface Adapter
 *
 * Thin adapter that bridges Grammy's Context to the surface-agnostic
 * pipeline orchestrator. This file:
 *   - Extracts MessageInput from Grammy Context
 *   - Creates PipelineSurfaceHooks bound to ctx
 *   - Creates PipelineConfig from environment variables
 *   - Delegates ALL cognitive logic to orchestrateMessage()
 *
 * Sprint: ARCH-CPE-001 Phase 5 — Handler Decomposition
 * Formerly: 1,608 LOC God Object → now packages/agents/src/pipeline/orchestrator.ts
 */

import { InputFile, type Context } from 'grammy';
import { logger } from '../logger';
import { formatMessage } from '../formatting';
import { orchestrateMessage } from '@atlas/agents/src/pipeline/orchestrator';
import type {
  MessageInput,
  PipelineSurfaceHooks,
  PipelineConfig,
  ReplyOptions,
  LowConfidenceRoutingData,
} from '@atlas/agents/src/pipeline/types';
import { maybeHandleAsContentShare, triggerInstantClassification, triggerMediaConfirmation } from './content-flow';
import { handleSocraticAnswer, executeResolvedGoal } from './socratic-adapter';
import { processMedia } from './media';
import {
  storePendingDispatch,
  formatRoutingChoiceMessage,
  buildRoutingChoiceKeyboard,
} from './dispatch-choice';
import type { AttachmentInfo } from '@atlas/agents/src/conversation/attachments';
import type { MediaContext, Pillar } from '@atlas/agents/src/media/processor';
import type { TriageResult } from '@atlas/agents/src/cognitive/triage-skill';
import { formatProposalText } from '@atlas/agents/src/emergence/proposal-generator';
import type { EmergenceProposal } from '@atlas/agents/src/emergence/types';

// Feature flags — resolved once at module load from env vars
const CONTENT_CONFIRM_ENABLED = process.env.ATLAS_CONTENT_CONFIRM !== 'false';
const DOMAIN_AUDIENCE_ENABLED = process.env.ATLAS_DOMAIN_AUDIENCE === 'true';
const BRIDGE_RELAY_ENABLED = process.env.ATLAS_BRIDGE_RELAY === 'true';
const BRIDGE_URL = process.env.BRIDGE_URL || 'http://localhost:3848';

logger.info('Content confirmation keyboard', { enabled: CONTENT_CONFIRM_ENABLED });
logger.info('Bridge relay mode', { enabled: BRIDGE_RELAY_ENABLED, url: BRIDGE_URL });

// ─── Input Extraction ────────────────────────────────────

function extractInput(ctx: Context): MessageInput {
  return {
    text: ctx.message?.text || ctx.message?.caption || '',
    userId: ctx.from!.id,
    chatId: ctx.chat!.id,
    username: ctx.from?.username || String(ctx.from!.id),
    messageId: ctx.message?.message_id,
    rawMessage: ctx.message,
  };
}

// ─── Surface Hooks ───────────────────────────────────────

function buildHooks(ctx: Context): PipelineSurfaceHooks {
  return {
    // Basic I/O
    async reply(text: string, options?: ReplyOptions): Promise<number> {
      const msg = await ctx.reply(text, {
        parse_mode: options?.parseMode as 'HTML' | 'MarkdownV2' | undefined,
        reply_markup: options?.replyMarkup as any,
        reply_to_message_id: options?.replyToMessageId,
      });
      return msg.message_id;
    },

    async setReaction(emoji: string): Promise<void> {
      try {
        await ctx.react(emoji);
      } catch (error) {
        logger.debug('Failed to set reaction', { emoji, error });
      }
    },

    async sendTyping(): Promise<void> {
      await ctx.replyWithChatAction('typing');
    },

    // Response formatting (Telegram HTML)
    formatResponse(text: string): string {
      return formatMessage(text);
    },

    // Delegation hooks — surface adapters that need Grammy Context
    async checkContentShare(): Promise<boolean> {
      return maybeHandleAsContentShare(ctx);
    },

    async handleSocraticAnswer(text: string): Promise<boolean> {
      return handleSocraticAnswer(ctx, text);
    },

    async handleInstantClassification(attachment: AttachmentInfo): Promise<boolean> {
      return triggerInstantClassification(ctx, attachment);
    },

    async handleMediaConfirmation(
      attachment: AttachmentInfo,
      media: MediaContext,
      pillar: Pillar,
    ): Promise<boolean> {
      return triggerMediaConfirmation(ctx, attachment, media, pillar);
    },

    async executeResolvedGoal(
      resolved: unknown,
      content: string,
      contentType: string,
      title: string,
      answerContext?: unknown,
      urlContent?: unknown,
      triage?: TriageResult,
      goal?: unknown,
      tracker?: unknown,
    ): Promise<void> {
      await executeResolvedGoal(
        ctx,
        resolved as any,
        content,
        contentType as any,
        title,
        answerContext as string | undefined,
        urlContent as any,
        triage,
        goal as any,
        tracker as any,
      );
    },

    async processMedia(attachment: AttachmentInfo, pillar: Pillar): Promise<MediaContext | null> {
      return processMedia(ctx, attachment, pillar);
    },

    // Low-confidence routing — needs InlineKeyboard (Grammy-specific)
    async handleLowConfidenceRouting(data: LowConfidenceRoutingData): Promise<void> {
      storePendingDispatch({
        requestId: data.requestId,
        chatId: data.chatId,
        userId: data.userId,
        messageId: data.messageId,
        reasoning: data.reasoning,
        title: data.title,
        description: data.description,
        priority: data.priority,
        requireReview: data.requireReview,
        pillar: data.pillar,
        routingConfidence: data.routingConfidence,
        suggestedCategory: data.suggestedCategory,
        alternativeCategory: data.alternativeCategory,
        timestamp: data.timestamp,
      });

      const messageText = formatRoutingChoiceMessage({
        requestId: data.requestId,
        chatId: data.chatId,
        userId: data.userId,
        messageId: data.messageId,
        reasoning: data.reasoning,
        title: data.title,
        description: data.description,
        priority: data.priority,
        requireReview: data.requireReview,
        pillar: data.pillar,
        routingConfidence: data.routingConfidence,
        suggestedCategory: data.suggestedCategory,
        alternativeCategory: data.alternativeCategory,
        timestamp: data.timestamp,
      });

      const keyboard = buildRoutingChoiceKeyboard(
        data.requestId,
        data.suggestedCategory,
        data.alternativeCategory,
      );

      await ctx.reply(messageText, {
        parse_mode: 'HTML',
        reply_markup: keyboard,
      });
    },

    // Emergence proposal delivery — formatted plain text (no HTML)
    async deliverEmergenceProposal(proposal: EmergenceProposal): Promise<number> {
      const text = formatProposalText(proposal);
      const msg = await ctx.reply(text);
      return msg.message_id;
    },
  };
}

// ─── Config ──────────────────────────────────────────────

function buildConfig(): PipelineConfig {
  return {
    contentConfirmEnabled: CONTENT_CONFIRM_ENABLED,
    domainAudienceEnabled: DOMAIN_AUDIENCE_ENABLED,
    contextEnrichmentEnabled: process.env.ATLAS_CONTEXT_ENRICHMENT !== 'false',
    selfModelEnabled: process.env.ATLAS_SELF_MODEL === 'true',
    skillLoggingEnabled: process.env.ATLAS_SKILL_LOGGING !== 'false',
  };
}

// ─── Public API ──────────────────────────────────────────

/**
 * Handle incoming message — Grammy surface adapter
 *
 * When ATLAS_BRIDGE_RELAY=true, messages route through the Bridge server
 * which runs Claude Code with full MCP tools (including headed browser).
 * When off, delegates to the orchestrator directly (legacy path).
 */
export async function handleConversation(ctx: Context): Promise<void> {
  if (BRIDGE_RELAY_ENABLED) {
    await handleViaBridgeRelay(ctx);
    return;
  }

  const input = extractInput(ctx);
  const hooks = buildHooks(ctx);
  const config = buildConfig();
  await orchestrateMessage(input, hooks, config);
}

/**
 * Bridge relay — sends message to Bridge server, returns response to Telegram.
 * Bridge runs Claude Code with full MCP tools (browser automation, RAG, etc.).
 */
async function handleViaBridgeRelay(ctx: Context): Promise<void> {
  const input = extractInput(ctx);

  // Show typing while Bridge processes
  await ctx.replyWithChatAction('typing');

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000); // 2 min max

    // Keep typing indicator alive during long operations
    const typingInterval = setInterval(async () => {
      try { await ctx.replyWithChatAction('typing'); } catch {}
    }, 4_000);

    const res = await fetch(`${BRIDGE_URL}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: input.text,
        userId: input.userId,
        chatId: input.chatId,
        username: input.username,
        surface: 'telegram',
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    clearInterval(typingInterval);

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      logger.error('Bridge relay failed', { status: res.status, error: errText });
      await ctx.reply(`Bridge error (${res.status}). Falling back to direct mode.`);
      // Fallback to direct orchestrator
      const hooks = buildHooks(ctx);
      const config = buildConfig();
      await orchestrateMessage(input, hooks, config);
      return;
    }

    const result = await res.json() as { text?: string; screenshots?: string[] };

    // Send text response (chunked for Telegram's 4096 char limit)
    if (result.text) {
      const formatted = formatMessage(result.text);
      const chunks = chunkText(formatted, 4000);
      for (const chunk of chunks) {
        await ctx.reply(chunk, { parse_mode: 'HTML' });
      }
    }

    // Send screenshots as photos
    if (result.screenshots?.length) {
      for (const b64 of result.screenshots) {
        const buffer = Buffer.from(b64, 'base64');
        await ctx.replyWithPhoto(new InputFile(buffer, 'screenshot.png'));
      }
    }
  } catch (err: any) {
    if (err.name === 'AbortError') {
      logger.error('Bridge relay timed out');
      await ctx.reply('Bridge request timed out (120s). The operation may still be running on grove-node-1.');
    } else {
      logger.error('Bridge relay error', { error: err.message });
      await ctx.reply(`Bridge unreachable: ${err.message}. Falling back to direct mode.`);
      // Fallback to direct orchestrator
      const hooks = buildHooks(ctx);
      const config = buildConfig();
      await orchestrateMessage(input, hooks, config);
    }
  }
}

/** Split text into chunks respecting Telegram's message size limit. */
function chunkText(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    // Find last newline within limit
    let splitAt = remaining.lastIndexOf('\n', maxLen);
    if (splitAt <= 0) splitAt = maxLen;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt);
  }
  return chunks;
}

/**
 * Handle conversation with tools — same as handleConversation now
 * @deprecated Use handleConversation directly
 */
export async function handleConversationWithTools(ctx: Context): Promise<void> {
  await handleConversation(ctx);
}
