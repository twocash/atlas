/**
 * Media Processor — Surface-Agnostic Media Analysis
 *
 * Processes media files (images, documents, audio, video) using Gemini Vision.
 * Surface adapters provide file buffers via FileProvider hook.
 * All Telegram/Grammy dependencies removed — pure cognitive logic.
 *
 * @module media/processor
 * Sprint: ARCH-CPE-001 Phase 4 — extracted from apps/telegram/src/conversation/media.ts
 */

import { GoogleGenAI } from '@google/genai';
import { logger } from '../logger';
import type { AttachmentInfo } from '../conversation/attachments';

// ─── Types ──────────────────────────────────────────────

export interface MediaContext {
  type: 'image' | 'document' | 'audio' | 'video' | 'unknown';
  description: string;
  extractedText?: string;
  metadata?: Record<string, unknown>;
  processingTime: number;
  archivedPath?: string;
}

export type Pillar = 'Personal' | 'The Grove' | 'Consulting' | 'Home/Garage';

// ─── Gemini Client ──────────────────────────────────────

let gemini: GoogleGenAI | null = null;

function getGemini(): GoogleGenAI {
  if (!gemini) {
    const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GOOGLE_API_KEY or GEMINI_API_KEY required for media processing');
    }
    gemini = new GoogleGenAI({ apiKey });
  }
  return gemini;
}

// ─── MIME mappings ──────────────────────────────────────

const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const DOCUMENT_MIMES = ['application/pdf', 'text/plain', 'text/csv', 'text/markdown'];
const AUDIO_MIMES = ['audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/wav'];

// ─── Core Processors ───────────────────────────────────

/**
 * Dispatch media processing based on attachment type.
 * Callers provide the file buffer (downloaded by surface layer).
 */
export async function analyzeMedia(
  buffer: Buffer,
  attachment: AttachmentInfo,
  localPath?: string,
): Promise<MediaContext> {
  const startTime = Date.now();

  let result: MediaContext;

  switch (attachment.type) {
    case 'photo':
      result = await processImage(buffer, attachment);
      break;
    case 'document':
      result = await processDocument(buffer, attachment, localPath);
      break;
    case 'voice':
    case 'audio':
      result = await processAudio(buffer, attachment);
      break;
    case 'video':
    case 'video_note':
      result = await processVideo(buffer, attachment);
      break;
    default:
      result = {
        type: 'unknown',
        description: `Received ${attachment.type} file. Unable to process this format.`,
        processingTime: Date.now() - startTime,
      };
  }

  result.processingTime = Date.now() - startTime;
  return result;
}

/**
 * Process image with Gemini Vision
 */
export async function processImage(
  buffer: Buffer,
  attachment: AttachmentInfo
): Promise<MediaContext> {
  const client = getGemini();
  const mimeType = attachment.mimeType || 'image/jpeg';

  let prompt = 'Analyze this image comprehensively. Describe:\n';
  prompt += '1. What is shown (objects, people, text, scenes)\n';
  prompt += '2. Any text visible (OCR it fully)\n';
  prompt += '3. Key details that might be actionable\n';
  prompt += '4. If it\'s a screenshot, describe the interface/content\n';
  prompt += '5. If it\'s a document/receipt/form, extract all data\n\n';
  prompt += 'Be thorough but concise. Focus on information that would help take action.';

  if (attachment.caption) {
    prompt += `\n\nUser caption: "${attachment.caption}"`;
  }

  try {
    const response = await client.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: [{
        role: 'user',
        parts: [
          { inlineData: { mimeType: mimeType as any, data: buffer.toString('base64') } },
          { text: prompt },
        ],
      }],
    });

    return {
      type: 'image',
      description: response.text || 'Image processed but no description generated.',
      metadata: { width: attachment.width, height: attachment.height, mimeType },
      processingTime: 0,
    };
  } catch (error) {
    logger.error('Gemini image processing failed', { error });
    return {
      type: 'image',
      description: `Image received (${attachment.width}x${attachment.height}) but vision processing failed.`,
      processingTime: 0,
    };
  }
}

