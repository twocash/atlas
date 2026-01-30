/**
 * Atlas Agent SDK - Work Queue Integration
 *
 * Syncs agent lifecycle events to Notion Work Queue so Jim
 * sees real-time agent progress in his dashboard.
 *
 * Database: Work Queue 2.0
 * ID: 6a8d9c43-b084-47b5-bc83-bc363640f2cd
 */

import { Client } from "@notionhq/client";
import type {
  WorkQueueStatus,
  WorkQueueUpdater,
  Agent,
  AgentEvent,
  AgentResult,
} from "./types";

// ==========================================
// Configuration
// ==========================================

const WORK_QUEUE_DB_ID = "6a8d9c43-b084-47b5-bc83-bc363640f2cd";

// ==========================================
// Notion Client (Lazy Loaded)
// ==========================================

let _notion: Client | null = null;

function getNotionClient(): Client {
  if (!_notion) {
    const apiKey = process.env.NOTION_API_KEY;
    if (!apiKey) {
      throw new Error("NOTION_API_KEY environment variable is required");
    }
    _notion = new Client({ auth: apiKey });
  }
  return _notion;
}

/**
 * Get formatted date string for Notion (YYYY-MM-DD)
 */
function formatDate(date: Date = new Date()): string {
  return date.toISOString().split("T")[0];
}

/**
 * Get Notion page URL from page ID
 */
export function getNotionPageUrl(pageId: string): string {
  const cleanId = pageId.replace(/-/g, "");
  return `https://notion.so/${cleanId}`;
}

// ==========================================
// Work Queue Updater Implementation
// ==========================================

/**
 * Implementation of WorkQueueUpdater interface
 * Updates Notion Work Queue items based on agent events
 */
export class NotionWorkQueueUpdater implements WorkQueueUpdater {
  /**
   * Update status of a Work Queue item
   */
  async updateStatus(
    itemId: string,
    status: WorkQueueStatus,
    notes?: string
  ): Promise<void> {
    const properties: Record<string, unknown> = {
      Status: {
        select: { name: status },
      },
    };

    // Append notes if provided
    if (notes) {
      // Get existing notes first
      const page = await getNotionClient().pages.retrieve({ page_id: itemId });
      const existingNotes = extractRichText(page, "Notes") || "";
      const updatedNotes = existingNotes
        ? `${existingNotes}\n\n${notes}`
        : notes;

      properties["Notes"] = {
        rich_text: [{ text: { content: truncateText(updatedNotes, 2000) } }],
      };
    }

    await getNotionClient().pages.update({
      page_id: itemId,
      properties,
    });
  }

  /**
   * Add a comment to a Work Queue item
   */
  async addComment(itemId: string, comment: string): Promise<void> {
    await getNotionClient().comments.create({
      parent: { page_id: itemId },
      rich_text: [{ text: { content: truncateText(comment, 2000) } }],
    });
  }

  /**
   * Set output/result on completion
   */
  async setOutput(itemId: string, output: string): Promise<void> {
    await getNotionClient().pages.update({
      page_id: itemId,
      properties: {
        Output: {
          rich_text: [{ text: { content: truncateText(output, 2000) } }],
        },
      },
    });
  }
}

// ==========================================
// Agent Lifecycle Sync
// ==========================================

/**
 * Sync agent spawn event to Work Queue
 * Sets status to "Active" and records start time
 */
export async function syncAgentSpawn(
  workItemId: string,
  agent: Agent
): Promise<void> {
  const notion = getNotionClient();

  await notion.pages.update({
    page_id: workItemId,
    properties: {
      Status: {
        select: { name: "Active" },
      },
      Started: {
        date: { start: formatDate(agent.startedAt || new Date()) },
      },
    },
  });

  // Add comment documenting agent assignment
  await notion.comments.create({
    parent: { page_id: workItemId },
    rich_text: [
      {
        text: {
          content: `[AGENT ASSIGNED - ${formatDate()}]

Agent ID: ${agent.id}
Type: ${agent.type}
Priority: ${agent.priority}

Agent is now executing this task autonomously.`,
        },
      },
    ],
  });
}

/**
 * Sync agent progress to Work Queue
 * Updates notes with progress summary
 */
