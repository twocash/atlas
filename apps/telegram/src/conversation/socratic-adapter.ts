/**
 * Socratic Adapter — Telegram Surface
 *
 * Wraps the transport-agnostic Socratic engine for Telegram.
 * Builds ContextSignals from Telegram message data + triage results,
 * calls engine.assess(), and either:
 *   - Auto-dispatches (resolved) → proceeds directly to Feed/WQ creation
 *   - Asks a question → sends as reply text, stores session for answer handling
 *
 * Replaces the keyboard-based prompt selection flow with conversational
 * Socratic questions (zero inline keyboards for content classification).
 */

import type { Context } from 'grammy';
import { logger } from '../logger';
import {
  getSocraticEngine,
  type ContextSignals,
  type ResolvedContext,
  type SocraticQuestion,
} from '../../../../packages/agents/src/socratic';
import type { IntentType } from '../../../../packages/agents/src/services/prompt-composition/types';
import type { TriageResult } from '../cognitive/triage-skill';
import { storeSocraticSession, removeSocraticSession, getSocraticSession } from './socratic-session';
import { createAuditTrail } from './audit';
import { runResearchAgentWithNotifications, sendCompletionNotification } from '../services/research-executor';
import { routeForAnalysis } from './content-router';
import type { ResearchDepth, ResearchConfig } from '../../../../packages/agents/src/agents/research';
import type { Pillar, RequestType } from './types';
import type { UrlContent } from '../types';

/**
 * Build ContextSignals from Telegram message data
 */
function buildSignals(
  content: string,
  contentType: 'url' | 'text' | 'media',
  title: string,
  triageResult?: TriageResult,
  prefetchedUrlContent?: UrlContent,
): ContextSignals {
  // For URLs: prefer the fetched page title over the triage title.
  // Triage title is a classification label ("Social Media Post: Shawn Chauhan Thread").
  // Fetched title is the actual page title ("Google Research: Prompt Doubling Lifts Accuracy").
  const effectiveTitle = (prefetchedUrlContent?.success && prefetchedUrlContent.title)
    ? prefetchedUrlContent.title
    : title;

  const signals: ContextSignals = {
    contentSignals: {
      topic: effectiveTitle,
      title: effectiveTitle,
      hasUrl: contentType === 'url',
      url: contentType === 'url' ? content : undefined,
      contentLength: content.length,
    },
  };

  // Merge triage intelligence if available
  if (triageResult) {
    signals.classification = {
      intent: mapTriageIntentToComposition(triageResult.intent),
      pillar: triageResult.pillar,
      confidence: triageResult.confidence,
    };
  }

  return signals;
}

/**
 * Map triage intent to composition IntentType
 */
function mapTriageIntentToComposition(triageIntent: TriageResult['intent']): IntentType {
  switch (triageIntent) {
    case 'capture': return 'capture';
    case 'command': return 'capture';
    case 'query': return 'research';
    case 'clarify': return 'capture';
    default: return 'capture';
  }
}

/**
 * Main entry point: Run Socratic interview for content
 *
 * Replaces startPromptSelection(ctx, content, contentType, title).
 * Called from content-flow.ts and spark.ts.
 */
export async function socraticInterview(
  ctx: Context,
  content: string,
  contentType: 'url' | 'text' | 'media',
  title: string,
  triageResult?: TriageResult,
  prefetchedUrlContent?: UrlContent,
): Promise<boolean> {
  const userId = ctx.from?.id;
  const chatId = ctx.chat?.id;
  const messageId = ctx.message?.message_id;

  if (!userId || !chatId) {
    logger.warn('Missing userId or chatId for Socratic interview');
    return false;
  }

  try {
    // Build context signals from available data
    const signals = buildSignals(content, contentType, title, triageResult, prefetchedUrlContent);

    // Run the engine
    const engine = getSocraticEngine();
    const result = await engine.assess(signals, 'telegram');

    if (result.type === 'error') {
      logger.error('Socratic engine error, falling back to simple capture', {
        error: result.message,
        content: content.substring(0, 100),
      });
      // Graceful fallback: auto-capture with defaults
      await handleResolved(ctx, {
        intent: 'capture',
        depth: 'standard',
        audience: 'self',
        pillar: triageResult?.pillar || 'The Grove',
        confidence: 0.5,
        resolvedVia: 'auto_draft',
        extraContext: {},
        contentTopic: title,
      }, content, contentType, title, undefined, prefetchedUrlContent, triageResult);
      return true;
    }

    if (result.type === 'resolved') {
      // Auto-dispatch — high confidence, no question needed
      logger.info('Socratic auto-dispatch', {
        confidence: result.context.confidence,
        intent: result.context.intent,
        pillar: result.context.pillar,
      });
      await handleResolved(ctx, result.context, content, contentType, title, undefined, prefetchedUrlContent, triageResult);
      return true;
    }

    if (result.type === 'question') {
      // Need to ask Jim — send question as text message (no keyboard!)
      const session = engine.getSession(
        // Find the session ID from the engine's internal state
        engine.getActiveSessions().find(id => {
          const s = engine.getSession(id);
          return s && s.surface === 'telegram' && s.state === 'ASKING';
        }) || ''
      );

      if (!session) {
        logger.error('Socratic session not found after question generation');
        return false;
      }

      // Format question text — show fetched content title, not triage label
      const fetchedTitle = prefetchedUrlContent?.success ? prefetchedUrlContent.title : undefined;
      const questionText = formatQuestionMessage(title, result.questions, fetchedTitle);

      // Send the question
      const questionMsg = await ctx.reply(questionText, {
        parse_mode: 'HTML',
        reply_parameters: messageId ? { message_id: messageId } : undefined,
      });

      // Store session for answer handling
      storeSocraticSession({
        sessionId: session.id,
        chatId,
        userId,
        questionMessageId: questionMsg.message_id,
        questions: result.questions,
        currentQuestionIndex: 0,
        content,
        contentType,
        title,
        triageResult,
        signals,
        createdAt: Date.now(),
        prefetchedUrlContent,
      });

      logger.info('Socratic question sent', {
        sessionId: session.id,
        chatId,
        questionCount: result.questions.length,
      });

      return true;
    }

    return false;
  } catch (error) {
    logger.error('Socratic adapter error', {
      error: error instanceof Error ? error.message : String(error),
      content: content.substring(0, 100),
    });
    return false;
  }
}

