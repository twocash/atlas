/**
 * Atlas Telegram Bot - Feed & Work Queue Audit
 *
 * Every message creates a Feed entry + Work Queue item with bidirectional linking.
 * This is the "Everything in Work Queue" philosophy.
 */

import { Client } from '@notionhq/client';
import { NOTION_DB } from '@atlas/shared/config';
import { reportFailure } from '@atlas/shared/error-escalation';
import type { TraceContext } from '@atlas/shared/trace';
import { logger } from '../logger';
import { checkUrl, registerUrl, normalizeUrl } from '../utils/url-dedup';
import type { Pillar, RequestType, FeedStatus, WQStatus, StructuredContext } from './types';

// Re-export Pillar for use by other modules
export type { Pillar };

// Initialize Notion client
const notion = new Client({ auth: process.env.NOTION_API_KEY });

// Canonical IDs from @atlas/shared/config
const FEED_DATABASE_ID = NOTION_DB.FEED;
const WORK_QUEUE_DATABASE_ID = NOTION_DB.WORK_QUEUE;

// Track Feed database health - if it's inaccessible, skip Feed logging
let feedDatabaseHealthy = true;
let lastFeedCheck = 0;
const FEED_CHECK_INTERVAL = 60000; // Re-check every 60 seconds

/**
 * Capitalize first letter (for Notion select option names)
 */
function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Strip Markdown formatting for Notion plain text
 * Notion rich_text doesn't render Markdown - it shows raw asterisks
 */
function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, '$1')     // Bold **text**
    .replace(/\*([^*]+)\*/g, '$1')          // Italic *text*
    .replace(/__([^_]+)__/g, '$1')          // Bold __text__
    .replace(/_([^_]+)_/g, '$1')            // Italic _text_
    .replace(/`([^`]+)`/g, '$1')            // Inline code `text`
    .replace(/```[\s\S]*?```/g, '')         // Code blocks
    .replace(/#+\s+/g, '')                  // Headers
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // Links [text](url)
    .replace(/<binary data[^>]*>/gi, '')    // Binary artifacts
    .replace(/\\([*_`#\[\]])/g, '$1')       // Escaped chars
    .trim();
}

/**
 * Clean and truncate text for Notion blocks
 * Notion has a 2000 char limit per rich_text block
 */
function prepareForNotion(text: string, maxLength: number = 2000): string {
  const cleaned = stripMarkdown(text);
  if (cleaned.length <= maxLength) return cleaned;
  return cleaned.substring(0, maxLength - 3) + '...';
}

/**
 * Verify database access on startup or after failures
 */
export async function verifyDatabaseAccess(): Promise<{
  feed: boolean;
  workQueue: boolean;
  details: string;
}> {
  const results = { feed: false, workQueue: false, details: '' };

  // Test Feed 2.0
  try {
    await notion.databases.retrieve({ database_id: FEED_DATABASE_ID });
    results.feed = true;
    feedDatabaseHealthy = true;
    logger.info('Feed 2.0 database accessible', { id: FEED_DATABASE_ID });
  } catch (error: any) {
    results.feed = false;
    feedDatabaseHealthy = false;
    logger.error('Feed 2.0 database NOT accessible', {
      id: FEED_DATABASE_ID,
      error: error?.message || String(error),
      code: error?.code
    });
  }

  // Test Work Queue 2.0
  try {
    await notion.databases.retrieve({ database_id: WORK_QUEUE_DATABASE_ID });
    results.workQueue = true;
    logger.info('Work Queue 2.0 database accessible', { id: WORK_QUEUE_DATABASE_ID });
  } catch (error: any) {
    results.workQueue = false;
    logger.error('Work Queue 2.0 database NOT accessible', {
      id: WORK_QUEUE_DATABASE_ID,
      error: error?.message || String(error),
      code: error?.code
    });
  }

  results.details = `Feed: ${results.feed ? '✓' : '✗'}, WorkQueue: ${results.workQueue ? '✓' : '✗'}`;
  lastFeedCheck = Date.now();

  return results;
}

export interface AuditEntry {
  // Core
  entry: string;           // Human-readable summary
  pillar: Pillar;
  requestType: RequestType;
  source: 'Telegram';
  author: string;          // Atlas [Telegram], Jim, etc.

  // Classification
  confidence: number;      // 0-1
  keywords: string[];
  workType?: string;       // 2-5 word description within pillar