export async function syncAgentProgress(
  workItemId: string,
  agent: Agent,
  progress: number,
  activity?: string
): Promise<void> {
  const notion = getNotionClient();

  // Build progress summary
  const progressBar = buildProgressBar(progress);
  const timestamp = new Date().toLocaleTimeString();
  const summary = `[${timestamp}] ${progressBar} ${progress}%${activity ? ` - ${activity}` : ""}`;

  // Get existing notes and append
  const page = await notion.pages.retrieve({ page_id: workItemId });
  const existingNotes = extractRichText(page, "Notes") || "";

  // Keep last 5 progress updates to avoid bloat
  const progressLines = existingNotes
    .split("\n")
    .filter((line) => line.startsWith("[") && line.includes("%"));
  const otherLines = existingNotes
    .split("\n")
    .filter((line) => !line.startsWith("[") || !line.includes("%"));

  const recentProgress = [...progressLines.slice(-4), summary];
  const updatedNotes = [...otherLines, ...recentProgress]
    .filter(Boolean)
    .join("\n");

  await notion.pages.update({
    page_id: workItemId,
    properties: {
      Notes: {
        rich_text: [{ text: { content: truncateText(updatedNotes, 2000) } }],
      },
    },
  });
}

/**
 * Sync agent completion to Work Queue
 * Sets status to "Done", populates Output, sets Completed date
 */
export async function syncAgentComplete(
  workItemId: string,
  agent: Agent,
  result: AgentResult
): Promise<void> {
  const notion = getNotionClient();

  // Build output summary
  const outputParts: string[] = [];

  if (result.summary) {
    outputParts.push(result.summary);
  }

  if (result.artifacts && result.artifacts.length > 0) {
    outputParts.push(`\nArtifacts:\n${result.artifacts.map((a) => `• ${a}`).join("\n")}`);
  }

  if (result.metrics) {
    const duration = Math.round(result.metrics.durationMs / 1000);
    outputParts.push(`\nCompleted in ${duration}s`);
    if (result.metrics.tokensUsed) {
      outputParts.push(`Tokens: ${result.metrics.tokensUsed}`);
    }
  }

  const output = outputParts.join("\n") || "Task completed successfully";

  await notion.pages.update({
    page_id: workItemId,
    properties: {
      Status: {
        select: { name: "Done" },
      },
      Output: {
        rich_text: [{ text: { content: truncateText(output, 2000) } }],
      },
      Completed: {
        date: { start: formatDate(agent.completedAt || new Date()) },
      },
    },
  });

  // Add completion comment
  await notion.comments.create({
    parent: { page_id: workItemId },
    rich_text: [
      {
        text: {
          content: `[AGENT COMPLETED - ${formatDate()}]

Agent ID: ${agent.id}
Result: ${result.success ? "SUCCESS" : "COMPLETED WITH ISSUES"}

${result.summary || "Task finished."}${
            result.artifacts && result.artifacts.length > 0
              ? `\n\nArtifacts produced:\n${result.artifacts.map((a) => `• ${a}`).join("\n")}`
              : ""
          }`,
        },
      },
    ],
  });
}

/**
 * Sync agent failure to Work Queue
 * Sets status to "Blocked", populates Blocked Reason
 */
export async function syncAgentFailure(
  workItemId: string,
  agent: Agent,
  error: string,
  retryable: boolean = false
): Promise<void> {
  const notion = getNotionClient();

  const blockedReason = `Agent ${agent.id} failed: ${error}${retryable ? " (retryable)" : ""}`;

  await notion.pages.update({
    page_id: workItemId,
    properties: {
      Status: {
        select: { name: "Blocked" },
      },
      "Blocked Reason": {
        rich_text: [{ text: { content: truncateText(blockedReason, 2000) } }],
      },
    },
  });

  // Add failure comment with details
  await notion.comments.create({
    parent: { page_id: workItemId },
    rich_text: [
      {
        text: {
          content: `[AGENT FAILED - ${formatDate()}]

Agent ID: ${agent.id}
Type: ${agent.type}
Error: ${error}
Retryable: ${retryable ? "Yes" : "No"}

${
  retryable
    ? "This error may be temporary. Consider retrying."
    : "Manual intervention may be required."
}`,
        },
      },
    ],
  });
}

