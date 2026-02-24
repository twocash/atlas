/**
 * Atlas Telegram Bot - Conversation Handler
 *
 * Main entry point for the conversational UX. Claude is the front door.
 * Every message goes through Claude, which decides what to do.
 *
 * ═══════════════════════════════════════════════════════════════════
 * CONTENT PIPELINE GUARDRAIL — READ BEFORE EDITING
 * ═══════════════════════════════════════════════════════════════════
 *
 * This file ORCHESTRATES the content pipeline. It does NOT contain:
 * - Prompt text (lives in Notion System Prompts DB, fetched via PromptManager)
 * - Classification logic (lives in cognitive/triage-skill.ts)
 * - Composition logic (lives in packages/agents/src/services/prompt-composition/)
 * - Pillar/Action/Voice config (lives in prompt-composition/registry.ts)
 *
 * The content flow call chain:
 *   handler.ts → content-flow.ts → triage-skill.ts → socratic-adapter.ts
 *     → packages/agents/src/socratic/engine.ts → audit.ts → Notion Feed/WQ
 *
 * FORBIDDEN — DO NOT ADD TO THIS FILE:
 * - Inline classification prompts or direct Anthropic calls for classification
 * - Any prompt text constants (all prompts live in prompt-composition system)
 * - Classification parsing logic (handled by triage-skill.ts adapters)
 * - Hardcoded pillar routing rules (use triage-skill.ts)
 * - See ADR-001-handler-thin-orchestrator.md for rationale
 *
 * See: packages/skills/superpowers/atlas-patterns.md Section 8
 * See: apps/telegram/src/conversation/ARCHITECTURE.md
 * ═══════════════════════════════════════════════════════════════════
 */

import type { Context } from 'grammy';
import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../logger';
import { formatMessage } from '../formatting';
import { getConversation, updateConversation, buildMessages, type ToolContext } from './context';
import { buildSystemPrompt } from './prompt';
import { detectAttachment, buildAttachmentPrompt } from './attachments';
import { processMedia, buildMediaContext, buildAnalysisContent, type Pillar } from './media';
import { createAuditTrail, type AuditEntry, type AuditResult } from './audit';
import { getAllTools, executeTool } from './tools';
import { recordUsage } from './stats';
import { maybeHandleAsContentShare, triggerMediaConfirmation, triggerInstantClassification } from './content-flow';
import { hasPendingSocraticSessionForUser, getSocraticSessionByUserId, removeSocraticSession } from './socratic-session';
import { handleSocraticAnswer, executeResolvedGoal } from './socratic-adapter';
import { logAction, getIntentHash, isFeatureEnabled } from '../skills';
import { reportFailure } from '@atlas/shared/error-escalation';
import { createTrace, addStep, completeStep, completeTrace, failTrace, type TraceContext } from '@atlas/shared/trace';
import { classifyWithFallback, triageForAudit, triageMessage } from '../cognitive/triage-skill';
import type { TriageResult } from '../cognitive/triage-skill';
import { enrichWithContextSlots, type EnrichmentResult } from './context-enrichment';
import {
  generateDispatchChoiceId,
  storePendingDispatch,
  formatRoutingChoiceMessage,
  buildRoutingChoiceKeyboard,
  type PendingDispatch,
} from './dispatch-choice';
import { getLastAgentResult, clearLastAgentResult } from './context-manager';
import {
  assessRequest,
  type RequestAssessment,
  type AssessmentContext,
  getCachedModel,
  assessmentNeedsDialogue,
  enterDialogue,
  continueDialogue,
  derivePillar,
  detectDomainCorrection,
  logDomainCorrection,
  extractKeywords,
  type DomainType,
} from '../../../../packages/agents/src';
import {
  hasDialogueSessionForUser,
  getDialogueSessionByUserId,
  storeDialogueSession,
  removeDialogueSession,
} from './dialogue-session';
import {
  hasApprovalSessionForUser,
  getApprovalSessionByUserId,
  storeApprovalSession,
  removeApprovalSession,
  isApprovalSignal,
  isRejectionSignal,
  formatProposalMessage,
} from './approval-session';
import {
  getOrCreateState,
  getStateByUserId,
  getContentContext,
  storeAssessment,
  storeTriage as storeTriageInState,
  enterDialoguePhase,
  enterApprovalPhase,
  enterGoalClarificationPhase,
  returnToIdle,
  recordTurn,
} from './conversation-state';
import {
  incorporateClarification,
  resolveAfterClarification,
  recordClarification,
} from '../../../../packages/agents/src/goal';

// Feature flag for content confirmation keyboard (Universal Content Analysis)
// Enabled by default - set ATLAS_CONTENT_CONFIRM=false to disable
const CONTENT_CONFIRM_ENABLED = process.env.ATLAS_CONTENT_CONFIRM !== 'false';

// Feature flag for domain/audience unbundling (STAB-002c)
const DOMAIN_AUDIENCE_ENABLED = process.env.ATLAS_DOMAIN_AUDIENCE === 'true';

// Per-user last-domain cache for correction detection (STAB-002c)
// Lightweight in-memory map — only tracks the most recent domain per user.
const lastDomainByUser = new Map<number, DomainType>();

/**
 * Format tool context for conversation history
 *
 * Extracts key information (IDs, URLs, success/failure) from tool results
 * so Claude can maintain context across conversation turns.
 *
 * Fix for: "Conversation continuity breaks on tool follow-ups"
 */
function formatToolContextForHistory(toolContexts: ToolContext[]): string {
  if (toolContexts.length === 0) return '';

  const summaries: string[] = [];

  for (const ctx of toolContexts) {
    const toolResult = ctx.result as { success?: boolean; result?: unknown; error?: string } | undefined;
    const success = toolResult?.success ?? false;
    const result = toolResult?.result as Record<string, unknown> | undefined;

    // Extract key identifiers from results
    const keyInfo: string[] = [];

    if (result) {
      // Common ID fields
      if (result.id) keyInfo.push(`id: ${result.id}`);
      if (result.pageId) keyInfo.push(`pageId: ${result.pageId}`);
      if (result.taskId) keyInfo.push(`taskId: ${result.taskId}`);
      if (result.feedId) keyInfo.push(`feedId: ${result.feedId}`);
      if (result.workQueueId) keyInfo.push(`workQueueId: ${result.workQueueId}`);
      if (result.discussionId) keyInfo.push(`discussionId: ${result.discussionId}`);

      // URLs
      if (result.url) keyInfo.push(`url: ${result.url}`);
      if (result.notionUrl) keyInfo.push(`url: ${result.notionUrl}`);

      // Status/title for context
      if (result.title) keyInfo.push(`title: "${String(result.title).substring(0, 50)}"`);
      if (result.status) keyInfo.push(`status: ${result.status}`);
    }

    // Build summary line
    const status = success ? '✓' : '✗';
    const info = keyInfo.length > 0 ? ` (${keyInfo.join(', ')})` : '';
    summaries.push(`${status} ${ctx.toolName}${info}`);
  }

  return `[Tool context for follow-up:\n${summaries.join('\n')}]`;
}

/**
 * ANTI-HALLUCINATION: Fix fabricated Notion URLs in Claude's response
 *
 * Claude often ignores EXACT_URL_FOR_USER markers and fabricates similar-looking URLs.
 * This function:
 * 1. Extracts actual URLs from tool results
 * 2. Replaces any fabricated Notion URLs with the real ones
 * 3. Appends the URL if Claude omitted it entirely
 * 4. CRITICAL: If a dispatch tool FAILED, strip any Notion URLs Claude fabricated
 */
