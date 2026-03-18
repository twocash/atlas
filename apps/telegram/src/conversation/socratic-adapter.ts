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
import type { TriageResult } from '@atlas/agents/src/cognitive/triage-skill';
import { resolveIntentCompositionSync } from '@atlas/agents/src/config/intent-composition';
import { enterSocraticPhase, enterGoalClarificationPhase, returnToIdle, storeSocraticAnswer, getState } from '@atlas/agents/src/conversation/conversation-state';
import { orchestrateResolvedContext } from '@atlas/agents/src/pipeline/orchestrator';
import type { ResolvedContextInput } from '@atlas/agents/src/pipeline/types';
import {
  parseGoalFromResponse,
  startGoalTracker,
  buildImmediateTelemetry,
  finalizeGoalTelemetry,
  goalTelemetryToKeywords,
  goalTelemetryToMetadata,
  type GoalContext,
  type GoalTelemetry,
  type GoalTracker,
  type ContentAnalysis as GoalContentAnalysis,
} from '../../../../packages/agents/src/goal';
import { runResearchAgentWithNotifications, sendCompletionNotification } from '../services/research-executor';
import { routeForAnalysis } from '@atlas/agents/src/conversation/content-router';
import { stripNonTextContent } from '@atlas/agents/src/conversation/content-extractor';
import { buildResearchQuery, type ResearchDepth } from '../../../../packages/agents/src/agents/research';
import {
  parseAnswerToRouting,
  fetchPOVContext,
  EVIDENCE_PRESETS,
  type ResearchConfigV2,
  type ResearchIntent,
  type SourceType,
} from '../../../../packages/agents/src';
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
      bodySummary: prefetchedUrlContent?.preReadSummary,
      contentType: prefetchedUrlContent?.preReadContentType,
    },
  };

  // Merge triage intelligence if available
  if (triageResult) {
    signals.classification = {
      intent: resolveIntentCompositionSync(triageResult.intent) as IntentType,
      pillar: triageResult.pillar,
      confidence: triageResult.confidence,
    };
  }

  return signals;
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
      const preReadSummary = prefetchedUrlContent?.preReadSummary;
      const extractionFailed = prefetchedUrlContent !== undefined && !prefetchedUrlContent.success;
      const questionText = formatQuestionMessage(title, result.questions, fetchedTitle, preReadSummary, extractionFailed);

      // Send the question
      const questionMsg = await ctx.reply(questionText, {
        parse_mode: 'HTML',
        reply_parameters: messageId ? { message_id: messageId } : undefined,
      });

      // Store session for answer handling (unified state — canonical)
      enterSocraticPhase(chatId, userId, {
        sessionId: session.id,
        questionMessageId: questionMsg.message_id,
        questions: result.questions,
        currentQuestionIndex: 0,
        content,
        contentType,
        title,
        triageResult,
        signals,
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

/** Map GoalContext.depthSignal to ResearchDepth */
function mapGoalDepthToResearch(goalDepth: string): ResearchDepth {
  if (goalDepth === 'deep') return 'deep';
  if (goalDepth === 'quick') return 'light';
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
  /** Pre-parsed goal from clarification loop (skips re-parsing) */
  preResolvedGoal?: GoalContext,
  /** Tracker from clarification loop (carries initial completeness + rounds) */
  preResolvedTracker?: GoalTracker,
): Promise<void> {
  const userId = ctx.from?.id;
  const chatId = ctx.chat?.id;

  if (!userId || !chatId) return;

  try {
    // ─── GOAL-FIRST-CAPTURE: Parse goal from Jim's answer ─────────
    const goalParseStartMs = Date.now();
    let goalContext: GoalContext | undefined = preResolvedGoal;
    let goalTelemetry: GoalTelemetry | undefined;

    if (!goalContext && answerContext) {
      const contentAnalysis: GoalContentAnalysis = {
        content,
        title: (prefetchedUrlContent?.success && prefetchedUrlContent.title) || title,
        summary: prefetchedUrlContent?.preReadSummary,
        sourceType: contentType,
      };

      try {
        const goalResult = await parseGoalFromResponse(answerContext, contentAnalysis);
        goalContext = goalResult.goal;

        if (goalResult.clarificationNeeded && goalResult.nextQuestion) {
          // Start telemetry tracker — survives across clarification rounds
          const tracker = startGoalTracker(goalContext);

          // Need more info — enter goal-clarification phase
          enterGoalClarificationPhase(chatId, userId, goalContext, contentAnalysis,
            goalContext.missingFor[0]?.field || 'endStateRaw', 1,
            { resolved, content, contentType, title, answerContext },
            tracker);

          await ctx.reply(goalResult.nextQuestion);
          logger.info('Goal needs clarification, entering goal-clarification phase', {
            completeness: goalContext.completeness,
            targetField: goalContext.missingFor[0]?.field,
            endState: goalContext.endState,
          });
          return; // Don't create audit trail yet — telemetry emitted on resolution
        }

        // Goal resolved immediately — build telemetry
        goalTelemetry = buildImmediateTelemetry(goalContext, goalParseStartMs);

        logger.info('Goal parsed from Socratic answer', {
          endState: goalContext.endState,
          completeness: goalContext.completeness,
          thesisHook: goalContext.thesisHook,
          audience: goalContext.audience,
          format: goalContext.format,
          depthSignal: goalContext.depthSignal,
        });
      } catch (goalErr) {
        // CONSTRAINT 4: Log the failure but don't block execution
        logger.warn('Goal parsing failed, continuing without goal enrichment', {
          error: goalErr instanceof Error ? goalErr.message : String(goalErr),
        });
      }
    } else if (preResolvedGoal) {
      // Pre-resolved from clarification loop — use tracker if available
      if (preResolvedTracker) {
        goalTelemetry = finalizeGoalTelemetry(preResolvedTracker, preResolvedGoal);
      } else {
        // Fallback: no tracker (shouldn't happen but CONSTRAINT 4 — don't hide it)
        goalTelemetry = buildImmediateTelemetry(preResolvedGoal, goalParseStartMs);
        logger.warn('Pre-resolved goal has no tracker — telemetry will miss clarification data');
      }
    }

    // ADR-003: Map resolved context to routing signals (legacy path)
    const legacyRouting = mapAnswerToRouting(resolved);
    let { pillar, requestType } = legacyRouting;

    // GOAL-FIRST-CAPTURE: GoalContext overrides legacy routing when available.
    // The goal parser's endState is the authoritative action signal — it comes from
    // Jim's natural language answer, not from the old Socratic intent mapping.
    const activeGoal = goalContext || preResolvedGoal;
    if (activeGoal) {
      requestType = mapGoalEndStateToRequestType(activeGoal.endState);
      logger.info('Goal-driven routing override', {
        legacyRequestType: legacyRouting.requestType,
        goalEndState: activeGoal.endState,
        overriddenRequestType: requestType,
      });
    }

    // Descriptive title priority: Haiku triage → Socratic contentTopic → fetched page → raw input
    const descriptiveTitle = triageResult?.title
      || resolved.contentTopic
      || (prefetchedUrlContent?.success ? prefetchedUrlContent.title : undefined)
      || title;

    // ─── TELEMETRY: Merge goal signals into audit trail ─────────
    // ATLAS-RCI-001: Content injection telemetry keywords for Feed 2.0 observability
    const injectionKeywords: string[] = [];
    if (prefetchedUrlContent?.preReadSummary) injectionKeywords.push('rci:pre-reader');
    if (prefetchedUrlContent?.fullContent) injectionKeywords.push('rci:extracted');
    if (answerContext) injectionKeywords.push('rci:socratic-answer');

    const baseKeywords = [resolved.intent, resolved.depth, resolved.audience, `socratic/${resolved.resolvedVia}`, ...injectionKeywords].filter(Boolean) as string[];
    const goalKeywords = goalTelemetry ? goalTelemetryToKeywords(goalTelemetry) : [];
    const goalMetadata = goalTelemetry ? goalTelemetryToMetadata(goalTelemetry) : undefined;

    // ─── SPRINT A: Pipeline Unification ─────────────────────
    // Delegate audit trail, session telemetry, and provenance to orchestrator.
    // Adapter resolves routing signals; orchestrator owns infrastructure.
    const resolvedInput: ResolvedContextInput = {
      resolved,
      content,
      contentType,
      title: descriptiveTitle,
      answerContext,
      prefetchedUrlContent: prefetchedUrlContent ? {
        success: prefetchedUrlContent.success,
        title: prefetchedUrlContent.title,
        bodySnippet: prefetchedUrlContent.bodySnippet,
        fullContent: prefetchedUrlContent.fullContent,
        preReadSummary: prefetchedUrlContent.preReadSummary,
        preReadContentType: prefetchedUrlContent.preReadContentType,
        error: prefetchedUrlContent.error,
      } : undefined,
      triageResult,
      userId,
      chatId,
      username: ctx.from?.username || 'Jim',
      messageId: ctx.message?.message_id,
      // Pre-computed routing (adapter resolves, orchestrator consumes)
      pillar,
      requestType,
      keywords: [...baseKeywords, ...goalKeywords],
      // Goal state (opaque to orchestrator)
      goalContext: activeGoal,
      goalTelemetry,
      goalTracker: preResolvedTracker,
      goalMetadata,
    };

    const result = await orchestrateResolvedContext(resolvedInput, {
      reply: async (text, opts) => {
        await ctx.reply(text, { parse_mode: opts?.parseMode as 'HTML' | 'Markdown' | 'MarkdownV2' | undefined });
        return ctx.message?.message_id ?? 0;
      },
      setReaction: async (emoji) => {
        try {
          await ctx.react(emoji as Parameters<typeof ctx.react>[0]);
        } catch { /* reaction failures are non-fatal */ }
      },
      sendTyping: async () => {
        await ctx.replyWithChatAction('typing');
      },
    });

    if (!result) {
      // Orchestrator returned null — dedup or error (already logged + handled)
      await ctx.reply(`Duplicate detected — already captured.`);
      return;
    }

    // GOAL-FIRST-CAPTURE: Goal-aware confirmation message
    const confirmMsg = buildGoalAwareConfirmation(
      activeGoal, descriptiveTitle, pillar, requestType,
      result.feedUrl, result.workQueueUrl,
      resolved.resolvedVia === 'auto_draft',
    );

    await ctx.reply(confirmMsg, {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
    });

    // Dispatch research agent if that's what was resolved
    if (requestType === 'Research' && result.workQueueId && chatId) {
      // Research Intelligence v2: Parse Socratic answer into structured routing signals
      const parsed = parseAnswerToRouting(resolved);
      // Legacy routing still needed for non-V2 fields (requestType, focusDirection)
      const routing = mapAnswerToRouting(resolved);

      // ADR-003: Content Router consulted before any server-side extraction.
      // Social media (Threads, Twitter, LinkedIn) require browser hydration —
      // server-side fetch returns navigation chrome, not post content.
      let needsBrowser = false;
      if (contentType === 'url') {
        const route = await routeForAnalysis(content);
        needsBrowser = route.needsBrowser;
        logger.info('ADR-003 content route', {
          source: route.source,
          method: route.method,
          needsBrowser,
          domain: route.domain,
        });
      }

      // ADR-003: Build canonical research query from triage output
      // Query is a clean topic description — no raw URLs, no user direction text
      // Pass extracted content so research agent gets the actual topic, not just a generic triage title
      // Use fullContent (not truncated bodySnippet) so research gets the complete extraction
      let extractedContent = prefetchedUrlContent?.success
        ? (prefetchedUrlContent.fullContent || prefetchedUrlContent.bodySnippet)
        : undefined;

      // ATLAS-CEX-001 P0: SPA URLs (Threads, Twitter, LinkedIn) MUST have substantive extracted
      // content to produce meaningful research. Without it, the triage title is the platform's
      // generic <title> tag (e.g., "Pear (@simplpear) on Threads") — researching this produces
      // a paper about the Threads PLATFORM instead of the actual post content.
      //
      // ATLAS-CEX-001 refinement: Also reject image-only content — Jina can return profile
      // picture markdown that passes the raw length check but contains zero textual content.
      //
      // ATLAS-CEX-001 relaxation: If Jim provided a topic via Socratic answer, use it as
      // the research basis. Jim's answer IS the content — he told Atlas what the post is about.
      // This also unblocks worldview enrichment (ResearchConfig.worldviewContext at line 357+).
      const hasSubstantiveContent = extractedContent && stripNonTextContent(extractedContent).length >= 50;
      const jimProvidedTopic = answerContext?.trim() && answerContext.trim().length >= 10;

      if (needsBrowser && !hasSubstantiveContent && !jimProvidedTopic) {
        // Still block — no extracted content AND Jim didn't provide context
        logger.error('ATLAS-CEX-001: SPA extraction FAILED — blocking research dispatch (would produce platform-about research)', {
          url: content,
          title: descriptiveTitle,
          triageTitle: triageResult?.title,
          extractionSuccess: prefetchedUrlContent?.success,
          extractionError: prefetchedUrlContent?.error,
        });
        await ctx.reply(
          `\u26A0\uFE0F Couldn't read this post (requires browser rendering).\n` +
          `\uD83D\uDCCC Link captured — tell me what it's about if you want research.`
        );
        return;
      }

      // If Jim provided a topic and extraction failed, log it but do NOT
      // assign answer as extractedContent. Jim's answer flows correctly into
      // userDirection (line 566), userContext (line 553), and sourceContext.researchAngle.
      // Setting it as extractedContent conflates intent signal with webpage data.
      if (needsBrowser && !hasSubstantiveContent && jimProvidedTopic) {
        logger.info('ATLAS-CEX-001: SPA extraction failed but Jim provided topic via Socratic answer', {
          url: content,
          answerLength: answerContext!.trim().length,
        });
      }

      const researchQuery = buildResearchQuery({
        triageTitle: triageResult?.title || '',
        fallbackTitle: prefetchedUrlContent?.success ? prefetchedUrlContent.title : title,
        url: contentType === 'url' ? content : undefined,
        keywords: triageResult?.keywords,
        sourceContent: extractedContent,
        userIntent: answerContext,   // ATLAS-CEX-001 B2: Jim's Socratic reply → query construction
      });

      // Research Intelligence v2: Fetch POV Library context when thesis hook is available
      let povContext: ResearchConfigV2['povContext'] | undefined;
      if (parsed.thesisHook || triageResult?.keywords?.length) {
        try {
          const povResult = await fetchPOVContext(
            routing.pillar,
            parsed.thesisHook,
            triageResult?.keywords,
          );
          if (povResult.status === 'found' && povResult.context) {
            povContext = povResult.context;
            logger.info('Research Intelligence: POV context loaded', {
              title: povResult.context.title,
              thesisHook: parsed.thesisHook,
            });
          } else if (povResult.status === 'unreachable') {
            logger.warn('POV Library unreachable — research proceeds without epistemic context', {
              error: povResult.error,
              pillar: routing.pillar,
            });
          }
        } catch (err) {
          logger.warn('POV fetch failed — research proceeds without epistemic context', {
            error: (err as Error).message,
          });
        }
      }

      // Research Intelligence v2: Build structured ResearchConfigV2
      const researchDepth = parsed.depth;
      // GOAL-FIRST-CAPTURE: GoalContext provides richer signals than legacy routing
      const goalThesisHook = goalContext?.thesisHook || parsed.thesisHook;
      const goalDepth = goalContext?.depthSignal
        ? mapGoalDepthToResearch(goalContext.depthSignal)
        : researchDepth;

      const researchConfig: ResearchConfigV2 = {
        // V1 fields (backward compatible)
        query: researchQuery,
        depth: goalDepth,
        pillar: routing.pillar,
        focus: routing.focusDirection,
        queryMode: 'canonical',
        sourceContent: extractedContent,
        userContext: answerContext,   // ATLAS-CEX-001 B3: Jim's Socratic reply → research prompt
        sourceUrl: contentType === 'url' ? content : undefined,
        // V2 fields (structured context composition)
        thesisHook: goalThesisHook,
        evidenceRequirements: EVIDENCE_PRESETS[goalDepth],
        povContext,
        qualityFloor: goalDepth === 'deep' ? 'grove_grade' : goalDepth === 'standard' ? 'primary_sources' : 'any',
        sourceType: contentType as SourceType,
        intent: goalContext?.endState === 'research' ? 'explore' as ResearchIntent
          : goalContext?.endState === 'analyze' ? 'explore' as ResearchIntent
          : goalContext?.endState === 'create' ? 'synthesize' as ResearchIntent
          : goalContext?.endState === 'summarize' ? 'synthesize' as ResearchIntent
          : parsed.intent,
        userDirection: answerContext,
        // Sprint C: Chain continuity — pass orchestrator's chain to research
        provenanceChain: result.provenanceChain,
      };

      // Research launch — goal confirmation was already sent above
      await ctx.reply(`\uD83D\uDD2C Research underway. I'll ping you when it's ready.`);

      void runResearchAgentWithNotifications(
        researchConfig,
        chatId,
        ctx.api,
        result.workQueueId,
        'socratic-resolved',
      ).then(({ agent, result: researchResult, assessment }) =>
        sendCompletionNotification(ctx.api, chatId, agent, researchResult, result.workQueueUrl, 'socratic-resolved', assessment, result.feedId),
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
 * Execute a resolved goal after clarification loop completes.
 * Called from handler.ts when a goal-clarification phase resolves.
 *
 * Sprint: GOAL-FIRST-CAPTURE
 */
export async function executeResolvedGoal(
  ctx: Context,
  resolved: ResolvedContext,
  content: string,
  contentType: 'url' | 'text' | 'media',
  title: string,
  answerContext: string | undefined,
  prefetchedUrlContent: UrlContent | undefined,
  triageResult: TriageResult | undefined,
  goal: GoalContext,
  tracker?: GoalTracker,
): Promise<void> {
  await handleResolved(ctx, resolved, content, contentType, title,
    answerContext, prefetchedUrlContent, triageResult, goal, tracker);
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

  const state = getState(chatId);
  const session = state?.socratic;
  if (!session) return false;

  try {
    const engine = getSocraticEngine();
    const result = await engine.answer(
      session.sessionId,
      answerText,
      session.currentQuestionIndex,
    );

    // Clean up session
    returnToIdle(chatId);

    if (result.type === 'resolved') {
      // ATLAS-RCI-001: Persist Socratic answer to unified state BEFORE dispatch.
      // Previously a local var that died at function scope — now available for
      // research-executor to inject into research context (ADR-001 fix).
      storeSocraticAnswer(chatId, answerText);

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

      // Update session with new question (unified state — canonical)
      enterSocraticPhase(state!.chatId, state!.userId, {
        sessionId: session.sessionId,
        questionMessageId: questionMsg.message_id,
        questions: result.questions,
        currentQuestionIndex: 0,
        content: session.content,
        contentType: session.contentType,
        title: session.title,
        triageResult: session.triageResult,
        signals: session.signals,
        prefetchedUrlContent: session.prefetchedUrlContent,
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
    returnToIdle(chatId);
    return false;
  }
}

/**
 * Format a Socratic question as a Telegram message
 * No keyboards — conversational text with option hints.
 */
function formatQuestionMessage(
  title: string,
  questions: SocraticQuestion[],
  fetchedTitle?: string,
  preReadSummary?: string,
  extractionFailed?: boolean,
): string {
  const question = questions[0]; // Primary question
  if (!question) return 'How would you like to handle this?';

  // Use fetched content title when available (the actual page title, not triage label)
  const displayTitle = fetchedTitle || title;
  let msg = `\uD83D\uDCCE <b>${escapeHtml(displayTitle)}</b>\n\n`;

  // CONSTRAINT 4: Upfront warning when extraction failed (SPA login wall, Jina 422, etc.)
  if (extractionFailed) {
    msg += `\u26A0\uFE0F <i>Couldn't read this post (requires browser login)</i>\n\n`;
  }

  // Show Haiku's pre-read summary so Jim knows what Atlas extracted
  if (preReadSummary) {
    msg += `<i>${escapeHtml(preReadSummary)}</i>\n\n`;
  }

  msg += escapeHtml(question.text);

  // GOAL-FIRST-CAPTURE: No option hints. Jim's freeform answer feeds the goal parser.
  // Options were prescriptive ("Research / Draft / Capture / Summarize") — the goal
  // parser extracts structured intent from natural language instead.

  return msg;
}

// ==========================================
// ADR-003: Answer → Routing Mapping
// ==========================================

/**
 * Routing signals extracted from Socratic resolution.
 * These inform ResearchConfig routing fields — NOT the query string.
 */
export interface RoutingSignals {
  pillar: Pillar;
  requestType: RequestType;
  depth: ResearchDepth;
  /** User's stated direction — goes into ResearchConfig.focus, never into query */
  focusDirection?: string;
}

/**
 * Map Socratic resolved context to routing signals.
 *
 * ADR-003 rule: Socratic answers inform routing (pillar, depth, voice),
 * NOT query text. The query comes from triage title exclusively.
 */
export function mapAnswerToRouting(resolved: ResolvedContext): RoutingSignals {
  const pillar = resolved.pillar as Pillar;
  const requestType = mapIntentToRequestType(resolved.intent);
  const depth = mapToResearchDepth(resolved.depth);

  // userDirection goes to focus, NOT to query
  const userDirection = resolved.extraContext?.userDirection;
  const focusDirection = userDirection && userDirection.trim().length > 0
    ? userDirection.trim().slice(0, 500)
    : undefined;

  return { pillar, requestType, depth, focusDirection };
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
    case 'save': return 'Process';
    default: return 'Research';
  }
}

/**
 * Map GoalContext.endState to RequestType.
 * GOAL-FIRST-CAPTURE: This is the authoritative routing from Jim's natural language answer.
 *
 * Key distinction: "research" and "analyze" both dispatch to Research Agent.
 * "create" dispatches to Research (with synthesis intent) because the research
 * agent produces the draft. "bookmark" and "summarize" are capture-only.
 */
function mapGoalEndStateToRequestType(endState: string): RequestType {
  switch (endState) {
    case 'research': return 'Research';
    case 'analyze': return 'Research';
    case 'create': return 'Research';  // Research agent produces drafts via synthesis intent
    case 'summarize': return 'Process';
    case 'bookmark': return 'Process';
    default: return 'Research';
  }
}

/**
 * Build goal-aware confirmation message.
 * GOAL-FIRST-CAPTURE: Acknowledges Jim's specific intent (audience, format, thesis)
 * instead of generic "Pillar . RequestType" confirmation.
 */
function buildGoalAwareConfirmation(
  goal: GoalContext | undefined,
  title: string,
  pillar: string,
  requestType: string,
  feedUrl?: string,
  workQueueUrl?: string,
  isAutoDraft?: boolean,
): string {
  const emoji = isAutoDraft ? '\u26A1' : '\u2705';

  // If we have a rich goal, build a goal-aware message
  if (goal && goal.endState !== 'bookmark') {
    const parts: string[] = [];

    // Goal acknowledgment line
    const goalDesc = buildGoalDescription(goal);
    parts.push(`${emoji} ${goalDesc}`);

    // Links
    if (feedUrl) parts.push(`\uD83D\uDCCB <a href="${feedUrl}">Feed</a>`);
    if (workQueueUrl) parts.push(`\uD83D\uDCDD <a href="${workQueueUrl}">Work Queue</a>`);

    return parts.filter(Boolean).join('\n');
  }

  // Bookmark / no-goal fallback: simple confirmation
  if (goal?.endState === 'bookmark') {
    const parts = [`${emoji} Saved for later.`];
    if (feedUrl) parts.push(`\uD83D\uDCCB <a href="${feedUrl}">Feed</a>`);
    return parts.join('\n');
  }

  // Legacy fallback (no goal parsed)
  const parts = [
    `${emoji} <b>${escapeHtml(title)}</b>`,
    `\uD83D\uDCC1 ${pillar} \u00B7 ${requestType}`,
    feedUrl ? `\uD83D\uDCCB <a href="${feedUrl}">Feed</a>` : '',
    workQueueUrl ? `\uD83D\uDCDD <a href="${workQueueUrl}">Work Queue</a>` : '',
  ];
  return parts.filter(Boolean).join('\n');
}

/**
 * Build a natural language description of Jim's goal.
 * Examples:
 *   "Got it -- researching for a LinkedIn thinkpiece with your 'revenge of the B students' angle."
 *   "Got it -- deep research on this topic."
 *   "Got it -- drafting a brief for the client."
 */
function buildGoalDescription(goal: GoalContext): string {
  const parts: string[] = ['Got it --'];

  // Action
  switch (goal.endState) {
    case 'research':
    case 'analyze':
      parts.push(goal.depthSignal === 'deep' ? 'deep research' : 'researching');
      break;
    case 'create':
      parts.push('researching');  // create dispatches to research with synthesis intent
      break;
    case 'summarize':
      parts.push('summarizing');
      break;
    default:
      parts.push('processing');
  }

  // Format + audience
  if (goal.format && goal.audience) {
    parts.push(`for a ${goal.audience} ${goal.format}`);
  } else if (goal.format) {
    parts.push(`for a ${goal.format}`);
  } else if (goal.audience) {
    parts.push(`for ${goal.audience}`);
  }

  // Thesis hook
  if (goal.thesisHook) {
    parts.push(`with your "${goal.thesisHook}" angle`);
  }

  return parts.join(' ') + '.';
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
