/**
 * Atlas Daily Briefing - Notion Queries
 *
 * Queries Feed 2.0 (activity log) and Work Queue 2.0 (task ledger).
 * NO INBOX - Telegram IS the inbox.
 *
 * CANONICAL DATABASE IDs (for Notion SDK):
 * - Feed 2.0:       90b2b33f-4b44-4b42-870f-8d62fb8cbf18
 * - Work Queue 2.0: 3d679030-b76b-43bd-92d8-1ac51abb4a28
 */

import { Client } from "@notionhq/client";
import { logger } from "../logger";

// CANONICAL DATA SOURCE IDs - DO NOT CHANGE
const FEED_DB_ID = "90b2b33f-4b44-4b42-870f-8d62fb8cbf18";
const WORK_QUEUE_DB_ID = "3d679030-b76b-43bd-92d8-1ac51abb4a28";

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
  feedPendingCount: number;
  pendingSkills?: number;
  // DEPRECATED: Use feedPendingCount instead
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
 * Get count of Feed items awaiting processing (Received or Processing status)
 * Note: Telegram IS the inbox now. This counts Feed entries not yet Done.
 */
export async function getFeedPendingCount(): Promise<number> {
  const notion = getNotionClient();

  try {
    const response = await notion.databases.query({
      database_id: FEED_DB_ID,
      filter: {
        or: [
          { property: "Status", select: { equals: "Received" } },
          { property: "Status", select: { equals: "Processing" } },
        ],
      },
    });

    return response.results.length;
  } catch (error) {
    logger.error("Failed to query Feed pending count", { error });
    return 0;
  }
}

// DEPRECATED: Alias for legacy code
export const getInboxCount = getFeedPendingCount;

/**
 * Get pending skill proposals count
 */
async function getPendingSkillsCount(): Promise<number> {
  try {
    const { getQueueStats } = await import("../skills/approval-queue");
    const stats = await getQueueStats();
    return stats.pending;
  } catch {
    // Skills system may not be initialized
    return 0;
  }
}

/**
 * Fetch all briefing data in parallel
 */
export async function fetchBriefingData(): Promise<BriefingData> {
  const [blocked, dueThisWeek, active, completedYesterday, feedPendingCount, pendingSkills] =
    await Promise.all([
      getBlockedItems(),
      getDueThisWeek(),
      getActiveItems(),
      getCompletedYesterday(),
      getFeedPendingCount(),
      getPendingSkillsCount(),
    ]);

  return {
    blocked,
    dueThisWeek,
    active,
    completedYesterday,
    feedPendingCount,
    pendingSkills,
    inboxCount: feedPendingCount, // Legacy alias
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
