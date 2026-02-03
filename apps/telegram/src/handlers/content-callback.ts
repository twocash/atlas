/**
 * Content Callback Handler
 *
 * Processes inline keyboard callbacks for content classification confirmation.
 * Supports TWO-STEP CLASSIFY-FIRST flow:
 *
 * Phase 1 (Classify): Handle pillar selection, Quick File, Analyze First
 * Phase 2 (Confirm): Handle type selection, confirm, skip
 */

import type { Context } from 'grammy';
import { logger } from '../logger';
import {
  getPendingContent,
  updatePendingContent,
  removePendingContent,
  parseCallbackData,
  buildConfirmationKeyboard,
  formatContentPreview,
  type PendingContent,
} from '../conversation/content-confirm';
import { createAuditTrail, type AuditEntry } from '../conversation/audit';
import { buildContentPayload } from '../conversation/content-router';
import { type Pillar as MediaPillar } from '../conversation/media';
import { getPatternSuggestion, recordClassificationFeedback } from '../conversation/content-patterns';
import type { Pillar, RequestType } from '../conversation/types';
import { logAction, isFeatureEnabled, triggerContextualExtraction } from '../skills';
import { safeAnswerCallback } from '../utils/telegram-helpers';

/**
 * Handle content confirmation callback queries
 */
export async function handleContentCallback(ctx: Context): Promise<void> {
  const data = ctx.callbackQuery?.data;
  if (!data) return;

  const parsed = parseCallbackData(data);
  if (!parsed) {
    logger.warn('Invalid content callback data', { data });
    await ctx.answerCallbackQuery({ text: 'Invalid action' });
    return;
  }

  const { requestId, action, value } = parsed;

  // Get pending content
  const pending = getPendingContent(requestId);
  if (!pending) {
    // Use safe answer - if callback expired, falls back to regular message
    await safeAnswerCallback(ctx, 'Request expired. Please share again.', {
      fallbackMessage: '⏱️ That request expired. Please share the link again.'
    });
    // Try to delete the old message
    try {
      await ctx.deleteMessage();
    } catch {
      // Message may already be deleted
    }
    return;
  }

  // Handle action based on flow state
  switch (action) {
    // ========================================
    // Phase 1: Classify-First Actions
    // ========================================
    case 'classify':
      // User selected a pillar - run Gemini analysis with pillar context
      await handleClassifyPillar(ctx, requestId, pending, value as Pillar);
      break;

    case 'quickfile':
      // Quick File - skip Gemini, archive immediately
      await handleQuickFile(ctx, requestId, pending);
      break;

    case 'analyze':
      // Analyze First - run Gemini without pillar context
      await handleAnalyzeFirst(ctx, requestId, pending);
      break;

    // ========================================
    // Phase 2: Confirmation Actions
    // ========================================
    case 'pillar':
      await handlePillarChange(ctx, requestId, pending, value as Pillar);
      break;

    case 'type':
      await handleTypeChange(ctx, requestId, pending, value as RequestType);
      break;

    case 'confirm':
      await handleConfirm(ctx, requestId, pending);
      break;

    case 'skip':
      await handleSkip(ctx, requestId, pending);
      break;
  }
}

// ========================================
// PHASE 1: CLASSIFY-FIRST HANDLERS
// ========================================

/**
 * Handle pillar selection in classify-first flow
 * Runs Gemini analysis with pillar context, then shows type confirmation
 */