function fixHallucinatedUrls(responseText: string, toolContexts: ToolContext[]): string {
  // Check for dispatch tools that FAILED (submit_ticket, work_queue_create, etc.)
  const dispatchToolNames = ['submit_ticket', 'work_queue_create', 'mcp__pit_crew__dispatch_work'];
  let dispatchFailed = false;
  let failureError = '';

  // Extract actual URLs from tool results (most recent first)
  const actualUrls: string[] = [];
  for (let i = toolContexts.length - 1; i >= 0; i--) {
    const ctx = toolContexts[i];
    // Tool result structure: { success: boolean; result: unknown; error?: string }
    const toolResult = ctx.result as { success?: boolean; result?: unknown; error?: string } | undefined;

    // Track if a dispatch tool failed
    if (dispatchToolNames.includes(ctx.name)) {
      if (!toolResult?.success) {
        dispatchFailed = true;
        failureError = toolResult?.error || 'Dispatch failed';
        logger.error('DISPATCH TOOL FAILED', { tool: ctx.name, error: failureError });
      }
    }

    if (toolResult?.success) {
      const result = toolResult.result as Record<string, unknown> | undefined;
      if (result?.url && typeof result.url === 'string') {
        actualUrls.push(result.url);
      }
      if (result?.feedUrl && typeof result.feedUrl === 'string') {
        actualUrls.push(result.feedUrl);
      }
    }
  }

  // CRITICAL CASE: Dispatch tool failed but Claude may have fabricated a success URL
  // Strip ALL Notion URLs from response and add warning
  if (dispatchFailed && actualUrls.length === 0) {
    const notionUrlPattern = /https?:\/\/(?:www\.)?notion\.so\/[^\s\)\]>]+/gi;
    const matches = responseText.match(notionUrlPattern);

    if (matches && matches.length > 0) {
      logger.error('HALLUCINATION ON FAILURE: Claude fabricated URL despite tool failure', {
        fabricatedUrls: matches,
        error: failureError,
      });

      // Strip the fabricated URLs and add error notice
      let fixedText = responseText;
      for (const match of matches) {
        fixedText = fixedText.split(match).join('[DISPATCH FAILED]');
      }
      return `${fixedText}\n\n⚠️ **Dispatch failed:** ${failureError}`;
    }
  }

  if (actualUrls.length === 0) {
    return responseText; // No URLs to fix
  }

  // Regex to match Notion URLs (various formats Claude might fabricate)
  const notionUrlPattern = /https?:\/\/(?:www\.)?notion\.so\/[^\s\)\]>]+/gi;

  const matches = responseText.match(notionUrlPattern);

  // CASE 1: No Notion URLs in response, but tool returned one - append it
  if (!matches || matches.length === 0) {
    logger.info('URL MISSING: Claude omitted URL, appending actual', {
      actualUrls,
    });
    // Append the primary URL
    return `${responseText}\n\n📎 ${actualUrls[0]}`;
  }

  // CASE 2: Claude included Notion URLs - check if they're real or fabricated
  const uniqueMatches = [...new Set(matches)];
  const isHallucinated = uniqueMatches.some(m => !actualUrls.includes(m));

  if (isHallucinated) {
    logger.warn('HALLUCINATION DETECTED: Fixing fabricated Notion URLs', {
      claudeSaid: uniqueMatches,
      actualUrls,
    });

    // Replace ALL Notion URLs with the primary actual URL
    // (If multiple tools returned URLs, use the most recent one)
    let fixedText = responseText;
    for (const match of uniqueMatches) {
      if (!actualUrls.includes(match)) {
        // This is a fabricated URL - replace with actual
        fixedText = fixedText.split(match).join(actualUrls[0]);
      }
    }
    return fixedText;
  }

  return responseText; // URLs are correct
}

// Log feature status on module load
logger.info('Content confirmation keyboard', { enabled: CONTENT_CONFIRM_ENABLED });

// Initialize Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Max tool call iterations to prevent runaway loops
const MAX_TOOL_ITERATIONS = 5;

// Reaction emoji for processing states
const REACTIONS = {
  READING: '👀',    // Message received, starting processing
  WORKING: '⚡',    // Tools executing
  DONE: '👌',       // Action completed (logged to WQ, filed media, etc.)
  CHAT: '👍',       // Chat-only response, no action taken
  ERROR: '💔',      // Error during processing
} as const;

/**
 * Set reaction on a message, handling errors gracefully
 */
async function setReaction(ctx: Context, emoji: string): Promise<void> {
  try {
    await ctx.react(emoji);
  } catch (error) {
    // Reactions may fail (e.g., in channels, old messages, or unsupported emoji)
    logger.debug('Failed to set reaction', { emoji, error });
  }
}

/**
 * Detect if user is asking to convert/draft from a recent research result.
 * Matches phrases like "turn that into a LinkedIn post", "write a blog from that",
 * "draft an article about this", etc.
 *
 * Returns true if the message looks like a follow-on conversion request.
 */
function detectFollowOnConversionIntent(text: string): boolean {
  // Verb-first: "turn that into...", "write a blog...", "draft a post..."
  // Pronoun signals: "that", "this", "it" → implies referencing prior context
  const FOLLOW_ON_PATTERN = /^(can you |please )?(turn|draft|write|make|convert|transform)\b.*(into|as|up|a)\b/i;
  const PRONOUN_SIGNAL = /\b(that|this|it)\b/i;

  if (FOLLOW_ON_PATTERN.test(text)) return true;

  // Secondary: "make a post about that" / "summarize this for LinkedIn"
  const SECONDARY_PATTERN = /\b(summarize|post|article|blog|linkedin|thread|email|report)\b.*\b(that|this|it)\b/i;
  if (SECONDARY_PATTERN.test(text)) return true;

  // Tertiary: bare conversion phrases with pronoun — "LinkedIn post from that"
  const TERTIARY_PATTERN = /\b(linkedin|blog|article|thread|report|post|email)\b/i;
  if (TERTIARY_PATTERN.test(text) && PRONOUN_SIGNAL.test(text)) return true;

  return false;
}

/**
 * Handle incoming message - Claude as front door (with tools)
 */
