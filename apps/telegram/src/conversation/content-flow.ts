/**
 * Content Flow - Integration layer for Universal Content Analysis
 *
 * Detects when a message is primarily a URL share and triggers
 * the interactive classification keyboard instead of full Claude processing.
 *
 * This provides Jim with one-tap confirmation for content classification.
 */

import type { Context } from 'grammy';
import { logger } from '../logger';
import {
  generateRequestId,
  storePendingContent,
  formatContentPreview,
  buildConfirmationKeyboard,
  buildClassificationKeyboard,
  type PendingContent,
} from './content-confirm';
import {
  routeForAnalysis,
  extractUrlsFromText,
  detectContentSource,
  extractDomain,
  type ContentAnalysis,
} from './content-router';
import { isNotionUrl, handleNotionUrl } from './notion-url';
import type { Pillar, RequestType } from './types';
import type { MediaContext } from './media';
import type { AttachmentInfo } from './attachments';

/**
 * Result of content detection
 */
export interface ContentDetectionResult {
  isContentShare: boolean;  // Is this primarily a content share?
  urls: string[];           // Extracted URLs
  primaryUrl?: string;      // Main URL to process
  needsBrowser: boolean;    // Does extraction require browser?
}

/**
 * Detect if a message is primarily a URL/content share
 *
 * A message is a "content share" if:
 * - It contains 1-2 URLs
 * - The non-URL text is minimal (< 50 chars of context)
 * - OR the message is JUST a URL
 */
export function detectContentShare(text: string): ContentDetectionResult {
  const urls = extractUrlsFromText(text);

  if (urls.length === 0) {
    return { isContentShare: false, urls: [], needsBrowser: false };
  }

  // Get the primary URL (first one)
  const primaryUrl = urls[0];

  // Remove URLs from text to check remaining context
  let remainingText = text;
  for (const url of urls) {
    remainingText = remainingText.replace(url, '').trim();
  }

  // Content share if:
  // 1. Just a URL (or URLs)
  // 2. URL with minimal context (< 50 chars)
  // 3. Looks like a "check this out" pattern
  const isContentShare =
    urls.length > 0 &&
    (remainingText.length < 50 ||
     /^(check|look|see|read|watch|this|here|fyi|interesting|cool|nice)/i.test(remainingText));

  // Determine if browser extraction is needed
  const source = detectContentSource(primaryUrl);
  const needsBrowser = ['threads', 'twitter', 'linkedin'].includes(source);

  return {
    isContentShare,
    urls,
    primaryUrl,
    needsBrowser,
  };
}

/**
 * Infer pillar from URL domain and context
 */
function inferPillar(url: string, context: string): Pillar {
  const domain = extractDomain(url).toLowerCase();
  const text = (url + ' ' + context).toLowerCase();

  // The Grove: AI/tech content
  if (
    domain.includes('github.com') ||
    domain.includes('anthropic') ||
    domain.includes('openai') ||
    domain.includes('huggingface') ||
    text.includes('ai') ||
    text.includes('llm') ||
    text.includes('claude') ||
    text.includes('gpt')
  ) {
    return 'The Grove';
  }

  // Consulting: Client-related domains or mentions
  if (
    text.includes('drumwave') ||
    text.includes('take flight') ||
    text.includes('client') ||
    text.includes('consulting')
  ) {
    return 'Consulting';
  }

  // Home/Garage: Home improvement, vehicles, permits
  if (
    text.includes('permit') ||
    text.includes('garage') ||
    text.includes('home depot') ||
    text.includes('lowes') ||
    text.includes('renovation')
  ) {
    return 'Home/Garage';
  }

  // Personal: Health, fitness, family
  if (
    text.includes('gym') ||
    text.includes('health') ||
    text.includes('family') ||
    text.includes('fitness')
  ) {
    return 'Personal';
  }

  // Default to The Grove for tech/social media content
  if (['threads', 'twitter', 'linkedin', 'youtube', 'github'].includes(detectContentSource(url))) {
    return 'The Grove';
  }

  return 'The Grove'; // Default
}

/**
 * Infer request type from content source
 */