async function handleClassifyPillar(
  ctx: Context,
  requestId: string,
  pending: PendingContent | undefined,
  selectedPillar: Pillar
): Promise<void> {
  if (!pending) return;

  // Show "analyzing" feedback
  await ctx.answerCallbackQuery({ text: `${getPillarIcon(selectedPillar)} Analyzing...` });

  try {
    // Update pending with selected pillar
    updatePendingContent(requestId, {
      pillar: selectedPillar,
      flowState: 'confirm',  // Transition to Phase 2
    });

    // Show loading state
    try {
      await ctx.editMessageText(
        `${getPillarIcon(selectedPillar)} <b>${selectedPillar}</b>\n\n⏳ Running Gemini analysis...`,
        { parse_mode: 'HTML' }
      );
    } catch {
      // Message edit may fail
    }

    // Determine content type for pattern lookup
    const contentType = pending.attachmentInfo
      ? mapAttachmentTypeToContentType(pending.attachmentInfo.type)
      : 'url';

    // Try pattern-based suggestion first (Progressive Learning)
    let patternSuggestion: RequestType | null = null;
    try {
      const pattern = await getPatternSuggestion({
        pillar: selectedPillar,
        contentType,
        source: pending.attachmentInfo?.fileName?.split('.').pop(),  // File extension
      });
      if (pattern && pattern.confidence > 0.6) {
        patternSuggestion = pattern.suggestedType;
        logger.info('Pattern suggestion applied', {
          requestId,
          pillar: selectedPillar,
          contentType,
          suggestedType: patternSuggestion,
          confidence: pattern.confidence.toFixed(2),
          sampleCount: pattern.sampleCount,
        });
      }
    } catch {
      // Pattern lookup failed, continue without
    }

    // Run Gemini analysis if we have attachment info
    let analysisDescription = 'Content analysis unavailable';
    let suggestedType: RequestType = patternSuggestion || 'Research';

    if (pending.attachmentInfo) {
      // Import processMediaForCallback dynamically to avoid circular deps
      const mediaResult = await runPillarAwareAnalysis(ctx, pending.attachmentInfo, selectedPillar);

      if (mediaResult) {
        analysisDescription = mediaResult.description;

        // If no pattern suggestion, infer from analysis
        if (!patternSuggestion) {
          suggestedType = inferTypeFromAnalysis(mediaResult.description, selectedPillar);
        }

        // Update pending with analysis
        // Store FULL analysis text (not truncated) for Feed/WQ page body
        updatePendingContent(requestId, {
          analysis: {
            ...pending.analysis,
            title: pending.attachmentInfo.fileName || `${pending.attachmentInfo.type} analysis`,
            description: analysisDescription.substring(0, 200), // Short preview for keyboard
            fullText: analysisDescription, // Full text for page body
          },
          fullAnalysisText: analysisDescription, // Store full analysis for Feed/WQ
          requestType: suggestedType,
          originalSuggestion: suggestedType,  // For pattern learning
        });
      }
    }

    // Get updated pending
    const updated = getPendingContent(requestId);
    if (!updated) return;

    // Build confirmation preview with Gemini analysis
    const preview = formatAnalysisPreview(updated, analysisDescription);

    // Build confirmation keyboard with suggested type
    const keyboard = buildConfirmationKeyboard(requestId, selectedPillar, updated.requestType);

    // Update message with analysis and confirmation keyboard
    try {
      await ctx.editMessageText(preview, {
        parse_mode: 'HTML',
        reply_markup: keyboard,
      });
    } catch (error) {
      logger.warn('Failed to update with analysis', { error, requestId });
    }

    logger.info('Classify-first pillar selected, analysis complete', {
      requestId,
      pillar: selectedPillar,
      suggestedType: updated.requestType,
    });

  } catch (error) {
    logger.error('Failed to process classify-first pillar selection', { error, requestId });
    await ctx.reply('Analysis failed. Please try again.');
  }
}

/**
 * Handle Quick File - archive immediately without Gemini analysis
 */
