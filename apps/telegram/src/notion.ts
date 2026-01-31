/**
 * Atlas Telegram Bot - Notion Integration
 *
 * Architecture: Feed 2.0 (activity log) + Work Queue 2.0 (task ledger)
 * NO INBOX - Telegram IS the inbox. Everything routes to Feed/WQ.
 *
 * CANONICAL DATABASE IDs (Database Page IDs):
 * - Feed 2.0:       90b2b33f-4b44-4b42-870f-8d62fb8cbf18
 * - Work Queue 2.0: 3d679030-b76b-43bd-92d8-1ac51abb4a28
 *
 * @see IMPLEMENTATION.md Sprint 3 for requirements
 */

import { Client } from "@notionhq/client";
import type {
  Pillar,
  Priority,
  WorkStatus,
  NotionQueryOptions,
  NotionQueryResult,
  NotionItemSummary,
  StatusSummary,
  NotionSearchResult,
  Spark,
  ClassificationResult,
  Decision,
  ClarificationExchange,
} from "./types";
import { logger } from "./logger";

// CANONICAL DATABASE IDs - DO NOT CHANGE
// Database Page IDs (not Data Source IDs)
const FEED_DATABASE_ID = "90b2b33f-4b44-4b42-870f-8d62fb8cbf18";
const WORK_QUEUE_DATABASE_ID = "3d679030-b76b-43bd-92d8-1ac51abb4a28";

// Database ID accessor
const getDatabaseIds = () => ({
  feed: FEED_DATABASE_ID,
  workQueue: WORK_QUEUE_DATABASE_ID,
});

// Lazy-initialized Notion client
let _notion: Client | null = null;
function getNotionClient(): Client {
  if (!_notion) {
    const apiKey = process.env.NOTION_API_KEY;
    logger.debug("Initializing Notion client", {
      keyPresent: !!apiKey,
      keyLength: apiKey?.length,
      keyPrefix: apiKey?.substring(0, 7),
    });
    _notion = new Client({
      auth: apiKey,
    });
  }
  return _notion;
}

// ==========================================
// Feed 2.0 Functions (Activity Log)
// ==========================================

/**
 * Query Feed entries with optional filters
 */
export async function queryFeed(
  options: NotionQueryOptions = {}
): Promise<NotionQueryResult> {
  logger.debug("Querying Feed", options);

  const filters: any[] = [];

  if (options.pillar) {
    filters.push({
      property: "Pillar",
      select: { equals: options.pillar },
    });
  }

  if (options.status) {
    filters.push({
      property: "Status",
      select: { equals: options.status },
    });
  }

  const sorts: any[] = [];
  if (options.sortBy === "created") {
    sorts.push({
      property: "Date",
      direction: options.sortDirection === "asc" ? "ascending" : "descending",
    });
  } else if (options.sortBy === "updated") {
    sorts.push({
      timestamp: "last_edited_time",
      direction: options.sortDirection === "asc" ? "ascending" : "descending",
    });
  }

  try {
    const response = await getNotionClient().databases.query({
      database_id: FEED_DATABASE_ID,
      filter: filters.length > 0 ? { and: filters } : undefined,
      sorts:
        sorts.length > 0
          ? sorts
          : [{ timestamp: "created_time", direction: "descending" }],
      page_size: options.limit || 10,
    });

    const items: NotionItemSummary[] = response.results.map((page: any) => ({
      id: page.id,
      title: extractTitle(page, "Entry"),
      pillar: extractSelect(page, "Pillar") as Pillar | undefined,
      status: extractSelect(page, "Status"),
      priority: undefined,
      createdAt: page.created_time ? new Date(page.created_time) : undefined,
      url: getNotionPageUrl(page.id),
    }));

    return {
      items,
      total: response.results.length,
      hasMore: response.has_more,
    };
  } catch (error) {
    logger.error("Failed to query Feed", { error });
    throw error;
  }
}

// DEPRECATED: Alias for legacy code - use queryFeed instead
export const queryInbox = queryFeed;

// ==========================================
// Work Queue 2.0 Functions (Task Ledger)
// ==========================================

