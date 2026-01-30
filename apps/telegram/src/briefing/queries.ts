/**
 * Atlas Daily Briefing - Notion Queries
 *
 * Queries Work Queue 2.0 and Inbox 2.0 for briefing data.
 */

import { Client } from "@notionhq/client";
import { logger } from "../logger";

// Database IDs
const WORK_QUEUE_DB_ID = "3d679030-b76b-43bd-92d8-1ac51abb4a28";
const INBOX_DB_ID = "f6f638c9-6aee-42a7-8137-df5b6a560f50";

// Lazy-initialized Notion client
let _notion: Client | null = null;
function getNotionClient(): Client {
  if (!_notion) {
    _notion = new Client({ auth: process.env.NOTION_API_KEY });
  }
  return _notion;
}

// ==========================================
// Types
// ==========================================

export interface BriefingItem {
  id: string;
  title: string;
  status?: string;
  priority?: string;
  dueDate?: Date;
  completedDate?: Date;
  blockedReason?: string;
  daysSinceBlocked?: number;
  progress?: number;
}

export interface BriefingData {
  blocked: BriefingItem[];
  dueThisWeek: BriefingItem[];
  active: BriefingItem[];
  completedYesterday: BriefingItem[];
  inboxCount: number;
  queriedAt: Date;
}

// ==========================================
// Query Functions
// ==========================================

/**
 * Get blocked items from Work Queue
 */
export async function getBlockedItems(): Promise<BriefingItem[]> {
  const notion = getNotionClient();

  try {
    const response = await notion.databases.query({
      database_id: WORK_QUEUE_DB_ID,
      filter: {
        property: "Status",
        select: { equals: "Blocked" },
      },
      sorts: [{ property: "Priority", direction: "ascending" }],
    });

    return response.results.map((page: any) => {
      const startedDate = extractDate(page, "Started");
      const daysSinceBlocked = startedDate
        ? Math.floor((Date.now() - startedDate.getTime()) / (1000 * 60 * 60 * 24))
        : undefined;

      return {
        id: page.id,
        title: extractTitle(page),
        status: "Blocked",
        priority: extractSelect(page, "Priority"),
        blockedReason: extractRichText(page, "Blocked Reason"),
        daysSinceBlocked,
      };
    });
  } catch (error) {
    logger.error("Failed to query blocked items", { error });
    return [];
  }
}

/**
 * Get items due this week from Work Queue
 */
export async function getDueThisWeek(): Promise<BriefingItem[]> {
  const notion = getNotionClient();

  // Calculate date range: now to 7 days from now
  const now = new Date();
  const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  try {
    const response = await notion.databases.query({
      database_id: WORK_QUEUE_DB_ID,
      filter: {
        and: [
          {
            property: "Due",
            date: { on_or_before: weekFromNow.toISOString().split("T")[0] },
          },
          {
            property: "Status",
            select: { does_not_equal: "Done" },
          },
          {
            property: "Status",
            select: { does_not_equal: "Shipped" },
          },
        ],
      },
      sorts: [{ property: "Due", direction: "ascending" }],
    });

    return response.results.map((page: any) => ({
      id: page.id,
      title: extractTitle(page),
      status: extractSelect(page, "Status"),
      priority: extractSelect(page, "Priority"),
      dueDate: extractDate(page, "Due"),
    }));
  } catch (error) {
    logger.error("Failed to query due items", { error });
    return [];
  }
}

/**
 * Get active items from Work Queue
 */
export async function getActiveItems(): Promise<BriefingItem[]> {
  const notion = getNotionClient();

  try {
    const response = await notion.databases.query({
      database_id: WORK_QUEUE_DB_ID,
      filter: {
        property: "Status",
        select: { equals: "Active" },
      },
      sorts: [{ property: "Priority", direction: "ascending" }],
    });

    return response.results.map((page: any) => ({
      id: page.id,
      title: extractTitle(page),
      status: "Active",
      priority: extractSelect(page, "Priority"),
      progress: extractProgress(page),
    }));
  } catch (error) {
    logger.error("Failed to query active items", { error });
    return [];
  }
}

/**
 * Get items completed yesterday from Work Queue
 */
export async function getCompletedYesterday(): Promise<BriefingItem[]> {
  const notion = getNotionClient();

  // Calculate yesterday's date range
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const yesterdayStr = yesterday.toISOString().split("T")[0];

  try {
    const response = await notion.databases.query({
      database_id: WORK_QUEUE_DB_ID,
      filter: {
        and: [
          {
            or: [
              { property: "Status", select: { equals: "Done" } },
              { property: "Status", select: { equals: "Shipped" } },
            ],
          },
          {
            property: "Completed",
            date: { equals: yesterdayStr },
          },
        ],
      },
    });

    return response.results.map((page: any) => ({
      id: page.id,
      title: extractTitle(page),
      status: extractSelect(page, "Status"),
      completedDate: extractDate(page, "Completed"),
    }));
  } catch (error) {
    logger.error("Failed to query completed items", { error });
    return [];
  }
}

/**
 * Get count of unprocessed inbox items
 */
export async function getInboxCount(): Promise<number> {
  const notion = getNotionClient();

  try {
    const response = await notion.databases.query({
      database_id: INBOX_DB_ID,
      filter: {
        property: "Atlas Status",
        select: { equals: "Captured" },
      },
    });

    return response.results.length;
  } catch (error) {
    logger.error("Failed to query inbox count", { error });
    return 0;
  }
}

/**
 * Fetch all briefing data in parallel
 */
export async function fetchBriefingData(): Promise<BriefingData> {
  const [blocked, dueThisWeek, active, completedYesterday, inboxCount] =
    await Promise.all([
      getBlockedItems(),
      getDueThisWeek(),
      getActiveItems(),
      getCompletedYesterday(),
      getInboxCount(),
    ]);

  return {
    blocked,
    dueThisWeek,
    active,
    completedYesterday,
    inboxCount,
    queriedAt: new Date(),
  };
}

// ==========================================
// Helper Functions
// ==========================================

function extractTitle(page: any): string {
  for (const propName of ["Task", "Spark", "Name", "Title"]) {
    const prop = page.properties?.[propName];
    if (prop?.title?.[0]?.plain_text) {
      return prop.title[0].plain_text;
    }
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

function extractRichText(page: any, propName: string): string | undefined {
  const richText = page.properties?.[propName]?.rich_text;
  if (!richText || richText.length === 0) return undefined;
  return richText.map((rt: any) => rt.plain_text || "").join("");
}

function extractProgress(page: any): number | undefined {
  // Try to extract progress from Notes field if it contains percentage
  const notes = extractRichText(page, "Notes");
  if (notes) {
    const match = notes.match(/(\d+)%/);
    if (match) {
      return parseInt(match[1], 10);
    }
  }
  return undefined;
}