async function handleQuickFile(
  ctx: Context,
  requestId: string,
  pending: PendingContent | undefined
): Promise<void> {
  if (!pending) return;

  await ctx.answerCallbackQuery({ text: '📂 Quick filing...' });

  try {
    // Use default pillar (The Grove) for quick file
    const pillar = 'The Grove';
    const requestType: RequestType = 'Quick';

    // Build minimal audit entry
    const auditEntry: AuditEntry = {
      entry: pending.attachmentInfo?.fileName || pending.originalText.substring(0, 100) || 'Quick file',
      pillar,
      requestType,
      source: 'Telegram',
      author: 'Jim',

      confidence: 0.8,  // Quick file = less certain
      keywords: ['quick-file', pending.attachmentInfo?.type || 'content'].filter(Boolean),
      workType: 'quick file',

      userId: pending.userId,
      messageText: pending.originalText,
      hasAttachment: !!pending.attachmentInfo,
      attachmentType: pending.attachmentInfo?.type,

      extractionMethod: 'Fetch',  // No Gemini = basic extraction
    };

    // Create audit trail
    const result = await createAuditTrail(auditEntry);

    // Remove from pending
    removePendingContent(requestId);

    // Delete confirmation message
    try {
      await ctx.deleteMessage();
    } catch {
      // May already be deleted
    }

    // Send success message
    if (result) {
      await ctx.reply(
        `📂 Quick filed to <b>The Grove</b>\n\n` +
        `<a href="${result.feedUrl}">Feed</a> | <a href="${result.workQueueUrl}">Work Queue</a>`,
        { parse_mode: 'HTML', link_preview_options: { is_disabled: true } }
      );
    } else {
      await ctx.reply('📂 Quick filed');
    }

    logger.info('Quick file completed', { requestId, feedId: result?.feedId });

  } catch (error) {
    logger.error('Quick file failed', { error, requestId });
    await ctx.reply('Quick file failed. Please try again.');
  }
}

/**
 * Handle Analyze First - run Gemini without pillar context
 */
async function handleAnalyzeFirst(
  ctx: Context,
  requestId: string,
  pending: PendingContent | undefined
): Promise<void> {
  if (!pending) return;

  await ctx.answerCallbackQuery({ text: '🔍 Analyzing...' });

  try {
    // Show loading state
    try {
      await ctx.editMessageText(
        `🔍 <b>Analyzing content...</b>\n\n⏳ Running Gemini analysis...`,
        { parse_mode: 'HTML' }
      );
    } catch {
      // Message edit may fail
    }

    // Run Gemini analysis without pillar context
    let analysisDescription = 'Content analysis unavailable';
    let suggestedPillar: Pillar = 'The Grove';
    let suggestedType: RequestType = 'Research';

    if (pending.attachmentInfo) {
      const mediaResult = await runPillarAwareAnalysis(ctx, pending.attachmentInfo);

      if (mediaResult) {
        analysisDescription = mediaResult.description;
        suggestedPillar = inferPillarFromAnalysis(mediaResult.description);
        suggestedType = inferTypeFromAnalysis(mediaResult.description, suggestedPillar);

        // Update pending with analysis
        // Store FULL analysis text (not truncated) for Feed/WQ page body
        updatePendingContent(requestId, {
          flowState: 'confirm',
          pillar: suggestedPillar,
          requestType: suggestedType,
          originalSuggestion: suggestedType,
          fullAnalysisText: analysisDescription, // Store full analysis for Feed/WQ
          analysis: {
            ...pending.analysis,
            title: pending.attachmentInfo.fileName || `${pending.attachmentInfo.type} analysis`,
            description: analysisDescription.substring(0, 200), // Short preview
            fullText: analysisDescription, // Full text for page body
          },
        });
      }
    }

    // Get updated pending
    const updated = getPendingContent(requestId);
    if (!updated) return;

    // Build confirmation preview
    const preview = formatAnalysisPreview(updated, analysisDescription);

    // Build confirmation keyboard
    const keyboard = buildConfirmationKeyboard(requestId, updated.pillar, updated.requestType);

    // Update message
    try {
      await ctx.editMessageText(preview, {
        parse_mode: 'HTML',
        reply_markup: keyboard,
      });
    } catch (error) {
      logger.warn('Failed to update with analysis', { error, requestId });
    }

    logger.info('Analyze-first complete', {
      requestId,
      suggestedPillar,
      suggestedType,
    });

  } catch (error) {
    logger.error('Analyze-first failed', { error, requestId });
    await ctx.reply('Analysis failed. Please try again.');
  }
}

/**
 * Run Gemini analysis with optional pillar context
 */
async function runPillarAwareAnalysis(
  ctx: Context,
  attachment: import('../conversation/attachments').AttachmentInfo,
  pillar?: Pillar
): Promise<{ description: string; type: string } | null> {
  try {
    // Import media processor
    const { processMedia } = await import('../conversation/media');

    // Process with pillar context (for archiving)
    const safePillar: MediaPillar = pillar || 'The Grove';
    const result = await processMedia(ctx, attachment, safePillar);

    if (result) {
      return {
        description: result.description,
        type: result.type,
      };
    }
  } catch (error) {
    logger.error('Pillar-aware analysis failed', { error, pillar });
  }
  return null;
}