  // Metadata
  userId: number;
  messageText: string;
  hasAttachment: boolean;
  attachmentType?: string;

  // Token tracking
  tokenCount?: number;

  // URL & Content Analysis (Universal Content Analysis)
  url?: string;                // Original source URL
  urlTitle?: string;           // Page/Post title
  urlDomain?: string;          // e.g., "threads.net", "github.com"
  urlDescription?: string;     // Meta description or post snippet
  contentAuthor?: string;      // Author/Handle for social media
  extractionMethod?: 'Fetch' | 'Browser' | 'Gemini';  // Capitalized to match Notion options

  // Context Injection: Structured payload for future re-analysis
  // Stores full extracted text/metadata for Progressive Learning
  contentPayload?: string;

  // Analysis Content: Rich analysis to write to Feed page body
  // This makes content searchable, referenceable, and actionable
  analysisContent?: {
    summary?: string;        // Brief summary of the content
    fullText?: string;       // OCR text, article body, transcript, etc.
    keyPoints?: string[];    // Extracted key points or insights
    suggestedActions?: string[];  // What could be done with this
    metadata?: Record<string, string>;  // Source, author, date, etc.
  };

  // Pattern Learning (Universal Content Analysis - Classify First)
  contentType?: 'image' | 'document' | 'url' | 'video' | 'audio';  // What was shared
  contentSource?: string;  // Domain or media subtype (threads.net, pdf, screenshot)
  classificationConfirmed?: boolean;  // Was this human-verified?
  classificationAdjusted?: boolean;   // Did user change the suggestion?
  originalSuggestion?: string;        // What Atlas initially suggested

  // Intent-First Structured Context (Phase 0)
  structuredContext?: StructuredContext;
}

export interface AuditResult {
  feedId: string;
  workQueueId: string;
  feedUrl: string;
  workQueueUrl: string;
}

/**
 * Determine initial status based on request type
 * Quick answers get closed immediately, substantive work enters the queue
 */
function determineInitialStatus(requestType: RequestType): { feedStatus: FeedStatus; wqStatus: WQStatus } {
  if (requestType === 'Chat' || requestType === 'Quick' || requestType === 'Answer') {
    // Instant resolution — logged for telemetry, immediately closed
    return { feedStatus: 'Done', wqStatus: 'Done' };
  }
  // Substantive work — enters the queue
  return { feedStatus: 'Routed', wqStatus: 'Captured' };
}

/**
 * Create Feed entry in Notion
 */
