/**
 * Atlas Telegram Bot - Media Processor
 *
 * Downloads attachments from Telegram and processes them with Gemini
 * for visual/document understanding. Injects context back to Claude.
 */

import type { Context, Api, RawApi } from 'grammy';
import { GoogleGenAI } from '@google/genai';
import { readFile, writeFile, mkdir, unlink } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../logger';
import type { AttachmentInfo } from './attachments';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Temp directory for processing
const TEMP_DIR = join(__dirname, '../../data/temp/media');

// Retention directory organized by pillar
const MEDIA_ARCHIVE = join(__dirname, '../../data/media');

// Retention period in days (default 30)
const RETENTION_DAYS = 30;

// Initialize Gemini client
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

// Notion client for Feed 2.0
import { Client } from '@notionhq/client';
import { NOTION_DB } from '@atlas/shared/config';

let notionClient: Client | null = null;

function getNotion(): Client {
  if (!notionClient) {
    notionClient = new Client({ auth: process.env.NOTION_API_KEY });
  }
  return notionClient;
}

// Feed 2.0 database ID (from @atlas/shared/config)
const FEED_DB_ID = NOTION_DB.FEED;

/**
 * Log media to Feed 2.0 in Notion
 */
async function logMediaToFeed(
  attachment: AttachmentInfo,
  result: MediaContext,
  pillar: Pillar
): Promise<string | null> {
  // Defensive default for pillar (classification may return null)
  const safePillar = pillar || 'The Grove';

  try {
    const notion = getNotion();

    // Build entry title
    const title = attachment.type === 'document' && attachment.fileName
      ? `Media: ${attachment.fileName}`
      : `Media: ${attachment.type} (${result.type})`;

    // Build description with Gemini analysis summary
    const descriptionParts: string[] = [];

    // Basic info
    descriptionParts.push(`Type: ${attachment.type}`);
    if (attachment.fileName) descriptionParts.push(`File: ${attachment.fileName}`);
    if (attachment.mimeType) descriptionParts.push(`Format: ${attachment.mimeType}`);
    if (attachment.fileSize) descriptionParts.push(`Size: ${formatFileSize(attachment.fileSize)}`);
    if (attachment.width && attachment.height) {
      descriptionParts.push(`Dimensions: ${attachment.width}x${attachment.height}`);
    }
    if (attachment.duration) {
      descriptionParts.push(`Duration: ${formatDuration(attachment.duration)}`);
    }

    descriptionParts.push('');
    descriptionParts.push('--- Gemini Analysis ---');
    // Truncate analysis for Feed (keep it concise)
    const analysisPreview = result.description.slice(0, 500);
    descriptionParts.push(analysisPreview);
    if (result.description.length > 500) {
      descriptionParts.push('...[truncated]');
    }

    if (result.archivedPath) {
      descriptionParts.push('');
      descriptionParts.push(`Archived: ${result.archivedPath}`);
    }

    const response = await notion.pages.create({
      parent: { database_id: FEED_DB_ID },
      properties: {
        Entry: {
          title: [{ text: { content: title.slice(0, 100) } }],
        },
        Pillar: {
          select: { name: safePillar },
        },
        Source: {
          select: { name: 'Telegram' },
        },
        Author: {
          select: { name: 'Jim' },
        },
        Status: {
          select: { name: 'Received' },
        },
        Notes: {
          rich_text: [{ text: { content: descriptionParts.join('\n').slice(0, 2000) } }],
        },
      },
    });

    // Get URL from response
    const url = (response as { url?: string }).url || '';

    logger.info('Media logged to Feed 2.0', { title, pillar: safePillar, url });
    return url;

  } catch (error) {
    logger.error('Failed to log media to Feed', { error });
    return null;
  }
}

// MIME type mappings for Gemini
const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const DOCUMENT_MIMES = ['application/pdf', 'text/plain', 'text/csv', 'text/markdown'];
const AUDIO_MIMES = ['audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/wav'];

export interface MediaContext {
  type: 'image' | 'document' | 'audio' | 'video' | 'unknown';
  description: string;
  extractedText?: string;
  metadata?: Record<string, unknown>;
  processingTime: number;
  archivedPath?: string;  // Where the file is retained
}

export type Pillar = 'Personal' | 'The Grove' | 'Consulting' | 'Home/Garage';