/**
 * Infer pillar from Gemini analysis text
 */
function inferPillarFromAnalysis(analysisText: string): Pillar {
  const text = analysisText.toLowerCase();

  // The Grove: AI/tech content
  if (
    text.includes('code') ||
    text.includes('programming') ||
    text.includes('api') ||
    text.includes('claude') ||
    text.includes('ai') ||
    text.includes('llm') ||
    text.includes('error') ||
    text.includes('terminal') ||
    text.includes('screenshot')
  ) {
    return 'The Grove';
  }

  // Consulting: Client-related
  if (
    text.includes('client') ||
    text.includes('drumwave') ||
    text.includes('take flight') ||
    text.includes('invoice') ||
    text.includes('contract')
  ) {
    return 'Consulting';
  }

  // Home/Garage: Physical space
  if (
    text.includes('permit') ||
    text.includes('garage') ||
    text.includes('house') ||
    text.includes('renovation') ||
    text.includes('receipt') ||
    text.includes('home depot') ||
    text.includes('lowes')
  ) {
    return 'Home/Garage';
  }

  // Personal: Health, family
  if (
    text.includes('health') ||
    text.includes('gym') ||
    text.includes('family') ||
    text.includes('personal') ||
    text.includes('medical')
  ) {
    return 'Personal';
  }

  return 'The Grove';  // Default
}

/**
 * Infer request type from analysis and pillar
 */
function inferTypeFromAnalysis(analysisText: string, pillar: Pillar): RequestType {
  const text = analysisText.toLowerCase();

  // Error screenshots → Build
  if (text.includes('error') || text.includes('bug') || text.includes('failed')) {
    return 'Build';
  }

  // Document/PDF → Research
  if (text.includes('document') || text.includes('pdf') || text.includes('article')) {
    return 'Research';
  }

  // Social content → Draft
  if (text.includes('post') || text.includes('tweet') || text.includes('thread')) {
    return 'Draft';
  }

  // Receipt/Invoice → Process
  if (text.includes('receipt') || text.includes('invoice') || text.includes('payment')) {
    return 'Process';
  }

  // Default by pillar
  switch (pillar) {
    case 'The Grove':
      return 'Research';
    case 'Consulting':
      return 'Process';
    case 'Home/Garage':
      return 'Process';
    case 'Personal':
      return 'Process';
    default:
      return 'Research';
  }
}

/**
 * Format analysis preview for Phase 2 confirmation
 */
function formatAnalysisPreview(pending: PendingContent, analysisDescription: string): string {
  const pillarIcon = getPillarIcon(pending.pillar);
  const typeIcon = '📋';

  let preview = `${pillarIcon} <b>${pending.pillar}</b> / ${pending.requestType}\n\n`;

  // Show analysis (truncated)
  const desc = analysisDescription.length > 200
    ? analysisDescription.substring(0, 197) + '...'
    : analysisDescription;
  preview += `<b>Analysis:</b>\n${desc}\n`;

  preview += `\n${typeIcon} <b>Suggested type:</b> ${pending.requestType}`;
  preview += `\n🔍 <b>Method:</b> Gemini`;

  return preview;
}

/**
 * Map attachment type to content type for pattern learning
 */
function mapAttachmentTypeToContentType(
  attachmentType: string
): 'image' | 'document' | 'url' | 'video' | 'audio' {
  switch (attachmentType) {
    case 'photo':
    case 'image':
      return 'image';
    case 'document':
      return 'document';
    case 'video':
    case 'video_note':
      return 'video';
    case 'voice':
    case 'audio':
      return 'audio';
    default:
      return 'document';
  }
}

// ========================================
// PHASE 2: CONFIRMATION HANDLERS
// ========================================

/**
 * Handle pillar selection change
 */
