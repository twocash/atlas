/**
 * Atlas Active Worker
 *
 * Background process that polls the Work Queue for tasks
 * with Status=Triaged AND Type=Research, then executes them.
 *
 * This implements the "Active Worker" pattern from the Neuro-Link Sprint:
 * - Poll for ready work ("Triaged" = classified and ready, not "Captured" which needs review)
 * - Lock task → Active
 * - Execute research
 * - Complete → Done
 *
 * Status Flow:
 * - Captured: Needs human review before execution
 * - Triaged: Ready for autonomous execution (worker picks up)
 * - Active: Currently being worked on
 * - Done: Completed successfully
 * - Blocked: Failed or stuck
 *
 * Usage:
 *   bun packages/agents/src/worker.ts
 *
 * Or via package.json script:
 *   cd packages/agents && bun run worker
 */

import { Client } from "@notionhq/client";
import { NOTION_DB } from "@atlas/shared/config";
import { AgentRegistry } from "./registry";
import { executeResearch } from "./agents/research";
import {
  wireAgentToWorkQueue,
  syncAgentComplete,
  syncAgentFailure,
} from "./workqueue";

// ==========================================
// Configuration
// ==========================================

const WORK_QUEUE_DB_ID = NOTION_DB.WORK_QUEUE;
const POLL_INTERVAL_MS = 30000; // 30 seconds
const MAX_CONCURRENT = 1; // Process one task at a time

// ==========================================
// Notion Client
// ==========================================

let notion: Client | null = null;

function getNotionClient(): Client {
  if (!notion) {
    const apiKey = process.env.NOTION_API_KEY;
    if (!apiKey) {
      throw new Error("NOTION_API_KEY environment variable is required");
    }
    notion = new Client({ auth: apiKey });
  }
  return notion;
}

// ==========================================
// Worker State
// ==========================================

let isRunning = false;
let activeTaskId: string | null = null;

// ==========================================
// Notion Property Helpers
// ==========================================

function getTitle(props: Record<string, unknown>, key: string): string {
  const prop = props[key] as {
    type?: string;
    title?: Array<{ plain_text?: string }>;
  } | undefined;
  if (
    prop?.type === "title" &&
    Array.isArray(prop.title) &&
    prop.title[0]?.plain_text
  ) {
    return prop.title[0].plain_text;
  }
  return "Untitled";
}

function getSelect(props: Record<string, unknown>, key: string): string | null {
  const prop = props[key] as {
    type?: string;
    select?: { name?: string } | null;
  } | undefined;
  if (prop?.type === "select" && prop.select?.name) {
    return prop.select.name;
  }
  return null;
}

function getStatus(props: Record<string, unknown>, key: string): string | null {
  const prop = props[key] as {
    type?: string;
    status?: { name?: string } | null;
  } | undefined;
  if (prop?.type === "status" && prop.status?.name) {
    return prop.status.name;
  }
  return null;
}

function getRichText(
  props: Record<string, unknown>,
  key: string
): string | null {
  const prop = props[key] as {
    type?: string;
    rich_text?: Array<{ plain_text?: string }>;
  } | undefined;
  if (
    prop?.type === "rich_text" &&
    Array.isArray(prop.rich_text) &&
    prop.rich_text.length > 0
  ) {
    return prop.rich_text.map((t) => t.plain_text || "").join("");
  }
  return null;
}

// ==========================================
// Task Discovery
// ==========================================

interface TriagedTask {
  id: string;
  title: string;
  type: string;
  priority: string;
  pillar: string;
  notes: string | null;
  url: string;
}

/**
 * Find tasks ready for execution
 * Status=Triaged AND Type=Research
 *
 * "Triaged" means: classified, ready for work, approved for autonomous execution
 */