/**
 * Query work queue items with optional filters
 */
export async function queryWorkQueue(
  options: NotionQueryOptions = {}
): Promise<NotionQueryResult> {
  logger.debug("Querying work queue", options);

  const filters: any[] = [];

  if (options.status) {
    filters.push({
      property: "Status",
      select: { equals: options.status },
    });
  }

  if (options.pillar) {
    filters.push({
      property: "Pillar",
      select: { equals: options.pillar },
    });
  }

  const sorts: any[] = [];
  if (options.sortBy === "priority") {
    sorts.push({
      property: "Priority",
      direction: options.sortDirection === "desc" ? "descending" : "ascending",
    });
  } else if (options.sortBy === "created") {
    sorts.push({
      property: "Queued",
      direction: options.sortDirection === "asc" ? "ascending" : "descending",
    });
  }

  try {
    const response = await getNotionClient().databases.query({
      database_id: WORK_QUEUE_DATABASE_ID,
      filter: filters.length > 0 ? { and: filters } : undefined,
      sorts:
        sorts.length > 0
          ? sorts
          : [{ property: "Priority", direction: "ascending" }],
      page_size: options.limit || 10,
    });

    const items: NotionItemSummary[] = response.results.map((page: any) => ({
      id: page.id,
      title: extractTitle(page, "Task"),
      pillar: extractSelect(page, "Pillar") as Pillar | undefined,
      status: extractSelect(page, "Status"),
      priority: extractSelect(page, "Priority") as Priority | undefined,
      createdAt: extractDate(page, "Queued"),
      url: getNotionPageUrl(page.id),
    }));

    return {
      items,
      total: response.results.length,
      hasMore: response.has_more,
    };
  } catch (error) {
    logger.error("Failed to query work queue", { error });
    throw error;
  }
}

// ==========================================
// Status & Search
// ==========================================

/**
 * Get status summary across databases (Feed + WQ)
 */
export async function getStatusSummary(): Promise<StatusSummary> {
  logger.debug("Getting status summary");

  try {
    // Query both databases for aggregates
    const [feedResponse, workResponse] = await Promise.all([
      getNotionClient().databases.query({
        database_id: FEED_DATABASE_ID,
        page_size: 100,
      }),
      getNotionClient().databases.query({
        database_id: WORK_QUEUE_DATABASE_ID,
        page_size: 100,
      }),
    ]);

    // Aggregate Feed stats
    const feedByStatus: Record<string, number> = {};
    const feedByPillar: Record<string, number> = {};

    for (const page of feedResponse.results as any[]) {
      const status = extractSelect(page, "Status") || "Unknown";
      const pillar = extractSelect(page, "Pillar") || "Unknown";

      feedByStatus[status] = (feedByStatus[status] || 0) + 1;
      feedByPillar[pillar] = (feedByPillar[pillar] || 0) + 1;
    }

    // Aggregate work queue stats
    const workByStatus: Record<string, number> = {};
    const workByPriority: Record<string, number> = {};

    for (const page of workResponse.results as any[]) {
      const status = extractSelect(page, "Status") || "Unknown";
      const priority = extractSelect(page, "Priority") || "Unknown";

      workByStatus[status] = (workByStatus[status] || 0) + 1;
      workByPriority[priority] = (workByPriority[priority] || 0) + 1;
    }

    return {
      feed: {
        total: feedResponse.results.length,
        byStatus: feedByStatus,
        byPillar: feedByPillar,
      },
      workQueue: {
        total: workResponse.results.length,
        byStatus: workByStatus,
        byPriority: workByPriority,
      },
      lastUpdated: new Date(),
    };
  } catch (error) {
    logger.error("Failed to get status summary", { error });
    throw error;
  }
}

/**
 * Search Notion across all pages
 */