async function handlePillarChange(
  ctx: Context,
  requestId: string,
  pending: ReturnType<typeof getPendingContent>,
  newPillar: Pillar
): Promise<void> {
  if (!pending) return;

  // Update pending content
  updatePendingContent(requestId, { pillar: newPillar });

  // Get updated pending
  const updated = getPendingContent(requestId);
  if (!updated) return;

  // Acknowledge and update keyboard
  await ctx.answerCallbackQuery({ text: `Pillar: ${newPillar}` });

  // Update message with new keyboard
  try {
    await ctx.editMessageText(formatContentPreview(updated), {
      parse_mode: 'HTML',
      reply_markup: buildConfirmationKeyboard(requestId, updated.pillar, updated.requestType),
    });
  } catch (error) {
    logger.warn('Failed to update confirmation message', { error, requestId });
  }
}

/**
 * Handle type selection change
 */
async function handleTypeChange(
  ctx: Context,
  requestId: string,
  pending: ReturnType<typeof getPendingContent>,
  newType: RequestType
): Promise<void> {
  if (!pending) return;

  // Update pending content
  updatePendingContent(requestId, { requestType: newType });

  // Get updated pending
  const updated = getPendingContent(requestId);
  if (!updated) return;

  // Acknowledge and update keyboard
  await ctx.answerCallbackQuery({ text: `Type: ${newType}` });

  // Update message with new keyboard
  try {
    await ctx.editMessageText(formatContentPreview(updated), {
      parse_mode: 'HTML',
      reply_markup: buildConfirmationKeyboard(requestId, updated.pillar, updated.requestType),
    });
  } catch (error) {
    logger.warn('Failed to update confirmation message', { error, requestId });
  }
}

/**
 * Handle confirm action - create Feed + Work Queue entries
 */