/**
 * Handle a resolved Socratic result — create Feed + Work Queue entries
 */
function mapToResearchDepth(socraticDepth: string | undefined): ResearchDepth {
  if (socraticDepth === 'deep' || socraticDepth === 'thorough') return 'deep';
  if (socraticDepth === 'light' || socraticDepth === 'quick') return 'light';
  return 'standard';
}

async function handleResolved(
  ctx: Context,
  resolved: ResolvedContext,
  content: string,
  contentType: 'url' | 'text' | 'media',
  title: string,
  answerContext?: string,
  prefetchedUrlContent?: UrlContent,
  triageResult?: TriageResult,
): Promise<void> {
  const userId = ctx.from?.id;
  const chatId = ctx.chat?.id;

  if (!userId || !chatId) return;

  try {
    // Map resolved context to audit trail format
    const pillar = resolved.pillar as Pillar;
    const requestType = mapIntentToRequestType(resolved.intent);

    // Descriptive title priority: Haiku triage → Socratic contentTopic → fetched page → raw input
    const descriptiveTitle = triageResult?.title
      || resolved.contentTopic
      || (prefetchedUrlContent?.success ? prefetchedUrlContent.title : undefined)
      || title;

    // Build a proper AuditEntry for createAuditTrail
    const result = await createAuditTrail({
      entry: descriptiveTitle,
      pillar,
      requestType,
      source: 'Telegram',
      author: ctx.from?.username || 'Jim',
      confidence: resolved.confidence,
      keywords: [resolved.intent, resolved.depth, resolved.audience, `socratic/${resolved.resolvedVia}`].filter(Boolean) as string[],
      userId,
      messageText: content,
      hasAttachment: false,
      url: contentType === 'url' ? content : undefined,
      urlTitle: descriptiveTitle,
      contentType: contentType === 'url' ? 'url' : undefined,
    });

    if (!result) {
      logger.info('Socratic resolved but createAuditTrail returned null (likely dedup)', { title });
      await ctx.reply(`Duplicate detected — already captured.`);
      return;
    }

    // Confirm to user
    const resolvedEmoji = resolved.resolvedVia === 'auto_draft' ? '\u26A1' : '\u2705';
    const confirmMsg = [
      `${resolvedEmoji} <b>${escapeHtml(descriptiveTitle)}</b>`,
      `\uD83D\uDCC1 ${pillar} \u00B7 ${requestType}`,
      result.feedUrl ? `\uD83D\uDCCB <a href="${result.feedUrl}">Feed</a>` : '',
      result.workQueueUrl ? `\uD83D\uDCDD <a href="${result.workQueueUrl}">Work Queue</a>` : '',
    ].filter(Boolean).join('\n');

    await ctx.reply(confirmMsg, {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
    });

    // Dispatch research agent if that's what was resolved
    if (requestType === 'Research' && result.workQueueId && chatId) {
      const depth = mapToResearchDepth(resolved.depth);

      // ADR: Research Query Architecture Conformance
      // Content Router consulted before any server-side extraction.
      // Social media (Threads, Twitter, LinkedIn) require browser hydration —
      // server-side fetch returns navigation chrome, not post content.
      let needsBrowser = false;
      if (contentType === 'url') {
        const route = await routeForAnalysis(content);
        needsBrowser = route.needsBrowser;
        logger.info('Socratic research content route', {
          source: route.source,
          method: route.method,
          needsBrowser,
          domain: route.domain,
        });
      }

      // Build research query from best available sources:
      // 1. Fetched URL title (actual content topic, not triage label)
      // 2. User direction from Socratic answer (intent, framing, angle)
      // 3. Fallback: triage title
      let researchQuery = title; // default fallback

      // Prefer fetched content title over triage label
      if (prefetchedUrlContent?.success && prefetchedUrlContent.title) {
        researchQuery = prefetchedUrlContent.title;
      }

      // Enrich with user direction if provided (from Socratic answer)
      const userDirection = resolved.extraContext?.userDirection;
      if (userDirection) {
        // Append user direction, capped to keep query under 200 chars
        const combined = `${researchQuery}: ${userDirection}`;
        researchQuery = combined.length <= 200 ? combined : combined.slice(0, 197) + '...';
      }

      const researchConfig: ResearchConfig = {
        query: researchQuery,
        depth,
        pillar,
      };

      await ctx.reply(`\uD83D\uDD2C Starting research agent...\nDepth: ${depth}`);

      void runResearchAgentWithNotifications(
        researchConfig,
        chatId,
        ctx.api,
        result.workQueueId,
        'socratic-resolved',
      ).then(({ agent, result: researchResult }) =>
        sendCompletionNotification(ctx.api, chatId, agent, researchResult, result.workQueueUrl, 'socratic-resolved'),
      ).catch((err: Error) => {
        logger.error('Research agent failed (Socratic path)', { error: err.message, title, source: 'socratic-resolved' });
        void ctx.api.sendMessage(chatId, `\u274C Research failed: ${err.message}`);
      });
    }
  } catch (error) {
    logger.error('Failed to create entries from Socratic result', {
      error: error instanceof Error ? error.message : String(error),
      title,
    });
    await ctx.reply('Failed to capture. Try again.');
  }
}