/**
 * Archive media to pillar-organized storage
 */
async function archiveMedia(
  buffer: Buffer,
  attachment: AttachmentInfo,
  pillar: Pillar = 'The Grove'
): Promise<string> {
  // Sanitize pillar name for filesystem
  const pillarDir = pillar.toLowerCase().replace(/[^a-z0-9]/g, '-');
  const archiveDir = join(MEDIA_ARCHIVE, pillarDir);

  await mkdir(archiveDir, { recursive: true });

  // Build filename: date_type_originalname
  const date = new Date().toISOString().split('T')[0];
  const ext = getExtension(attachment);
  const baseName = attachment.fileName?.replace(/[^a-zA-Z0-9.-]/g, '_') || attachment.type;
  const filename = `${date}_${attachment.type}_${baseName}${ext ? '.' + ext : ''}`;

  const archivePath = join(archiveDir, filename);
  await writeFile(archivePath, buffer);

  // Write metadata sidecar
  const metaPath = archivePath + '.json';
  await writeFile(metaPath, JSON.stringify({
    originalName: attachment.fileName,
    type: attachment.type,
    mimeType: attachment.mimeType,
    size: attachment.fileSize,
    pillar,
    archivedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString(),
    caption: attachment.caption,
    dimensions: attachment.width ? `${attachment.width}x${attachment.height}` : undefined,
    duration: attachment.duration,
  }, null, 2));

  logger.info('Media archived', { path: archivePath, pillar });

  return archivePath;
}

/**
 * Get file extension from attachment
 */