/**
 * Process document (PDF, text, images-as-documents, etc.)
 */
export async function processDocument(
  buffer: Buffer,
  attachment: AttachmentInfo,
  localPath?: string
): Promise<MediaContext> {
  const mimeType = attachment.mimeType || 'application/octet-stream';

  if (mimeType === 'application/pdf') {
    return await processPdfWithGemini(buffer, attachment);
  }

  if (mimeType.startsWith('text/') ||
      attachment.fileName?.endsWith('.txt') ||
      attachment.fileName?.endsWith('.md') ||
      attachment.fileName?.endsWith('.csv') ||
      attachment.fileName?.endsWith('.json')) {
    const content = buffer.toString('utf-8');
    return {
      type: 'document',
      description: `Text document: ${attachment.fileName}`,
      extractedText: content.slice(0, 10000),
      metadata: {
        fileName: attachment.fileName,
        mimeType,
        fileSize: attachment.fileSize,
        truncated: content.length > 10000,
      },
      processingTime: 0,
    };
  }

  if (mimeType.startsWith('image/') ||
      attachment.fileName?.toLowerCase().endsWith('.png') ||
      attachment.fileName?.toLowerCase().endsWith('.jpg') ||
      attachment.fileName?.toLowerCase().endsWith('.jpeg') ||
      attachment.fileName?.toLowerCase().endsWith('.gif') ||
      attachment.fileName?.toLowerCase().endsWith('.webp')) {
    logger.info('Document is an image, routing to Gemini Vision', {
      fileName: attachment.fileName, mimeType,
    });
    return await processImageDocument(buffer, attachment, mimeType);
  }

  return {
    type: 'document',
    description: `Document received: ${attachment.fileName} (${formatFileSize(attachment.fileSize || 0)}). Format: ${mimeType}. This file format requires manual review - download to analyze.`,
    metadata: { fileName: attachment.fileName, mimeType, fileSize: attachment.fileSize },
    processingTime: 0,
  };
}

/**
 * Process image file sent as document with Gemini Vision
 */
async function processImageDocument(
  buffer: Buffer,
  attachment: AttachmentInfo,
  mimeType: string
): Promise<MediaContext> {
  const client = getGemini();
  const geminiMimeType = mimeType.startsWith('image/')
    ? mimeType as any
    : 'image/png';

  let prompt = 'Analyze this image/document thoroughly. Describe:\n';
  prompt += '1. What type of content this is (screenshot, diagram, document, photo, etc.)\n';
  prompt += '2. Extract ALL visible text (OCR) - be comprehensive\n';
  prompt += '3. Key information, data points, or actionable items\n';
  prompt += '4. If it\'s a research paper/article, summarize the main points\n';
  prompt += '5. If it\'s a UI/screenshot, describe what interface or app is shown\n';
  prompt += '6. Any relevant metadata (dates, names, numbers, URLs)\n\n';
  prompt += 'Be thorough - this content will be used to create actionable tasks.';

  if (attachment.caption) {
    prompt += `\n\nUser provided context: "${attachment.caption}"`;
  }

  try {
    const response = await client.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: [{
        role: 'user',
        parts: [
          { inlineData: { mimeType: geminiMimeType, data: buffer.toString('base64') } },
          { text: prompt },
        ],
      }],
    });

    const description = response.text || 'Image document processed but no description generated.';
    logger.info('Image document analyzed with Gemini', {
      fileName: attachment.fileName, descriptionLength: description.length,
    });

    return {
      type: 'document',
      description,
      metadata: { fileName: attachment.fileName, mimeType, fileSize: attachment.fileSize, analyzedAsImage: true },
      processingTime: 0,
    };
  } catch (error) {
    logger.error('Gemini image document processing failed', { error, fileName: attachment.fileName });
    return {
      type: 'document',
      description: `Image document received: ${attachment.fileName} (${formatFileSize(attachment.fileSize || 0)}). Vision analysis failed - please try again or download to review manually.`,
      metadata: { fileName: attachment.fileName, mimeType, fileSize: attachment.fileSize },
      processingTime: 0,
    };
  }
}