/**
 * Sync agent cancellation to Work Queue
 * Sets status to "Paused" with reason
 */
export async function syncAgentCancelled(
  workItemId: string,
  agent: Agent,
  reason?: string
): Promise<void> {
  const notion = getNotionClient();

  await notion.pages.update({
    page_id: workItemId,
    properties: {
      Status: {
        select: { name: "Paused" },
      },
      Notes: {
        rich_text: [
          {
            text: {
              content: `Agent cancelled${reason ? `: ${reason}` : ""}`,
            },
          },
        ],
      },
    },
  });

  await notion.comments.create({
    parent: { page_id: workItemId },
    rich_text: [
      {
        text: {
          content: `[AGENT CANCELLED - ${formatDate()}]

Agent ID: ${agent.id}
Reason: ${reason || "User requested cancellation"}

Task returned to queue for manual handling.`,
        },
      },
    ],
  });
}

// ==========================================
// Event Handler Factory
// ==========================================

/**
 * Create an event handler that syncs all agent events to Work Queue
 * Use with registry.subscribe() or registry.subscribeAll()
 */
export function createWorkQueueSyncHandler() {
  return async (event: AgentEvent & { agent?: Agent }): Promise<void> => {
    // Need the agent to get workItemId
    // In practice, the registry would attach the agent to the event
    // For now, we'll need to look it up or pass it differently

    // This is a simplified version - in production you'd get the agent
    // from the registry or include it in the event payload
  };
}

/**
 * Wire up automatic Work Queue sync for an agent
 * Call this after spawning an agent that has a workItemId
 */
export async function wireAgentToWorkQueue(
  agent: Agent,
  registry: {
    subscribe: (
      agentId: string,
      handler: (event: AgentEvent) => Promise<void>
    ) => { unsubscribe: () => void };
    status: (id: string) => Promise<Agent | null>;
  }
): Promise<{ unsubscribe: () => void }> {
  if (!agent.workItemId) {
    throw new Error("Agent has no workItemId - cannot wire to Work Queue");
  }

  const workItemId = agent.workItemId;

  // Sync initial spawn
  await syncAgentSpawn(workItemId, agent);

  // Subscribe to all events for this agent
  return registry.subscribe(agent.id, async (event: AgentEvent) => {
    // Get latest agent state
    const currentAgent = await registry.status(agent.id);
    if (!currentAgent) return;

    switch (event.type) {
      case "progress": {
        const data = event.data as { progress: number; activity?: string };
        await syncAgentProgress(
          workItemId,
          currentAgent,
          data.progress,
          data.activity
        );
        break;
      }

      case "completed": {
        const result = event.data as AgentResult;
        await syncAgentComplete(workItemId, currentAgent, result);
        break;
      }

      case "failed": {
        const data = event.data as { error: string; retryable: boolean };
        await syncAgentFailure(
          workItemId,
          currentAgent,
          data.error,
          data.retryable
        );
        break;
      }

      case "cancelled": {
        const data = event.data as { reason?: string } | undefined;
        await syncAgentCancelled(workItemId, currentAgent, data?.reason);
        break;
      }
    }
  });
}

// ==========================================
// Helper Functions
// ==========================================

/**
 * Extract rich text content from a Notion page property
 */
function extractRichText(page: unknown, propName: string): string | undefined {
  const pageObj = page as Record<string, unknown>;
  const properties = pageObj.properties as Record<string, unknown> | undefined;
  if (!properties) return undefined;

  const prop = properties[propName] as Record<string, unknown> | undefined;
  if (!prop) return undefined;

  const richText = prop.rich_text as Array<{ plain_text?: string }> | undefined;
  if (!richText || richText.length === 0) return undefined;

  return richText.map((rt) => rt.plain_text || "").join("");
}

/**
 * Truncate text to max length for Notion fields
 */
function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + "...";
}

/**
 * Build a simple ASCII progress bar
 */
function buildProgressBar(percent: number): string {
  const filled = Math.round(percent / 10);
  const empty = 10 - filled;
  return `[${"█".repeat(filled)}${"░".repeat(empty)}]`;
}

// ==========================================
// Singleton Updater Instance
// ==========================================

/**
 * Global Work Queue updater instance
 */
export const workQueueUpdater = new NotionWorkQueueUpdater();
