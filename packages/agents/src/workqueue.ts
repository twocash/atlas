/**
 * Atlas Agent SDK - Work Queue Integration
 *
 * Syncs agent lifecycle events to Notion Work Queue so Jim
 * sees real-time agent progress in his dashboard.
 *
 * Database: Work Queue 2.0
 * Data Source ID: 6a8d9c43-b084-47b5-bc83-bc363640f2cd
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

// DATA SOURCE ID - not database page ID!
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
   * Set output URL on completion (Output field is URL type)
   * If output is not a URL, appends to Notes instead
   */
  async setOutput(itemId: string, output: string): Promise<void> {
    const isUrl = output.startsWith("http://") || output.startsWith("https://");

    if (isUrl) {
      await getNotionClient().pages.update({
        page_id: itemId,
        properties: {
          Output: { url: output },
        },
      });
    } else {
      // Not a URL - append to Notes instead
      await this.updateStatus(itemId, "Done", `Output: ${output}`);
    }
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
 * Sets status to "Done", writes results to page body as markdown
 */
export async function syncAgentComplete(
  workItemId: string,
  agent: Agent,
  result: AgentResult
): Promise<void> {
  const notion = getNotionClient();

  // Build notes summary
  const notesParts: string[] = [];

  if (result.summary) {
    notesParts.push(result.summary.substring(0, 200));
  }

  if (result.metrics) {
    const duration = Math.round(result.metrics.durationMs / 1000);
    notesParts.push(`${duration}s`);
  }

  const notesUpdate = notesParts.join(" | ") || "Task completed";

  // Check if we have a URL artifact for the Output field
  const outputUrl = result.artifacts?.find(
    (a) => a.startsWith("http://") || a.startsWith("https://")
  );

  // Build properties update
  const properties: Record<string, unknown> = {
    Status: { select: { name: "Done" } },
    Completed: { date: { start: formatDate(agent.completedAt || new Date()) } },
    Notes: { rich_text: [{ text: { content: truncateText(notesUpdate, 2000) } }] },
  };

  // Only set Output if we have a valid URL
  if (outputUrl) {
    properties.Output = { url: outputUrl };
  }

  await notion.pages.update({
    page_id: workItemId,
    properties,
  });

  // Write research results to page body as markdown blocks
  await appendResearchResultsToPage(workItemId, agent, result);
}

/**
 * Append research results to Notion page body as formatted blocks
 */
async function appendResearchResultsToPage(
  pageId: string,
  agent: Agent,
  result: AgentResult
): Promise<void> {
  const notion = getNotionClient();

  // Build blocks for the page content
  const blocks: Array<{
    object: "block";
    type: string;
    [key: string]: unknown;
  }> = [];

  // Header with timestamp
  blocks.push({
    object: "block",
    type: "heading_2",
    heading_2: {
      rich_text: [{ type: "text", text: { content: `Research Results` } }],
    },
  });

  // Metadata callout
  const metaText = `Agent: ${agent.type} | Completed: ${formatDate(agent.completedAt || new Date())}${result.metrics ? ` | ${Math.round(result.metrics.durationMs / 1000)}s` : ""}`;
  blocks.push({
    object: "block",
    type: "callout",
    callout: {
      rich_text: [{ type: "text", text: { content: metaText } }],
      icon: { type: "emoji", emoji: "🤖" },
    },
  });

  // Summary section
  if (result.summary) {
    blocks.push({
      object: "block",
      type: "heading_3",
      heading_3: {
        rich_text: [{ type: "text", text: { content: "Summary" } }],
      },
    });

    // Split summary into paragraphs
    const summaryParagraphs = result.summary.split("\n\n").filter(Boolean);
    for (const para of summaryParagraphs.slice(0, 5)) {
      blocks.push({
        object: "block",
        type: "paragraph",
        paragraph: {
          rich_text: [{ type: "text", text: { content: truncateText(para, 2000) } }],
        },
      });
    }
  }

  // Findings section (for research results)
  const researchOutput = result.output as {
    findings?: Array<{ claim: string; source: string; url: string }>;
    sources?: string[];
  } | undefined;

  if (researchOutput?.findings && researchOutput.findings.length > 0) {
    blocks.push({
      object: "block",
      type: "heading_3",
      heading_3: {
        rich_text: [{ type: "text", text: { content: "Key Findings" } }],
      },
    });

    for (const finding of researchOutput.findings.slice(0, 10)) {
      // Each finding as a bulleted list item with source link
      const findingText = finding.url
        ? `${finding.claim}`
        : finding.claim;

      blocks.push({
        object: "block",
        type: "bulleted_list_item",
        bulleted_list_item: {
          rich_text: [
            { type: "text", text: { content: findingText } },
            ...(finding.source
              ? [
                  { type: "text", text: { content: " — " } },
                  {
                    type: "text",
                    text: {
                      content: finding.source,
                      link: finding.url ? { url: finding.url } : null,
                    },
                    annotations: { italic: true },
                  },
                ]
              : []),
          ],
        },
      });
    }
  }

  // Sources section
  if (researchOutput?.sources && researchOutput.sources.length > 0) {
    blocks.push({
      object: "block",
      type: "heading_3",
      heading_3: {
        rich_text: [{ type: "text", text: { content: "Sources" } }],
      },
    });

    for (const source of researchOutput.sources.slice(0, 10)) {
      blocks.push({
        object: "block",
        type: "bulleted_list_item",
        bulleted_list_item: {
          rich_text: [
            {
              type: "text",
              text: { content: source, link: { url: source } },
            },
          ],
        },
      });
    }
  }

  // Divider at end
  blocks.push({
    object: "block",
    type: "divider",
    divider: {},
  });

  // Append blocks to page
  try {
    await notion.blocks.children.append({
      block_id: pageId,
      children: blocks as any,
    });
  } catch (error) {
    console.error("[WorkQueue] Failed to append blocks to page:", error);
    // Don't throw - page properties were already updated
  }
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
// Research Work Item Creation
// ==========================================

/**
 * Research task configuration for Work Queue creation
 */
export interface ResearchTaskConfig {
  /** Research query (becomes the task title) */
  query: string;
  /** Research depth level */
  depth: "light" | "standard" | "deep";
  /** Optional focus area */
  focus?: string;
  /** Priority override (default: P1 for deep, P2 for others) */
  priority?: "P0" | "P1" | "P2" | "P3";
}

/**
 * Create a new Work Queue item for a research task
 * Returns the page ID and URL for the created item
 */
export async function createResearchWorkItem(
  config: ResearchTaskConfig
): Promise<{ pageId: string; url: string }> {
  const notion = getNotionClient();

  // Build title from query (truncated)
  const title = config.query.length > 80
    ? config.query.substring(0, 77) + "..."
    : config.query;

  // Depth descriptions for notes
  const depthDescriptions = {
    light: "Quick overview (~2k tokens, 2-3 sources)",
    standard: "Thorough analysis (~8k tokens, 5-8 sources)",
    deep: "Academic rigor (~25k tokens, 10+ sources, Chicago citations)",
  };

  // Default priority based on depth
  const priority = config.priority || (config.depth === "deep" ? "P1" : "P2");

  // Build notes with research context
  const notes = [
    `Research Depth: ${config.depth} — ${depthDescriptions[config.depth]}`,
    config.focus ? `Focus: ${config.focus}` : null,
    `Queued via Telegram Agent System`,
  ].filter(Boolean).join("\n");

  const response = await notion.pages.create({
    parent: { database_id: WORK_QUEUE_DB_ID },
    properties: {
      // Title
      Task: {
        title: [{ text: { content: `Research: ${title}` } }],
      },
      // Type - always Research for research agents
      Type: {
        select: { name: "Research" },
      },
      // Status - starts as Captured, will be set to Active when agent starts
      Status: {
        select: { name: "Captured" },
      },
      // Priority
      Priority: {
        select: { name: priority },
      },
      // Pillar - research usually goes to The Grove
      Pillar: {
        select: { name: "The Grove" },
      },
      // Queued date
      Queued: {
        date: { start: formatDate() },
      },
      // Notes with research context
      Notes: {
        rich_text: [{ text: { content: notes } }],
      },
    },
  });

  const pageId = response.id;
  const url = getNotionPageUrl(pageId);

  // Add initial comment
  await notion.comments.create({
    parent: { page_id: pageId },
    rich_text: [
      {
        text: {
          content: `[RESEARCH TASK CREATED - ${formatDate()}]

Query: "${config.query}"
Depth: ${config.depth}
${config.focus ? `Focus: ${config.focus}\n` : ""}
Research agent will be assigned automatically.`,
        },
      },
    ],
  });

  return { pageId, url };
}

// ==========================================
// Singleton Updater Instance
// ==========================================

/**
 * Global Work Queue updater instance
 */
export const workQueueUpdater = new NotionWorkQueueUpdater();
