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

import type { Context } from 'grammy';
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

logger.info('Content confirmation keyboard', { enabled: CONTENT_CONFIRM_ENABLED });

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
 * Extracts input from Grammy Context, creates surface hooks,
 * and delegates ALL cognitive processing to the orchestrator.
 */
export async function handleConversation(ctx: Context): Promise<void> {
  const input = extractInput(ctx);
  const hooks = buildHooks(ctx);
  const config = buildConfig();
  await orchestrateMessage(input, hooks, config);
}

/**
 * Handle conversation with tools — same as handleConversation now
 * @deprecated Use handleConversation directly
 */
export async function handleConversationWithTools(ctx: Context): Promise<void> {
  await handleConversation(ctx);
}