async function findTriagedTasks(): Promise<TriagedTask[]> {
  const client = getNotionClient();

  try {
    const response = await client.databases.query({
      database_id: WORK_QUEUE_DB_ID,
      filter: {
        and: [
          { property: "Status", select: { equals: "Triaged" } },
          { property: "Type", select: { equals: "Research" } },
        ],
      },
      sorts: [
        { property: "Priority", direction: "ascending" }, // P0 first
        { property: "Queued", direction: "ascending" }, // Oldest first
      ],
      page_size: 10,
    });

    return response.results.map((page: any) => {
      const props = page.properties as Record<string, unknown>;
      return {
        id: page.id,
        title: getTitle(props, "Task"),
        type: getSelect(props, "Type") || "Research",
        priority: getSelect(props, "Priority") || "P2",
        pillar: getSelect(props, "Pillar") || "The Grove",
        notes: getRichText(props, "Notes"),
        url: page.url || `https://notion.so/${page.id.replace(/-/g, "")}`,
      };
    });
  } catch (error) {
    console.error("[Worker] Failed to query Work Queue:", error);
    return [];
  }
}

// Legacy alias for compatibility
const findQueuedTasks = findTriagedTasks;

// ==========================================
// Task Execution
// ==========================================

/**
 * Lock a task by setting Status → Active
 */
async function lockTask(taskId: string): Promise<boolean> {
  const client = getNotionClient();

  try {
    await client.pages.update({
      page_id: taskId,
      properties: {
        Status: { select: { name: "Active" } },
        Started: { date: { start: new Date().toISOString().split("T")[0] } },
      },
    });
    console.log(`[Worker] Locked task: ${taskId}`);
    return true;
  } catch (error) {
    console.error(`[Worker] Failed to lock task ${taskId}:`, error);
    return false;
  }
}

/**
 * Get the task specification from page body
 */
async function getTaskContext(taskId: string): Promise<string> {
  const client = getNotionClient();

  try {
    const blocks = await client.blocks.children.list({
      block_id: taskId,
      page_size: 50,
    });

    const textParts: string[] = [];

    for (const block of blocks.results as any[]) {
      if (block.type === "paragraph" && block.paragraph?.rich_text) {
        const text = block.paragraph.rich_text
          .map((t: any) => t.plain_text || "")
          .join("");
        if (text) textParts.push(text);
      } else if (block.type === "callout" && block.callout?.rich_text) {
        const text = block.callout.rich_text
          .map((t: any) => t.plain_text || "")
          .join("");
        if (text) textParts.push(text);
      } else if (
        block.type === "bulleted_list_item" &&
        block.bulleted_list_item?.rich_text
      ) {
        const text = block.bulleted_list_item.rich_text
          .map((t: any) => t.plain_text || "")
          .join("");
        if (text) textParts.push(`• ${text}`);
      }
    }

    return textParts.join("\n\n");
  } catch (error) {
    console.error(`[Worker] Failed to get task context:`, error);
    return "";
  }
}

/**
 * Execute a research task
 */
