/**
 * Feed 2.0 Logging — Bridge Session Summaries and Memory Writes
 *
 * Two logging functions:
 *   logBridgeSession() — Called at session end (WebSocket close)
 *   logMemoryWrite()   — Called on each bridge_update_memory invocation
 *
 * Schema designed for downstream consumption by future reflection agent.
 * Fields are explicit and queryable.
 *
 * Feed 2.0 Database ID: 90b2b33f-4b44-4b42-870f-8d62fb8cbf18
 */

import { Client } from '@notionhq/client';

const FEED_DB_ID = '90b2b33f-4b44-4b42-870f-8d62fb8cbf18';

/** Lazy-initialized Notion client */
let _notion: Client | null = null;

function getNotion(): Client {
  if (!_notion) {
    _notion = new Client({ auth: process.env.NOTION_API_KEY });
  }
  return _notion;
}

// ─── Session Logging ─────────────────────────────────────

export interface BridgeSessionSummary {
  primaryTopic: string;
  sessionDurationMs: number;
  interactionCount: number;
  memoryWritesCount: number;
  correctionsCount: number;
  pagesVisited: string[];
  summary: string;  // 2-3 sentence freeform summary
}

/**
 * Log a Bridge session summary to Feed 2.0.
 * Called at WebSocket disconnect / session end.
 */
export async function logBridgeSession(session: BridgeSessionSummary): Promise<string | null> {
  try {
    const notion = getNotion();
    const date = new Date().toISOString().split('T')[0];

    const response = await notion.pages.create({
      parent: { database_id: FEED_DB_ID },
      properties: {
        Entry: {
          title: [{ text: { content: `Bridge Session — ${date} — ${session.primaryTopic}` } }],
        },
        Source: {
          select: { name: 'Bridge' },
        },
        Status: {
          select: { name: 'Logged' },
        },
        Keywords: {
          multi_select: [
            { name: 'bridge-session' },
            { name: 'session-summary' },
          ],
        },
      },
      children: [
        {
          type: 'callout',
          callout: {
            icon: { emoji: '🖥️' },
            color: 'blue_background',
            rich_text: [{ type: 'text', text: { content: session.summary } }],
          },
        },
        {
          type: 'paragraph',
          paragraph: {
            rich_text: [{
              type: 'text',
              text: {
                content:
                  `Duration: ${Math.round(session.sessionDurationMs / 1000 / 60)}min | ` +
                  `Interactions: ${session.interactionCount} | ` +
                  `Memory writes: ${session.memoryWritesCount} | ` +
                  `Corrections: ${session.correctionsCount}`,
              },
            }],
          },
        },
        ...(session.pagesVisited.length > 0 ? [{
          type: 'paragraph' as const,
          paragraph: {
            rich_text: [{
              type: 'text' as const,
              text: { content: `Pages visited: ${session.pagesVisited.join(', ')}` },
            }],
          },
        }] : []),
      ],
    });

    console.log(`[feed-logger] Bridge session logged: ${response.id}`);
    return response.id;
  } catch (error) {
    console.error('[feed-logger] Failed to log Bridge session:', error);
    return null;
  }
}

// ─── Memory Write Logging ────────────────────────────────

export interface MemoryWriteLog {
  memoryType: 'correction' | 'learning' | 'pattern';
  content: string;
  sourceContext: string;
  pageUrl?: string;
}

/**
 * Log a memory write event to Feed 2.0.
 * Called on each bridge_update_memory invocation.
 */
export async function logMemoryWrite(log: MemoryWriteLog): Promise<string | null> {
  try {
    const notion = getNotion();
    const truncated = log.content.length > 60
      ? log.content.slice(0, 57) + '...'
      : log.content;

    const response = await notion.pages.create({
      parent: { database_id: FEED_DB_ID },
      properties: {
        Entry: {
          title: [{ text: { content: `Bridge Memory — ${log.memoryType}: ${truncated}` } }],
        },
        Source: {
          select: { name: 'Bridge' },
        },
        Status: {
          select: { name: 'Logged' },
        },
        Keywords: {
          multi_select: [
            { name: 'bridge-memory-write' },
            { name: log.memoryType },
          ],
        },
      },
      children: [
        {
          type: 'paragraph',
          paragraph: {
            rich_text: [
              { type: 'text', text: { content: `Type: ${log.memoryType}\n` } },
              { type: 'text', text: { content: `Content: ${log.content}\n` } },
              { type: 'text', text: { content: `Context: ${log.sourceContext}` } },
              ...(log.pageUrl ? [{ type: 'text' as const, text: { content: `\nPage: ${log.pageUrl}` } }] : []),
            ],
          },
        },
      ],
    });

    console.log(`[feed-logger] Memory write logged: ${response.id}`);
    return response.id;
  } catch (error) {
    console.error('[feed-logger] Failed to log memory write:', error);
    return null;
  }
}