async function createFeedEntry(entry: AuditEntry, traceId?: string): Promise<{ id: string; url: string }> {
  const { feedStatus } = determineInitialStatus(entry.requestType);

  // Defensive default for pillar (classification may return null)
  const pillar = entry.pillar || 'The Grove';

  try {
    const response = await notion.pages.create({
      parent: { database_id: FEED_DATABASE_ID },
      properties: {
        'Entry': {
          title: [{ text: { content: entry.entry.substring(0, 100) } }],
        },
        'Pillar': {
          select: { name: pillar },
        },
        'Request Type': {
          select: { name: entry.requestType },
        },
        'Source': {
          select: { name: 'Telegram' },
        },
        'Author': {
          select: { name: entry.author },
        },
        'Confidence': {
          number: entry.confidence,
        },
        'Status': {
          select: { name: feedStatus },
        },
        'Date': {
          date: { start: new Date().toISOString() },
        },
        ...(entry.workType && {
          'Work Type': {
            rich_text: [{ text: { content: entry.workType } }],
          },
        }),
        ...(entry.tokenCount && {
          'Cost': {
            number: entry.tokenCount,
          },
        }),
        ...(entry.keywords.length > 0 && {
          'Keywords': {
            multi_select: entry.keywords.slice(0, 5).map(k => ({ name: k })),
          },
        }),
      },
    });

    // Use the actual URL from Notion API (includes workspace context)
    const url = (response as { url?: string }).url || '';
    if (!url) logger.warn('Notion response missing url field', { id: response.id });
    logger.debug('Feed entry created', { id: response.id, url });

    // Try to add optional fields (non-fatal if properties don't exist yet)
    // These are added in a separate update to prevent core entry creation from failing
    const optionalProps: Record<string, unknown> = {};

    // Pipeline trace ID for end-to-end diagnostics
    if (traceId) {
      optionalProps['Notes'] = { rich_text: [{ text: { content: `trace:${traceId}` } }] };
    }

    // URL & Content Analysis fields (Universal Content Analysis)
    // Store normalized URL for dedup matching
    if (entry.url) {
      optionalProps['Source URL'] = { url: normalizeUrl(entry.url) };
    }
    if (entry.urlTitle) {
      optionalProps['URL Title'] = { rich_text: [{ text: { content: entry.urlTitle.substring(0, 2000) } }] };
    }
    if (entry.urlDomain) {
      optionalProps['Domain'] = { rich_text: [{ text: { content: entry.urlDomain } }] };
    }
    if (entry.contentAuthor) {
      optionalProps['Content Author'] = { rich_text: [{ text: { content: entry.contentAuthor } }] };
    }
    if (entry.extractionMethod) {
      optionalProps['Extraction Method'] = { select: { name: entry.extractionMethod } };
    }
    if (entry.contentPayload) {
      optionalProps['Context Payload'] = { rich_text: [{ text: { content: entry.contentPayload.substring(0, 2000) } }] };
    }

    // Pattern Learning fields
    if (entry.contentType) {
      optionalProps['Content Type'] = { select: { name: entry.contentType } };
    }
    if (entry.contentSource) {
      optionalProps['Content Source'] = { rich_text: [{ text: { content: entry.contentSource } }] };
    }
    if (entry.classificationConfirmed !== undefined) {
      optionalProps['Classification Confirmed'] = { checkbox: entry.classificationConfirmed };
    }
    if (entry.classificationAdjusted !== undefined) {
      optionalProps['Classification Adjusted'] = { checkbox: entry.classificationAdjusted };
    }
    if (entry.originalSuggestion) {
      optionalProps['Original Suggestion'] = { rich_text: [{ text: { content: entry.originalSuggestion } }] };
    }

    // Intent-First Structured Context fields
    if (entry.structuredContext) {
      const ctx = entry.structuredContext;
      optionalProps['Intent'] = { select: { name: capitalize(ctx.intent) } };
      optionalProps['Depth'] = { select: { name: capitalize(ctx.depth) } };
      optionalProps['Audience'] = { select: { name: capitalize(ctx.audience) } };
      optionalProps['Source Type'] = { select: { name: capitalize(ctx.source_type) } };
      if (ctx.format) {
        optionalProps['Format'] = { select: { name: capitalize(ctx.format) } };
      }
    }

    // Update with optional fields if any exist
    if (Object.keys(optionalProps).length > 0) {
      try {
        await notion.pages.update({
          page_id: response.id,
          properties: optionalProps as Parameters<typeof notion.pages.update>[0]['properties'],
        });
        logger.debug('Optional fields added to Feed entry', { id: response.id, fieldCount: Object.keys(optionalProps).length });
      } catch (optionalError) {
        // Non-fatal: some optional properties may not exist in Notion schema
        // Core entry was created successfully, just log the warning
        logger.warn('Some optional Feed fields not added (properties may not exist in Notion)', {
          id: response.id,
          error: optionalError instanceof Error ? optionalError.message : String(optionalError),
          attemptedFields: Object.keys(optionalProps),
        });
      }
    }

    // Append analysis content to page body if provided
    if (entry.analysisContent) {
      await appendAnalysisToPage(response.id, entry.analysisContent, entry);
    }

    return { id: response.id, url };
  } catch (error) {
    logger.error('Failed to create Feed entry', { error, entry: entry.entry });
    reportFailure('feed-write', error, { entry: entry.entry });
    throw error;
  }
}

/**
 * Append analysis content to a Notion page as blocks
 *
 * This writes the analysis to the page body so it's:
 * - Searchable in Notion
 * - Referenceable for future conversations
 * - Actionable for pattern learning
 */