async function handleConfirm(
  ctx: Context,
  requestId: string,
  pending: ReturnType<typeof getPendingContent>
): Promise<void> {
  if (!pending) return;

  await ctx.answerCallbackQuery({ text: 'Creating entries...' });

  try {
    // Check if classification was adjusted (for pattern learning)
    const wasAdjusted = pending.originalSuggestion
      ? pending.requestType !== pending.originalSuggestion
      : false;

    // Determine content type for pattern learning
    const contentType = pending.attachmentInfo
      ? mapAttachmentTypeToContentType(pending.attachmentInfo.type)
      : (pending.url ? 'url' : undefined);

    // Build analysis content for Feed page body
    const analysisContent = buildAnalysisContent(pending);

    // Build audit entry from pending content
    const auditEntry: AuditEntry = {
      entry: pending.analysis.title || pending.originalText.substring(0, 100),
      pillar: pending.pillar,
      requestType: pending.requestType,
      source: 'Telegram',
      author: 'Jim', // Content shared by Jim, confirmed by Jim

      confidence: 1.0, // Human-verified = 100% confidence
      keywords: extractKeywords(pending),
      workType: inferWorkType(pending),

      userId: pending.userId,
      messageText: pending.originalText,
      hasAttachment: !!pending.attachmentInfo,
      attachmentType: pending.attachmentInfo?.type,

      // URL & Content fields
      url: pending.url,
      urlTitle: pending.analysis.title,
      urlDomain: pending.analysis.source !== 'generic' ? pending.analysis.source : undefined,
      contentAuthor: pending.analysis.author,
      extractionMethod: pending.analysis.method,
      contentPayload: buildContentPayload(pending.analysis),

      // Analysis content for Feed page body (searchable, actionable)
      analysisContent,

      // Pattern Learning fields (Classify-First)
      contentType,
      contentSource: pending.attachmentInfo?.fileName?.split('.').pop() || pending.analysis.source,
      classificationConfirmed: true,  // User confirmed via keyboard
      classificationAdjusted: wasAdjusted,
      originalSuggestion: pending.originalSuggestion,
    };

    // Record classification feedback for pattern learning
    if (contentType) {
      recordClassificationFeedback(
        pending.pillar,
        contentType,
        auditEntry.contentSource || 'unknown',
        pending.requestType,
        wasAdjusted,
        pending.originalSuggestion
      );
    }

    // Log pattern learning data
    if (wasAdjusted) {
      logger.info('Classification was adjusted by user', {
        requestId,
        originalSuggestion: pending.originalSuggestion,
        finalType: pending.requestType,
        pillar: pending.pillar,
      });
    }

    // Create audit trail (Feed + Work Queue)
    const result = await createAuditTrail(auditEntry);

    // Remove from pending
    removePendingContent(requestId);

    // Delete confirmation message
    try {
      await ctx.deleteMessage();
    } catch {
      // May already be deleted
    }

    // Send success message
    if (result) {
      const pillarIcon = getPillarIcon(pending.pillar);
      await ctx.reply(
        `${pillarIcon} Logged to <b>${pending.pillar}</b> / ${pending.requestType}\n\n` +
        `<a href="${result.feedUrl}">Feed</a> | <a href="${result.workQueueUrl}">Work Queue</a>`,
        { parse_mode: 'HTML', link_preview_options: { is_disabled: true } }
      );
    } else {
      await ctx.reply('Logged (links unavailable)');
    }

    // Log action for skill pattern detection (Phase 1)
    // Non-blocking - failures don't affect user experience
    if (isFeatureEnabled('skillLogging')) {
      logAction({
        messageText: pending.originalText,
        pillar: pending.pillar,
        requestType: pending.requestType,
        actionType: pending.attachmentInfo ? 'media' : 'extract',
        toolsUsed: [],
        userId: pending.userId,
        confidence: 1.0,  // Human confirmed
        classificationConfirmed: true,
        classificationAdjusted: wasAdjusted,
        originalSuggestion: pending.originalSuggestion,
        contentType,
        contentSource: pending.attachmentInfo?.fileName?.split('.').pop() || pending.analysis.source,
        keywords: extractKeywords(pending),
        workType: inferWorkType(pending),
      }).catch(err => {
        logger.warn('Skill action logging failed (non-fatal)', { error: err });
      });
    }

    // ========================================
    // CONTEXTUAL EXTRACTION (Pillar-Aware)
    // ========================================
    // Trigger pillar-aware extraction using the centralized function
    if (result && pending.url) {
      // Non-blocking: fire and forget
      triggerContextualExtraction({
        url: pending.url,
        pillar: pending.pillar,
        feedId: result.feedId,
        workQueueId: result.workQueueId,
        userId: pending.userId,
        chatId: ctx.chat?.id,
        requestType: pending.requestType,
      }).catch(err => {
        logger.warn('Contextual extraction error (non-fatal)', { error: err });
      });
    }

    logger.info('Content confirmed and logged', {
      requestId,
      pillar: pending.pillar,
      requestType: pending.requestType,
      feedId: result?.feedId,
      skillLogging: isFeatureEnabled('skillLogging'),
      skillExecution: isFeatureEnabled('skillExecution'),
    });
  } catch (error) {
    logger.error('Failed to create audit trail from confirmation', { error, requestId });
    await ctx.reply('Failed to log content. Please try again.');
  }
}

/**
 * Handle skip action - discard without logging
 */
async function handleSkip(
  ctx: Context,
  requestId: string,
  pending: ReturnType<typeof getPendingContent>
): Promise<void> {
  if (!pending) return;

  // Remove from pending
  removePendingContent(requestId);

  await ctx.answerCallbackQuery({ text: 'Skipped' });

  // Delete confirmation message
  try {
    await ctx.deleteMessage();
  } catch {
    // May already be deleted
  }

  // Send brief confirmation
  await ctx.reply('Skipped');

  logger.info('Content skipped', { requestId });
}

/**
 * Extract keywords from pending content
 */
function extractKeywords(pending: ReturnType<typeof getPendingContent>): string[] {
  if (!pending) return [];

  const keywords: string[] = [];

  // Add source as keyword
  if (pending.analysis.source !== 'generic') {
    keywords.push(pending.analysis.source);
  }

  // Add "link" keyword if URL present
  if (pending.url) {
    keywords.push('link');
  }

  return keywords.slice(0, 5);
}

/**
 * Infer work type from content
 */