/**
 * Process PDF with Gemini
 */
async function processPdfWithGemini(
  buffer: Buffer,
  attachment: AttachmentInfo
): Promise<MediaContext> {
  const client = getGemini();

  const prompt = `Analyze this PDF document thoroughly:
1. Extract and summarize the main content
2. List any key data points, dates, amounts, names
3. Identify the document type (invoice, contract, article, etc.)
4. Note any action items or important deadlines
5. Extract tables or structured data if present

Be comprehensive but organized. Use bullet points for clarity.`;

  try {
    const response = await client.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: [{
        role: 'user',
        parts: [
          { inlineData: { mimeType: 'application/pdf', data: buffer.toString('base64') } },
          { text: prompt },
        ],
      }],
    });

    return {
      type: 'document',
      description: response.text || 'PDF processed but no content extracted.',
      metadata: { fileName: attachment.fileName, mimeType: 'application/pdf', fileSize: attachment.fileSize },
      processingTime: 0,
    };
  } catch (error) {
    logger.error('Gemini PDF processing failed', { error });

    try {
      const pdfParse = await import('pdf-parse');
      const pdfData = await pdfParse.default(buffer);
      return {
        type: 'document',
        description: `PDF: ${attachment.fileName} (${pdfData.numpages} pages)`,
        extractedText: pdfData.text.slice(0, 10000),
        metadata: { fileName: attachment.fileName, pages: pdfData.numpages, truncated: pdfData.text.length > 10000 },
        processingTime: 0,
      };
    } catch {
      return {
        type: 'document',
        description: `PDF received: ${attachment.fileName}. Unable to extract content.`,
        processingTime: 0,
      };
    }
  }
}

/**
 * Process audio/voice with Gemini
 */
export async function processAudio(
  buffer: Buffer,
  attachment: AttachmentInfo
): Promise<MediaContext> {
  const client = getGemini();
  const mimeType = attachment.mimeType || 'audio/ogg';

  const prompt = `Transcribe this audio completely. Then provide:
1. Full transcription
2. Summary of main points
3. Any action items or questions mentioned
4. Speaker identification if multiple voices

Format the transcription clearly.`;

  try {
    const response = await client.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: [{
        role: 'user',
        parts: [
          { inlineData: { mimeType: mimeType as string, data: buffer.toString('base64') } },
          { text: prompt },
        ],
      }],
    });

    return {
      type: 'audio',
      description: response.text || 'Audio processed but no transcription generated.',
      metadata: { duration: attachment.duration, mimeType },
      processingTime: 0,
    };
  } catch (error) {
    logger.error('Gemini audio processing failed', { error });
    return {
      type: 'audio',
      description: `Voice message received (${formatDuration(attachment.duration || 0)}). Transcription failed.`,
      metadata: { duration: attachment.duration },
      processingTime: 0,
    };
  }
}

/**
 * Process video with Gemini
 */
export async function processVideo(
  buffer: Buffer,
  attachment: AttachmentInfo
): Promise<MediaContext> {
  const client = getGemini();
  const mimeType = attachment.mimeType || 'video/mp4';

  const prompt = `Analyze this video:
1. Describe the main content and action
2. Transcribe any speech or text shown
3. Note key moments or information
4. Identify any people, places, or objects of interest

Be comprehensive but concise.`;

  try {
    const response = await client.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: [{
        role: 'user',
        parts: [
          { inlineData: { mimeType: mimeType as string, data: buffer.toString('base64') } },
          { text: prompt },
        ],
      }],
    });

    return {
      type: 'video',
      description: response.text || 'Video processed but no analysis generated.',
      metadata: { duration: attachment.duration, width: attachment.width, height: attachment.height, mimeType },
      processingTime: 0,
    };
  } catch (error) {
    logger.error('Gemini video processing failed', { error });
    return {
      type: 'video',
      description: `Video received (${formatDuration(attachment.duration || 0)}). Analysis failed - video may be too large.`,
      metadata: { duration: attachment.duration, width: attachment.width, height: attachment.height },
      processingTime: 0,
    };
  }
}