export async function searchNotion(query: string): Promise<NotionSearchResult[]> {
  logger.debug("Searching Notion", { query });

  try {
    const response = await getNotionClient().search({
      query,
      sort: {
        direction: "descending",
        timestamp: "last_edited_time",
      },
      page_size: 10,
    });

    const results: NotionSearchResult[] = [];

    for (const page of response.results) {
      if (page.object !== "page") continue;

      const pageAny = page as any;
      const title = extractSearchTitle(pageAny);
      const parentDb = pageAny.parent?.database_id?.replace(/-/g, "");

      // Determine type based on parent database
      let type: "feed" | "work" | "page" = "page";
      if (parentDb === FEED_DATABASE_ID.replace(/-/g, "")) {
        type = "feed";
      } else if (parentDb === WORK_QUEUE_DATABASE_ID.replace(/-/g, "")) {
        type = "work";
      }

      results.push({
        id: page.id,
        title,
        type,
        url: getNotionPageUrl(page.id),
      });
    }

    return results;
  } catch (error) {
    logger.error("Failed to search Notion", { error });
    throw error;
  }
}

/**
 * Find an item by title search
 */
export async function findItemByTitle(
  query: string
): Promise<NotionItemSummary | null> {
  logger.debug("Finding item by title", { query });

  const lowerQuery = query.toLowerCase();

  // Search work queue first (most likely for actions)
  const workResults = await queryWorkQueue({ limit: 20 });
  for (const item of workResults.items) {
    if (item.title.toLowerCase().includes(lowerQuery)) {
      return item;
    }
  }

  // Search Feed
  const feedResults = await queryFeed({ limit: 20 });
  for (const item of feedResults.items) {
    if (item.title.toLowerCase().includes(lowerQuery)) {
      return item;
    }
  }

  // Fall back to global Notion search
  const searchResults = await searchNotion(query);
  if (searchResults.length > 0) {
    return {
      id: searchResults[0].id,
      title: searchResults[0].title,
      url: searchResults[0].url,
    };
  }

  return null;
}

// ==========================================
// Page Updates
// ==========================================

/**
 * Update a Notion page (complete, archive, dismiss, defer)
 */
export async function updateNotionPage(
  pageId: string,
  action: "complete" | "archive" | "dismiss" | "defer"
): Promise<void> {
  logger.info("Updating Notion page", { pageId, action });

  const page = await getNotionClient().pages.retrieve({ page_id: pageId });
  const pageAny = page as any;
  const parentDb = pageAny.parent?.database_id?.replace(/-/g, "");

  const isFeed = parentDb === FEED_DATABASE_ID.replace(/-/g, "");
  const isWorkQueue = parentDb === WORK_QUEUE_DATABASE_ID.replace(/-/g, "");

  try {
    if (isFeed) {
      const statusMap: Record<string, string> = {
        complete: "Done",
        archive: "Done",
        dismiss: "Dismissed",
        defer: "Routed",
      };

      await getNotionClient().pages.update({
        page_id: pageId,
        properties: {
          Status: {
            select: { name: statusMap[action] },
          },
        },
      });
    } else if (isWorkQueue) {
      const statusMap: Record<string, WorkStatus> = {
        complete: "Done",
        archive: "Done",
        dismiss: "Done",
        defer: "Paused",
      };

      await getNotionClient().pages.update({
        page_id: pageId,
        properties: {
          Status: {
            select: { name: statusMap[action] },
          },
        },
      });
    }

    // Add comment noting the action
    const actionDate = new Date().toISOString().split("T")[0];
    await getNotionClient().comments.create({
      parent: { page_id: pageId },
      rich_text: [
        {
          text: {
            content: `[ATLAS ACTION - ${actionDate}]\n\nAction: ${action}\nSource: Telegram`,
          },
        },
      ],
    });

    logger.info("Page updated successfully", { pageId, action });
  } catch (error) {
    logger.error("Failed to update page", { pageId, action, error });
    throw error;
  }
}

// ==========================================
// Connection & Utilities
// ==========================================

/**
 * Get Notion page URL from page ID
 */
export function getNotionPageUrl(pageId: string): string {
  const cleanId = pageId.replace(/-/g, "");
  return `https://notion.so/${cleanId}`;
}

/**
 * Test Notion connection - tests Feed 2.0 access
 */