/**
 * Handle Jim's reply to a Socratic question
 *
 * Called from handler.ts when a text message is detected as a reply
 * to a pending Socratic question.
 */
export async function handleSocraticAnswer(
  ctx: Context,
  answerText: string,
): Promise<boolean> {
  const chatId = ctx.chat?.id;
  if (!chatId) return false;

  const session = getSocraticSession(chatId);
  if (!session) return false;

  try {
    const engine = getSocraticEngine();
    const result = await engine.answer(
      session.sessionId,
      answerText,
      session.currentQuestionIndex,
    );

    // Clean up session
    removeSocraticSession(chatId);

    if (result.type === 'resolved') {
      await handleResolved(
        ctx,
        result.context,
        session.content,
        session.contentType,
        session.title,
        answerText,
        session.prefetchedUrlContent,
        session.triageResult,
      );
      return true;
    }

    if (result.type === 'question') {
      // More questions — send next one
      const questionText = formatQuestionMessage(session.title, result.questions);
      const questionMsg = await ctx.reply(questionText, { parse_mode: 'HTML' });

      // Update session with new question
      storeSocraticSession({
        ...session,
        questionMessageId: questionMsg.message_id,
        questions: result.questions,
        currentQuestionIndex: 0,
        createdAt: Date.now(), // Reset TTL
      });

      return true;
    }

    if (result.type === 'error') {
      logger.error('Socratic answer error', { error: result.message });
      await ctx.reply('Something went wrong processing that. Content captured with defaults.');
      // Fallback capture
      await handleResolved(ctx, {
        intent: 'capture',
        depth: 'standard',
        audience: 'self',
        pillar: session.triageResult?.pillar || 'The Grove',
        confidence: 0.5,
        resolvedVia: 'auto_draft',
        extraContext: {},
        contentTopic: session.title,
      }, session.content, session.contentType, session.title, undefined, session.prefetchedUrlContent, session.triageResult);
      return true;
    }

    return false;
  } catch (error) {
    logger.error('Socratic answer handler error', {
      error: error instanceof Error ? error.message : String(error),
    });
    removeSocraticSession(chatId);
    return false;
  }
}

/**
 * Format a Socratic question as a Telegram message
 * No keyboards — conversational text with option hints.
 */
function formatQuestionMessage(title: string, questions: SocraticQuestion[], fetchedTitle?: string): string {
  const question = questions[0]; // Primary question
  if (!question) return 'How would you like to handle this?';

  // Use fetched content title when available (the actual page title, not triage label)
  const displayTitle = fetchedTitle || title;
  let msg = `\uD83D\uDCCE <b>${escapeHtml(displayTitle)}</b>\n\n`;
  msg += escapeHtml(question.text);

  // Show options as hints (not buttons)
  if (question.options.length > 0) {
    msg += '\n\n';
    msg += question.options
      .map(opt => `\u00B7 ${escapeHtml(opt.label)}`)
      .join('\n');
  }

  return msg;
}

/**
 * Map composition intent to RequestType for downstream compatibility
 */
function mapIntentToRequestType(intent: string): RequestType {
  switch (intent) {
    case 'research': return 'Research';
    case 'draft': return 'Draft';
    case 'build': return 'Build';
    case 'capture':
    case 'save':
    default: return 'Research';
  }
}

/**
 * Escape HTML for Telegram HTML parse mode
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