async function executeTask(task: TriagedTask): Promise<void> {
  console.log(`\n[Worker] ========================================`);
  console.log(`[Worker] Executing: ${task.title}`);
  console.log(`[Worker] Priority: ${task.priority} | Pillar: ${task.pillar}`);
  console.log(`[Worker] URL: ${task.url}`);
  console.log(`[Worker] ========================================\n`);

  activeTaskId = task.id;

  // Create registry for this task
  const registry = new AgentRegistry();

  try {
    // Get expanded context from page body
    const context = await getTaskContext(task.id);
    const fullQuery = task.notes
      ? `${task.title}\n\n${task.notes}\n\n${context}`
      : `${task.title}\n\n${context}`;

    console.log(`[Worker] Research query:\n${fullQuery.substring(0, 500)}...`);

    // Spawn the agent
    const agent = await registry.spawn({
      type: "research",
      name: `Research: ${task.title.substring(0, 50)}`,
      instructions: JSON.stringify({ query: fullQuery, depth: "standard" }),
      priority: task.priority as "P0" | "P1" | "P2",
      workItemId: task.id,
    });

    // Wire to Work Queue for automatic status updates
    const subscription = await wireAgentToWorkQueue(agent, registry);

    // Start the agent
    await registry.start(agent.id);

    // Execute research
    console.log(`[Worker] Starting Gemini research...`);
    const result = await executeResearch(
      {
        query: fullQuery,
        depth: "standard",
        voice: "grove-analytical",
      },
      agent,
      registry
    );

    // Complete or fail
    if (result.success) {
      console.log(`[Worker] Research completed successfully`);
      await registry.complete(agent.id, result);
      // syncAgentComplete is called automatically via wireAgentToWorkQueue
    } else {
      console.log(`[Worker] Research failed: ${result.summary}`);
      await registry.fail(agent.id, result.summary || "Research failed", true);
      // syncAgentFailure is called automatically via wireAgentToWorkQueue
    }

    // Cleanup
    subscription.unsubscribe();
    console.log(`[Worker] Task complete: ${task.id}`);
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    console.error(`[Worker] Task execution failed:`, errorMessage);

    // Mark task as blocked in Notion
    try {
      const client = getNotionClient();
      await client.pages.update({
        page_id: task.id,
        properties: {
          Status: { select: { name: "Blocked" } },
          "Blocked Reason": {
            rich_text: [
              { text: { content: `Worker error: ${errorMessage}` } },
            ],
          },
        },
      });
    } catch (updateError) {
      console.error(`[Worker] Failed to mark task as blocked:`, updateError);
    }
  } finally {
    activeTaskId = null;
  }
}

// ==========================================
// Worker Loop
// ==========================================

/**
 * Run one polling cycle
 * Exported for testing
 */
export async function runCycle(): Promise<void> {
  if (activeTaskId) {
    console.log(`[Worker] Skipping cycle - task in progress: ${activeTaskId}`);
    return;
  }

  console.log(`[Worker] Polling for triaged tasks...`);

  const tasks = await findTriagedTasks();

  if (tasks.length === 0) {
    console.log(`[Worker] No tasks found`);
    return;
  }

  console.log(`[Worker] Found ${tasks.length} triaged task(s)`);

  // Process first task (FIFO with priority)
  const task = tasks[0];

  // Lock it
  const locked = await lockTask(task.id);
  if (!locked) {
    console.log(`[Worker] Failed to lock task, skipping`);
    return;
  }

  // Execute
  await executeTask(task);
}

/**
 * Start the worker
 */
export async function startWorker(): Promise<void> {
  if (isRunning) {
    console.log("[Worker] Already running");
    return;
  }

  console.log("=========================================");
  console.log("       Atlas Active Worker v1.0");
  console.log("=========================================");
  console.log(`[Worker] Poll interval: ${POLL_INTERVAL_MS / 1000}s`);
  console.log(`[Worker] Max concurrent: ${MAX_CONCURRENT}`);
  console.log(`[Worker] Database: ${WORK_QUEUE_DB_ID}`);
  console.log("");

  // Verify Notion connection
  try {
    const client = getNotionClient();
    await client.databases.retrieve({ database_id: WORK_QUEUE_DB_ID });
    console.log("[Worker] ✓ Notion connection verified");
  } catch (error) {
    console.error("[Worker] ✗ Notion connection failed:", error);
    process.exit(1);
  }

  // Verify Gemini key
  if (!process.env.GEMINI_API_KEY) {
    console.error("[Worker] ✗ GEMINI_API_KEY not set");
    process.exit(1);
  }
  console.log("[Worker] ✓ Gemini API key present");

  console.log("\n[Worker] 👷 Worker online. Polling every 30s...\n");

  isRunning = true;

  // Initial run
  await runCycle();

  // Start polling
  setInterval(runCycle, POLL_INTERVAL_MS);
}

/**
 * Stop the worker
 */
export function stopWorker(): void {
  isRunning = false;
  console.log("[Worker] Stopped");
}

// ==========================================
// Main Entry Point
// ==========================================

// Run if executed directly
if (import.meta.main) {
  startWorker().catch((err) => {
    console.error("[Worker] Fatal error:", err);
    process.exit(1);
  });
}