// ─── Analysis Content Builder ───────────────────────────

/**
 * Build context injection for Claude based on media processing
 */
export function buildMediaContext(media: MediaContext, attachment: AttachmentInfo): string {
  let context = `\n\n[MEDIA ANALYSIS - ${media.type.toUpperCase()}]\n`;

  if (media.type === 'image') {
    context += `Image (${attachment.width}x${attachment.height})\n`;
  } else if (media.type === 'document') {
    context += `Document: ${attachment.fileName || 'unknown'}\n`;
  } else if (media.type === 'audio') {
    context += `Audio (${formatDuration(attachment.duration || 0)})\n`;
  } else if (media.type === 'video') {
    context += `Video (${formatDuration(attachment.duration || 0)})\n`;
  }

  context += '\n--- Gemini Analysis ---\n';
  context += media.description;

  if (media.extractedText) {
    context += '\n\n--- Extracted Text ---\n';
    context += media.extractedText;
  }

  if (attachment.caption) {
    context += `\n\n--- User Caption ---\n"${attachment.caption}"`;
  }

  context += '\n[END MEDIA ANALYSIS]\n';
  context += '\nRespond to the user based on this media. If they haven\'t specified what to do, briefly acknowledge what you see and ask how you can help.';

  return context;
}

/**
 * Extract structured analysis content from MediaContext for Notion page body.
 * Transforms Gemini's raw analysis into actionable, pillar-framed content.
 */
export function buildAnalysisContent(
  media: MediaContext,
  attachment: AttachmentInfo,
  pillar: Pillar
): {
  summary: string;
  fullText?: string;
  keyPoints?: string[];
  suggestedActions?: string[];
  metadata: Record<string, string>;
} {
  const keyPoints = extractKeyPoints(media.description);
  const suggestedActions = generateSuggestedActions(media, pillar, keyPoints);
  const summary = buildPillarFramedSummary(media, pillar, attachment);

  return {
    summary,
    fullText: media.extractedText || undefined,
    keyPoints: keyPoints.length > 0 ? keyPoints : undefined,
    suggestedActions: suggestedActions.length > 0 ? suggestedActions : undefined,
    metadata: {
      'Media Type': media.type,
      'Source': attachment.fileName || attachment.type,
      'Size': attachment.fileSize ? formatFileSize(attachment.fileSize) : 'Unknown',
      'Pillar': pillar,
      'Processing Time': `${media.processingTime}ms`,
      ...(attachment.width && attachment.height && {
        'Dimensions': `${attachment.width}x${attachment.height}`,
      }),
      ...(attachment.duration && {
        'Duration': formatDuration(attachment.duration),
      }),
      ...(media.archivedPath && {
        'Archived': media.archivedPath,
      }),
    },
  };
}

/**
 * Extract key points from Gemini's analysis
 */
function extractKeyPoints(description: string): string[] {
  const points: string[] = [];

  const numberedMatches = description.match(/^\d+[.)]\s*(.+)$/gm);
  if (numberedMatches) {
    points.push(...numberedMatches.map(m => m.replace(/^\d+[.)]\s*/, '').trim()));
  }

  const bulletMatches = description.match(/^[-*]\s+(.+)$/gm);
  if (bulletMatches) {
    points.push(...bulletMatches.map(m => m.replace(/^[-*]\s+/, '').trim()));
  }

  if (points.length === 0) {
    const sentences = description.split(/[.!?]+/).filter(s => s.trim().length > 20);
    points.push(...sentences.slice(0, 5).map(s => s.trim()));
  }

  return [...new Set(points)].slice(0, 8);
}

