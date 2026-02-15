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
 *   handler.ts → content-flow.ts → triage-skill.ts → prompt-selection-callback.ts
 *     → prompt-composition/composer.ts → PromptManager → Notion System Prompts DB
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
import { createAuditTrail, type AuditEntry } from './audit';
import { getAllTools, executeTool } from './tools';
import { recordUsage } from './stats';
import { maybeHandleAsContentShare, triggerMediaConfirmation, triggerInstantClassification } from './content-flow';
import { hasPendingSelectionForUser, getSelectionByUserId, updateSelection } from './prompt-selection';
import { logAction, isFeatureEnabled } from '../skills';
import { getFeatureFlags } from '../config/features';
import { classifyWithFallback, triageForAudit, triageMessage } from '../cognitive/triage-skill';
import type { TriageResult } from '../cognitive/triage-skill';
import {
  generateDispatchChoiceId,
  storePendingDispatch,
  formatRoutingChoiceMessage,
  buildRoutingChoiceKeyboard,
  type PendingDispatch,
} from './dispatch-choice';

// Feature flag for content confirmation keyboard (Universal Content Analysis)
// Enabled by default - set ATLAS_CONTENT_CONFIRM=false to disable
const CONTENT_CONFIRM_ENABLED = process.env.ATLAS_CONTENT_CONFIRM !== 'false';

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
 * Handle incoming message - Claude as front door (with tools)
 */
export async function handleConversation(ctx: Context): Promise<void> {
  const userId = ctx.from!.id;
  const messageText = ctx.message?.text || ctx.message?.caption || '';
  const username = ctx.from?.username || String(userId);

  logger.info('Conversation message received', {
    userId,
    username,
    textLength: messageText.length,
  });

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
      // Content confirmation keyboard shown - don't continue with Claude processing
      await setReaction(ctx, REACTIONS.DONE);
      logger.info('Content share detected, confirmation keyboard shown', { userId });
      return;
    }

    // BUG #2 FIX: Check if user has a pending selection and sent follow-up context
    // This handles the case where user sends URL, then "check this out" separately
    // Feature flag: ATLAS_PENDING_SELECTION_CONTEXT (default ON)
    const flags = getFeatureFlags();
    if (flags.pendingSelectionContext) {
      const pendingSelection = getSelectionByUserId(userId);
      if (pendingSelection && messageText.length < 100) {
        // Short message while pending selection exists - treat as context addition
        const isContextPhrase = /^(check|look|see|read|watch|this|here|fyi|interesting|cool|nice|for|about|regarding|re:|hey|btw|also|and|oh|note|important)/i.test(messageText.trim());

        if (isContextPhrase) {
          updateSelection(pendingSelection.requestId, {});  // Refresh TTL
          // Note: We don't update the title here as it would require re-rendering the keyboard
          // Instead, just acknowledge and let the existing keyboard handle it

          await ctx.reply('👍 Got it — use the buttons above to classify.', {
            reply_parameters: { message_id: pendingSelection.messageId || ctx.message?.message_id || 0 },
          });
          await setReaction(ctx, REACTIONS.CHAT);

          logger.info('Follow-up context acknowledged for pending selection', {
            userId,
            requestId: pendingSelection.requestId,
            context: messageText,
          });
          return;
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

  // PRE-FLIGHT TRIAGE: Detect command intent before sending to Claude
  // This fixes the meta-request bug where "log a bug about X" gets captured
  // as a task instead of executing the command. The triage result is reused
  // for audit later (no duplicate API call).
  let preflightTriage: TriageResult | null = null;
  try {
    preflightTriage = await triageMessage(messageText);

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
    logger.warn('Pre-flight triage failed (non-fatal, continuing with raw text)', { error: err });
  }

  // Get conversation history
  const conversation = await getConversation(userId);

  // Build system prompt (pass conversation for tool context continuity)
  const systemPrompt = await buildSystemPrompt(conversation);

  // Build messages array for Claude API
  const messages: Anthropic.MessageParam[] = buildMessages(conversation, userContent);

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

        const result = await executeTool(
          toolUse.name,
          toolUse.input as Record<string, unknown>
        );

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
    const auditEntry: AuditEntry = {
      entry: smartTitle,
      pillar: classification.pillar,
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
          classification.pillar as Pillar
        ),
      }),
    };

    const auditResult = await createAuditTrail(auditEntry);

    // Update conversation history (with tool context for continuity)
    await updateConversation(
      userId,
      messageText,
      historyResponse,
      auditResult ? {
        pillar: classification.pillar,
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

    if (formattedResponse.length > 4000) {
      // Split into chunks for Telegram's message limit
      const chunks = splitMessage(formattedResponse, 4000);
      for (const chunk of chunks) {
        await ctx.reply(chunk, { parse_mode: 'HTML' });
      }
    } else {
      await ctx.reply(formattedResponse, { parse_mode: 'HTML' });
    }

    // Record usage for stats
    await recordUsage({
      inputTokens: Math.floor(totalTokens * 0.7), // Approximate split
      outputTokens: Math.floor(totalTokens * 0.3),
      pillar: classification.pillar,
      requestType: classification.requestType,
      model: 'claude-sonnet-4',
    });

    // Final reaction based on whether action was taken
    const actionTaken = !!auditResult || toolsUsed.length > 0 || !!mediaContext;
    await setReaction(ctx, actionTaken ? REACTIONS.DONE : REACTIONS.CHAT);

    // Log action for skill pattern detection (Phase 1)
    // Non-blocking - pass existingFeedId to prevent dual-write (Bug A fix)
    if (isFeatureEnabled('skillLogging')) {
      logAction({
        messageText,
        pillar: classification.pillar,
        requestType: classification.requestType,
        actionType: toolsUsed.length > 0 ? 'tool' : (mediaContext ? 'media' : 'chat'),
        toolsUsed,
        userId,
        confidence: classification.confidence,
        keywords: classification.keywords,
        workType: classification.workType,
        contentType: mediaContext ? mediaContext.type as 'image' | 'document' | 'video' | 'audio' : undefined,
        existingFeedId: auditResult?.feedId,
      }).catch(err => {
        logger.warn('Skill action logging failed (non-fatal)', { error: err });
      });
    }

    logger.info('Conversation response sent', {
      userId,
      pillar: classification.pillar,
      requestType: classification.requestType,
      tokens: totalTokens,
      toolIterations: iterations,
      auditCreated: !!auditResult,
      actionTaken,
      skillLogging: isFeatureEnabled('skillLogging'),
    });

  } catch (error) {
    logger.error('Conversation handler error', { error, userId });
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