function getExtension(attachment: AttachmentInfo): string {
  if (attachment.fileName) {
    const parts = attachment.fileName.split('.');
    if (parts.length > 1) return parts.pop()!;
  }

  // Infer from mime type
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

/**
 * Clean up expired media files
 */
export async function cleanupExpiredMedia(): Promise<{ deleted: number; errors: number }> {
  const { readdir, stat, unlink } = await import('fs/promises');
  let deleted = 0;
  let errors = 0;

  try {
    const pillars = await readdir(MEDIA_ARCHIVE);

    for (const pillarDir of pillars) {
      const pillarPath = join(MEDIA_ARCHIVE, pillarDir);
      const pillarStat = await stat(pillarPath);
      if (!pillarStat.isDirectory()) continue;

      const files = await readdir(pillarPath);

      for (const file of files) {
        if (!file.endsWith('.json')) continue;

        const metaPath = join(pillarPath, file);
        try {
          const metaContent = await readFile(metaPath, 'utf-8');
          const meta = JSON.parse(metaContent);

          if (meta.expiresAt && new Date(meta.expiresAt) < new Date()) {
            // Delete media file and metadata
            const mediaPath = metaPath.replace('.json', '');
            try {
              await unlink(mediaPath);
              await unlink(metaPath);
              deleted++;
              logger.info('Expired media deleted', { path: mediaPath });
            } catch {
              errors++;
            }
          }
        } catch {
          errors++;
        }
      }
    }
  } catch (err) {
    logger.error('Media cleanup failed', { error: err });
  }

  return { deleted, errors };
}

/**
 * List archived media by pillar
 */
export async function listArchivedMedia(pillar?: Pillar): Promise<Array<{
  path: string;
  pillar: string;
  type: string;
  archivedAt: string;
  originalName?: string;
}>> {
  const { readdir, stat } = await import('fs/promises');
  const results: Array<{
    path: string;
    pillar: string;
    type: string;
    archivedAt: string;
    originalName?: string;
  }> = [];

  try {
    const pillars = pillar
      ? [pillar.toLowerCase().replace(/[^a-z0-9]/g, '-')]
      : await readdir(MEDIA_ARCHIVE);

    for (const pillarDir of pillars) {
      const pillarPath = join(MEDIA_ARCHIVE, pillarDir);

      try {
        const pillarStat = await stat(pillarPath);
        if (!pillarStat.isDirectory()) continue;

        const files = await readdir(pillarPath);

        for (const file of files) {
          if (!file.endsWith('.json')) continue;

          try {
            const metaPath = join(pillarPath, file);
            const metaContent = await readFile(metaPath, 'utf-8');
            const meta = JSON.parse(metaContent);

            results.push({
              path: metaPath.replace('.json', ''),
              pillar: meta.pillar || pillarDir,
              type: meta.type,
              archivedAt: meta.archivedAt,
              originalName: meta.originalName,
            });
          } catch {
            // Skip invalid metadata
          }
        }
      } catch {
        // Pillar dir doesn't exist
      }
    }
  } catch {
    // Archive dir doesn't exist
  }

  return results.sort((a, b) => new Date(b.archivedAt).getTime() - new Date(a.archivedAt).getTime());
}

/**
 * Process an attachment and return context for Claude
 * @param ctx - Grammy context
 * @param attachment - Attachment info from detectAttachment
 * @param pillar - Which pillar to archive under (defaults to The Grove)
 */
export async function processMedia(
  ctx: Context,
  attachment: AttachmentInfo,
  pillar: Pillar = 'The Grove'
): Promise<MediaContext | null> {
  if (attachment.type === 'none' || !attachment.fileId) {
    return null;
  }

  const startTime = Date.now();

  try {
    // Ensure temp directory exists
    await mkdir(TEMP_DIR, { recursive: true });

    // Download file from Telegram
    const file = await ctx.api.getFile(attachment.fileId);
    const filePath = file.file_path;

    if (!filePath) {
      logger.warn('No file path returned from Telegram');
      return null;
    }

    // Construct download URL
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      throw new Error('TELEGRAM_BOT_TOKEN required for file downloads');
    }

    const downloadUrl = `https://api.telegram.org/file/bot${botToken}/${filePath}`;

    // Download the file
    const response = await fetch(downloadUrl);
    if (!response.ok) {
      throw new Error(`Failed to download file: ${response.statusText}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const localPath = join(TEMP_DIR, `${attachment.fileId}_${Date.now()}`);
    await writeFile(localPath, buffer);

    logger.info('File downloaded', {
      type: attachment.type,
      size: buffer.length,
      mime: attachment.mimeType,
    });

    // Process based on type
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

    // Archive the file (organized by pillar)
    try {
      const archivedPath = await archiveMedia(buffer, attachment, pillar);
      result.archivedPath = archivedPath;

      // Log to Feed 2.0
      await logMediaToFeed(attachment, result, pillar);
    } catch (archiveError) {
      logger.error('Media archiving failed', { error: archiveError });
      // Continue without archiving - processing still succeeded
    }

    // Cleanup temp file
    try {
      await unlink(localPath);
    } catch {
      // Ignore cleanup errors
    }

    result.processingTime = Date.now() - startTime;
    return result;

  } catch (error) {
    logger.error('Media processing failed', { error, type: attachment.type });
    return {
      type: 'unknown',
      description: `Failed to process ${attachment.type}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      processingTime: Date.now() - startTime,
    };
  }
}

/**
 * Process image with Gemini Vision
 */
async function processImage(
  buffer: Buffer,
  attachment: AttachmentInfo
): Promise<MediaContext> {
  const client = getGemini();

  // Determine MIME type (default to jpeg for photos)
  const mimeType = attachment.mimeType || 'image/jpeg';

  // Build contextual prompt based on caption
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
      contents: [
        {
          role: 'user',
          parts: [
            {
              inlineData: {
                mimeType: mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
                data: buffer.toString('base64'),
              },
            },
            { text: prompt },
          ],
        },
      ],
    });

    const description = response.text || 'Image processed but no description generated.';

    return {
      type: 'image',
      description,
      metadata: {
        width: attachment.width,
        height: attachment.height,
        mimeType,
      },
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
 * Process document (PDF, text, etc.)
 */
async function processDocument(
  buffer: Buffer,
  attachment: AttachmentInfo,
  localPath: string
): Promise<MediaContext> {
  const mimeType = attachment.mimeType || 'application/octet-stream';

  // For PDFs, try Gemini directly (it can handle PDFs)
  if (mimeType === 'application/pdf') {
    return await processPdfWithGemini(buffer, attachment);
  }

  // For text files, read content directly
  if (mimeType.startsWith('text/') ||
      attachment.fileName?.endsWith('.txt') ||
      attachment.fileName?.endsWith('.md') ||
      attachment.fileName?.endsWith('.csv') ||
      attachment.fileName?.endsWith('.json')) {
    const content = buffer.toString('utf-8');
    return {
      type: 'document',
      description: `Text document: ${attachment.fileName}`,
      extractedText: content.slice(0, 10000), // Limit for context
      metadata: {
        fileName: attachment.fileName,
        mimeType,
        fileSize: attachment.fileSize,
        truncated: content.length > 10000,
      },
      processingTime: 0,
    };
  }

  // For image files sent as documents (PNG, JPG, etc.), use Gemini Vision
  if (mimeType.startsWith('image/') ||
      attachment.fileName?.toLowerCase().endsWith('.png') ||
      attachment.fileName?.toLowerCase().endsWith('.jpg') ||
      attachment.fileName?.toLowerCase().endsWith('.jpeg') ||
      attachment.fileName?.toLowerCase().endsWith('.gif') ||
      attachment.fileName?.toLowerCase().endsWith('.webp')) {
    logger.info('Document is an image, routing to Gemini Vision', {
      fileName: attachment.fileName,
      mimeType,
    });
    return await processImageDocument(buffer, attachment, mimeType);
  }

  // For other documents (docx, xlsx, etc.), describe what we received
  // These need specialized parsers that we don't have yet
  return {
    type: 'document',
    description: `Document received: ${attachment.fileName} (${formatFileSize(attachment.fileSize || 0)}). Format: ${mimeType}. This file format requires manual review - download to analyze.`,
    metadata: {
      fileName: attachment.fileName,
      mimeType,
      fileSize: attachment.fileSize,
    },
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

  // Normalize MIME type for Gemini
  const geminiMimeType = mimeType.startsWith('image/')
    ? mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'
    : 'image/png'; // Default to PNG for unknown image types

  // Build contextual prompt
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
      contents: [
        {
          role: 'user',
          parts: [
            {
              inlineData: {
                mimeType: geminiMimeType,
                data: buffer.toString('base64'),
              },
            },
            { text: prompt },
          ],
        },
      ],
    });

    const description = response.text || 'Image document processed but no description generated.';

    logger.info('Image document analyzed with Gemini', {
      fileName: attachment.fileName,
      descriptionLength: description.length,
    });

    return {
      type: 'document', // Keep as document type since that's how it was sent
      description,
      metadata: {
        fileName: attachment.fileName,
        mimeType,
        fileSize: attachment.fileSize,
        analyzedAsImage: true,
      },
      processingTime: 0,
    };
  } catch (error) {
    logger.error('Gemini image document processing failed', { error, fileName: attachment.fileName });
    return {
      type: 'document',
      description: `Image document received: ${attachment.fileName} (${formatFileSize(attachment.fileSize || 0)}). Vision analysis failed - please try again or download to review manually.`,
      metadata: {
        fileName: attachment.fileName,
        mimeType,
        fileSize: attachment.fileSize,
      },
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
      contents: [
        {
          role: 'user',
          parts: [
            {
              inlineData: {
                mimeType: 'application/pdf',
                data: buffer.toString('base64'),
              },
            },
            { text: prompt },
          ],
        },
      ],
    });

    const description = response.text || 'PDF processed but no content extracted.';

    return {
      type: 'document',
      description,
      metadata: {
        fileName: attachment.fileName,
        mimeType: 'application/pdf',
        fileSize: attachment.fileSize,
      },
      processingTime: 0,
    };
  } catch (error) {
    logger.error('Gemini PDF processing failed', { error });

    // Fallback to pdf-parse
    try {
      const pdfParse = await import('pdf-parse');
      const pdfData = await pdfParse.default(buffer);
      return {
        type: 'document',
        description: `PDF: ${attachment.fileName} (${pdfData.numpages} pages)`,
        extractedText: pdfData.text.slice(0, 10000),
        metadata: {
          fileName: attachment.fileName,
          pages: pdfData.numpages,
          truncated: pdfData.text.length > 10000,
        },
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
async function processAudio(
  buffer: Buffer,
  attachment: AttachmentInfo
): Promise<MediaContext> {
  const client = getGemini();

  // Gemini supports audio transcription
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
      contents: [
        {
          role: 'user',
          parts: [
            {
              inlineData: {
                mimeType: mimeType as string,
                data: buffer.toString('base64'),
              },
            },
            { text: prompt },
          ],
        },
      ],
    });

    const transcription = response.text || 'Audio processed but no transcription generated.';

    return {
      type: 'audio',
      description: transcription,
      metadata: {
        duration: attachment.duration,
        mimeType,
      },
      processingTime: 0,
    };
  } catch (error) {
    logger.error('Gemini audio processing failed', { error });
    return {
      type: 'audio',
      description: `Voice message received (${formatDuration(attachment.duration || 0)}). Transcription failed.`,
      metadata: {
        duration: attachment.duration,
      },
      processingTime: 0,
    };
  }
}