function inferRequestType(source: string): RequestType {
  switch (source) {
    case 'article':
    case 'github':
      return 'Research';
    case 'threads':
    case 'twitter':
    case 'linkedin':
      return 'Draft'; // Social content often relates to content creation
    case 'youtube':
      return 'Research';
    default:
      return 'Research';
  }
}

/**
 * Trigger the content confirmation flow
 *
 * This sends a message with the content preview and classification keyboard.
 * Returns true if the flow was triggered, false otherwise.
 */
export async function triggerContentConfirmation(
  ctx: Context,
  url: string,
  contextText: string = ''
): Promise<boolean> {
  const userId = ctx.from?.id;
  const chatId = ctx.chat?.id;

  if (!userId || !chatId) {
    logger.warn('Missing userId or chatId for content confirmation');
    return false;
  }

  try {
    // Route for analysis
    const route = await routeForAnalysis(url);

    // Build initial content analysis (basic metadata)
    // Full extraction happens after confirmation if browser is needed
    const analysis: ContentAnalysis = {
      source: route.source,
      method: route.method,
      title: contextText || `${route.source} content`,
      description: url,
      extractedAt: new Date().toISOString(),
    };

    // Infer classification
    const pillar = inferPillar(url, contextText);
    const requestType = inferRequestType(route.source);

    // Generate request ID
    const requestId = generateRequestId();

    // Create pending content
    const pending: PendingContent = {
      requestId,
      chatId,
      userId,
      messageId: ctx.message?.message_id,
      flowState: 'confirm',  // URL flow goes straight to confirm (no Gemini needed)
      analysis,
      originalText: ctx.message?.text || url,
      pillar,
      requestType,
      timestamp: Date.now(),
      url,
    };

    // Store pending
    storePendingContent(pending);

    // Build preview and keyboard
    const preview = formatContentPreview(pending);
    const keyboard = buildConfirmationKeyboard(requestId, pillar, requestType);

    // Send confirmation message
    const confirmMsg = await ctx.reply(preview, {
      parse_mode: 'HTML',
      reply_markup: keyboard,
      reply_to_message_id: ctx.message?.message_id,
    });

    // Store the confirmation message ID for later editing
    pending.confirmMessageId = confirmMsg.message_id;
    storePendingContent(pending);

    logger.info('Content confirmation triggered', {
      requestId,
      url,
      source: route.source,
      pillar,
      requestType,
    });

    return true;
  } catch (error) {
    logger.error('Failed to trigger content confirmation', { error, url });
    return false;
  }
}

/**
 * Check if a message should use content confirmation flow
 * and trigger it if appropriate.
 *
 * Returns true if the confirmation flow was triggered (message handled),
 * false if the message should continue through normal processing.
 */
export async function maybeHandleAsContentShare(ctx: Context): Promise<boolean> {
  const text = ctx.message?.text || '';

  // Detect if this is a content share
  const detection = detectContentShare(text);

  if (!detection.isContentShare || !detection.primaryUrl) {
    return false; // Not a content share, continue normal processing
  }

  // NOTION URL INTELLIGENCE: Check if this is a Notion URL first
  // Notion URLs get special object-aware handling
  if (isNotionUrl(detection.primaryUrl)) {
    logger.info('Detected Notion URL, routing to Notion handler', { url: detection.primaryUrl });
    const handled = await handleNotionUrl(ctx, detection.primaryUrl);
    if (handled) {
      return true; // Notion handler took over
    }
    // If Notion handler failed, fall through to generic URL handling
    logger.warn('Notion URL handler failed, falling back to generic handling');
  }

  // Get any non-URL context
  let context = text;
  for (const url of detection.urls) {
    context = context.replace(url, '').trim();
  }

  // Trigger the confirmation flow
  return await triggerContentConfirmation(ctx, detection.primaryUrl, context);
}

/**
 * Get icon for media type
 */
function getMediaIcon(type: string): string {
  const icons: Record<string, string> = {
    image: '🖼️',
    photo: '🖼️',
    document: '📄',
    audio: '🎵',
    voice: '🎤',
    video: '🎬',
    video_note: '🎬',
    unknown: '📎',
  };
  return icons[type] || '📎';
}

