/**
 * Atlas Telegram Bot - Notion Integration
 *
 * Architecture: Feed 2.0 (activity log) + Work Queue 2.0 (task ledger)
 * NO INBOX - Telegram IS the inbox. Everything routes to Feed/WQ.
 *
 * CANONICAL DATABASE IDs (for Notion SDK):
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
  ActionStatus,
  ActionType,
  ActionData,
  ActionedVia,
  ActionFeedEntry,
  ActionDataTriage,
  ActionDataApproval,
  ActionDataReview,
  ActionDataAlert,
  ActionDataInfo,
} from "./types";
import { NotionSyncError } from "./errors";
import { logger } from "./logger";

// CANONICAL DATA SOURCE IDs - DO NOT CHANGE
// Use database page IDs (NOT data source IDs which are for MCP only)
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
      url: page.url || '',
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
      url: page.url || '',
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
        url: page.url || '',
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

// getNotionPageUrl() DELETED — was fabricating broken URLs without workspace context.
// Use the `url` field from Notion API responses instead.

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
// Action Feed Functions
// ==========================================

/**
 * Create an Action Feed entry (for alerts, approvals, reviews that don't originate from sparks)
 */
export async function createActionFeedEntry(
  actionType: ActionType,
  actionData: ActionData,
  source: string,
  title?: string
): Promise<string> {
  const notion = getNotionClient();
  const entryTitle = title || generateActionTitle(actionType, actionData);

  try {
    const response = await notion.pages.create({
      parent: { database_id: FEED_DATABASE_ID },
      properties: {
        'Entry': {
          title: [{ text: { content: entryTitle.substring(0, 100) } }],
        },
        'Source': {
          select: { name: source },
        },
        'Date': {
          date: { start: new Date().toISOString() },
        },
        'Action Status': {
          select: { name: 'Pending' },
        },
        'Action Type': {
          select: { name: actionType },
        },
        'Action Data': {
          rich_text: [{ text: { content: JSON.stringify(actionData) } }],
        },
      },
    });

    logger.info('Action Feed entry created', { id: response.id, actionType });
    return response.id;
  } catch (error) {
    logger.error('Failed to create Action Feed entry', { error, actionType });
    throw error;
  }
}

/**
 * Generate a title based on action type and data
 */
function generateActionTitle(actionType: ActionType, actionData: ActionData): string {
  switch (actionType) {
    case 'Triage': {
      const data = actionData as ActionDataTriage;
      return `[Triage] ${data.title}`;
    }
    case 'Approval': {
      const data = actionData as ActionDataApproval;
      return `[Approval] ${data.skill_name}`;
    }
    case 'Review': {
      const data = actionData as ActionDataReview;
      return `[Review] ${data.wq_title}`;
    }
    case 'Alert': {
      const data = actionData as ActionDataAlert;
      return `[Alert] ${data.alert_type}: ${data.platform || 'System'}`;
    }
    case 'Info':
    default: {
      const data = actionData as ActionDataInfo;
      return data.message;
    }
  }
}

/**
 * Update Action properties on a Feed entry
 */
export async function updateFeedEntryAction(
  pageId: string,
  updates: Partial<{
    actionStatus: ActionStatus;
    actionData: ActionData;
    actionedAt: string;
    actionedVia: ActionedVia;
  }>
): Promise<void> {
  const notion = getNotionClient();
  const properties: Record<string, any> = {};

  if (updates.actionStatus) {
    properties['Action Status'] = { select: { name: updates.actionStatus } };
  }
  if (updates.actionData) {
    properties['Action Data'] = {
      rich_text: [{ text: { content: JSON.stringify(updates.actionData) } }],
    };
  }
  if (updates.actionedAt) {
    properties['Actioned At'] = { date: { start: updates.actionedAt } };
  }
  if (updates.actionedVia) {
    properties['Actioned Via'] = { select: { name: updates.actionedVia } };
  }

  try {
    await notion.pages.update({
      page_id: pageId,
      properties,
    });
    logger.info('Feed entry action updated', { pageId, actionStatus: updates.actionStatus });
  } catch (error) {
    logger.error('Failed to update feed entry action', { pageId, error });
    throw error;
  }
}

/**
 * Query pending Action Feed items (Pending or Snoozed)
 */