/**
 * Generate suggested actions based on media type and pillar
 */
function generateSuggestedActions(
  media: MediaContext,
  pillar: Pillar,
  _keyPoints: string[]
): string[] {
  const actions: string[] = [];

  const pillarFrames: Record<Pillar, string[]> = {
    'Personal': [
      'Review for personal insights or learning opportunities',
      'Consider how this relates to health/wellness goals',
      'Archive for future reference in personal growth',
    ],
    'The Grove': [
      'Analyze for potential Grove content or research',
      'Consider implications for AI/architecture work',
      'Extract patterns for technical documentation',
    ],
    'Consulting': [
      'Review for client deliverable opportunities',
      'Consider relevance to active consulting projects',
      'Identify actionable items for client work',
    ],
    'Home/Garage': [
      'Review for project planning or reference',
      'Consider impact on home/garage projects',
      'Archive for future project documentation',
    ],
  };

  const pillarActions = pillarFrames[pillar] || pillarFrames['The Grove'];

  if (media.type === 'image') {
    if (media.description.toLowerCase().includes('text') ||
        media.description.toLowerCase().includes('ocr')) {
      actions.push('Extract and organize OCR text for reference');
    }
    if (media.description.toLowerCase().includes('receipt') ||
        media.description.toLowerCase().includes('invoice')) {
      actions.push('Log expense or financial item');
    }
    if (media.description.toLowerCase().includes('screenshot')) {
      actions.push('Review UI/interface for potential improvements');
    }
  } else if (media.type === 'document') {
    actions.push('Review document content and extract key information');
    if (media.description.toLowerCase().includes('contract') ||
        media.description.toLowerCase().includes('agreement')) {
      actions.push('Flag for legal review or action items');
    }
  } else if (media.type === 'audio' || media.type === 'video') {
    actions.push('Review transcription for action items');
    if (media.description.toLowerCase().includes('meeting') ||
        media.description.toLowerCase().includes('call')) {
      actions.push('Extract meeting notes and follow-ups');
    }
  }

  actions.push(pillarActions[0]);

  return [...new Set(actions)].slice(0, 5);
}

/**
 * Build a professional summary framed for the pillar context
 */
function buildPillarFramedSummary(
  media: MediaContext,
  pillar: Pillar,
  attachment: AttachmentInfo
): string {
  const pillarContext: Record<Pillar, string> = {
    'Personal': 'personal development context',
    'The Grove': 'Grove AI venture context',
    'Consulting': 'consulting/client work context',
    'Home/Garage': 'home improvement context',
  };

  const context = pillarContext[pillar] || 'general context';
  const firstParagraph = media.description.split('\n\n')[0] || media.description;
  const truncated = firstParagraph.length > 300
    ? firstParagraph.slice(0, 300) + '...'
    : firstParagraph;

  const typeLabel = media.type.charAt(0).toUpperCase() + media.type.slice(1);
  const fileName = attachment.fileName ? ` (${attachment.fileName})` : '';

  return `${typeLabel}${fileName} received and analyzed in ${context}. ${truncated}`;
}

// ─── Helpers ────────────────────────────────────────────

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export function getExtension(attachment: AttachmentInfo): string {
  if (attachment.fileName) {
    const parts = attachment.fileName.split('.');
    if (parts.length > 1) return parts.pop()!;
  }

  const mimeMap: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'audio/ogg': 'ogg',
    'audio/mpeg': 'mp3',
    'video/mp4': 'mp4',
    'application/pdf': 'pdf',
    'text/plain': 'txt',
  };

  return mimeMap[attachment.mimeType || ''] || '';
}