async function appendAnalysisToPage(
  pageId: string,
  analysis: NonNullable<AuditEntry['analysisContent']>,
  entry: AuditEntry
): Promise<void> {
  try {
    const blocks: Array<{
      object: 'block';
      type: string;
      [key: string]: unknown;
    }> = [];

    // Add a divider first
    blocks.push({
      object: 'block',
      type: 'divider',
      divider: {},
    });

    // Add analysis header
    blocks.push({
      object: 'block',
      type: 'heading_2',
      heading_2: {
        rich_text: [{ type: 'text', text: { content: 'Analysis' } }],
      },
    });

    // Add summary if present (strip markdown for Notion)
    if (analysis.summary) {
      blocks.push({
        object: 'block',
        type: 'callout',
        callout: {
          rich_text: [{ type: 'text', text: { content: prepareForNotion(analysis.summary) } }],
          icon: { type: 'emoji', emoji: '📋' },
        },
      });
    }

    // Add metadata section if present
    if (analysis.metadata && Object.keys(analysis.metadata).length > 0) {
      blocks.push({
        object: 'block',
        type: 'heading_3',
        heading_3: {
          rich_text: [{ type: 'text', text: { content: 'Source Info' } }],
        },
      });

      for (const [key, value] of Object.entries(analysis.metadata)) {
        if (value) {
          blocks.push({
            object: 'block',
            type: 'bulleted_list_item',
            bulleted_list_item: {
              rich_text: [{ type: 'text', text: { content: `${key}: ${value}` } }],
            },
          });
        }
      }
    }

    // Add key points if present
    if (analysis.keyPoints && analysis.keyPoints.length > 0) {
      blocks.push({
        object: 'block',
        type: 'heading_3',
        heading_3: {
          rich_text: [{ type: 'text', text: { content: 'Key Points' } }],
        },
      });

      for (const point of analysis.keyPoints) {
        blocks.push({
          object: 'block',
          type: 'bulleted_list_item',
          bulleted_list_item: {
            rich_text: [{ type: 'text', text: { content: stripMarkdown(point) } }],
          },
        });
      }
    }

    // Add suggested actions if present
    if (analysis.suggestedActions && analysis.suggestedActions.length > 0) {
      blocks.push({
        object: 'block',
        type: 'heading_3',
        heading_3: {
          rich_text: [{ type: 'text', text: { content: 'Suggested Actions' } }],
        },
      });

      for (const action of analysis.suggestedActions) {
        blocks.push({
          object: 'block',
          type: 'to_do',
          to_do: {
            rich_text: [{ type: 'text', text: { content: action } }],
            checked: false,
          },
        });
      }
    }

    // Add full text content if present (truncated to avoid API limits)
    if (analysis.fullText) {
      blocks.push({
        object: 'block',
        type: 'heading_3',
        heading_3: {
          rich_text: [{ type: 'text', text: { content: 'Content' } }],
        },
      });

      // Split into chunks if too long (Notion has 2000 char limit per block)
      const MAX_BLOCK_LENGTH = 1900;
      const chunks = splitTextIntoChunks(analysis.fullText, MAX_BLOCK_LENGTH);

      for (const chunk of chunks.slice(0, 10)) { // Max 10 blocks to avoid API limits
        blocks.push({
          object: 'block',
          type: 'paragraph',
          paragraph: {
            rich_text: [{ type: 'text', text: { content: chunk } }],
          },
        });
      }

      if (chunks.length > 10) {
        blocks.push({
          object: 'block',
          type: 'paragraph',
          paragraph: {
            rich_text: [{
              type: 'text',
              text: { content: `[... ${chunks.length - 10} more sections truncated ...]` },
              annotations: { italic: true, color: 'gray' },
            }],
          },
        });
      }
    }

    // Add source URL if present
    if (entry.url) {
      blocks.push({
        object: 'block',
        type: 'heading_3',
        heading_3: {
          rich_text: [{ type: 'text', text: { content: 'Source' } }],
        },
      });

      blocks.push({
        object: 'block',
        type: 'bookmark',
        bookmark: {
          url: entry.url,
        },
      });
    }

    // Append blocks to page
    if (blocks.length > 0) {
      await notion.blocks.children.append({
        block_id: pageId,
        children: blocks as Parameters<typeof notion.blocks.children.append>[0]['children'],
      });

      logger.info('Analysis content appended to Feed page', {
        pageId,
        blockCount: blocks.length,
        hasSummary: !!analysis.summary,
        hasFullText: !!analysis.fullText,
        keyPointCount: analysis.keyPoints?.length || 0,
      });
    }
  } catch (error) {
    // Non-fatal: page was created, just couldn't add analysis blocks
    logger.warn('Failed to append analysis to Feed page', {
      pageId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Split text into chunks of max length, trying to break at sentence boundaries
 */
function splitTextIntoChunks(text: string, maxLength: number): string[] {
  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    // Try to find a good break point (sentence end)
    let breakPoint = remaining.lastIndexOf('. ', maxLength);
    if (breakPoint === -1 || breakPoint < maxLength / 2) {
      breakPoint = remaining.lastIndexOf(' ', maxLength);
    }
    if (breakPoint === -1) {
      breakPoint = maxLength;
    }

    chunks.push(remaining.substring(0, breakPoint + 1).trim());
    remaining = remaining.substring(breakPoint + 1).trim();
  }

  return chunks;
}

/**
 * Create Work Queue entry in Notion with link back to Feed
 * Includes source URL if available for quick reference
 */
async function createWorkQueueEntry(
  entry: AuditEntry,
  feedId: string,
  traceId?: string
): Promise<{ id: string; url: string }> {
  const { wqStatus } = determineInitialStatus(entry.requestType);

  // Defensive default for pillar (classification may return null)
  const pillar = entry.pillar || 'The Grove';

  // Map request type to work queue type
  const typeMap: Record<RequestType, string> = {
    'Research': 'Research',
    'Draft': 'Draft',
    'Build': 'Build',
    'Schedule': 'Schedule',
    'Answer': 'Answer',
    'Process': 'Process',
    'Quick': 'Answer',
    'Triage': 'Process',
    'Chat': 'Answer',
  };

  const wqType = typeMap[entry.requestType] || 'Answer';

  try {
    const response = await notion.pages.create({
      parent: { database_id: WORK_QUEUE_DATABASE_ID },
      properties: {
        'Task': {
          title: [{ text: { content: entry.entry.substring(0, 100) } }],
        },
        'Type': {
          select: { name: wqType },
        },
        'Status': {
          select: { name: wqStatus },
        },
        'Priority': {
          select: { name: 'P2' }, // Default, can be upgraded
        },
        'Pillar': {
          select: { name: pillar },
        },
        'Assignee': {
          select: { name: 'Atlas [Telegram]' },
        },
        'Feed Source': {
          relation: [{ id: feedId }],
        },
        'Queued': {
          date: { start: new Date().toISOString().split('T')[0] },
        },
        ...(wqStatus === 'Done' && {
          'Completed': {
            date: { start: new Date().toISOString().split('T')[0] },
          },
        }),
        ...(entry.workType && {
          'Work Type': {
            rich_text: [{ text: { content: entry.workType } }],
          },
        }),
        // Source Link for quick access to original URL (normalized, no tracking params)
        ...(entry.url && {
          'Source Link': { url: normalizeUrl(entry.url) },
        }),
        // Pipeline trace ID for end-to-end diagnostics
        ...(traceId && {
          'Notes': { rich_text: [{ text: { content: `trace:${traceId}` } }] },
        }),
      },
    });

    // Use the actual URL from Notion API (includes workspace context)
    const url = (response as { url?: string }).url || '';
    if (!url) logger.warn('Notion response missing url field', { id: response.id });
    logger.debug('Work Queue entry created', { id: response.id, feedId, url });

    // Append analysis content to Work Queue page body if provided
    // This makes the task actionable with full context
    if (entry.analysisContent) {
      await appendAnalysisToWorkQueue(response.id, entry.analysisContent, entry);
    }

    return { id: response.id, url };
  } catch (error) {
    logger.error('Failed to create Work Queue entry', { error, entry: entry.entry });
    reportFailure('work-queue-write', error, { entry: entry.entry });
    throw error;
  }
}

/**
 * Append analysis content to a Work Queue page
 *
 * Focused on actionable context for task execution
 */
async function appendAnalysisToWorkQueue(
  pageId: string,
  analysis: NonNullable<AuditEntry['analysisContent']>,
  entry: AuditEntry
): Promise<void> {
  try {
    const blocks: Array<{
      object: 'block';
      type: string;
      [key: string]: unknown;
    }> = [];

    // Add context header
    blocks.push({
      object: 'block',
      type: 'heading_2',
      heading_2: {
        rich_text: [{ type: 'text', text: { content: 'Context' } }],
      },
    });

    // Add summary/analysis as callout (strip markdown for Notion)
    if (analysis.summary) {
      blocks.push({
        object: 'block',
        type: 'callout',
        callout: {
          rich_text: [{ type: 'text', text: { content: prepareForNotion(analysis.summary) } }],
          icon: { type: 'emoji', emoji: '📝' },
        },
      });
    }

    // Add key points as a quick reference
    if (analysis.keyPoints && analysis.keyPoints.length > 0) {
      blocks.push({
        object: 'block',
        type: 'heading_3',
        heading_3: {
          rich_text: [{ type: 'text', text: { content: 'Key Points' } }],
        },
      });

      for (const point of analysis.keyPoints.slice(0, 5)) {
        blocks.push({
          object: 'block',
          type: 'bulleted_list_item',
          bulleted_list_item: {
            rich_text: [{ type: 'text', text: { content: stripMarkdown(point) } }],
          },
        });
      }
    }

    // Add suggested actions as to-dos (the main work items)
    if (analysis.suggestedActions && analysis.suggestedActions.length > 0) {
      blocks.push({
        object: 'block',
        type: 'heading_3',
        heading_3: {
          rich_text: [{ type: 'text', text: { content: 'Tasks' } }],
        },
      });

      for (const action of analysis.suggestedActions) {
        blocks.push({
          object: 'block',
          type: 'to_do',
          to_do: {
            rich_text: [{ type: 'text', text: { content: action } }],
            checked: false,
          },
        });
      }
    }

    // Add source URL bookmark
    if (entry.url) {
      blocks.push({
        object: 'block',
        type: 'heading_3',
        heading_3: {
          rich_text: [{ type: 'text', text: { content: 'Source' } }],
        },
      });

      blocks.push({
        object: 'block',
        type: 'bookmark',
        bookmark: {
          url: entry.url,
        },
      });
    }

    // Append blocks to Work Queue page
    if (blocks.length > 0) {
      await notion.blocks.children.append({
        block_id: pageId,
        children: blocks as Parameters<typeof notion.blocks.children.append>[0]['children'],
      });

      logger.info('Analysis content appended to Work Queue page', {
        pageId,
        blockCount: blocks.length,
      });
    }
  } catch (error) {
    // Non-fatal: page was created, just couldn't add context
    logger.warn('Failed to append analysis to Work Queue page', {
      pageId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Update Feed entry with Work Queue link (bidirectional)
 */
async function linkFeedToWorkQueue(feedId: string, workQueueId: string): Promise<void> {
  try {
    await notion.pages.update({
      page_id: feedId,
      properties: {
        'Work Queue': {
          relation: [{ id: workQueueId }],
        },
      },
    });
    logger.debug('Feed linked to Work Queue', { feedId, workQueueId });
  } catch (error) {
    logger.error('Failed to link Feed to Work Queue', { error, feedId, workQueueId });
    // Non-fatal, continue
  }
}

/**
 * Create audit trail with bidirectional Feed ↔ Work Queue linking
 */
export async function createAuditTrail(entry: AuditEntry, trace?: TraceContext): Promise<AuditResult | null> {
  try {
    // 0. URL dedup check — skip if this URL already has a Feed entry
    if (entry.url) {
      const dedup = await checkUrl(entry.url);
      if (dedup.isDuplicate) {
        logger.info('URL dedup: skipping duplicate Feed entry', {
          url: entry.url,
          existingFeedId: dedup.existingFeedId,
          source: dedup.source,
          wasSkipped: dedup.wasSkipped,
        });
        return dedup.existingFeedId ? {
          feedId: dedup.existingFeedId,
          workQueueId: '',
          feedUrl: '',
          workQueueUrl: '',
        } : null;
      }
    }

    // 1. Create Feed entry
    const feed = await createFeedEntry(entry, trace?.traceId);

    // 2. Create Work Queue entry with Feed link
    const workQueue = await createWorkQueueEntry(entry, feed.id, trace?.traceId);

    // 3. Update Feed with Work Queue link (bidirectional)
    await linkFeedToWorkQueue(feed.id, workQueue.id);

    // 4. Register URL in dedup cache (prevents duplicate on resend)
    if (entry.url) {
      registerUrl(entry.url, feed.id);
    }

    logger.info('Audit trail created', {
      feedId: feed.id,
      workQueueId: workQueue.id,
      pillar: entry.pillar,
      requestType: entry.requestType,
    });

    return {
      feedId: feed.id,
      workQueueId: workQueue.id,
      feedUrl: feed.url,
      workQueueUrl: workQueue.url,
    };
  } catch (error) {
    // Log detailed error for debugging
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorBody = (error as { body?: string })?.body;

    logger.error('Failed to create audit trail', {
      error: errorMessage,
      errorBody,
      entry: entry.entry,
      pillar: entry.pillar,
      requestType: entry.requestType,
    });

    // If the error is about unknown property, provide guidance
    if (errorMessage.includes('property') || errorBody?.includes('property')) {
      logger.warn('Notion property error - some properties may not exist in the database schema');
    }

    return null;
  }
}

/**
 * Update Work Queue item status
 */
export async function updateWorkQueueStatus(
  workQueueId: string,
  status: WQStatus,
  resolutionNotes?: string
): Promise<void> {
  try {
    const properties: Record<string, any> = {
      'Status': { select: { name: status } },
    };

    if (status === 'Done' || status === 'Shipped') {
      properties['Completed'] = {
        date: { start: new Date().toISOString().split('T')[0] },
      };
    }

    if (resolutionNotes) {
      properties['Resolution Notes'] = {
        rich_text: [{ text: { content: resolutionNotes } }],
      };
    }

    await notion.pages.update({
      page_id: workQueueId,
      properties,
    });

    logger.debug('Work Queue status updated', { workQueueId, status });
  } catch (error) {
    logger.error('Failed to update Work Queue status', { error, workQueueId });
  }
}

/**
 * Log reclassification when Jim corrects Atlas
 */
export async function logReclassification(
  workQueueId: string,
  newPillar: Pillar,
  originalPillar: Pillar
): Promise<void> {
  try {
    await notion.pages.update({
      page_id: workQueueId,
      properties: {
        'Was Reclassified': { checkbox: true },
        'Original Pillar': { select: { name: originalPillar } },
        'Pillar': { select: { name: newPillar } },
      },
    });

    logger.info('Reclassification logged', { workQueueId, originalPillar, newPillar });
  } catch (error) {
    logger.error('Failed to log reclassification', { error, workQueueId });
  }
}

// notionUrl() DELETED — was fabricating broken URLs without workspace context.
// Use the `url` field from Notion API responses instead.

/**
 * Activity action types for WQ mutations
 */
export type WQActivityAction = 'created' | 'status_change' | 'priority_change' | 'updated';

export interface WQActivityOptions {
  action: WQActivityAction;
  wqItemId: string;
  wqTitle: string;
  details?: string;  // e.g., "P2→P0" or "→ Done"
  pillar?: Pillar;   // Inherit from WQ item if available
  source: 'Telegram' | 'Scheduled' | 'CLI';
}

export interface WQActivityResult {
  feedId: string;
  feedUrl: string;
}

/**
 * Build activity entry text based on action type
 */
function buildActivityEntry(opts: WQActivityOptions): string {
  const title = opts.wqTitle.substring(0, 80);
  switch (opts.action) {
    case 'created':
      return `Created: ${title}`;
    case 'status_change':
      return opts.details ? `${opts.details}: ${title}` : `Updated: ${title}`;
    case 'priority_change':
      return opts.details ? `Reprioritized: ${title} (${opts.details})` : `Reprioritized: ${title}`;
    case 'updated':
      return `Updated: ${title}`;
    default:
      return `Activity: ${title}`;
  }
}

/**
 * Log Work Queue activity to Feed
 * Creates a Feed entry for any WQ mutation with bidirectional linking
 */
export async function logWQActivity(opts: WQActivityOptions): Promise<WQActivityResult | null> {
  const entryText = buildActivityEntry(opts);
  const pillar = opts.pillar || 'The Grove';

  try {
    const response = await notion.pages.create({
      parent: { database_id: FEED_DATABASE_ID },
      properties: {
        'Entry': {
          title: [{ text: { content: entryText } }],
        },
        'Pillar': {
          select: { name: pillar },
        },
        'Request Type': {
          select: { name: 'Process' },
        },
        'Source': {
          select: { name: opts.source },
        },
        'Author': {
          select: { name: 'Atlas [Telegram]' },
        },
        'Confidence': {
          number: 1.0,  // Activity logs are certain
        },
        'Status': {
          select: { name: 'Done' },  // Activity logs are already complete
        },
        'Date': {
          date: { start: new Date().toISOString() },
        },
        'Work Queue': {
          relation: [{ id: opts.wqItemId }],
        },
      },
    });

    const feedUrl = (response as { url?: string }).url || '';
    logger.info('WQ activity logged to Feed', {
      action: opts.action,
      wqItemId: opts.wqItemId,
      feedId: response.id,
    });

    return {
      feedId: response.id,
      feedUrl,
    };
  } catch (error) {
    logger.error('Failed to log WQ activity', { error, opts });
    return null;
  }
}