export async function queryPendingActionItems(): Promise<ActionFeedEntry[]> {
  const notion = getNotionClient();

  try {
    const response = await notion.databases.query({
      database_id: FEED_DATABASE_ID,
      filter: {
        or: [
          {
            property: 'Action Status',
            select: { equals: 'Pending' },
          },
          {
            property: 'Action Status',
            select: { equals: 'Snoozed' },
          },
        ],
      },
      sorts: [
        { timestamp: 'created_time', direction: 'descending' },
      ],
    });

    return response.results.map(parseActionFeedEntry);
  } catch (error) {
    logger.error('Failed to query pending action items', { error });
    throw error;
  }
}

/**
 * Parse a Notion page into an ActionFeedEntry
 */
function parseActionFeedEntry(page: any): ActionFeedEntry {
  const props = page.properties;

  const actionDataRaw = props['Action Data']?.rich_text?.[0]?.text?.content || '{}';
  let actionData: ActionData;
  try {
    actionData = JSON.parse(actionDataRaw);
  } catch {
    actionData = { message: 'Parse error' } as ActionDataInfo;
  }

  return {
    id: page.id,
    url: page.url || '',
    createdAt: page.created_time,
    title: extractTitle(page, 'Entry'),
    source: props['Source']?.select?.name || 'Unknown',
    actionStatus: props['Action Status']?.select?.name || 'Pending',
    actionType: props['Action Type']?.select?.name || 'Info',
    actionData,
    actionedAt: props['Actioned At']?.date?.start,
    actionedVia: props['Actioned Via']?.select?.name,
  };
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
  _clarification?: ClarificationExchange,
  actionProps?: {
    actionStatus?: ActionStatus;
    actionType?: ActionType;
    actionData?: ActionData;
  }
): Promise<string> {
  const notion = getNotionClient();

  try {
    const properties: Record<string, any> = {
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
    };

    // Add Action properties if provided
    if (actionProps) {
      if (actionProps.actionStatus) {
        properties['Action Status'] = { select: { name: actionProps.actionStatus } };
      }
      if (actionProps.actionType) {
        properties['Action Type'] = { select: { name: actionProps.actionType } };
      }
      if (actionProps.actionData) {
        properties['Action Data'] = {
          rich_text: [{ text: { content: JSON.stringify(actionProps.actionData) } }],
        };
      }
    }

    const response = await notion.pages.create({
      parent: { database_id: FEED_DATABASE_ID },
      properties,
    });

    if (!response.id) {
      throw new NotionSyncError('Feed item create returned no page ID', {
        title: classification.suggestedTitle,
      });
    }

    // Read-after-write verification
    try {
      const verification = await notion.pages.retrieve({ page_id: response.id });
      if (!verification) {
        throw new NotionSyncError('Feed item created but read-after-write verification failed', {
          pageId: response.id,
        });
      }
    } catch (verifyError) {
      if (verifyError instanceof NotionSyncError) throw verifyError;
      throw new NotionSyncError(
        `Feed item created but verification read failed: ${(verifyError as Error).message}`,
        { pageId: response.id }
      );
    }

    logger.info('Feed item created (verified)', { id: response.id });
    return response.id;
  } catch (error) {
    if (error instanceof NotionSyncError) throw error;
    logger.error('Failed to create Feed item', { error });
    throw new NotionSyncError(
      `Failed to create Feed item: ${(error as Error).message}`,
      { title: classification.suggestedTitle }
    );
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

    if (!response.id) {
      throw new NotionSyncError('Work Queue create returned no page ID', {
        title: classification.suggestedTitle,
        feedSource: feedPageId,
      });
    }

    // Read-after-write verification
    try {
      const verification = await notion.pages.retrieve({ page_id: response.id });
      if (!verification) {
        throw new NotionSyncError('Work item created but read-after-write verification failed', {
          pageId: response.id,
          feedSource: feedPageId,
        });
      }
    } catch (verifyError) {
      if (verifyError instanceof NotionSyncError) throw verifyError;
      throw new NotionSyncError(
        `Work item created but verification read failed: ${(verifyError as Error).message}`,
        { pageId: response.id, feedSource: feedPageId }
      );
    }

    logger.info('Work Queue item created (verified)', { id: response.id, feedSource: feedPageId });
    return response.id;
  } catch (error) {
    if (error instanceof NotionSyncError) throw error;
    logger.error('Failed to create Work Queue item', { error });
    throw new NotionSyncError(
      `Failed to create Work Queue item: ${(error as Error).message}`,
      { title: classification.suggestedTitle, feedSource: feedPageId }
    );
  }
}

// Re-export getDatabaseIds for any remaining legacy code
export { getDatabaseIds };