export async function handleConversation(ctx: Context): Promise<void> {
  const userId = ctx.from!.id;
  let messageText = ctx.message?.text || ctx.message?.caption || '';
  const username = ctx.from?.username || String(userId);

  // Pipeline trace: tracks every step with timing and metadata
  const trace = createTrace();
  const msgStep = addStep(trace, 'message-received', {
    userId,
    messageLength: messageText.length,
    hasMedia: !!(ctx.message?.photo || ctx.message?.document || ctx.message?.video || ctx.message?.voice),
  });
  completeStep(msgStep);

  logger.info('Conversation message received', {
    userId,
    username,
    textLength: messageText.length,
    traceId: trace.traceId,
  });

  // Session telemetry: record turn + capture intent hash for drift detection
  const chatId = ctx.chat!.id;
  const currentIntentHash = messageText ? getIntentHash(messageText).hash : undefined;
  const sessionTelemetry = recordTurn(chatId, userId, currentIntentHash);

  // React to indicate message received
  await setReaction(ctx, REACTIONS.READING);

  // Show typing indicator
  await ctx.replyWithChatAction('typing');

  // Detect attachments
  const attachment = detectAttachment(ctx);
  const hasAttachment = attachment.type !== 'none';

  // Check for content share (URL) - trigger confirmation keyboard if enabled
  // Skip if message has attachments (let those go through normal flow)
  if (CONTENT_CONFIRM_ENABLED && !hasAttachment && messageText) {
    const handled = await maybeHandleAsContentShare(ctx);
    if (handled) {
      await setReaction(ctx, REACTIONS.DONE);
      logger.info('Content share detected, Socratic question sent', { userId });
      return;
    }
  }

  // DOMAIN CORRECTION DETECTION (STAB-002c)
  // Check if Jim's message is correcting the domain from a previous assessment.
  // Feature-gated — only runs when ATLAS_DOMAIN_AUDIENCE=true.
  if (DOMAIN_AUDIENCE_ENABLED && messageText && lastDomainByUser.has(userId)) {
    const currentDomain = lastDomainByUser.get(userId)!;
    const correction = detectDomainCorrection(messageText, currentDomain);
    if (correction) {
      const keywords = extractKeywords(messageText);
      // Fire-and-forget: telemetry shouldn't block the conversation
      logDomainCorrection(currentDomain, correction.corrected, keywords, messageText).catch(err => {
        logger.warn('Domain correction logging failed', { error: err });
      });
      // Update the cached domain so subsequent messages use the corrected value
      lastDomainByUser.set(userId, correction.corrected);
      logger.info('Domain correction detected', {
        userId,
        original: currentDomain,
        corrected: correction.corrected,
      });
    }
  }

  // SOCRATIC SESSION: Check if user has a pending Socratic question
  // Moved OUTSIDE CONTENT_CONFIRM_ENABLED gate — Socratic answers must be
  // processed regardless of the content confirmation feature flag.
  //
  // Bypass heuristic: if the message contains a URL, it's a new content share,
  // not an answer to the pending question. Cancel the session and let the
  // message flow through normal processing. (ADR-008: log bypass explicitly)
  if (!hasAttachment && messageText && hasPendingSocraticSessionForUser(userId)) {
    const containsUrl = /https?:\/\/\S+/i.test(messageText);
    if (containsUrl) {
      // URL in message = new content, not a Socratic answer
      const staleSocSession = getSocraticSessionByUserId(userId);
      if (staleSocSession) {
        removeSocraticSession(staleSocSession.chatId);
        returnToIdle(staleSocSession.chatId);
        logger.info('Socratic session bypassed: message contains URL (new content)', {
          userId,
          cancelledSessionId: staleSocSession.sessionId,
        });
      }
      // Fall through to normal processing — this URL will get triaged fresh
    } else {
      // No URL — treat as answer to the pending Socratic question
      const handled = await handleSocraticAnswer(ctx, messageText);
      if (handled) {
        await setReaction(ctx, REACTIONS.DONE);
        logger.info('Socratic answer processed', { userId });
        return;
      }
    }
  }

  // GOAL-CLARIFICATION: Check if user has a pending goal-clarification question
  // (ATLAS-GOAL-FIRST-001). Runs AFTER Socratic, BEFORE Approval.
  if (!hasAttachment && messageText) {
    const userState = getStateByUserId(userId);
    if (userState?.phase === 'goal-clarification' && userState.pendingGoal && userState.goalTargetField) {
      const containsUrl = /https?:\/\/\S+/i.test(messageText);
      if (containsUrl) {
        // URL = new content, cancel stale goal-clarification
        returnToIdle(userState.chatId);
        logger.info('Goal-clarification bypassed: new URL content', { userId });
        // Fall through to normal processing
      } else {
        try {
          // Incorporate Jim's clarification answer into the goal
          const updatedGoal = await incorporateClarification(
            userState.pendingGoal,
            messageText,
            userState.goalTargetField,
          );

          // Track clarification in telemetry
          const tracker = userState.goalTracker;
          if (tracker) {
            recordClarification(tracker, userState.goalTargetField || 'unknown');
          }

          const round = userState.goalClarificationRound || 1;
          const contentAnalysis = userState.goalContentAnalysis || { content: '' };
          const goalResult = resolveAfterClarification(updatedGoal, round, contentAnalysis);

          if (goalResult.immediateExecution) {
            // Snapshot state before returnToIdle clears it
            const trackerSnapshot = userState.goalTracker;
            const deferred = userState.goalDeferredExecution;
            const lastTriage = userState.lastTriage;
            returnToIdle(userState.chatId);
            if (deferred) {
              const cc = getContentContext(userState.chatId);
              await executeResolvedGoal(
                ctx,
                deferred.resolved,
                deferred.content,
                deferred.contentType,
                deferred.title,
                deferred.answerContext,
                cc?.prefetchedUrlContent,
                lastTriage || undefined,
                updatedGoal,
                trackerSnapshot,
              );
            }
            await setReaction(ctx, REACTIONS.DONE);
            logger.info('Goal clarification resolved, executing', {
              userId,
              completeness: updatedGoal.completeness,
              round,
            });
            return;
          }

          if (goalResult.clarificationNeeded && goalResult.nextQuestion) {
            // Still incomplete, ask next question
            const nextField = updatedGoal.missingFor[0]?.field || 'endStateRaw';
            enterGoalClarificationPhase(
              userState.chatId, userId, updatedGoal, contentAnalysis,
              nextField, round + 1, userState.goalDeferredExecution,
              tracker);
            await ctx.reply(goalResult.nextQuestion);
            logger.info('Goal clarification round', {
              userId,
              round: round + 1,
              targetField: nextField,
              completeness: updatedGoal.completeness,
            });
            return;
          }
        } catch (goalErr) {
          // CONSTRAINT 4: Log failure, fall through to normal processing
          logger.error('Goal clarification failed', {
            error: goalErr instanceof Error ? goalErr.message : String(goalErr),
            userId,
          });
          returnToIdle(userState.chatId);
          // Fall through to normal processing
        }
      }
    }
  }

  // APPROVAL SESSION: Check for pending complex-terrain proposal (STAB-003)
  // Runs AFTER Socratic, BEFORE Dialogue — approval is a quick yes/no gate.
  let approvalGranted = false;
  if (!hasAttachment && messageText && hasApprovalSessionForUser(userId)) {
    const containsUrl = /https?:\/\/\S+/i.test(messageText);
    if (containsUrl) {
      // URL = new content, cancel stale approval
      const staleSession = getApprovalSessionByUserId(userId);
      if (staleSession) {
        removeApprovalSession(staleSession.chatId);
        returnToIdle(staleSession.chatId);
        logger.info('Approval session bypassed: new URL content', { userId });
      }
    } else {
      const approvalSession = getApprovalSessionByUserId(userId);
      if (approvalSession) {
        const approvalStep = addStep(trace, 'approval-check');
        if (isApprovalSignal(messageText)) {
          // Approved — proceed with refined (or original) message
          removeApprovalSession(approvalSession.chatId);
          if (approvalSession.refinedRequest) {
            messageText = approvalSession.refinedRequest;
          } else {
            messageText = approvalSession.originalMessage;
          }
          approvalGranted = true;
          // SESSION-STATE-FOUNDATION: Return unified state to idle.
          // Assessment + triage remain cached — pipeline skip reads them.
          returnToIdle(approvalSession.chatId);
          approvalStep.metadata = { status: 'approved', hasRefinedRequest: !!approvalSession.refinedRequest };
          completeStep(approvalStep);
          logger.info('Proposal approved, proceeding with execution', { userId });
          // Fall through to normal processing — approvalGranted skips triage/enrichment/assessment
        } else if (isRejectionSignal(messageText)) {
          // Rejected — ask for adjustment
          removeApprovalSession(approvalSession.chatId);
          returnToIdle(approvalSession.chatId);
          await ctx.reply(
            "Got it — what would you adjust? I can rethink the approach.",
            { parse_mode: 'HTML' },
          );
          approvalStep.metadata = { status: 'rejected' };
          completeStep(approvalStep);
          completeTrace(trace);
          logger.info('Proposal rejected', { userId });
          return;
        } else {
          // Ambiguous — treat as new message, remove session, re-assess
          removeApprovalSession(approvalSession.chatId);
          returnToIdle(approvalSession.chatId);
          approvalStep.metadata = { status: 'ambiguous', treatedAsNewMessage: true };
          completeStep(approvalStep);
          logger.info('Ambiguous approval reply, treating as new message', { userId });
          // Fall through — messageText stays as-is, gets full pipeline treatment
        }
      }
    }
  }

  // DIALOGUE SESSION: Check for pending rough-terrain dialogue
  // Moved AFTER Socratic check — Socratic handles content capture,
  // dialogue handles rough-terrain exploration. Mutually exclusive by design.
  if (!hasAttachment && messageText && hasDialogueSessionForUser(userId)) {
    const containsUrl = /https?:\/\/\S+/i.test(messageText);
    if (containsUrl) {
      // URL = new content, cancel stale dialogue
      const staleSession = getDialogueSessionByUserId(userId);
      if (staleSession) {
        removeDialogueSession(staleSession.chatId);
        returnToIdle(staleSession.chatId);
        logger.info('Dialogue session bypassed: new URL content', { userId });
      }
    } else {
      // Continue dialogue with Jim's response
      const dialogueSession = getDialogueSessionByUserId(userId);
      if (dialogueSession) {
        const dialogueStep = addStep(trace, 'dialogue-continue');
        try {
          const model = getCachedModel();
          if (!model) {
            // Can't continue without model — cancel and fall through
            removeDialogueSession(dialogueSession.chatId);
            returnToIdle(dialogueSession.chatId);
            dialogueStep.metadata = { status: 'cancelled', reason: 'no-cached-model' };
            completeStep(dialogueStep);
          } else {
            const result = continueDialogue(messageText, dialogueSession.dialogueState, model);
            if (result.needsResponse) {
              // Dialogue continues — update state, send next message
              const nextMsgId = (await ctx.reply(
                result.message.length > 4000 ? result.message.substring(0, 3997) + '...' : result.message,
                { parse_mode: 'HTML' },
              )).message_id;
              storeDialogueSession({
                ...dialogueSession,
                dialogueState: result.state,
                questionMessageId: nextMsgId,
              });
              // SESSION-STATE-FOUNDATION: Mirror to unified state
              enterDialoguePhase(dialogueSession.chatId, userId, {
                questionMessageId: nextMsgId,
                dialogueState: result.state,
                assessment: dialogueSession.assessment,
                assessmentContext: dialogueSession.assessmentContext,
                originalMessage: dialogueSession.originalMessage,
              });
              dialogueStep.metadata = {
                status: 'continued',
                turn: result.state.turnCount,
                openQuestions: result.state.openQuestions.length,
              };
              completeStep(dialogueStep);
              completeTrace(trace);
              return;
            } else {
              // Dialogue resolved — remove session, proceed with refined request
              removeDialogueSession(dialogueSession.chatId);
              returnToIdle(dialogueSession.chatId);

              // STAB-003 Fix 1: Substitute refined request for downstream processing.
              // The dialogue engine synthesizes user intent into a clear, actionable
              // request. Using the original vague message would discard that work.
              if (result.refinedRequest) {
                const original = messageText;
                messageText = result.refinedRequest;
                logger.info('Refined request substituted (STAB-003)', {
                  original: original.substring(0, 50),
                  refined: messageText.substring(0, 50),
                });
              }

              // STAB-003 Fix 2: If dialogue produced a proposal, surface it for approval
              // before executing. Complex terrain deserves user sign-off.
              if (result.proposal) {
                const proposalMsg = formatProposalMessage(result.proposal, 'complex');
                const sentMsg = await ctx.reply(
                  proposalMsg.length > 4000 ? proposalMsg.substring(0, 3997) + '...' : proposalMsg,
                  { parse_mode: 'HTML' },
                );
                storeApprovalSession({
                  chatId: ctx.chat!.id,
                  userId,
                  proposalMessageId: sentMsg.message_id,
                  proposal: result.proposal,
                  refinedRequest: result.refinedRequest,
                  originalMessage: dialogueSession.originalMessage,
                  assessment: dialogueSession.assessment,
                  assessmentContext: dialogueSession.assessmentContext,
                  createdAt: Date.now(),
                });
                // SESSION-STATE-FOUNDATION: Mirror to unified state
                enterApprovalPhase(ctx.chat!.id, userId, {
                  proposalMessageId: sentMsg.message_id,
                  proposal: result.proposal,
                  refinedRequest: result.refinedRequest,
                  originalMessage: dialogueSession.originalMessage,
                  assessment: dialogueSession.assessment,
                  assessmentContext: dialogueSession.assessmentContext,
                });
                dialogueStep.metadata = {
                  status: 'resolved-awaiting-approval',
                  turns: result.state.turnCount,
                  hasProposal: true,
                  hasRefinedRequest: !!result.refinedRequest,
                };
                completeStep(dialogueStep);
                completeTrace(trace);
                logger.info('Dialogue resolved, approval pending', {
                  turns: result.state.turnCount,
                  hasRefinedRequest: !!result.refinedRequest,
                });
                return;
              }

              dialogueStep.metadata = {
                status: 'resolved',
                turns: result.state.turnCount,
                hasProposal: false,
                hasRefinedRequest: !!result.refinedRequest,
              };
              completeStep(dialogueStep);
              // Fall through to normal processing with refined (or original) message
            }
          }
        } catch (err) {
          removeDialogueSession(dialogueSession.chatId);
          returnToIdle(dialogueSession.chatId);
          dialogueStep.metadata = {
            status: 'failed',
            error: err instanceof Error ? err.message : String(err),
          };
          completeStep(dialogueStep);
          logger.warn('Dialogue continuation failed, falling through to normal flow', { error: err });
          // Fall through to normal processing
        }
      }
    }
  }

  // Build the message content
  let userContent = messageText;

  // Process media with Gemini if attachment present
  let mediaContext = null;
  if (hasAttachment) {
    logger.info('Media attachment detected', { type: attachment.type });

    // CLASSIFY-FIRST FLOW: Show instant keyboard BEFORE running Gemini
    // This enables faster UX and pillar-aware analysis
    if (CONTENT_CONFIRM_ENABLED) {
      const handled = await triggerInstantClassification(ctx, attachment);
      if (handled) {
        await setReaction(ctx, REACTIONS.DONE);
        logger.info('Media detected, instant classification keyboard shown (classify-first)', {
          userId,
          type: attachment.type,
        });
        return; // Don't continue to Claude - keyboard handles flow
      }
    }

    // FALLBACK: If classify-first disabled or failed, use legacy flow
    await ctx.replyWithChatAction('typing');

    // Quick classification for pillar routing
    const quickPillar = await classifyWithFallback(messageText || attachment.caption || 'media')
      .then(c => c.pillar as Pillar);

    // Process with Gemini + archive + log to Feed
    mediaContext = await processMedia(ctx, attachment, quickPillar);

    if (mediaContext) {
      // If content confirmation is enabled but classify-first failed, use old flow
      if (CONTENT_CONFIRM_ENABLED) {
        const handled = await triggerMediaConfirmation(ctx, attachment, mediaContext, quickPillar);
        if (handled) {
          await setReaction(ctx, REACTIONS.DONE);
          logger.info('Media processed, confirmation keyboard shown (legacy)', {
            userId,
            type: mediaContext.type,
          });
          return; // Don't continue to Claude
        }
      }

      // Fallback: Inject Gemini's understanding into Claude's context
      userContent += buildMediaContext(mediaContext, attachment);
      logger.info('Media processed', {
        type: mediaContext.type,
        processingTime: mediaContext.processingTime,
        archived: !!mediaContext.archivedPath,
      });
    } else {
      // Fallback to basic attachment prompt
      userContent += buildAttachmentPrompt(attachment);
    }
  }

  // FOLLOW-ON CONVERSION: Detect "turn that into a post" patterns and enrich
  // userContent with the stashed research result so Claude knows exactly what
  // "that" refers to. Consumes the stash so it doesn't bleed into future turns.
  const followOnIntent = detectFollowOnConversionIntent(messageText);
  if (followOnIntent) {
    const recentResult = getLastAgentResult(userId);
    if (recentResult) {
      userContent = [
        `[FOLLOW-ON CONVERSION REQUEST]`,
        `User says: "${messageText}"`,
        ``,
        `Recent research topic: "${recentResult.topic}"`,
        `Research summary: ${recentResult.resultSummary.substring(0, 300)}`,
        ``,
        `Please draft the requested content based on the research above.`,
      ].join('\n');
      clearLastAgentResult(userId);
      logger.info('Follow-on conversion intent detected, enriching context', {
        userId,
        topic: recentResult.topic.substring(0, 60),
        intent: messageText.substring(0, 60),
      });
    }
  }

  // ────────────────────────────────────────────────────────
  // PIPELINE SKIP (SESSION-STATE-FOUNDATION)
  //
  // When approvalGranted === true, the triage, enrichment, and assessment
  // were already computed BEFORE the proposal was surfaced. Re-running them
  // on the approval text ("yes") wastes 4-6 API calls (Bug #1) and drifts
  // the pillar (Bug #5). Instead, pull cached results from unified state.
  // ────────────────────────────────────────────────────────

  let preflightTriage: TriageResult | null = null;
  let contextEnrichment: EnrichmentResult | null = null;
  let assessment: RequestAssessment | null = null;

  if (approvalGranted) {
    // Restore cached triage + assessment from unified state
    const cachedState = getStateByUserId(userId);
    if (cachedState?.lastTriage) {
      preflightTriage = cachedState.lastTriage;
      logger.info('Pipeline skip: reusing cached triage (post-approval)', {
        userId,
        pillar: preflightTriage.pillar,
        intent: preflightTriage.intent,
      });
    }
    if (cachedState?.lastAssessment) {
      assessment = cachedState.lastAssessment;
      logger.info('Pipeline skip: reusing cached assessment (post-approval)', {
        userId,
        complexity: assessment.complexity,
      });
    }
    // Triage step in trace: mark as skipped-reused
    const triageStep = addStep(trace, 'triage');
    triageStep.metadata = { status: 'skipped-reused', reason: 'approval-granted' };
    completeStep(triageStep);
    // Enrichment: skipped post-approval (already computed before proposal)
    // Assessment: skipped (already have it from cache)
  } else {
    // ── Normal path: full triage → enrichment → assessment ──

    // PRE-FLIGHT TRIAGE: Detect command intent before sending to Claude
    // This fixes the meta-request bug where "log a bug about X" gets captured
    // as a task instead of executing the command. The triage result is reused
    // for audit later (no duplicate API call).
    //
    // BUG #2 FIX (SESSION-STATE-FOUNDATION): Prepend URL context from unified state
    // so triage sees the full picture when Jim's follow-up text is decontextualized.
    // Without this, "research this" after a URL share → triage sees only "research this"
    // and drifts to the wrong pillar.
    const triageStep = addStep(trace, 'triage');
    try {
      let triageInput = messageText;
      const contentCtx = getContentContext(ctx.chat!.id);
      if (contentCtx && !messageText.includes('http')) {
        // Follow-up text after URL share — prepend URL context for triage
        const contextParts = [`[URL context: ${contentCtx.url}]`];
        if (contentCtx.title) contextParts.push(`[Title: ${contentCtx.title}]`);
        if (contentCtx.preReadSummary) contextParts.push(`[Summary: ${contentCtx.preReadSummary}]`);
        triageInput = `${contextParts.join(' ')}\n\n${messageText}`;
        triageStep.metadata = { urlContextPrepended: true, url: contentCtx.url };
      }
      preflightTriage = await triageMessage(triageInput);
      completeStep(triageStep);
      triageStep.metadata = {
        ...triageStep.metadata,
        intent: preflightTriage.intent,
        confidence: preflightTriage.confidence,
        pillar: preflightTriage.pillar,
        source: preflightTriage.source,
      };
      // Cache triage in unified state (Bug #4: prevents double triage, Bug #5: stable pillar)
      storeTriageInState(ctx.chat!.id, preflightTriage);

      // Command intent: rewrite userContent so Claude structures the ticket properly
      if (preflightTriage.intent === 'command' && preflightTriage.command) {
        const cmd = preflightTriage.command;
        userContent = [
          `[USER COMMAND: ${cmd.verb} ${cmd.target}${cmd.priority ? ` priority=${cmd.priority}` : ''}]`,
          `Pillar: ${preflightTriage.pillar}`,
          ``,
          cmd.description,
        ].join('\n');

        logger.info('Pre-flight triage: command intent detected', {
          verb: cmd.verb,
          target: cmd.target,
          priority: cmd.priority,
          descriptionLength: cmd.description.length,
        });
      }
    } catch (err) {
      completeStep(triageStep);
      triageStep.metadata = { error: err instanceof Error ? err.message : String(err) };
      logger.warn('Pre-flight triage failed (non-fatal, continuing with raw text)', { error: err });
    }

    // CONTEXT ENRICHMENT: Populate cognitive context slots (domain RAG, POV, voice, intent)
    // Feature gate: ATLAS_CONTEXT_ENRICHMENT (default: enabled)
    if (process.env.ATLAS_CONTEXT_ENRICHMENT !== 'false') {
      const enrichStep = addStep(trace, 'context-enrichment');
      // No try/catch — enrichment errors propagate to the outer handler.
      // Graceful degradation will be re-enabled once the pipeline is stable.
      contextEnrichment = await enrichWithContextSlots(messageText, userId);
      completeStep(enrichStep);
      enrichStep.metadata = {
        slotsUsed: contextEnrichment?.slotsUsed,
        tier: contextEnrichment?.tier,
        totalTokens: contextEnrichment?.totalTokens,
        slotStatuses: contextEnrichment?.slotResults
          ? Object.fromEntries(contextEnrichment.slotResults.map((s) => [s.slotName, s.status]))
          : undefined,
        degraded: contextEnrichment?.degradedContextNote != null,
      };
    }
  }

  // REQUEST ASSESSMENT: Classify complexity + build approach proposal
  // Feature gate: ATLAS_SELF_MODEL (assessment needs capability model from Fix 1)
  // Observability-only in STAB-001: logs to trace, does NOT alter conversation flow
  // SESSION-STATE-FOUNDATION: Skip when approvalGranted (assessment already cached above)
  if (!approvalGranted && process.env.ATLAS_SELF_MODEL === 'true' && preflightTriage) {
    const assessStep = addStep(trace, 'request-assessment');
    try {
      const model = getCachedModel();
      if (!model) {
        // Explicit trace — not silent degradation (ADR-008)
        assessStep.metadata = { status: 'skipped', reason: 'no-cached-model' };
        completeStep(assessStep);
        logger.info('Assessment skipped: no cached capability model');
      } else {
        const assessmentContext: AssessmentContext = {
          intent: preflightTriage.intent,
          pillar: preflightTriage.pillar,
          keywords: preflightTriage.keywords,
          hasUrl: /https?:\/\//.test(messageText),
          hasContact: false,
          hasDeadline: false,
        };
        assessment = await assessRequest(messageText, assessmentContext, model);
        assessStep.metadata = {
          status: 'ok',
          complexity: assessment.complexity,
          signalCount: assessment.signals ? Object.values(assessment.signals).filter(Boolean).length : 0,
          hasProposal: !!assessment.approach,
        };
        completeStep(assessStep);
        logger.info('Assessment complete', {
          complexity: assessment.complexity,
          signalCount: assessment.signals ? Object.values(assessment.signals).filter(Boolean).length : 0,
          hasProposal: !!assessment.approach,
        });

        // Cache domain for correction detection on next message (STAB-002c)
        if (DOMAIN_AUDIENCE_ENABLED && assessment.domain) {
          lastDomainByUser.set(userId, assessment.domain);
        }

        // Cache assessment in unified state (Bug #1: reused after approval)
        storeAssessment(ctx.chat!.id, assessment, assessmentContext);
      }
    } catch (err) {
      // Explicit trace failure — ADR-008: surface failure in metadata, not just log
      assessStep.metadata = {
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
      };
      completeStep(assessStep);
      logger.warn('Assessment failed', { error: err });
    }
  }

  // DIALOGUE ROUTING: If rough terrain, enter collaborative exploration
  // instead of sending directly to Claude
  if (assessment && assessmentNeedsDialogue(assessment)) {
    const dialogueStep = addStep(trace, 'dialogue-entry');
    try {
      const model = getCachedModel();
      if (!model) {
        dialogueStep.metadata = { status: 'skipped', reason: 'no-cached-model' };
        completeStep(dialogueStep);
        // Fall through to normal Claude conversation
      } else {
        const assessCtx: AssessmentContext = {
          intent: preflightTriage?.intent,
          pillar: preflightTriage?.pillar,
          keywords: preflightTriage?.keywords,
          hasUrl: /https?:\/\//.test(messageText),
          hasContact: false,
          hasDeadline: false,
        };
        const result = enterDialogue(messageText, assessment, assessCtx, model);

        const dialogueMsg = result.message.length > 4000
          ? result.message.substring(0, 3997) + '...'
          : result.message;
        const sentMsg = await ctx.reply(dialogueMsg, { parse_mode: 'HTML' });
        storeDialogueSession({
          chatId: ctx.chat!.id,
          userId,
          questionMessageId: sentMsg.message_id,
          dialogueState: result.state,
          assessment,
          assessmentContext: assessCtx,
          originalMessage: messageText,
          createdAt: Date.now(),
        });
        // SESSION-STATE-FOUNDATION: Mirror to unified state
        enterDialoguePhase(ctx.chat!.id, userId, {
          questionMessageId: sentMsg.message_id,
          dialogueState: result.state,
          assessment,
          assessmentContext: assessCtx,
          originalMessage: messageText,
        });

        dialogueStep.metadata = {
          status: 'entered',
          terrain: 'rough',
          threadCount: result.state.threads.length,
          openQuestions: result.state.openQuestions.length,
        };
        completeStep(dialogueStep);
        completeTrace(trace);
        logger.info('Entered dialogue: rough terrain', {
          terrain: 'rough',
          threads: result.state.threads.length,
        });
        return; // Skip normal Claude conversation
      }
    } catch (err) {
      dialogueStep.metadata = {
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
      };
      completeStep(dialogueStep);
      logger.warn('Dialogue entry failed, falling through to normal flow', { error: err });
      // Fall through — ADR-008 compliant: visible failure, graceful degradation
    }
  }

  // APPROVAL GATE: Moderate+ terrain with proposal → surface for approval (STAB-003/003a)
  // Any non-simple request with an approach proposal gets surfaced for sign-off.
  // Rough terrain routes to dialogue first, so in practice this gates moderate + complex.
  // Bug #3 fix (SESSION-STATE-FOUNDATION): Add steps.length >= 2 to prevent over-gating.
  // Single-step moderate proposals don't need approval — they're just "do this one thing".
  if (assessment && assessment.approach && assessment.approach.steps.length >= 2 && assessment.complexity !== 'simple' && !approvalGranted) {
    const approvalStep = addStep(trace, 'approval-gate');
    const proposalMsg = formatProposalMessage(assessment.approach, assessment.complexity);
    const sentMsg = await ctx.reply(
      proposalMsg.length > 4000 ? proposalMsg.substring(0, 3997) + '...' : proposalMsg,
      { parse_mode: 'HTML' },
    );
    const assessCtx: AssessmentContext = {
      intent: preflightTriage?.intent,
      pillar: preflightTriage?.pillar,
      keywords: preflightTriage?.keywords,
      hasUrl: /https?:\/\//.test(messageText),
      hasContact: false,
      hasDeadline: false,
    };
    storeApprovalSession({
      chatId: ctx.chat!.id,
      userId,
      proposalMessageId: sentMsg.message_id,
      proposal: assessment.approach,
      originalMessage: messageText,
      assessment,
      assessmentContext: assessCtx,
      createdAt: Date.now(),
    });
    // SESSION-STATE-FOUNDATION: Mirror to unified state
    enterApprovalPhase(ctx.chat!.id, userId, {
      proposalMessageId: sentMsg.message_id,
      proposal: assessment.approach,
      originalMessage: messageText,
      assessment,
      assessmentContext: assessCtx,
    });
    approvalStep.metadata = {
      status: 'proposal-surfaced',
      complexity: assessment.complexity,
      stepsCount: assessment.approach.steps.length,
    };
    completeStep(approvalStep);
    completeTrace(trace);
    logger.info('Proposal surfaced, awaiting approval', {
      complexity: assessment.complexity,
      steps: assessment.approach.steps.length,
    });
    return;
  }

  // Get conversation history
  const conversation = await getConversation(userId);

  // Build system prompt (pass conversation for tool context continuity)
  const promptStep = addStep(trace, 'prompt-build');
  const baseSystemPrompt = await buildSystemPrompt(conversation);

  // Inject cognitive context into system prompt if enrichment succeeded
  // When slots are degraded/failed, append a transparency note so the model
  // knows which context areas may be missing and can adjust accordingly.
  let systemPrompt = baseSystemPrompt;
  if (contextEnrichment) {
    systemPrompt += `\n\n---\n\n## Cognitive Context\n\n${contextEnrichment.enrichedContext}`;
    if (contextEnrichment.degradedContextNote) {
      systemPrompt += `\n\n${contextEnrichment.degradedContextNote}`;
    }
  }

  // Inject assessment context: complexity tier + approach proposal
  // This tells Claude HOW to respond, not just WHAT context is available
  if (assessment) {
    const assessmentLines = [
      `\n\n---\n\n## Request Assessment`,
      ``,
      `**Complexity:** ${assessment.complexity}`,
      `**Reasoning:** ${assessment.reasoning}`,
    ];

    // For complex/rough: include the approach proposal
    if (assessment.approach) {
      assessmentLines.push(
        ``,
        `**Proposed Approach:**`,
        ...assessment.approach.steps.map((s, i) => `${i + 1}. ${s.description}`),
      );
      if (assessment.approach.timeEstimate) {
        assessmentLines.push(`**Estimated Time:** ${assessment.approach.timeEstimate}`);
      }
      if (assessment.approach.questionForJim) {
        assessmentLines.push(``, `**Before proceeding, ask Jim:** ${assessment.approach.questionForJim}`);
      }
    }

    // Surface matched capabilities
    if (assessment.capabilities.length > 0) {
      assessmentLines.push(
        ``,
        `**Relevant Capabilities:** ${assessment.capabilities.map(c => c.capabilityId).join(', ')}`,
      );
    }

    systemPrompt += assessmentLines.join('\n');
  }

  // Inject last agent result for follow-on conversion awareness
  // If the user says "turn that into a post", Claude knows what "that" is
  const lastAgentResult = getLastAgentResult(userId);
  if (lastAgentResult) {
    systemPrompt += [
      `\n\n---\n\n## Recent Research Result (available for follow-on)`,
      ``,
      `The user recently completed a research task. If they ask you to draft, convert,`,
      `or transform content, this is what they are most likely referring to.`,
      ``,
      `Topic: ${lastAgentResult.topic}`,
      `Summary: ${lastAgentResult.resultSummary}`,
      `Source: ${lastAgentResult.source}`,
    ].join('\n');
  }

  // Build messages array for Claude API
  const messages: Anthropic.MessageParam[] = buildMessages(conversation, userContent);
  completeStep(promptStep);

  let totalTokens = 0;
  const toolsUsed: string[] = [];  // Track tools for conversation history
  const toolContexts: ToolContext[] = [];  // Store tool calls/results for continuity

  try {
    // Get all tools (native + MCP) dynamically
    const tools = getAllTools();

    // Detect if message requires tool use (create/add operations)
    // Also force tool use when pre-flight triage detected command intent
    const isCommandIntent = preflightTriage?.intent === 'command' && !!preflightTriage.command;
    const requiresToolUse = isCommandIntent ||
                           /\b(create|add|log|make|put|track|file|submit)\b.*\b(bug|feature|task|item|pipeline|queue|notion)\b/i.test(messageText) ||
                           /\b(dev.?pipeline|work.?queue)\b/i.test(messageText);

    // Call Claude with tools
    const claudeStep = addStep(trace, 'claude-api', { model: 'claude-sonnet-4-20250514' });
    let response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      temperature: 0.4,  // PM mode - balanced precision, reduces hallucination
      system: systemPrompt,
      messages,
      tools,
      // Force tool use for create/add operations
      ...(requiresToolUse && { tool_choice: { type: 'any' as const } }),
    });

    totalTokens += response.usage.input_tokens + response.usage.output_tokens;
    completeStep(claudeStep);
    claudeStep.metadata = {
      ...claudeStep.metadata,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      stopReason: response.stop_reason,
    };

    // Tool use loop
    let iterations = 0;
    let reactedWorking = false;
    while (response.stop_reason === 'tool_use' && iterations < MAX_TOOL_ITERATIONS) {
      iterations++;

      // React to indicate tools are executing (only on first iteration)
      if (!reactedWorking) {
        await setReaction(ctx, REACTIONS.WORKING);
        reactedWorking = true;
      }

      // Find tool use blocks
      const toolUseBlocks = response.content.filter(
        (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
      );

      if (toolUseBlocks.length === 0) break;

      // Execute each tool call
      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const toolUse of toolUseBlocks) {
        logger.info('Executing tool', { tool: toolUse.name, input: toolUse.input });

        // Track tool usage for conversation history
        if (!toolsUsed.includes(toolUse.name)) {
          toolsUsed.push(toolUse.name);
        }

        // Keep typing indicator active
        await ctx.replyWithChatAction('typing');

        const toolStep = addStep(trace, 'tool-execution', { toolName: toolUse.name });
        const result = await executeTool(
          toolUse.name,
          toolUse.input as Record<string, unknown>
        );
        completeStep(toolStep);
        toolStep.metadata = { ...toolStep.metadata, success: result.success };

        // CHECK FOR LOW-CONFIDENCE ROUTING: Intercept needsChoice response
        if (toolUse.name === 'submit_ticket' && result.needsChoice) {
          const choiceData = result.result as {
            routingConfidence: number;
            suggestedCategory: string;
            alternativeCategory: string;
            title: string;
            description: string;
            priority: 'P0' | 'P1' | 'P2';
            requireReview: boolean;
            pillar: string;
            reasoning: string;
          };

          // Generate request ID and store pending dispatch
          const requestId = generateDispatchChoiceId();
          const pending: PendingDispatch = {
            requestId,
            chatId: ctx.chat!.id,
            userId,
            messageId: ctx.message?.message_id,
            reasoning: choiceData.reasoning,
            title: choiceData.title,
            description: choiceData.description,
            priority: choiceData.priority,
            requireReview: choiceData.requireReview,
            pillar: choiceData.pillar,
            routingConfidence: choiceData.routingConfidence,
            suggestedCategory: choiceData.suggestedCategory,
            alternativeCategory: choiceData.alternativeCategory,
            timestamp: Date.now(),
          };

          storePendingDispatch(pending);

          // Build and send the choice keyboard
          const message = formatRoutingChoiceMessage(pending);
          const keyboard = buildRoutingChoiceKeyboard(
            requestId,
            choiceData.suggestedCategory,
            choiceData.alternativeCategory
          );

          await ctx.reply(message, {
            parse_mode: 'HTML',
            reply_markup: keyboard,
          });

          // React to indicate user action needed
          await setReaction(ctx, REACTIONS.CHAT);

          logger.info('Low-confidence routing - presenting choice keyboard', {
            requestId,
            confidence: choiceData.routingConfidence,
            suggested: choiceData.suggestedCategory,
            alternative: choiceData.alternativeCategory,
          });

          // Update conversation with the interaction
          await updateConversation(
            userId,
            messageText,
            `[Routing choice requested: ${choiceData.title} - ${choiceData.routingConfidence}% confidence]`,
            { toolsUsed: ['submit_ticket'] }
          );

          return; // Exit early - keyboard handles the rest
        }

        // Capture tool context for conversation continuity
        toolContexts.push({
          toolName: toolUse.name,
          input: toolUse.input as Record<string, unknown>,
          result: result,
          timestamp: new Date().toISOString(),
        });

        // Format result to make errors EXPLICIT and impossible to ignore
        // AND make URLs UNMISSABLE to prevent hallucination
        let toolResultContent: string;
        if (result.success) {
          const resultObj = result.result as Record<string, unknown> | undefined;
          const url = resultObj?.url as string | undefined;
          const feedUrl = resultObj?.feedUrl as string | undefined;

          if (url || feedUrl) {
            // CRITICAL: Put URLs LAST - Claude hallucinates less with recent context
            // Also use EXACT_URL_* naming to make it crystal clear
            const jsonResult = JSON.stringify(result, null, 2);
            let urlBlock = '\n\n════════════════════════════════════════\n';
            urlBlock += '⚠️ MANDATORY - COPY EXACTLY - NO FABRICATION ⚠️\n';
            urlBlock += '════════════════════════════════════════\n';
            if (url) urlBlock += `EXACT_URL_FOR_USER: ${url}\n`;
            if (feedUrl) urlBlock += `EXACT_FEED_URL: ${feedUrl}\n`;
            urlBlock += '════════════════════════════════════════\n';
            urlBlock += 'If you display ANY Notion URL other than EXACT_URL_FOR_USER,\n';
            urlBlock += 'you are LYING to the user. Use ONLY the URL above.\n';
            urlBlock += '════════════════════════════════════════';
            // Put JSON first, URLS LAST (recency bias helps)
            toolResultContent = `✅ SUCCESS\n\nResult data:\n${jsonResult}${urlBlock}`;
          } else {
            toolResultContent = JSON.stringify(result);
          }
        } else {
          // CRITICAL: Prefix failed results so Claude cannot hallucinate success
          toolResultContent = `⚠️ TOOL FAILED - DO NOT CLAIM SUCCESS ⚠️\n\nError: ${result.error || 'Unknown error'}\n\nRaw result: ${JSON.stringify(result)}\n\n⚠️ You MUST acknowledge this failure to the user. Do NOT pretend this operation succeeded.`;
          logger.warn('Tool execution failed', {
            tool: toolUse.name,
            error: result.error,
          });
        }

        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: toolResultContent,
        });

        logger.info('Tool executed', {
          tool: toolUse.name,
          success: result.success,
        });
      }

      // Add assistant response and tool results to messages
      messages.push({ role: 'assistant', content: response.content });
      messages.push({ role: 'user', content: toolResults });

      // Continue conversation with tool results
      response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        temperature: 0.4,  // PM mode - balanced precision, reduces hallucination
        system: systemPrompt,
        messages,
        tools,
      });

      totalTokens += response.usage.input_tokens + response.usage.output_tokens;
    }

    // Extract final text response
    const textContent = response.content.find(
      (block): block is Anthropic.TextBlock => block.type === 'text'
    );
    let responseText = textContent?.text.trim() || "Done.";

    // ANTI-HALLUCINATION: Post-process to fix fabricated URLs
    // Claude ignores EXACT_URL_FOR_USER markers, so we must replace any Notion URLs
    // in its response with the actual URLs from tool results
    responseText = fixHallucinatedUrls(responseText, toolContexts);

    // Build version with tool context for conversation history
    // This helps maintain context across turns when tools were used
    // Solution A: Include key result data (IDs, URLs) for follow-up continuity
    const historyResponse = toolContexts.length > 0
      ? `${responseText}\n\n${formatToolContextForHistory(toolContexts)}`
      : responseText;

    // Classify the message for audit — reuse pre-flight triage if available
    // This avoids a redundant Haiku API call (pre-flight already ran)
    let classification: { pillar: Pillar; requestType: string; confidence: number; workType: string; keywords: string[]; reasoning: string; };
    let smartTitle: string;

    if (preflightTriage) {
      classification = {
        pillar: preflightTriage.pillar as Pillar,
        requestType: preflightTriage.requestType,
        confidence: preflightTriage.confidence,
        workType: preflightTriage.requestType.toLowerCase(),
        keywords: preflightTriage.keywords,
        reasoning: preflightTriage.titleRationale || `Triage: ${preflightTriage.intent} (${preflightTriage.source})`,
      };
      // For command intents, use the extracted description as title (not the meta-request)
      smartTitle = preflightTriage.intent === 'command' && preflightTriage.command
        ? preflightTriage.command.description.substring(0, 100)
        : (preflightTriage.title || messageText.substring(0, 100) || 'Message');
    } else {
      // Fallback: pre-flight failed, run triage now
      const auditTriage = await triageForAudit(messageText);
      classification = auditTriage.classification;
      smartTitle = auditTriage.smartTitle;
    }

    // Create audit trail (Feed + Work Queue)
    // Assessment pillar (keyword-based) overrides triage pillar (Haiku-based)
    // when available — triage guesses wrong at low confidence (e.g. "add milk" → The Grove).
    // STAB-002c: When domain is available, derive pillar from domain for consistency.
    const auditPillar = (assessment?.domain
      ? derivePillar(assessment.domain, assessment.audience)
      : (assessment?.pillar ?? classification.pillar)) as Pillar;
    const auditEntry: AuditEntry = {
      entry: smartTitle,
      pillar: auditPillar,
      requestType: classification.requestType,
      source: 'Telegram',
      author: 'Jim',
      confidence: classification.confidence,
      keywords: classification.keywords,
      workType: classification.workType,
      userId,
      messageText,
      hasAttachment,
      attachmentType: hasAttachment ? attachment.type : undefined,
      tokenCount: totalTokens,
      // Vision Processing Fix (0225379)
      // Bug: https://notion.so/2fc780a78eef81ad9c03dac5b062d7a2
      // Without this wiring, Gemini's MediaContext never reached Notion page bodies.
      // Now image analysis appears as structured content (summary, key points, actions).
      ...(mediaContext && {
        contentType: mediaContext.type as 'image' | 'document' | 'video' | 'audio',
        analysisContent: buildAnalysisContent(
          mediaContext,
          attachment,
          auditPillar
        ),
      }),
    };

    // Assessment gates audit trail: when assessment says simple, skip audit if
    // either (a) Claude already handled via tools (no double-write), or
    // (b) triage confidence is too low to trust (no wrong-pillar garbage).
    // Wrong entries are worse than missing entries.
    const AUDIT_CONFIDENCE_THRESHOLD = 0.7;
    const skipAudit = assessment?.complexity === 'simple' &&
      (toolsUsed.length > 0 || classification.confidence < AUDIT_CONFIDENCE_THRESHOLD);

    const auditStep = addStep(trace, 'audit-trail');
    let auditResult: AuditResult | null = null;
    if (skipAudit) {
      const reason = toolsUsed.length > 0
        ? 'assessment-simple-tools-handled'
        : `assessment-simple-low-confidence:${classification.confidence}`;
      auditStep.metadata = { status: 'skipped', reason };
    } else {
      auditResult = await createAuditTrail(auditEntry, trace);
      auditStep.metadata = {
        feedId: auditResult?.feedId,
        workQueueId: auditResult?.workQueueId,
      };
    }
    completeStep(auditStep);

    // Update conversation history (with tool context for continuity)
    await updateConversation(
      userId,
      messageText,
      historyResponse,
      auditResult ? {
        pillar: auditPillar,
        requestType: classification.requestType,
        feedId: auditResult.feedId,
        workQueueId: auditResult.workQueueId,
        toolsUsed: toolsUsed.length > 0 ? toolsUsed : undefined,
      } : (toolsUsed.length > 0 ? { toolsUsed } : undefined),
      toolContexts.length > 0 ? toolContexts : undefined  // Pass tool context for continuity
    );

    // Send response (handle long messages)
    // Smart formatting: preserves HTML if present, converts markdown otherwise
    const formattedResponse = formatMessage(responseText);
    const sendStep = addStep(trace, 'response-sent');

    if (formattedResponse.length > 4000) {
      // Split into chunks for Telegram's message limit
      const chunks = splitMessage(formattedResponse, 4000);
      for (const chunk of chunks) {
        await ctx.reply(chunk, { parse_mode: 'HTML' });
      }
    } else {
      await ctx.reply(formattedResponse, { parse_mode: 'HTML' });
    }
    completeStep(sendStep);

    // Record usage for stats
    await recordUsage({
      inputTokens: Math.floor(totalTokens * 0.7), // Approximate split
      outputTokens: Math.floor(totalTokens * 0.3),
      pillar: auditPillar,
      requestType: classification.requestType,
      model: 'claude-sonnet-4',
    });

    // Final reaction based on whether action was taken
    const actionTaken = !!auditResult || toolsUsed.length > 0 || !!mediaContext;
    await setReaction(ctx, actionTaken ? REACTIONS.DONE : REACTIONS.CHAT);

    // Log action for skill pattern detection (Phase 1)
    // Non-blocking - pass existingFeedId to prevent dual-write (Bug A fix)
    // When audit was skipped (simple + tools handled), tools already logged
    // to Feed — skill logger would create a redundant third entry.
    if (isFeatureEnabled('skillLogging') && !skipAudit) {
      logAction({
        messageText,
        pillar: auditPillar,
        requestType: classification.requestType,
        actionType: toolsUsed.length > 0 ? 'tool' : (mediaContext ? 'media' : 'chat'),
        toolsUsed,
        userId,
        confidence: classification.confidence,
        keywords: classification.keywords,
        workType: classification.workType,
        contentType: mediaContext ? mediaContext.type as 'image' | 'document' | 'video' | 'audio' : undefined,
        existingFeedId: auditResult?.feedId,
        // Session telemetry
        sessionId: sessionTelemetry.sessionId,
        turnNumber: sessionTelemetry.turnNumber,
        priorIntentHash: sessionTelemetry.priorIntentHash,
      }).catch(err => {
        logger.warn('Skill action logging failed (non-fatal)', { error: err });
      });
    }

    // Complete the pipeline trace
    completeTrace(trace);

    logger.info('Conversation response sent', {
      userId,
      pillar: auditPillar,
      requestType: classification.requestType,
      tokens: totalTokens,
      toolIterations: iterations,
      auditCreated: !!auditResult,
      actionTaken,
      skillLogging: isFeatureEnabled('skillLogging'),
      contextEnrichment: !!contextEnrichment,
      slotsUsed: contextEnrichment?.slotsUsed ?? [],
      contextTokens: contextEnrichment?.totalTokens ?? 0,
      enrichmentLatencyMs: contextEnrichment?.assemblyLatencyMs ?? 0,
      enrichmentTier: contextEnrichment?.tier ?? null,
      traceId: trace.traceId,
      traceDurationMs: trace.totalDurationMs,
      traceSteps: trace.steps.length,
    });

  } catch (error) {
    failTrace(trace, error instanceof Error ? error : String(error));
    logger.error('Conversation handler error', { error, userId, traceId: trace.traceId });
    reportFailure('conversation-handler', error, { userId, traceId: trace.traceId });
    await setReaction(ctx, REACTIONS.ERROR);
    await ctx.reply("Something went wrong. Please try again.");
  }
}

/**
 * Split a long message into chunks
 */
function splitMessage(text: string, maxLength: number): string[] {
  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    // Try to split at a paragraph or sentence boundary
    let splitPoint = remaining.lastIndexOf('\n\n', maxLength);
    if (splitPoint === -1 || splitPoint < maxLength / 2) {
      splitPoint = remaining.lastIndexOf('\n', maxLength);
    }
    if (splitPoint === -1 || splitPoint < maxLength / 2) {
      splitPoint = remaining.lastIndexOf('. ', maxLength);
    }
    if (splitPoint === -1 || splitPoint < maxLength / 2) {
      splitPoint = maxLength;
    }

    chunks.push(remaining.slice(0, splitPoint + 1).trim());
    remaining = remaining.slice(splitPoint + 1).trim();
  }

  return chunks;
}

/**
 * Handle conversation with tools - same as handleConversation now
 * @deprecated Use handleConversation directly
 */
export async function handleConversationWithTools(ctx: Context): Promise<void> {
  await handleConversation(ctx);
}