function inferWorkType(pending: ReturnType<typeof getPendingContent>): string {
  if (!pending) return 'content review';

  const source = pending.analysis.source;

  switch (source) {
    case 'threads':
    case 'twitter':
    case 'linkedin':
      return 'social media content';
    case 'github':
      return 'code review';
    case 'youtube':
      return 'video review';
    case 'article':
      return 'article review';
    default:
      return 'content review';
  }
}

/**
 * Get icon for pillar (duplicated here to avoid circular imports)
 */
function getPillarIcon(pillar: Pillar): string {
  const icons: Record<Pillar, string> = {
    'Personal': '👤',
    'The Grove': '🌳',
    'Consulting': '💼',
    'Home/Garage': '🏠',
  };
  return icons[pillar] || '📁';
}

/**
 * Build analysis content for Feed page body
 *
 * This structures the analysis for writing to the Notion page body,
 * making it searchable, referenceable, and actionable.
 */
function buildAnalysisContent(pending: ReturnType<typeof getPendingContent>): AuditEntry['analysisContent'] {
  if (!pending) return undefined;

  const analysis = pending.analysis;
  const content: NonNullable<AuditEntry['analysisContent']> = {};

  // Use FULL analysis text (not truncated) for summary
  // This is the actual Gemini Vision analysis, not just file metadata
  const fullAnalysis = pending.fullAnalysisText || analysis.fullText || analysis.description;

  if (fullAnalysis) {
    content.summary = fullAnalysis;
  }

  // Store full text for page body
  if (pending.fullAnalysisText) {
    content.fullText = pending.fullAnalysisText;
  }

  // Build metadata
  const metadata: Record<string, string> = {};

  if (analysis.source && analysis.source !== 'generic') {
    metadata['Source'] = analysis.source;
  }
  if (analysis.author) {
    metadata['Author'] = analysis.author;
  }
  if (pending.attachmentInfo?.fileName) {
    metadata['File'] = pending.attachmentInfo.fileName;
  }
  if (pending.attachmentInfo?.fileSize) {
    metadata['Size'] = formatFileSize(pending.attachmentInfo.fileSize);
  }
  if (pending.attachmentInfo?.mimeType) {
    metadata['Type'] = pending.attachmentInfo.mimeType;
  }
  if (analysis.extractedAt) {
    metadata['Analyzed'] = new Date(analysis.extractedAt).toLocaleString();
  }

  if (Object.keys(metadata).length > 0) {
    content.metadata = metadata;
  }

  // Extract key points from FULL analysis (not truncated description)
  const keyPoints = extractKeyPointsFromAnalysis(fullAnalysis || '');
  if (keyPoints.length > 0) {
    content.keyPoints = keyPoints;
  }

  // Suggest actions based on request type
  const suggestedActions = suggestActionsForContent(pending.requestType, pending.pillar);
  if (suggestedActions.length > 0) {
    content.suggestedActions = suggestedActions;
  }

  // Full text if we have extended content
  if (analysis.fullText) {
    content.fullText = analysis.fullText;
  }

  return Object.keys(content).length > 0 ? content : undefined;
}

/**
 * Extract key points from analysis text
 * Looks for actual insights, not raw OCR text or artifacts
 */
function extractKeyPointsFromAnalysis(text: string): string[] {
  if (!text || text.length < 50) return [];

  // Clean the text first
  const cleanedText = cleanAnalysisText(text);

  const points: string[] = [];

  // Look for sections that explicitly contain key information
  // These patterns indicate Gemini's structured analysis sections
  const keyInfoPatterns = [
    /\*\*Key (?:Information|Points|Features|Findings)[:\*]*\*?\*?([^*]+?)(?=\n\n|\*\*\d|$)/gi,
    /Key (?:Information|Points|Features|Findings):\s*\n([\s\S]+?)(?=\n\n\d\.|\n\n\*\*|$)/gi,
  ];

  for (const pattern of keyInfoPatterns) {
    const match = cleanedText.match(pattern);
    if (match) {
      // Extract bullet points from this section
      const section = match[0];
      const bullets = section.match(/[•\-\*]\s+[^\n]{30,}/g);
      if (bullets) {
        points.push(...bullets.map(b => cleanBulletPoint(b)));
      }
    }
  }

  // If we found good key points, return them
  if (points.length >= 2) {
    return filterAndDedupePoints(points).slice(0, 5);
  }

  // Fallback: Look for the first few meaningful bullet points
  // But filter out short items, OCR artifacts, and navigation text
  const allBullets = cleanedText.match(/[•\-\*]\s+[^\n]+/g) || [];
  for (const bullet of allBullets) {
    const cleaned = cleanBulletPoint(bullet);
    if (isGoodKeyPoint(cleaned)) {
      points.push(cleaned);
    }
    if (points.length >= 5) break;
  }

  // If still no points, extract first meaningful sentences
  if (points.length === 0) {
    const sentences = cleanedText.split(/[.!?]+/).filter(s => {
      const trimmed = s.trim();
      return trimmed.length > 40 && trimmed.length < 200 && isGoodKeyPoint(trimmed);
    });
    points.push(...sentences.slice(0, 3).map(s => s.trim()));
  }

  return filterAndDedupePoints(points).slice(0, 5);
}

