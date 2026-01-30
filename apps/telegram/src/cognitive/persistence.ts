/**
 * Cognitive Router - Notion Persistence
 *
 * Persists token ledger entries and worker results to Notion databases.
 */

import { Client } from "@notionhq/client";
import type { TokenLedgerEntry, WorkerResult } from "./types";
import { getCognitiveConfig } from "../config/cognitive";
import { logger } from "../logger";

// Lazy-initialized Notion client
let _notion: Client | null = null;

function getNotionClient(): Client {
  if (!_notion) {
    const apiKey = process.env.NOTION_API_KEY;
    if (!apiKey) {
      throw new Error("NOTION_API_KEY not configured");
    }
    _notion = new Client({ auth: apiKey });
  }
  return _notion;
}

/**
 * Persist a token ledger entry to Notion
 */
export async function persistTokenEntry(entry: TokenLedgerEntry): Promise<string | null> {
  const config = getCognitiveConfig();
  const databaseId = config.notion.tokenLedger;

  if (!databaseId) {
    logger.warn("Token ledger database not configured");
    return null;
  }

  try {
    const notion = getNotionClient();

    const response = await notion.pages.create({
      parent: { database_id: databaseId },
      properties: {
        "Task ID": {
          title: [{ text: { content: entry.taskId } }],
        },
        Model: {
          select: { name: formatModelName(entry.model) },
        },
        Provider: {
          select: { name: entry.provider },
        },
        Endpoint: {
          select: { name: entry.endpoint },
        },
        "Input Tokens": {
          number: entry.inputTokens,
        },
        "Output Tokens": {
          number: entry.outputTokens,
        },
        "Cost (USD)": {
          number: entry.costUsd,
        },
        "Latency (ms)": {
          number: entry.latencyMs,
        },
        Success: {
          checkbox: entry.success,
        },
        Timestamp: {
          date: { start: entry.timestamp.toISOString() },
        },
      },
    });

    logger.debug("Token entry persisted to Notion", {
      pageId: response.id,
      taskId: entry.taskId,
    });

    return response.id;
  } catch (error) {
    // Log at debug level - Notion persistence is optional
    logger.debug("Notion persistence skipped (token entry)", {
      taskId: entry.taskId,
      reason: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Persist a worker result to Notion
 */
export async function persistWorkerResult(
  result: WorkerResult,
  taskSummary: string,
  tokenSpendId?: string
): Promise<string | null> {
  const config = getCognitiveConfig();
  const databaseId = config.notion.workerResults;

  if (!databaseId) {
    logger.warn("Worker results database not configured");
    return null;
  }

  try {
    const notion = getNotionClient();

    const properties: Record<string, unknown> = {
      "Task Summary": {
        title: [{ text: { content: taskSummary.substring(0, 100) } }],
      },
      "Task ID": {
        rich_text: [{ text: { content: result.taskId } }],
      },
      Model: {
        select: { name: formatModelName(result.modelId) },
      },
      Provider: {
        select: { name: result.provider },
      },
      Endpoint: {
        select: { name: result.endpoint },
      },
      Status: {
        select: { name: result.success ? "Success" : "Failed" },
      },
      "Cost (USD)": {
        number: result.usage.cost,
      },
      "Latency (ms)": {
        number: result.latencyMs,
      },
      Rerunnable: {
        checkbox: !result.error?.includes("auth"), // Can rerun if not auth error
      },
      Created: {
        date: { start: new Date().toISOString() },
      },
    };

    // Add relation to token spend if available
    if (tokenSpendId) {
      properties["Token Spend"] = {
        relation: [{ id: tokenSpendId }],
      };
    }

    const response = await notion.pages.create({
      parent: { database_id: databaseId },
      properties: properties as any,
    });

    logger.debug("Worker result persisted to Notion", {
      pageId: response.id,
      taskId: result.taskId,
    });

    return response.id;
  } catch (error) {
    // Log at debug level - Notion persistence is optional
    logger.debug("Notion persistence skipped (worker result)", {
      taskId: result.taskId,
      reason: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Persist both token entry and worker result
 */
export async function persistWorkerExecution(
  result: WorkerResult,
  taskSummary: string
): Promise<{ tokenEntryId: string | null; workerResultId: string | null }> {
  // First persist token entry
  const tokenEntry: TokenLedgerEntry = {
    taskId: result.taskId,
    model: result.modelId,
    provider: result.provider,
    endpoint: result.endpoint,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    costUsd: result.usage.cost,
    latencyMs: result.latencyMs,
    success: result.success,
    timestamp: new Date(),
  };

  const tokenEntryId = await persistTokenEntry(tokenEntry);

  // Then persist worker result with relation
  const workerResultId = await persistWorkerResult(result, taskSummary, tokenEntryId || undefined);

  return { tokenEntryId, workerResultId };
}

/**
 * Batch persist multiple entries (for session flush)
 */
export async function batchPersistTokenEntries(
  entries: TokenLedgerEntry[]
): Promise<number> {
  let successCount = 0;

  for (const entry of entries) {
    const id = await persistTokenEntry(entry);
    if (id) successCount++;
  }

  logger.info("Batch persisted token entries", {
    total: entries.length,
    success: successCount,
  });

  return successCount;
}

/**
 * Format model name for Notion select (match configured options)
 */
function formatModelName(modelId: string): string {
  // Map full model IDs to Notion select option names
  const modelMap: Record<string, string> = {
    "claude-sonnet-4-20250514": "claude-sonnet-4",
    "claude-3-5-haiku-20241022": "claude-3-5-haiku",
    "gpt-4o": "gpt-4o",
    "gpt-4o-mini": "gpt-4o-mini",
    local: "local",
  };

  return modelMap[modelId] || modelId;
}

/**
 * Query recent token entries for reporting
 */
export async function queryRecentTokenEntries(
  limit: number = 10
): Promise<TokenLedgerEntry[]> {
  const config = getCognitiveConfig();
  const databaseId = config.notion.tokenLedger;

  if (!databaseId) {
    return [];
  }

  try {
    const notion = getNotionClient();

    const response = await notion.databases.query({
      database_id: databaseId,
      sorts: [{ property: "Timestamp", direction: "descending" }],
      page_size: limit,
    });

    return response.results.map((page: any) => ({
      taskId: page.properties["Task ID"]?.title?.[0]?.text?.content || "",
      model: page.properties["Model"]?.select?.name || "",
      provider: page.properties["Provider"]?.select?.name || "local",
      endpoint: page.properties["Endpoint"]?.select?.name || "local",
      inputTokens: page.properties["Input Tokens"]?.number || 0,
      outputTokens: page.properties["Output Tokens"]?.number || 0,
      costUsd: page.properties["Cost (USD)"]?.number || 0,
      latencyMs: page.properties["Latency (ms)"]?.number || 0,
      success: page.properties["Success"]?.checkbox || false,
      timestamp: new Date(page.properties["Timestamp"]?.date?.start || Date.now()),
    }));
  } catch (error) {
    logger.error("Failed to query token entries", { error });
    return [];
  }
}

/**
 * Get total spend from Notion (for budget tracking across sessions)
 */
export async function getTotalSpendFromNotion(): Promise<number> {
  const entries = await queryRecentTokenEntries(100); // Get last 100 entries
  return entries.reduce((sum, e) => sum + e.costUsd, 0);
}