/**
 * Trigger INSTANT classification keyboard for media (Classify-First Flow)
 *
 * This shows the pillar selection keyboard IMMEDIATELY when media is shared,
 * BEFORE running any Gemini analysis. The analysis happens AFTER pillar selection.
 *
 * Flow:
 * 1. User shares image/document/video
 * 2. INSTANT: Show pillar keyboard (< 200ms)
 * 3. User taps pillar → triggers Gemini with pillar context
 * 4. Show type confirmation with Gemini analysis
 * 5. User confirms → Feed + Work Queue created
 *
 * Benefits:
 * - Faster UX (instant keyboard, no waiting for Gemini)
 * - More accurate (pillar-aware prompts)
 * - Cheaper (Quick File skips Gemini entirely)
 * - Enables pattern learning
 */
export async function triggerInstantClassification(
  ctx: Context,
  attachment: AttachmentInfo
): Promise<boolean> {
  const userId = ctx.from?.id;
  const chatId = ctx.chat?.id;

  if (!userId || !chatId) {
    logger.warn('Missing userId or chatId for instant classification');
    return false;
  }

  try {
    const caption = ctx.message?.caption || '';

    // Generate request ID
    const requestId = generateRequestId();

    // Create pending content in 'classify' state (no analysis yet)
    const pending: PendingContent = {
      requestId,
      chatId,
      userId,
      messageId: ctx.message?.message_id,
      flowState: 'classify',  // Phase 1: awaiting pillar selection
      analysis: {
        source: 'generic',
        method: 'Gemini',  // Will be processed after pillar selection
        title: attachment.fileName || `${attachment.type} content`,
        extractedAt: new Date().toISOString(),
      },
      originalText: caption || `[${attachment.type}]`,
      pillar: 'The Grove',  // Default, will be set by user
      requestType: 'Research',  // Default, will be set after analysis
      timestamp: Date.now(),
      attachmentInfo: attachment,
    };

    // Store pending
    storePendingContent(pending);

    // Build instant preview (minimal - no Gemini analysis yet)
    const icon = getMediaIcon(attachment.type);
    let preview = `${icon} <b>Content received</b>\n`;

    if (attachment.fileName) {
      preview += `📁 ${attachment.fileName}\n`;
    }
    if (attachment.fileSize) {
      preview += `📊 ${formatFileSize(attachment.fileSize)}\n`;
    }
    if (caption) {
      const truncCaption = caption.length > 100 ? caption.substring(0, 97) + '...' : caption;
      preview += `\n"${truncCaption}"\n`;
    }

    preview += `\n<b>Quick classify:</b>`;

    // Build instant keyboard (pillar selection + Quick File/Analyze)
    const keyboard = buildClassificationKeyboard(requestId);

    // Send confirmation message
    const confirmMsg = await ctx.reply(preview, {
      parse_mode: 'HTML',
      reply_markup: keyboard,
      reply_to_message_id: ctx.message?.message_id,
    });

    // Store the confirmation message ID
    pending.confirmMessageId = confirmMsg.message_id;
    storePendingContent(pending);

    logger.info('Instant classification triggered (classify-first)', {
      requestId,
      type: attachment.type,
      fileName: attachment.fileName,
    });

    return true;
  } catch (error) {
    logger.error('Failed to trigger instant classification', { error, type: attachment.type });
    return false;
  }
}

/**
 * Helper to format file size
 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/**
 * Infer pillar from media context
 */
function inferPillarFromMedia(mediaContext: MediaContext, caption: string): Pillar {
  const text = (mediaContext.description + ' ' + caption).toLowerCase();

  // Check for pillar indicators in the Gemini analysis
  if (
    text.includes('code') ||
    text.includes('programming') ||
    text.includes('api') ||
    text.includes('claude') ||
    text.includes('ai') ||
    text.includes('llm')
  ) {
    return 'The Grove';
  }

  if (
    text.includes('client') ||
    text.includes('drumwave') ||
    text.includes('take flight') ||
    text.includes('consulting') ||
    text.includes('invoice')
  ) {
    return 'Consulting';
  }

  if (
    text.includes('permit') ||
    text.includes('garage') ||
    text.includes('house') ||
    text.includes('renovation') ||
    text.includes('home')
  ) {
    return 'Home/Garage';
  }

  if (
    text.includes('health') ||
    text.includes('gym') ||
    text.includes('family') ||
    text.includes('personal')
  ) {
    return 'Personal';
  }

  // Default based on media type
  return 'The Grove';
}