/**
 * Clean bullet point text
 */
function cleanBulletPoint(text: string): string {
  return text
    .replace(/^[•\-\*]\s+/, '')  // Remove bullet marker
    .replace(/\*\*/g, '')         // Remove bold markers
    .replace(/\*/g, '')           // Remove italic markers
    .trim();
}

/**
 * Check if a point is a meaningful insight (not OCR garbage)
 */
function isGoodKeyPoint(text: string): boolean {
  // Too short
  if (text.length < 30) return false;

  // OCR artifacts and navigation elements
  const badPatterns = [
    /^[✔✓✗✘☐☑]/,           // Checkbox characters
    /^[0-9]+$/,              // Just numbers
    /^#\d+/,                 // "#1 Repository" type headers
    /TRENDING/i,             // Social media labels
    /binary data/i,          // Binary artifacts
    /Homepage|Discord|Contact|Docs$/i,  // Navigation links
    /^\s*[A-Z]{2,}$/,        // All caps short strings
    /^https?:\/\//,          // Raw URLs
    /^\d+\.\s*$/,            // Just "1." or "2."
  ];

  for (const pattern of badPatterns) {
    if (pattern.test(text)) return false;
  }

  // Should have some substance (words)
  const wordCount = text.split(/\s+/).length;
  if (wordCount < 5) return false;

  return true;
}

/**
 * Filter and dedupe points
 */
function filterAndDedupePoints(points: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const point of points) {
    const normalized = point.toLowerCase().substring(0, 50);
    if (!seen.has(normalized) && isGoodKeyPoint(point)) {
      seen.add(normalized);
      result.push(point);
    }
  }

  return result;
}

/**
 * Clean analysis text - remove artifacts and normalize
 */
function cleanAnalysisText(text: string): string {
  return text
    .replace(/<binary data[^>]*>/gi, '')  // Remove binary data markers
    .replace(/\\n/g, '\n')                 // Normalize newlines
    .replace(/\n{3,}/g, '\n\n')            // Collapse multiple newlines
    .trim();
}

/**
 * Strip Markdown formatting for plain text contexts
 */
function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, '$1')     // Bold
    .replace(/\*([^*]+)\*/g, '$1')          // Italic
    .replace(/__([^_]+)__/g, '$1')          // Bold underscore
    .replace(/_([^_]+)_/g, '$1')            // Italic underscore
    .replace(/`([^`]+)`/g, '$1')            // Inline code
    .replace(/```[\s\S]*?```/g, '')         // Code blocks
    .replace(/#+\s+/g, '')                  // Headers
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // Links
    .replace(/<binary data[^>]*>/gi, '')    // Binary artifacts
    .trim();
}

/**
 * Suggest actions based on request type and pillar
 *
 * NOTE: Returns empty array. Generic placeholders like "Review and summarize key findings"
 * add no value. Real suggested actions come from Claude's analysis in the skill execution.
 */
function suggestActionsForContent(_requestType: RequestType, _pillar: Pillar): string[] {
  // Return empty - skill execution provides real, contextual suggested actions
  return [];
}

/**
 * Format file size for display
 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
