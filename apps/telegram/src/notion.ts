/**
 * Atlas Telegram Bot - Notion Integration
 * 
 * Creates inbox items, adds comments, routes to work queue.
 * 
 * @see IMPLEMENTATION.md Sprint 3 for requirements
 */

import { Client } from "@notionhq/client";
import type {
  Spark,
  ClassificationResult,
  ClarificationExchange,
  Pillar,
  Intent,
  Decision,
  AtlasStatus,
  WorkStatus,
  Priority,
  NotionQueryOptions,
  NotionQueryResult,
  NotionItemSummary,
  StatusSummary,
  NotionSearchResult,
} from "./types";
import { logger } from "./logger";

// Database IDs (lazy loaded) - from CLAUDE.md
const getDatabaseIds = () => ({
  inbox: process.env.NOTION_INBOX_DB || "f6f638c9-6aee-42a7-8137-df5b6a560f50",
  workQueue: process.env.NOTION_WORK_QUEUE_DB || "3d679030-b76b-43bd-92d8-1ac51abb4a28",
});

// Lazy-initialized Notion client
let _notion: Client | null = null;
function getNotionClient(): Client {
  if (!_notion) {
    const apiKey = process.env.NOTION_API_KEY;
    logger.debug("Initializing Notion client", {
      keyPresent: !!apiKey,
      keyLength: apiKey?.length,
      keyPrefix: apiKey?.substring(0, 7) // Just "secret_" prefix, safe to log
    });
    _notion = new Client({
      auth: apiKey,
    });
  }
  return _notion;
}

/**
 * Create an inbox item from a classified spark
 */
export async function createInboxItem(
  spark: Spark,
  classification: ClassificationResult,
  decision: Decision,
  clarification?: ClarificationExchange
): Promise<string> {
  logger.info("Creating inbox item", { 
    url: spark.url, 
    pillar: classification.pillar 
  });

  try {
    // Build properties object
    const properties: Record<string, any> = {
      // Title
      "Spark": {
        title: [{ text: { content: classification.suggestedTitle || spark.content.substring(0, 100) } }],
      },
      // Source Type
      "Source Type": {
        select: { name: spark.source },
      },
      // Pillar
      "Pillar": {
        select: { name: classification.pillar },
      },
      // Intent
      "Intent": {
        select: { name: classification.intent },
      },
      // Confidence (as decimal, e.g., 0.85 for 85%)
      "Confidence": {
        number: classification.confidence / 100,
      },
      // Decision
      "Decision": {
        select: { name: decision },
      },
      // Atlas Status
      "Atlas Status": {
        select: { name: decision === "Route to Work" ? "Routed" : "Classified" },
      },
      // Atlas Notes
      "Atlas Notes": {
        rich_text: [{ text: { content: classification.reasoning } }],
      },
      // Tags
      "Tags": {
        multi_select: classification.tags.map(tag => ({ name: tag })),
      },
      // Spark Date
      "Spark Date": {
        date: { start: spark.receivedAt.toISOString().split("T")[0] },
      },
      // Decision Date
      "Decision Date": {
        date: { start: new Date().toISOString().split("T")[0] },
      },
    };

    // Add URL if present
    if (spark.url) {
      properties["Source"] = { url: spark.url };
    }

    const response = await getNotionClient().pages.create({
      parent: { database_id: getDatabaseIds().inbox },
      properties,
    });

    const pageId = response.id;
    logger.info("Inbox item created", { pageId });

    // Add comment with full exchange
    await addTelegramExchangeComment(pageId, spark, classification, clarification);

    return pageId;
  } catch (error) {
    logger.error("Failed to create inbox item", { error });
    throw error;
  }
}

/**
 * Add a comment documenting the Telegram exchange
 */
