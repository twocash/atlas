/**
 * Pipeline Orchestrator — Cognitive Message Processing Engine
 *
 * Contains ALL decision logic for message handling: gate routing,
 * triage, enrichment, assessment, Claude API calls, tool execution,
 * audit trail creation, and response processing.
 *
 * Surface-agnostic: zero Grammy imports. All I/O goes through
 * PipelineSurfaceHooks injected by the adapter.
 *
 * Sprint: ARCH-CPE-001 Phase 5 — extracted from apps/telegram/src/conversation/handler.ts
 */

import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../logger';
import { getConversation, updateConversation, buildMessages, type ToolContext } from '../conversation/context';
import { buildSystemPrompt } from '../conversation/prompt';
import { detectAttachment, buildAttachmentPrompt } from '../conversation/attachments';
import { buildMediaContext, buildAnalysisContent, type Pillar } from '../media/processor';
import { createAuditTrail, type AuditEntry, type AuditResult } from '../conversation/audit';
import { getAllTools, executeTool, getToolTokenCost } from '../conversation/tools';
import { recordUsage } from '../conversation/stats';
// socratic-session.ts DELETED (STATE-PERSIST-TEARDOWN) — unified state is canonical
import { getIntentHash } from '../skills/intent-hash';
import { logAction } from '../skills/action-log';
import { reportFailure } from '@atlas/shared/error-escalation';
import { createTrace, addStep, completeStep, completeTrace, failTrace } from '@atlas/shared/trace';
import { classifyWithFallback, triageForAudit, triageMessage } from '../cognitive/triage-skill';
import type { TriageResult } from '../cognitive/triage-skill';
import { enrichWithContextSlots, type EnrichmentResult } from '../conversation/context-enrichment';
import { getLastAgentResult, clearLastAgentResult } from '../conversation/context-manager';
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
} from '..';
// approval-session.ts DELETED (STATE-PERSIST-TEARDOWN) — unified state is canonical
import {
  isApprovalSignal,
  isRejectionSignal,
  formatProposalMessage,
} from '../conversation/approval-utils';
import {
  getStateByUserId,
  getContentContext,
  storeAssessment,
  storeTriage as storeTriageInState,
  enterDialoguePhase,
  enterApprovalPhase,
  enterGoalClarificationPhase,
  returnToIdle,
  recordTurn,
  isInPhase,
} from '../conversation/conversation-state';
import { sessionManager } from '../sessions/session-manager';
import {
  incorporateClarification,
  resolveAfterClarification,
  recordClarification,
} from '../goal';
import {
  hasPendingEmergenceProposal,
  processEmergenceResponse,
  storeEmergenceProposal,
} from '../emergence/approval-store';
import { persistDismissedPattern, wireEmergenceFeedSubscriber } from '../emergence/feed-writer';

import type {
  MessageInput,
  PipelineSurfaceHooks,
  PipelineConfig,
  LowConfidenceRoutingData,
  ResolvedContextInput,
} from './types';
import { REACTIONS } from './types';
import {
  createProvenanceChain,
  appendPath,
  appendPhase,
  setConfig as setProvenanceConfig,
  setContext as setProvenanceContext,
  setResult as setProvenanceResult,
  finalizeProvenance,
} from '../provenance';
import type { ProvenanceChain } from '../types/provenance';

/**
 * Extract RAG chunk references from enriched context.
 * Chunks from domain-rag-slot are formatted as `[Document Title]` headers.
 * Returns array of chunk references like `rag:Document Title`.
 */
function extractRagChunkRefs(enrichedContext: string | undefined, slotsUsed: string[] | undefined): string[] {
  if (!enrichedContext || !slotsUsed?.includes('domain_rag')) return [];
  const matches = enrichedContext.match(/\[([^\]]{3,})\]/g);
  if (!matches) return [];
  // Dedupe and prefix with rag: for provenance tracking
  const seen = new Set<string>();
  const refs: string[] = [];
  for (const m of matches) {
    const title = m.slice(1, -1).trim();
    // Filter out non-document references (short labels, markdown links, etc.)
    if (title.length > 2 && !title.startsWith('http') && !seen.has(title)) {
      seen.add(title);
      refs.push(`rag:${title}`);
    }
  }
  return refs;
}

// ─── Anthropic Client ───────────────────────────────────

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const MAX_TOOL_ITERATIONS = 5;

// Per-user last-domain cache for correction detection (STAB-002c)
const lastDomainByUser = new Map<number, DomainType>();

// ─── Pure Helper Functions ──────────────────────────────

/**
 * Format tool context for conversation history.
 * Extracts key information (IDs, URLs, success/failure) from tool results
 * so Claude can maintain context across conversation turns.
 */
export function formatToolContextForHistory(toolContexts: ToolContext[]): string {
  if (toolContexts.length === 0) return '';

  const summaries: string[] = [];

  for (const ctx of toolContexts) {
    const toolResult = ctx.result as { success?: boolean; result?: unknown; error?: string } | undefined;
    const success = toolResult?.success ?? false;
    const result = toolResult?.result as Record<string, unknown> | undefined;

    const keyInfo: string[] = [];

    if (result) {
      if (result.id) keyInfo.push(`id: ${result.id}`);
      if (result.pageId) keyInfo.push(`pageId: ${result.pageId}`);
      if (result.taskId) keyInfo.push(`taskId: ${result.taskId}`);
      if (result.feedId) keyInfo.push(`feedId: ${result.feedId}`);
      if (result.workQueueId) keyInfo.push(`workQueueId: ${result.workQueueId}`);
      if (result.discussionId) keyInfo.push(`discussionId: ${result.discussionId}`);
      if (result.url) keyInfo.push(`url: ${result.url}`);
      if (result.notionUrl) keyInfo.push(`url: ${result.notionUrl}`);
      if (result.title) keyInfo.push(`title: "${String(result.title).substring(0, 50)}"`);
      if (result.status) keyInfo.push(`status: ${result.status}`);
    }

    const status = success ? '✓' : '✗';
    const info = keyInfo.length > 0 ? ` (${keyInfo.join(', ')})` : '';
    summaries.push(`${status} ${ctx.toolName}${info}`);
  }

  return `[Tool context for follow-up:\n${summaries.join('\n')}]`;
}

/**
 * Structured result from URL hallucination detection and fix.
 */
export interface HallucinationFixResult {
  /** The (possibly fixed) response text */
  text: string;
  /** Whether any URL hallucination was detected */
  hallucinationDetected: boolean;
  /** Whether a dispatch tool call failed */
  dispatchFailed: boolean;
  /** Number of fabricated URLs that were replaced */
  fabricatedUrlCount: number;
  /** Error message if dispatch failed */
  failureError?: string;
}

