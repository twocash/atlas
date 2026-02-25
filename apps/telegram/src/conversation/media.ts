/**
 * Atlas Telegram Bot - Media Surface Adapter
 *
 * Thin wrapper over the surface-agnostic media processor.
 * Handles Telegram-specific concerns: file download via Bot API,
 * local archiving, Feed 2.0 logging, and temp file lifecycle.
 *
 * Cognitive processing (Gemini vision/audio/document analysis)
 * lives in @atlas/agents/src/media/processor.ts.
 *
 * @module conversation/media
 * Sprint: ARCH-CPE-001 Phase 4 — surface adapter rewrite
 */

import type { Context } from 'grammy';
import { writeFile, mkdir, unlink, readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../logger';
import type { AttachmentInfo } from '@atlas/agents/src/conversation/attachments';
import {
  analyzeMedia,
  formatFileSize,
  formatDuration,
  getExtension,
} from '@atlas/agents/src/media/processor';

// Re-export types and functions from processor for consumers
export type { MediaContext, Pillar } from '@atlas/agents/src/media/processor';
export { buildMediaContext, buildAnalysisContent, formatDuration, formatFileSize, getExtension } from '@atlas/agents/src/media/processor';

// Import types locally for use in this file
import type { MediaContext, Pillar } from '@atlas/agents/src/media/processor';

// Notion client for Feed 2.0
import { Client } from '@notionhq/client';
import { NOTION_DB } from '@atlas/shared/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ─── Local Constants ────────────────────────────────────

// Temp directory for processing
const TEMP_DIR = join(__dirname, '../../data/temp/media');

// Retention directory organized by pillar
const MEDIA_ARCHIVE = join(__dirname, '../../data/media');

// Retention period in days (default 30)
const RETENTION_DAYS = 30;

// ─── Notion Client ──────────────────────────────────────

let notionClient: Client | null = null;

function getNotion(): Client {
  if (!notionClient) {
    notionClient = new Client({ auth: process.env.NOTION_API_KEY });
  }
  return notionClient;
}

// Feed 2.0 database ID (from @atlas/shared/config)
const FEED_DB_ID = NOTION_DB.FEED;

// ─── Surface-Specific Functions ─────────────────────────

/**
 * Process an attachment and return context for Claude.
 * Downloads file from Telegram, delegates cognitive processing to
 * the surface-agnostic processor, then archives + logs to Feed.
 *
 * @param ctx - Grammy context (Telegram surface)
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

    // Delegate to surface-agnostic processor
    let result = await analyzeMedia(buffer, attachment, localPath);

    // Archive + Feed (surface-specific)
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
