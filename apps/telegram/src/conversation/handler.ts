/**
 * Atlas Telegram Bot - Conversation Handler
 *
 * Main entry point for the conversational UX. Claude is the front door.
 * Every message goes through Claude, which decides what to do.
 */

import type { Context } from 'grammy';
import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../logger';
import { getConversation, updateConversation, buildMessages } from './context';
import { buildSystemPrompt } from './prompt';
import { detectAttachment, buildAttachmentPrompt } from './attachments';
import { createAuditTrail, type AuditEntry } from './audit';
import { ALL_TOOLS, executeTool } from './tools';
import { recordUsage } from './stats';
import type { ClassificationResult } from './types';

// Initialize Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Max tool call iterations to prevent runaway loops
const MAX_TOOL_ITERATIONS = 5;

// Classification prompt (injected into tool response handling)
const CLASSIFICATION_PROMPT = `Based on the conversation, classify this request:

Return JSON with:
- pillar: "Personal" | "The Grove" | "Consulting" | "Home/Garage"
- requestType: "Research" | "Draft" | "Build" | "Schedule" | "Answer" | "Process" | "Quick" | "Triage" | "Chat"
- confidence: 0-1
- workType: 2-5 word description (e.g., "agent infrastructure", "blog content creation")
- keywords: array of relevant terms
- reasoning: brief explanation

Classification rules:
- Permits → always Home/Garage
- Client mentions (DrumWave, Take Flight) → always Consulting
- AI/LLM research → always The Grove
- "gym", "health", "family" → Personal
- Quick answers/chat → "Chat" or "Quick" type
- Research requests → "Research" type
- Writing tasks → "Draft" type`;

/**
 * Parse classification from Claude response
 */
function parseClassification(text: string): ClassificationResult | null {
  try {
    // Try to find JSON in the response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]) as ClassificationResult;
    }
  } catch {
    // Classification parsing failed
  }
  return null;
}

/**
 * Classify the message using a quick Claude call
 */
async function classifyMessage(message: string): Promise<ClassificationResult> {
  try {
    const response = await anthropic.messages.create({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 300,
      messages: [
        {
          role: 'user',
          content: `${CLASSIFICATION_PROMPT}\n\nMessage: "${message}"`,
        },
      ],
    });

    const textContent = response.content.find(block => block.type === 'text');
    if (textContent?.type === 'text') {
      const classification = parseClassification(textContent.text);
      if (classification) {
        return classification;
      }
    }
  } catch (error) {
    logger.error('Classification failed', { error });
  }

  // Default classification
  return {
    pillar: 'The Grove',
    requestType: 'Chat',
    confidence: 0.5,
    workType: 'general chat',
    keywords: [],
    reasoning: 'Default classification (parsing failed)',
  };
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

  // Show typing indicator
  await ctx.replyWithChatAction('typing');

  // Detect attachments
  const attachment = detectAttachment(ctx);
  const hasAttachment = attachment.type !== 'none';

  // Build the message content
  let userContent = messageText;
  if (hasAttachment) {
    userContent += buildAttachmentPrompt(attachment);
  }

  // Get conversation history
  const conversation = await getConversation(userId);

  // Build system prompt
  const systemPrompt = await buildSystemPrompt();

  // Build messages array for Claude API
  const messages: Anthropic.MessageParam[] = buildMessages(conversation, userContent);

  let totalTokens = 0;

  try {
    // Call Claude with tools
    let response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: systemPrompt,
      messages,
      tools: ALL_TOOLS,
    });

    totalTokens += response.usage.input_tokens + response.usage.output_tokens;

    // Tool use loop
    let iterations = 0;
    while (response.stop_reason === 'tool_use' && iterations < MAX_TOOL_ITERATIONS) {
      iterations++;

      // Find tool use blocks
      const toolUseBlocks = response.content.filter(
        (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
      );

      if (toolUseBlocks.length === 0) break;

      // Execute each tool call
      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const toolUse of toolUseBlocks) {
        logger.info('Executing tool', { tool: toolUse.name, input: toolUse.input });

        // Keep typing indicator active
        await ctx.replyWithChatAction('typing');

        const result = await executeTool(
          toolUse.name,
          toolUse.input as Record<string, unknown>
        );

        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: JSON.stringify(result),
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
        system: systemPrompt,
        messages,
        tools: ALL_TOOLS,
      });

      totalTokens += response.usage.input_tokens + response.usage.output_tokens;
    }

    // Extract final text response
    const textContent = response.content.find(
      (block): block is Anthropic.TextBlock => block.type === 'text'
    );
    const responseText = textContent?.text.trim() || "Done.";

    // Classify the message for audit
    const classification = await classifyMessage(messageText);

    // Create audit trail (Feed + Work Queue)
    const auditEntry: AuditEntry = {
      entry: messageText.substring(0, 100) || 'Message',
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
    };

    const auditResult = await createAuditTrail(auditEntry);

    // Update conversation history
    await updateConversation(
      userId,
      messageText,
      responseText,
      auditResult ? {
        pillar: classification.pillar,
        requestType: classification.requestType,
        feedId: auditResult.feedId,
        workQueueId: auditResult.workQueueId,
      } : undefined
    );

    // Send response (handle long messages)
    if (responseText.length > 4000) {
      // Split into chunks for Telegram's message limit
      const chunks = splitMessage(responseText, 4000);
      for (const chunk of chunks) {
        await ctx.reply(chunk);
      }
    } else {
      await ctx.reply(responseText);
    }

    // Record usage for stats
    await recordUsage({
      inputTokens: Math.floor(totalTokens * 0.7), // Approximate split
      outputTokens: Math.floor(totalTokens * 0.3),
      pillar: classification.pillar,
      requestType: classification.requestType,
      model: 'claude-sonnet-4',
    });

    logger.info('Conversation response sent', {
      userId,
      pillar: classification.pillar,
      requestType: classification.requestType,
      tokens: totalTokens,
      toolIterations: iterations,
      auditCreated: !!auditResult,
    });

  } catch (error) {
    logger.error('Conversation handler error', { error, userId });
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