/**
 * Fix fabricated Notion URLs in Claude's response.
 * Claude often ignores EXACT_URL_FOR_USER markers and fabricates similar-looking URLs.
 *
 * Returns structured result with hallucination detection metadata.
 */
export function fixHallucinatedUrls(responseText: string, toolContexts: ToolContext[]): HallucinationFixResult {
  const dispatchToolNames = ['submit_ticket', 'work_queue_create', 'mcp__pit_crew__dispatch_work', 'dispatch_research'];
  let dispatchFailed = false;
  let failureError = '';

  const actualUrls: string[] = [];
  for (let i = toolContexts.length - 1; i >= 0; i--) {
    const tc = toolContexts[i];
    const toolResult = tc.result as { success?: boolean; result?: unknown; error?: string } | undefined;

    if (dispatchToolNames.includes(tc.toolName)) {
      if (!toolResult?.success) {
        dispatchFailed = true;
        failureError = toolResult?.error || 'Dispatch failed';
        logger.error('DISPATCH TOOL FAILED', { tool: tc.toolName, error: failureError });
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
      if (result?.workQueueUrl && typeof result.workQueueUrl === 'string') {
        actualUrls.push(result.workQueueUrl);
      }
    }
  }

  if (actualUrls.length > 0) {
    logger.debug('fixHallucinatedUrls: collected actual URLs from tool results', { actualUrls, toolCount: toolContexts.length });
  }

  // CRITICAL: Dispatch failed but Claude may have fabricated a success URL
  if (dispatchFailed && actualUrls.length === 0) {
    const notionUrlPattern = /https?:\/\/(?:www\.)?notion\.so\/[^\s\)\]>]+/gi;
    const matches = responseText.match(notionUrlPattern);

    if (matches && matches.length > 0) {
      logger.error('HALLUCINATION ON FAILURE: Claude fabricated URL despite tool failure', {
        fabricatedUrls: matches,
        error: failureError,
      });

      let fixedText = responseText;
      for (const match of matches) {
        fixedText = fixedText.split(match).join('[DISPATCH FAILED]');
      }
      return {
        text: `${fixedText}\n\n⚠️ **Dispatch failed:** ${failureError}`,
        hallucinationDetected: true,
        dispatchFailed: true,
        fabricatedUrlCount: matches.length,
        failureError,
      };
    }

    return { text: responseText, hallucinationDetected: false, dispatchFailed: true, fabricatedUrlCount: 0, failureError };
  }

  // Dispatch hallucination: submit_ticket was called but Claude claims research was dispatched
  const submitTicketUsed = toolContexts.some(tc => tc.toolName === 'submit_ticket');
  const dispatchResearchUsed = toolContexts.some(tc => tc.toolName === 'dispatch_research');
  if (submitTicketUsed && !dispatchResearchUsed) {
    const dispatchClaims = /research\s+(dispatched|underway|initiated|launched|started|in progress|complete|running)/i;
    if (dispatchClaims.test(responseText)) {
      logger.warn('HALLUCINATION DETECTED: Claude claimed research dispatched but only submit_ticket was called');
      return {
        text: responseText.replace(dispatchClaims, 'research queued (not yet dispatched)'),
        hallucinationDetected: true,
        dispatchFailed: false,
        fabricatedUrlCount: 0,
      };
    }
  }

  if (actualUrls.length === 0) {
    return { text: responseText, hallucinationDetected: false, dispatchFailed: false, fabricatedUrlCount: 0 };
  }

  const notionUrlPattern = /https?:\/\/(?:www\.)?notion\.so\/[^\s\)\]>]+/gi;
  const matches = responseText.match(notionUrlPattern);

  if (!matches || matches.length === 0) {
    logger.info('URL MISSING: Claude omitted URL, appending actual', { actualUrls });
    return { text: `${responseText}\n\n📎 ${actualUrls[0]}`, hallucinationDetected: false, dispatchFailed: false, fabricatedUrlCount: 0 };
  }

  // Extract page IDs from URLs for robust comparison (slug-independent)
  const extractPageId = (url: string): string | null => {
    const m = url.match(/([0-9a-f]{32})(?:[?#]|$)/i);
    return m ? m[1].toLowerCase() : null;
  };
  const actualPageIds = new Set(actualUrls.map(extractPageId).filter(Boolean) as string[]);

  const uniqueMatches = [...new Set(matches)];
  let fabricatedCount = 0;
  for (const m of uniqueMatches) {
    if (actualUrls.includes(m)) continue;
    const pid = extractPageId(m);
    // Either fabricated slug on real page, or fully fabricated — both count
    fabricatedCount++;
  }
  const isHallucinated = fabricatedCount > 0;

  if (isHallucinated) {
    logger.warn('HALLUCINATION DETECTED: Fixing fabricated Notion URLs', {
      claudeSaid: uniqueMatches,
      actualUrls,
    });

    let fixedText = responseText;
    for (const match of uniqueMatches) {
      if (!actualUrls.includes(match)) {
        fixedText = fixedText.split(match).join(actualUrls[0]);
      }
    }
    return { text: fixedText, hallucinationDetected: true, dispatchFailed, fabricatedUrlCount: fabricatedCount, failureError: failureError || undefined };
  }

  return { text: responseText, hallucinationDetected: false, dispatchFailed, fabricatedUrlCount: 0 };
}

/**
 * Detect if user is asking to convert/draft from a recent research result.
 */
export function detectFollowOnConversionIntent(text: string): boolean {
  const FOLLOW_ON_PATTERN = /^(can you |please )?(turn|draft|write|make|convert|transform)\b.*(into|as|up|a)\b/i;
  const PRONOUN_SIGNAL = /\b(that|this|it)\b/i;

  if (FOLLOW_ON_PATTERN.test(text)) return true;

  const SECONDARY_PATTERN = /\b(summarize|post|article|blog|linkedin|thread|email|report)\b.*\b(that|this|it)\b/i;
  if (SECONDARY_PATTERN.test(text)) return true;

  const TERTIARY_PATTERN = /\b(linkedin|blog|article|thread|report|post|email)\b/i;
  if (TERTIARY_PATTERN.test(text) && PRONOUN_SIGNAL.test(text)) return true;

  return false;
}

/**
 * Split a long message into chunks.
 */
export function splitMessage(text: string, maxLength: number): string[] {
  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

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

// ─── Socratic Exit / Intent-Break Detection (Sprint C) ──

const EXIT_SIGNALS = new Set([
  'nevermind', 'never mind', 'nvm',
  'forget it', 'forget about it',
  'cancel', 'stop', 'exit', 'quit',
  'skip', 'skip it',
  'nah', 'no thanks', 'no thank you',
  'drop it', 'leave it',
  'actually nevermind', 'actually never mind',
  'actually nvm',
]);

/**
 * Bug 2 fix: Detect hard exit signals that should immediately abandon Socratic flow.
 * "Nevermind", "nvm", "forget it", "cancel", etc.
 */
function isSocraticExitSignal(text: string): boolean {
  const normalized = text.trim().toLowerCase().replace(/[.!,?]+$/g, '');
  return EXIT_SIGNALS.has(normalized);
}


// ─── Main Orchestrator ──────────────────────────────────

/**
 * Orchestrate a message through the full cognitive pipeline.
 *
 * All decisions happen here. Surface I/O goes through hooks.
 * The adapter (handler.ts) creates hooks from Grammy context.
 */
export async function orchestrateMessage(
  input: MessageInput,
  hooks: PipelineSurfaceHooks,
  config: PipelineConfig,
): Promise<void> {
  const { text: initialText, userId, chatId, username, messageId } = input;
  let messageText = initialText;

  // Pipeline trace: tracks every step with timing and metadata
  const trace = createTrace();
  const msgStep = addStep(trace, 'message-received', {
    userId,
    messageLength: messageText.length,
    hasMedia: !!(input.rawMessage && detectAttachment(input.rawMessage).type !== 'none'),
  });
  completeStep(msgStep);

  logger.info('Conversation message received', {
    userId,
    username,
    textLength: messageText.length,
    traceId: trace.traceId,
  });

  // Sprint C: Provenance chain — tracks the full pipeline trace
  const chain = createProvenanceChain('orchestrator', ['message-entry'], 'user-message');

  // Session telemetry
  const currentIntentHash = messageText ? getIntentHash(messageText).hash : undefined;
  const sessionTelemetry = recordTurn(chatId, userId, currentIntentHash);

  // Session tracking (P0 SessionManager)
  if (process.env.ATLAS_SESSION_TRACKING !== 'false') {
    sessionManager.startTurn(
      sessionTelemetry.sessionId,
      messageText,
      'telegram',
      { intentHash: currentIntentHash },
    ).catch(err => {
      logger.warn('SessionManager.startTurn failed (non-fatal)', { error: (err as Error).message });
    });
  }

  // React to indicate message received
  await hooks.setReaction(REACTIONS.READING);
  await hooks.sendTyping();

  // Detect attachments
  const attachment = detectAttachment(input.rawMessage);
  const hasAttachment = attachment.type !== 'none';

  // ── Gate 1: Content Share (URL) ──
  if (config.contentConfirmEnabled && !hasAttachment && messageText) {
    const handled = await hooks.checkContentShare();
    if (handled) {
      await hooks.setReaction(REACTIONS.DONE);
      logger.info('Content share detected, Socratic question sent', { userId });
      return;
    }
  }

  // ── Gate 2: Domain Correction (STAB-002c) ──
  if (config.domainAudienceEnabled && messageText && lastDomainByUser.has(userId)) {
    const currentDomain = lastDomainByUser.get(userId)!;
    const correction = detectDomainCorrection(messageText, currentDomain);
    if (correction) {
      const keywords = extractKeywords(messageText);
      logDomainCorrection(currentDomain, correction.corrected, keywords, messageText).catch(err => {
        logger.warn('Domain correction logging failed', { error: err });
      });
      lastDomainByUser.set(userId, correction.corrected);
      logger.info('Domain correction detected', {
        userId,
        original: currentDomain,
        corrected: correction.corrected,
      });
    }
  }

  // ── Gate 3: Socratic Session ──
  if (!hasAttachment && messageText && isInPhase(userId, 'socratic')) {
    const socraticState = getStateByUserId(userId);
    const containsUrl = /https?:\/\/\S+/i.test(messageText);
    if (containsUrl) {
      if (socraticState) {
        returnToIdle(socraticState.chatId);
        logger.info('Socratic session bypassed: message contains URL (new content)', {
          userId,
          cancelledSessionId: socraticState.socratic?.sessionId,
        });
      }
    } else if (isSocraticExitSignal(messageText)) {
      // Sprint C Bug 2: Hard exit signals — immediate Socratic abandon
      if (socraticState) {
        returnToIdle(socraticState.chatId);
        logger.info('Socratic session abandoned: exit signal', {
          userId,
          signal: messageText.substring(0, 30),
          cancelledSessionId: socraticState.socratic?.sessionId,
        });
      }
      await hooks.reply('Got it — dropped. What\'s next?', {});
      await hooks.setReaction(REACTIONS.DONE);
      return;
    } else {
      const handled = await hooks.handleSocraticAnswer(messageText);
      if (handled) {
        await hooks.setReaction(REACTIONS.DONE);
        logger.info('Socratic answer processed', { userId });
        return;
      }
    }
  }

  // ── Gate 4: Goal Clarification (ATLAS-GOAL-FIRST-001) ──
  if (!hasAttachment && messageText) {
    const userState = getStateByUserId(userId);
    if (userState?.phase === 'goal-clarification' && userState.pendingGoal && userState.goalTargetField) {
      const containsUrl = /https?:\/\/\S+/i.test(messageText);
      if (containsUrl) {
        returnToIdle(userState.chatId);
        logger.info('Goal-clarification bypassed: new URL content', { userId });
      } else {
        try {
          const updatedGoal = await incorporateClarification(
            userState.pendingGoal,
            messageText,
            userState.goalTargetField,
          );

          const tracker = userState.goalTracker;
          if (tracker) {
            recordClarification(tracker, userState.goalTargetField || 'unknown');
          }

          const round = userState.goalClarificationRound || 1;
          const contentAnalysis = userState.goalContentAnalysis || { content: '' };
          const goalResult = resolveAfterClarification(updatedGoal, round, contentAnalysis);

          if (goalResult.immediateExecution) {
            const trackerSnapshot = userState.goalTracker;
            const deferred = userState.goalDeferredExecution;
            const lastTriage = userState.lastTriage;
            returnToIdle(userState.chatId);
            if (deferred) {
              const cc = getContentContext(userState.chatId);
              await hooks.executeResolvedGoal(
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
            await hooks.setReaction(REACTIONS.DONE);
            logger.info('Goal clarification resolved, executing', {
              userId,
              completeness: updatedGoal.completeness,
              round,
            });
            return;
          }

          if (goalResult.clarificationNeeded && goalResult.nextQuestion) {
            const nextField = updatedGoal.missingFor[0]?.field || 'endStateRaw';
            enterGoalClarificationPhase(
              userState.chatId, userId, updatedGoal, contentAnalysis,
              nextField, round + 1, userState.goalDeferredExecution,
              tracker);
            await hooks.reply(goalResult.nextQuestion);
            logger.info('Goal clarification round', {
              userId,
              round: round + 1,
              targetField: nextField,
              completeness: updatedGoal.completeness,
            });
            return;
          }
        } catch (goalErr) {
          logger.error('Goal clarification failed', {
            error: goalErr instanceof Error ? goalErr.message : String(goalErr),
            userId,
          });
          returnToIdle(userState.chatId);
        }
      }
    }
  }

  // ── Gate 5: Approval Session (STAB-003) — unified state ──
  let approvalGranted = false;
  if (!hasAttachment && messageText && isInPhase(userId, 'approval')) {
    const containsUrl = /https?:\/\/\S+/i.test(messageText);
    const approvalState = getStateByUserId(userId);
    const approvalData = approvalState?.approval;
    if (containsUrl) {
      if (approvalState) {
        returnToIdle(approvalState.chatId);
        logger.info('Approval session bypassed: new URL content', { userId });
      }
    } else if (approvalData && approvalState) {
      const approvalStep = addStep(trace, 'approval-check');
      if (isApprovalSignal(messageText)) {
        if (approvalData.refinedRequest) {
          messageText = approvalData.refinedRequest;
        } else {
          messageText = approvalData.originalMessage;
        }
        approvalGranted = true;
        returnToIdle(approvalState.chatId);
        approvalStep.metadata = { status: 'approved', hasRefinedRequest: !!approvalData.refinedRequest };
        completeStep(approvalStep);
        logger.info('Proposal approved, proceeding with execution', { userId });
      } else if (isRejectionSignal(messageText)) {
        returnToIdle(approvalState.chatId);
        await hooks.reply(
          "Got it — what would you adjust? I can rethink the approach.",
          { parseMode: 'HTML' },
        );
        approvalStep.metadata = { status: 'rejected' };
        completeStep(approvalStep);
        completeTrace(trace);
        logger.info('Proposal rejected', { userId });
        return;
      } else {
        returnToIdle(approvalState.chatId);
        approvalStep.metadata = { status: 'ambiguous', treatedAsNewMessage: true };
        completeStep(approvalStep);
        logger.info('Ambiguous approval reply, treating as new message', { userId });
      }
    }
  }

  // ── Gate 6: Dialogue Session ──
  if (!hasAttachment && messageText && isInPhase(userId, 'dialogue')) {
    const containsUrl = /https?:\/\/\S+/i.test(messageText);
    const dialogueConvState = getStateByUserId(userId);
    const dialogueData = dialogueConvState?.dialogue;
    if (containsUrl) {
      if (dialogueConvState) {
        returnToIdle(dialogueConvState.chatId);
        logger.info('Dialogue session bypassed: new URL content', { userId });
      }
    } else if (dialogueConvState && dialogueData) {
      const dialogueChatId = dialogueConvState.chatId;
      const dialogueStep = addStep(trace, 'dialogue-continue');
      try {
        const model = getCachedModel();
        if (!model) {
          returnToIdle(dialogueChatId);
          dialogueStep.metadata = { status: 'cancelled', reason: 'no-cached-model' };
          completeStep(dialogueStep);
        } else {
          const result = continueDialogue(messageText, dialogueData.dialogueState, model);
          if (result.needsResponse) {
            const dialogueMsg = result.message.length > 4000
              ? result.message.substring(0, 3997) + '...'
              : result.message;
            const nextMsgId = await hooks.reply(dialogueMsg, { parseMode: 'HTML' });
            enterDialoguePhase(dialogueChatId, userId, {
              questionMessageId: nextMsgId,
              dialogueState: result.state,
              assessment: dialogueData.assessment,
              assessmentContext: dialogueData.assessmentContext,
              originalMessage: dialogueData.originalMessage,
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
            returnToIdle(dialogueChatId);

            if (result.refinedRequest) {
              const original = messageText;
              messageText = result.refinedRequest;
              logger.info('Refined request substituted (STAB-003)', {
                original: original.substring(0, 50),
                refined: messageText.substring(0, 50),
              });
            }

            if (result.proposal) {
              const proposalMsg = formatProposalMessage(result.proposal, 'complex');
              const sentMsgId = await hooks.reply(
                proposalMsg.length > 4000 ? proposalMsg.substring(0, 3997) + '...' : proposalMsg,
                { parseMode: 'HTML' },
              );
              // Unified state — canonical (legacy storeApprovalSession removed)
              enterApprovalPhase(chatId, userId, {
                proposalMessageId: sentMsgId,
                proposal: result.proposal,
                refinedRequest: result.refinedRequest,
                originalMessage: dialogueData.originalMessage,
                assessment: dialogueData.assessment,
                assessmentContext: dialogueData.assessmentContext,
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
          }
        }
      } catch (err) {
        returnToIdle(dialogueChatId);
        dialogueStep.metadata = {
          status: 'failed',
          error: err instanceof Error ? err.message : String(err),
        };
        completeStep(dialogueStep);
        logger.warn('Dialogue continuation failed, falling through to normal flow', { error: err });
      }
    }
  }

  // ── Gate 7: Emergence Proposal Response ──
  if (!hasAttachment && messageText && hasPendingEmergenceProposal(chatId)) {
    const emergenceResult = processEmergenceResponse(chatId, messageText);
    if (emergenceResult) {
      const { action, proposal } = emergenceResult;
      if (action === 'approved') {
        await hooks.reply(
          `Got it — "${proposal.suggestedSkillName}" approved. I'll start building it.`,
        );
      } else {
        await hooks.reply(
          `Noted — "${proposal.suggestedSkillName}" dismissed. I won't bring it up again for a while.`,
        );
        // Persist dismiss to Feed 2.0 (fire-and-forget)
        persistDismissedPattern(proposal, proposal.dismissReason).catch(err => {
          logger.warn('Dismiss persistence failed (non-fatal)', { error: err });
        });
      }
      await hooks.setReaction(REACTIONS.DONE);
      logger.info('Emergence proposal response processed', {
        userId,
        action,
        skillName: proposal.suggestedSkillName,
      });
      completeTrace(trace);
      return;
    }
    // Not a clear signal — fall through to normal processing
  }

  // ── Build user content ──
  let userContent = messageText;

  // Process media with Gemini if attachment present
  let mediaContext = null;
  if (hasAttachment) {
    logger.info('Media attachment detected', { type: attachment.type });

    // CLASSIFY-FIRST: Show instant keyboard BEFORE running Gemini
    if (config.contentConfirmEnabled) {
      const handled = await hooks.handleInstantClassification(attachment);
      if (handled) {
        await hooks.setReaction(REACTIONS.DONE);
        logger.info('Media detected, instant classification keyboard shown (classify-first)', {
          userId,
          type: attachment.type,
        });
        return;
      }
    }

    // FALLBACK: If classify-first disabled or failed, use legacy flow
    await hooks.sendTyping();

    const quickPillar = await classifyWithFallback(messageText || attachment.caption || 'media')
      .then(c => c.pillar as Pillar);

    mediaContext = await hooks.processMedia(attachment, quickPillar);

    if (mediaContext) {
      if (config.contentConfirmEnabled) {
        const handled = await hooks.handleMediaConfirmation(attachment, mediaContext, quickPillar);
        if (handled) {
          await hooks.setReaction(REACTIONS.DONE);
          logger.info('Media processed, confirmation keyboard shown (legacy)', {
            userId,
            type: mediaContext.type,
          });
          return;
        }
      }

      userContent += buildMediaContext(mediaContext, attachment);
      logger.info('Media processed', {
        type: mediaContext.type,
        processingTime: mediaContext.processingTime,
        archived: !!mediaContext.archivedPath,
      });
    } else {
      userContent += buildAttachmentPrompt(attachment);
    }
  }

  // FOLLOW-ON CONVERSION: Detect "turn that into a post" patterns
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

  // ── Pipeline: Triage → Enrichment → Assessment ──

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
    const triageStep = addStep(trace, 'triage');
    triageStep.metadata = { status: 'skipped-reused', reason: 'approval-granted' };
    completeStep(triageStep);
  } else {
    // Normal path: full triage → enrichment → assessment

    // PRE-FLIGHT TRIAGE
    const triageStep = addStep(trace, 'triage');
    try {
      let triageInput = messageText;
      const contentCtx = getContentContext(chatId);
      if (contentCtx && !messageText.includes('http')) {
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
      storeTriageInState(chatId, preflightTriage);

      // Sprint C: Record triage in provenance
      appendPhase(chain, {
        name: 'triage',
        provider: preflightTriage.source === 'pattern_cache' ? 'pattern-cache' : 'claude-haiku',
        tools: [],
        durationMs: triageStep.durationMs ?? 0,
      });
      setProvenanceConfig(chain, { pillar: preflightTriage.pillar as Pillar });

      // Session tracking: patch turn with triage metadata (Bug #1 topic, #2 intent)
      if (process.env.ATLAS_SESSION_TRACKING !== 'false') {
        const triageTopic = preflightTriage.intent === 'command' && preflightTriage.command
          ? preflightTriage.command.description.substring(0, 100)
          : (preflightTriage.title || messageText.substring(0, 100));
        sessionManager.updateTurnMetadata(sessionTelemetry.sessionId, {
          topic: triageTopic,
          intent: preflightTriage.requestType,
          pillar: preflightTriage.pillar,
        });
      }

      // Command intent: rewrite userContent
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

    // CONTEXT ENRICHMENT
    if (config.contextEnrichmentEnabled) {
      const enrichStep = addStep(trace, 'context-enrichment');
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

  // COMMAND BYPASS: Direct commands skip assessment/dialogue/approval — go straight to Claude with tool_choice: any.
  // "log this as a P0 bug", "create a task for X", "mark Y done" — triage already parsed the intent.
  // Without this gate, assessRequest sees ambiguous raw text ("this"), scores it rough, and enters dialogue.
  const isCommandBypass = preflightTriage?.intent === 'command' && !!preflightTriage.command;
  if (isCommandBypass) {
    logger.info('Command bypass: skipping assessment/dialogue/approval', {
      verb: preflightTriage.command!.verb,
      target: preflightTriage.command!.target,
      priority: preflightTriage.command!.priority,
    });
  }

  // REQUEST ASSESSMENT
  if (!isCommandBypass && !approvalGranted && config.selfModelEnabled && preflightTriage) {
    const assessStep = addStep(trace, 'request-assessment');
    try {
      const model = getCachedModel();
      if (!model) {
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

        if (config.domainAudienceEnabled && assessment.domain) {
          lastDomainByUser.set(userId, assessment.domain);
        }

        storeAssessment(chatId, assessment, assessmentContext);
      }
    } catch (err) {
      assessStep.metadata = {
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
      };
      completeStep(assessStep);
      logger.warn('Assessment failed', { error: err });
    }
  }

  // DIALOGUE ROUTING: If rough terrain, enter collaborative exploration
  // Command bypass: commands never enter dialogue (triage already resolved intent)
  if (!isCommandBypass && assessment && assessmentNeedsDialogue(assessment)) {
    const dialogueStep = addStep(trace, 'dialogue-entry');
    try {
      const model = getCachedModel();
      if (!model) {
        dialogueStep.metadata = { status: 'skipped', reason: 'no-cached-model' };
        completeStep(dialogueStep);
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
        const sentMsgId = await hooks.reply(dialogueMsg, { parseMode: 'HTML' });
        enterDialoguePhase(chatId, userId, {
          questionMessageId: sentMsgId,
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
        return;
      }
    } catch (err) {
      dialogueStep.metadata = {
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
      };
      completeStep(dialogueStep);
      logger.warn('Dialogue entry failed, falling through to normal flow', { error: err });
    }
  }

  // APPROVAL GATE: Moderate+ terrain with multi-step proposal
  // Command bypass: commands execute immediately (no proposal needed)
  if (!isCommandBypass && assessment && assessment.approach && assessment.approach.steps.length >= 2 && assessment.complexity !== 'simple' && !approvalGranted) {
    const approvalStep = addStep(trace, 'approval-gate');
    const proposalMsg = formatProposalMessage(assessment.approach, assessment.complexity);
    const sentMsgId = await hooks.reply(
      proposalMsg.length > 4000 ? proposalMsg.substring(0, 3997) + '...' : proposalMsg,
      { parseMode: 'HTML' },
    );
    const assessCtx: AssessmentContext = {
      intent: preflightTriage?.intent,
      pillar: preflightTriage?.pillar,
      keywords: preflightTriage?.keywords,
      hasUrl: /https?:\/\//.test(messageText),
      hasContact: false,
      hasDeadline: false,
    };
    // Unified state — canonical (legacy storeApprovalSession removed)
    enterApprovalPhase(chatId, userId, {
      proposalMessageId: sentMsgId,
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

  // ── Claude API Pipeline ──

  const conversation = await getConversation(userId);

  // Build system prompt
  const promptStep = addStep(trace, 'prompt-build');
  const baseSystemPrompt = await buildSystemPrompt(conversation);

  let systemPrompt = baseSystemPrompt;
  if (contextEnrichment) {
    systemPrompt += `\n\n---\n\n## Cognitive Context\n\n${contextEnrichment.enrichedContext}`;
    if (contextEnrichment.degradedContextNote) {
      systemPrompt += `\n\n${contextEnrichment.degradedContextNote}`;
    }
  }

  if (assessment) {
    const assessmentLines = [
      `\n\n---\n\n## Request Assessment`,
      ``,
      `**Complexity:** ${assessment.complexity}`,
      `**Reasoning:** ${assessment.reasoning}`,
    ];

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

    if (assessment.capabilities.length > 0) {
      assessmentLines.push(
        ``,
        `**Relevant Capabilities:** ${assessment.capabilities.map(c => c.capabilityId).join(', ')}`,
      );
    }

    systemPrompt += assessmentLines.join('\n');
  }

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

  const messages: Anthropic.MessageParam[] = buildMessages(conversation, userContent);
  completeStep(promptStep);

  let totalTokens = 0;
  const toolsUsed: string[] = [];
  const toolContexts: ToolContext[] = [];

  try {
    const tools = getAllTools();

    const isCommandIntent = preflightTriage?.intent === 'command' && !!preflightTriage.command;
    const requiresToolUse = isCommandIntent ||
                           /\b(create|add|log|make|put|track|file|submit)\b.*\b(bug|feature|task|item|pipeline|queue|notion)\b/i.test(messageText) ||
                           /\b(dev.?pipeline|work.?queue)\b/i.test(messageText);

    const claudeStep = addStep(trace, 'claude-api', { model: 'claude-sonnet-4-20250514' });
    let response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      temperature: 0.4,
      system: systemPrompt,
      messages,
      tools,
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

    // Sprint C: Record Claude API phase in provenance
    appendPhase(chain, {
      name: 'claude-api',
      provider: 'claude-sonnet-4',
      tools: [],
      durationMs: claudeStep.durationMs ?? 0,
    });

    // Tool use loop
    let iterations = 0;
    let reactedWorking = false;
    while (response.stop_reason === 'tool_use' && iterations < MAX_TOOL_ITERATIONS) {
      iterations++;

      if (!reactedWorking) {
        await hooks.setReaction(REACTIONS.WORKING);
        reactedWorking = true;
      }

      const toolUseBlocks = response.content.filter(
        (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
      );

      if (toolUseBlocks.length === 0) break;

      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const toolUse of toolUseBlocks) {
        logger.info('Executing tool', { tool: toolUse.name, input: toolUse.input });

        if (!toolsUsed.includes(toolUse.name)) {
          toolsUsed.push(toolUse.name);
        }

        await hooks.sendTyping();

        const toolStep = addStep(trace, 'tool-execution', { toolName: toolUse.name });
        const result = await executeTool(
          toolUse.name,
          toolUse.input as Record<string, unknown>
        );
        completeStep(toolStep);
        toolStep.metadata = { ...toolStep.metadata, success: result.success };

        // Sprint C: Record tool execution in provenance
        appendPhase(chain, {
          name: toolUse.name,
          provider: 'claude-sonnet-4',
          tools: [toolUse.name],
          durationMs: toolStep.durationMs ?? 0,
        });

        // LOW-CONFIDENCE ROUTING: Intercept needsChoice response
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

          const routingData: LowConfidenceRoutingData = {
            requestId: `dispatch_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
            chatId,
            userId,
            messageId,
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

          await hooks.handleLowConfidenceRouting(routingData);

          await hooks.setReaction(REACTIONS.CHAT);

          logger.info('Low-confidence routing - presenting choice keyboard', {
            requestId: routingData.requestId,
            confidence: choiceData.routingConfidence,
            suggested: choiceData.suggestedCategory,
            alternative: choiceData.alternativeCategory,
          });

          await updateConversation(
            userId,
            messageText,
            `[Routing choice requested: ${choiceData.title} - ${choiceData.routingConfidence}% confidence]`,
            { toolsUsed: ['submit_ticket'] }
          );

          return;
        }

        // Capture tool context for conversation continuity
        toolContexts.push({
          toolName: toolUse.name,
          input: toolUse.input as Record<string, unknown>,
          result: result,
          timestamp: new Date().toISOString(),
        });

        // Format result to make errors EXPLICIT
        let toolResultContent: string;
        if (result.success) {
          const resultObj = result.result as Record<string, unknown> | undefined;
          const url = (resultObj?.url ?? resultObj?.workQueueUrl) as string | undefined;
          const feedUrl = resultObj?.feedUrl as string | undefined;

          if (url || feedUrl) {
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
            toolResultContent = `✅ SUCCESS\n\nResult data:\n${jsonResult}${urlBlock}`;
          } else {
            toolResultContent = JSON.stringify(result);
          }
        } else {
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

      messages.push({ role: 'assistant', content: response.content });
      messages.push({ role: 'user', content: toolResults });

      response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        temperature: 0.4,
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

    // Fix fabricated URLs
    const hallucinationFix = fixHallucinatedUrls(responseText, toolContexts);
    responseText = hallucinationFix.text;

    // Wire reportFailure when hallucination detected
    if (hallucinationFix.hallucinationDetected) {
      reportFailure('url-hallucination', new Error(
        `Claude fabricated ${hallucinationFix.fabricatedUrlCount} Notion URL(s)` +
        (hallucinationFix.dispatchFailed ? ' after dispatch failure' : '')
      ), { fabricatedUrlCount: hallucinationFix.fabricatedUrlCount });
    }

    // Build history response with tool context
    const historyResponse = toolContexts.length > 0
      ? `${responseText}\n\n${formatToolContextForHistory(toolContexts)}`
      : responseText;

    // Classify for audit — reuse pre-flight triage if available
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
      smartTitle = preflightTriage.intent === 'command' && preflightTriage.command
        ? preflightTriage.command.description.substring(0, 100)
        : (preflightTriage.title || messageText.substring(0, 100) || 'Message');
    } else {
      const auditTriage = await triageForAudit(messageText);
      classification = auditTriage.classification;
      smartTitle = auditTriage.smartTitle;
    }

    // Sprint C Bug 7+8: Grade + claim detection BEFORE audit write
    // MUST be after classification is assigned (temporal dead zone if before)
    const { detectSensitiveClaims } = await import('../services/claim-detector');
    const claims = detectSensitiveClaims(responseText);
    if (claims.flags.length > 0) {
      logger.info('Sensitive claims detected in conversational response', { flags: claims.flags, patterns: claims.matchedPatterns });
    }

    // Andon Gate: assess conversational output through the same gate as research
    const { assessConversationalOutput } = await import('../services/andon-gate');
    const conversationalAssessment = assessConversationalOutput({
      responseText,
      originalMessage: messageText,
      requestType: classification.requestType,
      claimFlags: claims.flags,
      hallucinationDetected: hallucinationFix.hallucinationDetected,
      toolsUsed,
    });

    const ragChunkRefs = extractRagChunkRefs(contextEnrichment?.enrichedContext, contextEnrichment?.slotsUsed);
    setProvenanceResult(chain, {
      findingCount: 0,
      citations: [],
      ragChunks: ragChunkRefs,
      hallucinationDetected: hallucinationFix.hallucinationDetected,
      andonGrade: conversationalAssessment.confidence,
      claimFlags: claims.flags,
    });
    finalizeProvenance(chain);

    // Create audit trail
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
      keywords: [...classification.keywords, conversationalAssessment.telemetry.keyword],
      workType: classification.workType,
      userId,
      messageText,
      hasAttachment,
      attachmentType: hasAttachment ? attachment.type : undefined,
      tokenCount: totalTokens,
      ...(mediaContext && {
        contentType: mediaContext.type as 'image' | 'document' | 'video' | 'audio',
        analysisContent: buildAnalysisContent(
          mediaContext,
          attachment,
          auditPillar
        ),
      }),
      // Sprint C: Attach provenance chain
      provenanceChain: chain,
    };

    const AUDIT_CONFIDENCE_THRESHOLD = 0.7;
    // Skip audit only for simple requests with no tool use AND sufficient confidence.
    // Tool-heavy requests MUST be audited — telemetry gap otherwise (BUG-007).
    const skipAudit = assessment?.complexity === 'simple' &&
      toolsUsed.length === 0 &&
      classification.confidence < AUDIT_CONFIDENCE_THRESHOLD;

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

    // Update conversation history
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
      toolContexts.length > 0 ? toolContexts : undefined
    );

    // Sprint C Bug 7: Grade finalization moved BEFORE audit write (see line ~1389)
    // Chain is already finalized with grade + claimFlags at that point.

    // Send response (handle long messages)
    const formattedResponse = hooks.formatResponse(responseText);
    const sendStep = addStep(trace, 'response-sent');

    if (formattedResponse.length > 4000) {
      const chunks = splitMessage(formattedResponse, 4000);
      for (const chunk of chunks) {
        await hooks.reply(chunk, { parseMode: 'HTML' });
      }
    } else {
      await hooks.reply(formattedResponse, { parseMode: 'HTML' });
    }
    completeStep(sendStep);

    // Record usage for stats (including tool definition overhead)
    const toolCost = getToolTokenCost();
    await recordUsage({
      inputTokens: Math.floor(totalTokens * 0.7),
      outputTokens: Math.floor(totalTokens * 0.3),
      pillar: auditPillar,
      requestType: classification.requestType,
      model: 'claude-sonnet-4',
      toolDefinitionTokens: toolCost.total,
    });

    // Final reaction
    const actionTaken = !!auditResult || toolsUsed.length > 0 || !!mediaContext;
    await hooks.setReaction(actionTaken ? REACTIONS.DONE : REACTIONS.CHAT);

    // Skill logging
    if (config.skillLoggingEnabled && !skipAudit) {
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
        sessionId: sessionTelemetry.sessionId,
        turnNumber: sessionTelemetry.turnNumber,
        priorIntentHash: sessionTelemetry.priorIntentHash,
      }).then(() => {
        // Feed write hook: trigger emergence check + deliver proposals
        // Feature flag from Notion Research Pipeline Config (Constraint 1: Notion governs routing)
        import('../config').then(({ getResearchPipelineConfig }) =>
          getResearchPipelineConfig()
        ).then(({ config: pipelineConfig }) => {
          if (!pipelineConfig.emergenceEnabled) return;
          // Ensure Feed subscriber is wired (idempotent)
          wireEmergenceFeedSubscriber();
          return import('../emergence/monitor').then(({ checkForEmergence }) =>
            checkForEmergence()
          ).then(result => {
            if (result.proposals.length > 0) {
              const proposal = result.proposals[0];
              return hooks.deliverEmergenceProposal(proposal).then(messageId => {
                storeEmergenceProposal(chatId, messageId, proposal);
                logger.info('Emergence proposal delivered', {
                  proposalId: proposal.id,
                  skillName: proposal.suggestedSkillName,
                  messageId,
                });
              });
            }
          });
        }).catch(err => {
          // Non-fatal: config resolution, emergence check, or delivery failure
          if (err?.message?.includes('emergence')) {
            reportFailure('emergence-check', err, { subsystem: 'emergence' });
          }
        });
      }).catch(err => {
        logger.warn('Skill action logging failed (non-fatal)', { error: err });
      });
    }

    completeTrace(trace);

    // Session tracking: completeTurn with response data (P0 SessionManager)
    if (process.env.ATLAS_SESSION_TRACKING !== 'false') {
      const responsePreview = responseText ? responseText.substring(0, 500) : undefined;

      // Extract findings: smartTitle + keywords + response excerpt
      const findingParts: string[] = [];
      if (smartTitle && smartTitle !== 'Message') findingParts.push(smartTitle);
      if (classification.keywords?.length > 0) findingParts.push(`Keywords: ${classification.keywords.join(', ')}`);
      if (responseText && responseText.length > 100) {
        findingParts.push(responseText.substring(0, 300));
      }
      const findings = findingParts.length > 0 ? findingParts.join(' | ') : undefined;

      // Extract thesisHook from recent agent result if available
      const agentResult = getLastAgentResult(userId);
      const thesisHook = agentResult?.resultSummary
        ? agentResult.resultSummary.substring(0, 200)
        : undefined;

      sessionManager.completeTurn(
        sessionTelemetry.sessionId,
        {
          responsePreview,
          toolsUsed: toolsUsed.length > 0 ? toolsUsed : undefined,
          findings,
          thesisHook,
        },
      ).catch(err => {
        logger.warn('SessionManager.completeTurn failed (non-fatal)', { error: (err as Error).message });
      });
    }

    logger.info('Conversation response sent', {
      userId,
      pillar: auditPillar,
      requestType: classification.requestType,
      tokens: totalTokens,
      toolIterations: iterations,
      auditCreated: !!auditResult,
      actionTaken,
      skillLogging: config.skillLoggingEnabled,
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
    await hooks.setReaction(REACTIONS.ERROR);
    await hooks.reply("Something went wrong. Please try again.");
  }
}


// ─── Resolved Context Orchestration (Sprint A: Pipeline Unification) ──

/**
 * Orchestrate a pre-resolved context through the unified pipeline.
 *
 * Called by the Socratic adapter after it resolves intent through the
 * Socratic engine. Runs through the SAME middleware as orchestrateMessage():
 * session telemetry, audit trail, dispatch, error recovery, completeTurn.
 *
 * This eliminates the parallel dispatch path in the Socratic adapter.
 * The adapter resolves context (its job). The orchestrator dispatches (its job).
 *
 * @returns AuditResult from createAuditTrail, or null if dedup
 */
export async function orchestrateResolvedContext(
  input: ResolvedContextInput,
  hooks: Pick<PipelineSurfaceHooks, 'reply' | 'setReaction' | 'sendTyping'>,
): Promise<{ feedId: string; workQueueId: string; feedUrl: string; workQueueUrl: string } | null> {
  const { userId, chatId, username, content, contentType, title, resolved } = input;

  // Pipeline trace
  const trace = createTrace();
  const entryStep = addStep(trace, 'resolved-context-entry', {
    userId,
    resolvedVia: resolved.resolvedVia,
    pillar: input.pillar,
    requestType: input.requestType,
  });
  completeStep(entryStep);

  // Session telemetry — same wiring as orchestrateMessage
  const currentIntentHash = content ? getIntentHash(content).hash : undefined;
  const sessionTelemetry = recordTurn(chatId, userId, currentIntentHash);

  if (process.env.ATLAS_SESSION_TRACKING !== 'false') {
    sessionManager.startTurn(
      sessionTelemetry.sessionId,
      content,
      'telegram',
      { intentHash: currentIntentHash },
    ).catch(err => {
      logger.warn('SessionManager.startTurn failed (resolved context, non-fatal)', { error: (err as Error).message });
    });

    // Patch turn metadata with resolved routing (Bug #1 topic, #2 intent — now covers Socratic path)
    sessionManager.updateTurnMetadata(sessionTelemetry.sessionId, {
      topic: title.substring(0, 100),
      intent: input.requestType,
      pillar: input.pillar,
    });
  }

  // Provenance: initialize or continue chain
  const chain = input.provenanceChain ?? createProvenanceChain(
    'socratic-resolved',
    ['socratic-adapter'],
    resolved.resolvedVia === 'auto_draft' ? 'auto-dispatch' : 'socratic-answer',
  );
  appendPath(chain, 'orchestrator');

  // Sprint C Bug 7+8: Grade + claim detection BEFORE audit write
  // Resolved context is a capture (user answered Socratic question) — grade by action type.
  // Research/Draft dispatches get re-graded by Andon downstream; 'informed' is safe default.
  const resolvedActionTypes = new Set(['Schedule', 'Build', 'Process', 'Triage']);
  const resolvedGrade = resolvedActionTypes.has(input.requestType) ? 'grounded' : 'informed';
  const { detectSensitiveClaims } = await import('../services/claim-detector');
  const resolvedClaims = detectSensitiveClaims(content + ' ' + title);
  if (resolvedClaims.flags.length > 0) {
    logger.info('Sensitive claims detected in resolved context', { flags: resolvedClaims.flags, patterns: resolvedClaims.matchedPatterns });
  }
  setProvenanceResult(chain, {
    findingCount: 0,
    citations: [],
    ragChunks: [],
    hallucinationDetected: false,
    andonGrade: resolvedGrade,
    claimFlags: resolvedClaims.flags,
  });
  finalizeProvenance(chain);

  try {
    // ── AUDIT TRAIL ──────────────────────────────────────
    const auditStep = addStep(trace, 'audit-trail');
    const auditResult = await createAuditTrail({
      entry: title,
      pillar: input.pillar,
      requestType: input.requestType,
      source: 'Telegram',
      author: username || 'Jim',
      confidence: resolved.confidence,
      keywords: input.keywords,
      userId,
      messageText: content,
      hasAttachment: false,
      url: contentType === 'url' ? content : undefined,
      urlTitle: title,
      contentType: contentType === 'url' ? 'url' : undefined,
      ...(input.goalMetadata && {
        analysisContent: {
          metadata: input.goalMetadata,
        },
      }),
      // Sprint C: Attach provenance chain
      provenanceChain: chain,
    }, trace);
    completeStep(auditStep);

    if (!auditResult) {
      logger.info('Resolved context: createAuditTrail returned null (likely dedup)', { title });
      // Session telemetry: complete turn even for dedup
      if (process.env.ATLAS_SESSION_TRACKING !== 'false') {
        sessionManager.completeTurn(sessionTelemetry.sessionId, {
          responsePreview: 'Duplicate detected',
          findings: `Dedup: ${title}`,
        }).catch(err => {
          logger.warn('SessionManager.completeTurn failed (dedup, non-fatal)', { error: (err as Error).message });
        });
      }
      completeTrace(trace);
      // Chain already finalized before audit write (Bug 7 fix)
      return null;
    }

    // Log goal telemetry if present (observation layer)
    if (input.goalTelemetry) {
      logger.info('Goal telemetry emitted (unified path)', {
        feedId: auditResult.feedId,
        goalEndState: input.goalTelemetry.goalEndState,
        initialCompleteness: input.goalTelemetry.initialCompleteness,
        finalCompleteness: input.goalTelemetry.finalCompleteness,
        clarificationCount: input.goalTelemetry.clarificationCount,
      });
    }

    // ── SESSION TELEMETRY: completeTurn ──────────────────
    if (process.env.ATLAS_SESSION_TRACKING !== 'false') {
      const findingParts: string[] = [];
      if (title && title !== 'Message') findingParts.push(title);
      if (input.keywords.length > 0) findingParts.push(`Keywords: ${input.keywords.join(', ')}`);
      const findings = findingParts.length > 0 ? findingParts.join(' | ') : undefined;

      const thesisHook = input.goalContext?.thesisHook
        ? input.goalContext.thesisHook.substring(0, 200)
        : undefined;

      sessionManager.completeTurn(
        sessionTelemetry.sessionId,
        {
          responsePreview: `Captured: ${title}`,
          toolsUsed: input.requestType === 'Research' ? ['dispatch_research'] : undefined,
          findings,
          thesisHook,
        },
      ).catch(err => {
        logger.warn('SessionManager.completeTurn failed (resolved context, non-fatal)', { error: (err as Error).message });
      });
    }

    completeTrace(trace);
    // Chain already finalized before audit write (Bug 7 fix)

    logger.info('Resolved context orchestrated', {
      userId,
      pillar: input.pillar,
      requestType: input.requestType,
      resolvedVia: resolved.resolvedVia,
      hasGoal: !!input.goalContext,
      hasResearchConfig: !!input.researchConfig,
      feedId: auditResult.feedId,
      workQueueId: auditResult.workQueueId,
      traceId: trace.traceId,
      traceDurationMs: trace.totalDurationMs,
    });

    return { ...auditResult, provenanceChain: chain };

  } catch (error) {
    failTrace(trace, error instanceof Error ? error : String(error));
    // Chain already finalized before audit write (Bug 7 fix)
    logger.error('Resolved context orchestration error', {
      error: error instanceof Error ? error.message : String(error),
      userId,
      title,
      traceId: trace.traceId,
    });
    reportFailure('resolved-context-orchestrator', error, { userId, title, traceId: trace.traceId });
    await hooks.setReaction(REACTIONS.ERROR);
    await hooks.reply('Failed to capture. Try again.');
    return null;
  }
}