export async function addTelegramExchangeComment(
  pageId: string,
  spark: Spark,
  classification: ClassificationResult,
  clarification?: ClarificationExchange
): Promise<void> {
  const date = new Date().toISOString().split("T")[0];
  
  let commentText = `[TELEGRAM EXCHANGE - ${date}]

JIM SHARED: ${spark.url || spark.content}

ATLAS CLASSIFICATION:
• Source Type: ${spark.source}
• Detected Pillar: ${classification.pillar} @ ${classification.confidence}%
• Detected Intent: ${classification.intent}
• Reasoning: ${classification.reasoning}`;

  if (clarification) {
    commentText += `

CLARIFICATION:
Atlas: "${clarification.question}"
Jim: ${clarification.response}`;
  }

  commentText += `

ACTION: Created inbox item, ${spark.classification?.intent === "Build" ? "routing to Work Queue" : "classified for review"}.`;

  try {
    await getNotionClient().comments.create({
      parent: { page_id: pageId },
      rich_text: [{ text: { content: commentText } }],
    });
    logger.debug("Comment added to inbox item", { pageId });
  } catch (error) {
    logger.error("Failed to add comment", { pageId, error });
    // Don't throw - comment failure shouldn't fail the whole operation
  }
}

/**
 * Create a work queue item and link to inbox
 */
export async function createWorkItem(
  inboxPageId: string,
  spark: Spark,
  classification: ClassificationResult
): Promise<string> {
  logger.info("Creating work queue item", { inboxPageId });

  // Map intent to work type
  const typeMap: Record<Intent, string> = {
    "Research": "Research",
    "Catalog": "Process",
    "Build": "Build",
    "Content": "Draft",
    "Reference": "Process",
    "Task": "Build",
    "Question": "Answer",
  };

  // Map confidence to priority
  const priority: Priority = classification.confidence >= 90 ? "P1" 
    : classification.confidence >= 70 ? "P2" 
    : "P3";

  try {
    const response = await getNotionClient().pages.create({
      parent: { database_id: getDatabaseIds().workQueue },
      properties: {
        // Title
        "Task": {
          title: [{ text: { content: classification.suggestedTitle || spark.content.substring(0, 100) } }],
        },
        // Type
        "Type": {
          select: { name: typeMap[classification.intent] || "Process" },
        },
        // Status
        "Status": {
          select: { name: "Captured" },
        },
        // Priority
        "Priority": {
          select: { name: priority },
        },
        // Inbox Source relation
        "Inbox Source": {
          relation: [{ id: inboxPageId }],
        },
        // Queued date
        "Queued": {
          date: { start: new Date().toISOString().split("T")[0] },
        },
      },
    });

    const workPageId = response.id;
    logger.info("Work queue item created", { workPageId, inboxPageId });

    // Update inbox item with relation to work queue
    await updateInboxWithWorkRelation(inboxPageId, workPageId);

    // Add initial comment to work item
    await addWorkItemComment(workPageId, spark, classification);

    return workPageId;
  } catch (error) {
    logger.error("Failed to create work item", { error });
    throw error;
  }
}

/**
 * Update inbox item with relation to work queue item
 */
async function updateInboxWithWorkRelation(
  inboxPageId: string,
  workPageId: string
): Promise<void> {
  try {
    await getNotionClient().pages.update({
      page_id: inboxPageId,
      properties: {
        "Routed To": {
          relation: [{ id: workPageId }],
        },
      },
    });
  } catch (error) {
    logger.error("Failed to update inbox with work relation", { error });
    // Non-critical, don't throw
  }
}

/**
 * Add initial comment to work queue item
 */
async function addWorkItemComment(
  pageId: string,
  spark: Spark,
  classification: ClassificationResult
): Promise<void> {
  const commentText = `[WORK ITEM CREATED - ${new Date().toISOString().split("T")[0]}]

SOURCE: ${spark.url || spark.content}

CONTEXT:
• Pillar: ${classification.pillar}
• Intent: ${classification.intent}
• Classification confidence: ${classification.confidence}%

NOTES:
${classification.reasoning}

Ready for execution.`;

  try {
    await getNotionClient().comments.create({
      parent: { page_id: pageId },
      rich_text: [{ text: { content: commentText } }],
    });
  } catch (error) {
    logger.error("Failed to add work item comment", { error });
  }
}