/**
 * Process video (extract key frames)
 */
async function processVideo(
  buffer: Buffer,
  attachment: AttachmentInfo
): Promise<MediaContext> {
  // For short videos, Gemini can process them
  // For longer videos, we'd need to extract frames

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
      contents: [
        {
          role: 'user',
          parts: [
            {
              inlineData: {
                mimeType: mimeType as string,
                data: buffer.toString('base64'),
              },
            },
            { text: prompt },
          ],
        },
      ],
    });

    const description = response.text || 'Video processed but no analysis generated.';

    return {
      type: 'video',
      description,
      metadata: {
        duration: attachment.duration,
        width: attachment.width,
        height: attachment.height,
        mimeType,
      },
      processingTime: 0,
    };
  } catch (error) {
    logger.error('Gemini video processing failed', { error });
    return {
      type: 'video',
      description: `Video received (${formatDuration(attachment.duration || 0)}). Analysis failed - video may be too large.`,
      metadata: {
        duration: attachment.duration,
        width: attachment.width,
        height: attachment.height,
      },
      processingTime: 0,
    };
  }
}

/**
 * Build context injection for Claude based on media processing
 */
export function buildMediaContext(media: MediaContext, attachment: AttachmentInfo): string {
  let context = `\n\n[MEDIA ANALYSIS - ${media.type.toUpperCase()}]\n`;

  // Add metadata summary
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
 * Extract structured analysis content from MediaContext for Notion page body
 * This transforms Gemini's raw analysis into actionable, pillar-framed content
 */
export function buildAnalysisContent(
  media: MediaContext,
  attachment: AttachmentInfo,
  pillar: Pillar
): NonNullable<import('./audit').AuditEntry['analysisContent']> {
  // Extract key points from Gemini's description
  // Look for numbered lists, bullet points, or sentence patterns
  const keyPoints = extractKeyPoints(media.description);

  // Generate pillar-framed suggested actions
  const suggestedActions = generateSuggestedActions(media, pillar, keyPoints);

  // Build professional summary framed for the pillar
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

  // Match numbered lists (1. 2. 3.)
  const numberedMatches = description.match(/^\d+[.)]\s*(.+)$/gm);
  if (numberedMatches) {
    points.push(...numberedMatches.map(m => m.replace(/^\d+[.)]\s*/, '').trim()));
  }

  // Match bullet points (- or *)
  const bulletMatches = description.match(/^[-*]\s+(.+)$/gm);
  if (bulletMatches) {
    points.push(...bulletMatches.map(m => m.replace(/^[-*]\s+/, '').trim()));
  }

  // If no structured points found, extract sentences that look actionable
  if (points.length === 0) {
    const sentences = description.split(/[.!?]+/).filter(s => s.trim().length > 20);
    // Take first 5 meaningful sentences as key points
    points.push(...sentences.slice(0, 5).map(s => s.trim()));
  }

  // Dedupe and limit
  return [...new Set(points)].slice(0, 8);
}

/**
 * Generate suggested actions based on media type and pillar
 */
function generateSuggestedActions(
  media: MediaContext,
  pillar: Pillar,
  _keyPoints: string[]  // Reserved for future use: semantic action generation from key points
): string[] {
  const actions: string[] = [];

  // Pillar-specific action framing
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

  // Add pillar-specific actions
  const pillarActions = pillarFrames[pillar] || pillarFrames['The Grove'];

  // Media type specific actions
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

  // Add general pillar action
  actions.push(pillarActions[0]);

  // Dedupe and limit
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

  // Build summary from first substantial paragraph of description
  const firstParagraph = media.description.split('\n\n')[0] || media.description;
  const truncated = firstParagraph.length > 300
    ? firstParagraph.slice(0, 300) + '...'
    : firstParagraph;

  // Frame it
  const typeLabel = media.type.charAt(0).toUpperCase() + media.type.slice(1);
  const fileName = attachment.fileName ? ` (${attachment.fileName})` : '';

  return `${typeLabel}${fileName} received and analyzed in ${context}. ${truncated}`;
}

// Helpers
function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