export async function testNotionConnection(): Promise<boolean> {
  try {
    // Test Feed 2.0 access (the primary database)
    await getNotionClient().databases.retrieve({
      database_id: FEED_DATABASE_ID,
    });
    logger.info("Notion connection successful (Feed 2.0)");
    return true;
  } catch (error) {
    logger.error("Notion connection failed", { error });
    return false;
  }
}

/**
 * Get database IDs - for external reference
 */
export function getCanonicalDatabaseIds() {
  return {
    feed: FEED_DATABASE_ID,
    workQueue: WORK_QUEUE_DATABASE_ID,
  };
}

// ==========================================
// Helper Functions
// ==========================================

function extractTitle(page: any, primaryProp: string = "Task"): string {
  // Try primary property first
  const primary = page.properties?.[primaryProp];
  if (primary?.title?.[0]?.plain_text) {
    return primary.title[0].plain_text;
  }

  // Try common fallbacks
  for (const propName of ["Entry", "Task", "Name", "Title", "Spark"]) {
    const prop = page.properties?.[propName];
    if (prop?.title?.[0]?.plain_text) {
      return prop.title[0].plain_text;
    }
  }
  return "Untitled";
}

function extractSearchTitle(page: any): string {
  if (page.properties) {
    return extractTitle(page);
  }
  return "Untitled";
}

function extractSelect(page: any, propName: string): string | undefined {
  return page.properties?.[propName]?.select?.name;
}

function extractDate(page: any, propName: string): Date | undefined {
  const dateStr = page.properties?.[propName]?.date?.start;
  return dateStr ? new Date(dateStr) : undefined;
}

// ==========================================
// DEPRECATED FUNCTIONS - DO NOT USE
// ==========================================
// Legacy Item Creation (for handler.ts, spark.ts)
// ==========================================

/**
 * Create a Feed entry in Notion
 * Used by legacy handlers (handler.ts, spark.ts)
 */
export async function createFeedItem(
  _spark: Spark,
  classification: ClassificationResult,
  decision: Decision,
  _clarification?: ClarificationExchange
): Promise<string> {
  const notion = getNotionClient();

  try {
    const response = await notion.pages.create({
      parent: { database_id: FEED_DATABASE_ID },
      properties: {
        'Entry': {
          title: [{ text: { content: classification.suggestedTitle.substring(0, 100) } }],
        },
        'Pillar': {
          select: { name: classification.pillar },
        },
        'Source': {
          select: { name: 'Telegram' },
        },
        'Status': {
          select: { name: decision === 'Route to Work' ? 'Routed' : 'Done' },
        },
        'Confidence': {
          number: classification.confidence / 100,
        },
        'Date': {
          date: { start: new Date().toISOString() },
        },
      },
    });

    logger.info('Feed item created', { id: response.id });
    return response.id;
  } catch (error) {
    logger.error('Failed to create Feed item', { error });
    throw error;
  }
}

/** @deprecated Use createFeedItem instead */
export const createInboxItem = createFeedItem;

/**
 * Create a Work Queue entry in Notion
 * Used by legacy handlers (handler.ts, spark.ts)
 */
export async function createWorkItem(
  feedPageId: string,
  _spark: Spark,
  classification: ClassificationResult
): Promise<string> {
  const notion = getNotionClient();

  try {
    const response = await notion.pages.create({
      parent: { database_id: WORK_QUEUE_DATABASE_ID },
      properties: {
        'Task': {
          title: [{ text: { content: classification.suggestedTitle.substring(0, 100) } }],
        },
        'Status': {
          select: { name: 'Captured' },
        },
        'Priority': {
          select: { name: 'P2' },
        },
        'Pillar': {
          select: { name: classification.pillar },
        },
        'Feed Source': {
          relation: [{ id: feedPageId }],
        },
        'Queued': {
          date: { start: new Date().toISOString().split('T')[0] },
        },
      },
    });

    logger.info('Work Queue item created', { id: response.id, feedSource: feedPageId });
    return response.id;
  } catch (error) {
    logger.error('Failed to create Work Queue item', { error });
    throw error;
  }
}

// Re-export getDatabaseIds for any remaining legacy code
export { getDatabaseIds };