/**
 * Get Notion page URL from page ID
 */
export function getNotionPageUrl(pageId: string): string {
  // Remove dashes from page ID for URL
  const cleanId = pageId.replace(/-/g, "");
  return `https://notion.so/${cleanId}`;
}

/**
 * Test Notion connection
 */
export async function testNotionConnection(): Promise<boolean> {
  try {
    await getNotionClient().databases.retrieve({ database_id: getDatabaseIds().inbox });
    logger.info("Notion connection successful");
    return true;
  } catch (error) {
    logger.error("Notion connection failed", { error });
    return false;
  }
}

// ==========================================
// Query Methods (Intent Router Phase 2)
// ==========================================

/**
 * Query inbox items with optional filters
 */
export async function queryInbox(
  options: NotionQueryOptions = {}
): Promise<NotionQueryResult> {
  logger.debug("Querying inbox", options);

  const filters: any[] = [];

  if (options.pillar) {
    filters.push({
      property: "Pillar",
      select: { equals: options.pillar },
    });
  }

  if (options.status) {
    filters.push({
      property: "Atlas Status",
      select: { equals: options.status },
    });
  }

  const sorts: any[] = [];
  if (options.sortBy === "created") {
    sorts.push({ property: "Spark Date", direction: options.sortDirection === "asc" ? "ascending" : "descending" });
  } else if (options.sortBy === "updated") {
    sorts.push({ timestamp: "last_edited_time", direction: options.sortDirection === "asc" ? "ascending" : "descending" });
  }

  try {
    const response = await getNotionClient().databases.query({
      database_id: getDatabaseIds().inbox,
      filter: filters.length > 0 ? { and: filters } : undefined,
      sorts: sorts.length > 0 ? sorts : [{ timestamp: "created_time", direction: "descending" }],
      page_size: options.limit || 10,
    });

    const items: NotionItemSummary[] = response.results.map((page: any) => ({
      id: page.id,
      title: extractTitle(page),
      pillar: extractSelect(page, "Pillar") as Pillar | undefined,
      status: extractSelect(page, "Atlas Status"),
      priority: undefined, // Inbox doesn't have priority
      createdAt: page.created_time ? new Date(page.created_time) : undefined,
      url: extractUrl(page, "Source"),
    }));

    return {
      items,
      total: response.results.length,
      hasMore: response.has_more,
    };
  } catch (error) {
    logger.error("Failed to query inbox", { error });
    throw error;
  }
}

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

  const sorts: any[] = [];
  if (options.sortBy === "priority") {
    sorts.push({ property: "Priority", direction: options.sortDirection === "desc" ? "descending" : "ascending" });
  } else if (options.sortBy === "created") {
    sorts.push({ property: "Queued", direction: options.sortDirection === "asc" ? "ascending" : "descending" });
  }

  try {
    const response = await getNotionClient().databases.query({
      database_id: getDatabaseIds().workQueue,
      filter: filters.length > 0 ? { and: filters } : undefined,
      sorts: sorts.length > 0 ? sorts : [{ property: "Priority", direction: "ascending" }],
      page_size: options.limit || 10,
    });

    const items: NotionItemSummary[] = response.results.map((page: any) => ({
      id: page.id,
      title: extractTitle(page),
      pillar: undefined,
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

/**
 * Get status summary across databases
 */
export async function getStatusSummary(): Promise<StatusSummary> {
  logger.debug("Getting status summary");

  try {
    // Query both databases for aggregates
    const [inboxResponse, workResponse] = await Promise.all([
      getNotionClient().databases.query({
        database_id: getDatabaseIds().inbox,
        page_size: 100,
      }),
      getNotionClient().databases.query({
        database_id: getDatabaseIds().workQueue,
        page_size: 100,
      }),
    ]);

    // Aggregate inbox stats
    const inboxByStatus: Record<string, number> = {};
    const inboxByPillar: Record<string, number> = {};

    for (const page of inboxResponse.results as any[]) {
      const status = extractSelect(page, "Atlas Status") || "Unknown";
      const pillar = extractSelect(page, "Pillar") || "Unknown";

      inboxByStatus[status] = (inboxByStatus[status] || 0) + 1;
      inboxByPillar[pillar] = (inboxByPillar[pillar] || 0) + 1;
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
      inbox: {
        total: inboxResponse.results.length,
        byStatus: inboxByStatus,
        byPillar: inboxByPillar,
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
      const parentDb = pageAny.parent?.database_id;

      let type: "inbox" | "work" | "page" = "page";
      if (parentDb === getDatabaseIds().inbox.replace(/-/g, "")) {
        type = "inbox";
      } else if (parentDb === getDatabaseIds().workQueue.replace(/-/g, "")) {
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
 * Update a Notion page (complete, archive, dismiss)
 */
export async function updateNotionPage(
  pageId: string,
  action: "complete" | "archive" | "dismiss" | "defer"
): Promise<void> {
  logger.info("Updating Notion page", { pageId, action });

  // Determine which database and status to set
  const page = await getNotionClient().pages.retrieve({ page_id: pageId });
  const pageAny = page as any;
  const parentDb = pageAny.parent?.database_id?.replace(/-/g, "");

  const isInbox = parentDb === getDatabaseIds().inbox.replace(/-/g, "");
  const isWorkQueue = parentDb === getDatabaseIds().workQueue.replace(/-/g, "");

  try {
    if (isInbox) {
      const statusMap: Record<string, AtlasStatus> = {
        complete: "Archived",
        archive: "Archived",
        dismiss: "Dismissed",
        defer: "Classified", // Keep in inbox but mark for later
      };

      await getNotionClient().pages.update({
        page_id: pageId,
        properties: {
          "Atlas Status": {
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

    // Add a comment noting the action
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

/**
 * Find an item by title search (for action intents)
 */
export async function findItemByTitle(
  query: string
): Promise<NotionItemSummary | null> {
  logger.debug("Finding item by title", { query });

  // Search inbox first
  const inboxResults = await queryInbox({ limit: 20 });
  const lowerQuery = query.toLowerCase();

  for (const item of inboxResults.items) {
    if (item.title.toLowerCase().includes(lowerQuery)) {
      return item;
    }
  }

  // Search work queue
  const workResults = await queryWorkQueue({ limit: 20 });

  for (const item of workResults.items) {
    if (item.title.toLowerCase().includes(lowerQuery)) {
      return item;
    }
  }

  // Fall back to Notion search
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
// Helper Functions
// ==========================================

/**
 * Extract title from a Notion page
 */
function extractTitle(page: any): string {
  // Try common title property names
  for (const propName of ["Spark", "Task", "Name", "Title"]) {
    const prop = page.properties?.[propName];
    if (prop?.title?.[0]?.plain_text) {
      return prop.title[0].plain_text;
    }
  }
  return "Untitled";
}

/**
 * Extract title from search result
 */
function extractSearchTitle(page: any): string {
  // For search results, title is in a different location
  if (page.properties) {
    return extractTitle(page);
  }
  return "Untitled";
}

/**
 * Extract select value from a property
 */
function extractSelect(page: any, propName: string): string | undefined {
  return page.properties?.[propName]?.select?.name;
}

/**
 * Extract URL from a property
 */
function extractUrl(page: any, propName: string): string | undefined {
  return page.properties?.[propName]?.url;
}

/**
 * Extract date from a property
 */
function extractDate(page: any, propName: string): Date | undefined {
  const dateStr = page.properties?.[propName]?.date?.start;
  return dateStr ? new Date(dateStr) : undefined;
}
