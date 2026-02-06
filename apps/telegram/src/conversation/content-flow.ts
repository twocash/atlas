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
import { startPromptSelection } from '../handlers/prompt-selection-callback';
import { getFeatureFlags } from '../config/features';
import { triageMessage, type TriageResult } from '../cognitive/triage-skill';

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
 * V3 UPDATE (2026-02-05): Now routes to V3 Progressive Profiling flow
 * (Pillar → Action → Voice) instead of the old confirmation keyboard.
 *
 * TRIAGE INTELLIGENCE (2026-02-06): When triageSkill flag is enabled,
 * uses unified Haiku triage for smart title generation and pillar suggestion.
 *
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
    const flags = getFeatureFlags();
    let title: string;
    let triageResult: TriageResult | undefined;

    if (flags.triageSkill) {
      // TRIAGE INTELLIGENCE: Use unified Haiku triage for smart title + classification
      const triageInput = contextText ? `${url}\n\n${contextText}` : url;
      triageResult = await triageMessage(triageInput);

      // Use triage-generated title, fallback to URL domain
      title = triageResult.title || contextText || `Content from ${extractDomain(url)}`;

      logger.info('Triage skill completed', {
        url,
        intent: triageResult.intent,
        confidence: triageResult.confidence,
        suggestedPillar: triageResult.pillar,
        complexityTier: triageResult.complexityTier,
        source: triageResult.source,
        title,
        latencyMs: triageResult.latencyMs,
      });
    } else {
      // Legacy: Use context text or generic title
      const route = await routeForAnalysis(url);
      title = contextText || `${route.source} content from ${extractDomain(url)}`;

      logger.info('Content share detected (triage skill disabled)', {
        url,
        source: route.source,
        title,
      });
    }

    // V3 PROGRESSIVE PROFILING: Use the new Pillar → Action → Voice flow
    // Pass triage result for suggested pillar highlighting
    await startPromptSelection(ctx, url, 'url', title, triageResult);

    return true;
  } catch (error) {
    logger.error('Failed to trigger V3 content flow', { error, url });
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
 * Trigger classification for media (images, documents, etc.)
 *
 * V3 UPDATE (2026-02-05): Now routes to V3 Progressive Profiling flow
 * (Pillar → Action → Voice) instead of the old instant classification keyboard.
 *
 * Flow:
 * 1. User shares image/document/video
 * 2. Show V3 pillar keyboard
 * 3. User taps pillar → action → voice
 * 4. Feed + Work Queue created with attachment info
 */
export async function triggerInstantClassification(
  ctx: Context,
  attachment: AttachmentInfo
): Promise<boolean> {
  const userId = ctx.from?.id;
  const chatId = ctx.chat?.id;

  if (!userId || !chatId) {
    logger.warn('Missing userId or chatId for media classification');
    return false;
  }

  try {
    const caption = ctx.message?.caption || '';
    const title = attachment.fileName || caption || `${attachment.type} content`;

    // For media, we use the caption or filename as content, contentType as 'text'
    // since we don't have a URL. The V3 flow will handle it.
    const content = caption || `[${attachment.type}${attachment.fileName ? `: ${attachment.fileName}` : ''}]`;

    logger.info('Media share detected, routing to V3 progressive profiling', {
      type: attachment.type,
      fileName: attachment.fileName,
      title,
    });

    // V3 PROGRESSIVE PROFILING: Use the new Pillar → Action → Voice flow
    await startPromptSelection(ctx, content, 'text', title);

    return true;
  } catch (error) {
    logger.error('Failed to trigger V3 media flow', { error, type: attachment.type });
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
 * V3 UPDATE (2026-02-05): Now routes to V3 Progressive Profiling flow
 * (Pillar → Action → Voice) instead of the old confirmation keyboard.
 *
 * Note: This is called after Gemini analysis, so we include the analysis
 * in the title for context.
 */
export async function triggerMediaConfirmation(
  ctx: Context,
  attachment: AttachmentInfo,
  mediaContext: MediaContext,
  _suggestedPillar: Pillar
): Promise<boolean> {
  const userId = ctx.from?.id;
  const chatId = ctx.chat?.id;

  if (!userId || !chatId) {
    logger.warn('Missing userId or chatId for media confirmation');
    return false;
  }

  try {
    const caption = ctx.message?.caption || '';

    // Use Gemini's description as context, truncated for title
    const geminiSummary = mediaContext.description.length > 100
      ? mediaContext.description.substring(0, 97) + '...'
      : mediaContext.description;

    const title = attachment.fileName || geminiSummary || `${mediaContext.type} content`;

    // Content includes both caption and Gemini's analysis
    const content = caption
      ? `${caption}\n\n[Gemini analysis: ${geminiSummary}]`
      : `[${mediaContext.type}: ${geminiSummary}]`;

    logger.info('Media with Gemini analysis, routing to V3 progressive profiling', {
      type: mediaContext.type,
      fileName: attachment.fileName,
      title,
    });

    // V3 PROGRESSIVE PROFILING: Use the new Pillar → Action → Voice flow
    await startPromptSelection(ctx, content, 'text', title);

    return true;
  } catch (error) {
    logger.error('Failed to trigger V3 media flow', { error, type: mediaContext.type });
    return false;
  }
}