/**
 * Infer request type from media context
 */
function inferRequestTypeFromMedia(mediaContext: MediaContext): RequestType {
  const text = mediaContext.description.toLowerCase();

  // Screenshots of code/errors → Build
  if (text.includes('error') || text.includes('bug') || text.includes('code')) {
    return 'Build';
  }

  // Documents → Research
  if (mediaContext.type === 'document') {
    return 'Research';
  }

  // Screenshots → could be research or draft
  if (text.includes('article') || text.includes('post') || text.includes('tweet')) {
    return 'Draft';
  }

  return 'Research';
}

/**
 * Trigger the content confirmation flow for MEDIA (images, docs, etc.)
 *
 * This shows a keyboard with Gemini's analysis so Jim can confirm classification.
 */
export async function triggerMediaConfirmation(
  ctx: Context,
  attachment: AttachmentInfo,
  mediaContext: MediaContext,
  suggestedPillar: Pillar
): Promise<boolean> {
  const userId = ctx.from?.id;
  const chatId = ctx.chat?.id;

  if (!userId || !chatId) {
    logger.warn('Missing userId or chatId for media confirmation');
    return false;
  }

  try {
    const caption = ctx.message?.caption || '';

    // Build content analysis from Gemini's work
    const analysis: ContentAnalysis = {
      source: mediaContext.type === 'image' ? 'generic' : 'article',
      method: 'Gemini',
      title: attachment.fileName || `${mediaContext.type} content`,
      description: mediaContext.description.substring(0, 200),
      extractedAt: new Date().toISOString(),
    };

    // Infer classification from Gemini analysis
    const pillar = inferPillarFromMedia(mediaContext, caption) || suggestedPillar;
    const requestType = inferRequestTypeFromMedia(mediaContext);

    // Generate request ID
    const requestId = generateRequestId();

    // Create pending content
    const pending: PendingContent = {
      requestId,
      chatId,
      userId,
      messageId: ctx.message?.message_id,
      flowState: 'confirm',  // Legacy flow goes straight to confirm (Gemini already ran)
      analysis,
      originalText: caption || `[${mediaContext.type}]`,
      pillar,
      requestType,
      timestamp: Date.now(),
    };

    // Store pending
    storePendingContent(pending);

    // Build custom preview for media
    const icon = getMediaIcon(mediaContext.type);
    const pillarIcon = {
      'Personal': '👤',
      'The Grove': '🌳',
      'Consulting': '💼',
      'Home/Garage': '🏠',
    }[pillar] || '📁';

    let preview = `${icon} <b>${attachment.fileName || mediaContext.type.toUpperCase()}</b>\n`;

    // Show Gemini's analysis (truncated)
    const desc = mediaContext.description.length > 150
      ? mediaContext.description.substring(0, 147) + '...'
      : mediaContext.description;
    preview += `\n${desc}\n`;

    preview += `\n${pillarIcon} <b>Pillar:</b> ${pillar}`;
    preview += `\n📋 <b>Type:</b> ${requestType}`;
    preview += `\n🔍 <b>Method:</b> Gemini`;

    // Build keyboard
    const keyboard = buildConfirmationKeyboard(requestId, pillar, requestType);

    // Send confirmation message
    const confirmMsg = await ctx.reply(preview, {
      parse_mode: 'HTML',
      reply_markup: keyboard,
      reply_to_message_id: ctx.message?.message_id,
    });

    // Store the confirmation message ID
    pending.confirmMessageId = confirmMsg.message_id;
    storePendingContent(pending);

    logger.info('Media confirmation triggered', {
      requestId,
      type: mediaContext.type,
      pillar,
      requestType,
    });

    return true;
  } catch (error) {
    logger.error('Failed to trigger media confirmation', { error, type: mediaContext.type });
    return false;
  }
}
