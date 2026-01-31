/**
 * Atlas Telegram Bot - Feed & Work Queue Audit
 *
 * Every message creates a Feed entry + Work Queue item with bidirectional linking.
 * This is the "Everything in Work Queue" philosophy.
 */

import { Client } from '@notionhq/client';
import { logger } from '../logger';
import type { Pillar, RequestType, FeedStatus, WQStatus } from './types';

// Re-export Pillar for use by other modules
export type { Pillar };

// Initialize Notion client
const notion = new Client({ auth: process.env.NOTION_API_KEY });

// Notion Database IDs — USE DATABASE PAGE IDs (not data source IDs!)
// Per spec: https://www.notion.so/2f8780a78eef81bcbd69ece73530a3da
const FEED_DATABASE_ID = '90b2b33f-4b44-4b42-870f-8d62fb8cbf18';
const WORK_QUEUE_DATABASE_ID = '3d679030-b76b-43bd-92d8-1ac51abb4a28';

// Track Feed database health - if it's inaccessible, skip Feed logging
let feedDatabaseHealthy = true;
let lastFeedCheck = 0;
const FEED_CHECK_INTERVAL = 60000; // Re-check every 60 seconds

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
async function createFeedEntry(entry: AuditEntry): Promise<{ id: string; url: string }> {
  const { feedStatus } = determineInitialStatus(entry.requestType);

  try {
    const response = await notion.pages.create({
      parent: { database_id: FEED_DATABASE_ID },
      properties: {
        'Entry': {
          title: [{ text: { content: entry.entry.substring(0, 100) } }],
        },
        'Pillar': {
          select: { name: entry.pillar },
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

    const url = `https://notion.so/${response.id.replace(/-/g, '')}`;
    logger.debug('Feed entry created', { id: response.id });
    return { id: response.id, url };
  } catch (error) {
    logger.error('Failed to create Feed entry', { error, entry: entry.entry });
    throw error;
  }
}

/**
 * Create Work Queue entry in Notion with link back to Feed
 */
async function createWorkQueueEntry(
  entry: AuditEntry,
  feedId: string
): Promise<{ id: string; url: string }> {
  const { wqStatus } = determineInitialStatus(entry.requestType);

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
          select: { name: entry.pillar },
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
      },
    });

    const url = `https://notion.so/${response.id.replace(/-/g, '')}`;
    logger.debug('Work Queue entry created', { id: response.id, feedId });
    return { id: response.id, url };
  } catch (error) {
    logger.error('Failed to create Work Queue entry', { error, entry: entry.entry });
    throw error;
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
export async function createAuditTrail(entry: AuditEntry): Promise<AuditResult | null> {
  try {
    // 1. Create Feed entry
    const feed = await createFeedEntry(entry);

    // 2. Create Work Queue entry with Feed link
    const workQueue = await createWorkQueueEntry(entry, feed.id);

    // 3. Update Feed with Work Queue link (bidirectional)
    await linkFeedToWorkQueue(feed.id, workQueue.id);

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
    logger.error('Failed to create audit trail', { error });
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

/**
 * Generate a clickable Notion URL from a page ID
 */
export function notionUrl(pageId: string): string {
  return `https://notion.so/${pageId.replace(/-/g, '')}`;
}

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

    const feedUrl = notionUrl(response.id);
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
