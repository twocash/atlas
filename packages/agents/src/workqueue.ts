/**
 * Atlas Agent SDK - Work Queue Integration
 *
 * Syncs agent lifecycle events to Notion Work Queue so Jim
 * sees real-time agent progress in his dashboard.
 */

import { Client } from "@notionhq/client";
import { NOTION_DB } from "@atlas/shared/config";
import type {
  WorkQueueStatus,
  WorkQueueUpdater,
  Agent,
  AgentEvent,
  AgentResult,
} from "./types";
import {
  convertMarkdownToNotionBlocks,
  batchBlocksForApi,
  formatResearchAsMarkdown,
} from "./notion-markdown";

// ==========================================
// Configuration
// ==========================================

const WORK_QUEUE_DB_ID = NOTION_DB.WORK_QUEUE;

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
 *
 * WARNING: This constructs a bare URL without workspace context.
 * These URLs may not work correctly. Prefer using the `url` field
 * returned directly from Notion API responses when available.
 *
 * @deprecated Use the `url` field from Notion API responses instead
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
  console.log("[WorkQueue] syncAgentSpawn called", { workItemId, agentId: agent.id });
  const notion = getNotionClient();

  try {
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
    console.log("[WorkQueue] Status updated to Active", { workItemId });
  } catch (error) {
    console.error("[WorkQueue] Failed to update status to Active", { workItemId, error });
    throw error;
  }

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
  console.log("[WorkQueue] syncAgentComplete called", {
    workItemId,
    agentId: agent.id,
    hasResult: !!result,
    hasSummary: !!result?.summary,
    hasOutput: !!result?.output,
  });
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
  try {
    await appendResearchResultsToPage(workItemId, agent, result);
  } catch (error: any) {
    console.error("[WorkQueue] CRITICAL: appendResearchResultsToPage failed", {
      workItemId,
      error: error?.message || error,
      stack: error?.stack,
    });
    // Try fallback comment
    await writeResearchFallbackComment(workItemId, result, error?.message || "Unknown error");
  }
}

/**
 * Append research results to Notion page body as formatted blocks
 */
async function appendResearchResultsToPage(
  pageId: string,
  agent: Agent,
  result: AgentResult
): Promise<void> {
  console.log("[WorkQueue] appendResearchResultsToPage called", {
    pageId,
    agentId: agent.id,
    hasSummary: !!result?.summary,
    summaryLength: result?.summary?.length || 0,
    hasOutput: !!result?.output,
    outputType: typeof result?.output,
  });

  // DIAGNOSTIC: Log full result structure
  console.log("[WorkQueue] DIAGNOSTIC - result.output:", {
    hasOutput: !!result?.output,
    outputKeys: result?.output ? Object.keys(result.output as object) : [],
    summaryLength: (result?.output as any)?.summary?.length || 0,
    findingsCount: (result?.output as any)?.findings?.length || 0,
    sourcesCount: (result?.output as any)?.sources?.length || 0,
  });

  const notion = getNotionClient();

  // Get full research output
  const researchOutput = result.output as {
    summary?: string;
    findings?: Array<{ claim: string; source: string; url: string }>;
    sources?: string[];
    bibliography?: string[];
    query?: string;
    depth?: string;
    rawResponse?: string; // Full Gemini output - use this for page body
    contentMode?: 'prose' | 'json'; // Drafter mode output
    proseContent?: string; // Full prose markdown (drafter mode)
  } | undefined;

  // Build metadata header blocks manually (these aren't from markdown)
  const headerBlocks: any[] = [
    {
      object: "block",
      type: "heading_2",
      heading_2: {
        rich_text: [{ type: "text", text: { content: "Research Results" } }],
      },
    },
    {
      object: "block",
      type: "callout",
      callout: {
        rich_text: [{
          type: "text",
          text: {
            content: `Agent: ${agent.type} | Completed: ${formatDate(agent.completedAt || new Date())}${result.metrics ? ` | ${Math.round(result.metrics.durationMs / 1000)}s` : ""}`,
          },
        }],
        icon: { type: "emoji", emoji: "🤖" },
      },
    },
  ];

  // Convert research results to Notion-safe Markdown, then to blocks
  let contentBlocks: any[] = [];
  let markdown = "";

  // Log what we have to work with
  console.log("[WorkQueue] Content analysis:", {
    pageId,
    summaryLength: researchOutput?.summary?.length || 0,
    findingsCount: researchOutput?.findings?.length || 0,
    sourcesCount: researchOutput?.sources?.length || 0,
    rawResponseLength: researchOutput?.rawResponse?.length || 0,
  });

  // PROSE MODE: Drafter template produced prose markdown — skip all JSON re-parsing
  if (researchOutput?.contentMode === 'prose' && researchOutput?.proseContent) {
    console.log("[WorkQueue] Prose mode — using drafter output directly", {
      pageId,
      proseLength: researchOutput.proseContent.length,
      sourcesCount: researchOutput.sources?.length || 0,
    });

    markdown = researchOutput.proseContent;

    // Append ## Sources section if not already present in the prose body
    if (!/^##\s+Sources/m.test(markdown) && researchOutput.sources && researchOutput.sources.length > 0) {
      markdown += '\n\n## Sources\n\n';
      researchOutput.sources.forEach((s: string, i: number) => {
        markdown += `${i + 1}. ${s}\n`;
      });
    }
  }
  // LOSSLESS DELIVERY: Use the FULL rawResponse - this is the complete research report
  // The user wants 100% of what Gemini generated, not a truncated summary
  else if (researchOutput?.rawResponse && researchOutput.rawResponse.length > 500) {
    console.log("[WorkQueue] Using FULL rawResponse for lossless delivery", {
      pageId,
      rawResponseLength: researchOutput.rawResponse.length,
    });

    // Extract content from JSON if it's JSON formatted
    let fullContent = researchOutput.rawResponse;

    // Try to parse JSON and extract ALL content
    // Helper to clean text of citation markers and escape sequences
    const cleanText = (text: string) => text
      .replace(/\[cite:\s*[\d,\s]+\]/g, "") // Remove [cite: N] markers
      .replace(/\\n/g, "\n")               // Convert escaped newlines
      .replace(/\\"/g, '"')                // Convert escaped quotes
      .replace(/\\\\/g, "\\")              // Convert escaped backslashes
      .trim();

    let jsonParsed = false;
    try {
      const jsonMatch = fullContent.match(/```json\s*([\s\S]*?)\s*```/);
      const jsonText = jsonMatch ? jsonMatch[1] : fullContent;
      const jsonObjectMatch = jsonText.match(/\{[\s\S]*\}/);

      if (jsonObjectMatch) {
        const parsed = JSON.parse(jsonObjectMatch[0]);

        // Build FULL markdown from ALL JSON fields
        const parts: string[] = [];

        // Full summary - no truncation, but clean it
        if (parsed.summary) {
          parts.push("## Executive Summary\n");
          parts.push(cleanText(parsed.summary));
          parts.push("\n");
        }

        // Use RESOLVED URLs from structured output if available
        // The research agent resolves redirect URLs, but rawResponse has originals
        const findingsToUse = researchOutput?.findings?.length > 0
          ? researchOutput.findings
          : parsed.findings || [];
        const sourcesToUse = researchOutput?.sources?.length > 0
          ? researchOutput.sources
          : parsed.sources || [];

        // ALL findings with full detail (using resolved URLs)
        if (findingsToUse.length > 0) {
          parts.push("\n## Key Findings\n");
          findingsToUse.forEach((f: any, i: number) => {
            parts.push(`\n### ${i + 1}. ${cleanText(f.claim)}\n`);
            if (f.source) parts.push(`**Source:** ${f.source}\n`);
            if (f.url) parts.push(`**URL:** ${f.url}\n`);
            if (f.author) parts.push(`**Author:** ${f.author}\n`);
            if (f.date) parts.push(`**Date:** ${f.date}\n`);
          });
        }

        // ALL sources (using resolved URLs)
        if (sourcesToUse.length > 0) {
          parts.push("\n## Sources\n");
          sourcesToUse.forEach((s: string, i: number) => {
            parts.push(`${i + 1}. ${s}\n`);
          });
        }

        // Full bibliography - clean each entry
        if (parsed.bibliography && parsed.bibliography.length > 0) {
          parts.push("\n## Bibliography\n");
          parsed.bibliography.forEach((b: string) => {
            parts.push(`- ${cleanText(b)}\n`);
          });
        }

        markdown = parts.join("\n");
        jsonParsed = true;
        console.log("[WorkQueue] Extracted FULL content from JSON", {
          pageId,
          markdownLength: markdown.length,
          summaryLength: parsed.summary?.length || 0,
          findingsCount: parsed.findings?.length || 0,
        });
      }
    } catch (e) {
      console.log("[WorkQueue] JSON parse failed", { error: (e as Error).message });
      jsonParsed = false;
    }

    // LOSSLESS FALLBACK: If JSON parsing failed, try harder to extract content
    if (!jsonParsed) {
      console.log("[WorkQueue] JSON failed - attempting recovery", {
        pageId,
        rawContentLength: fullContent.length,
      });

      // First, clean the raw content thoroughly
      let cleaned = fullContent
        // Remove markdown code fences
        .replace(/^```json\s*/gm, "")
        .replace(/^```\s*/gm, "")
        .replace(/```$/gm, "")
        // Convert escaped newlines to real newlines
        .replace(/\\n/g, "\n")
        // Strip citation markers [cite: N] or [cite: N, M]
        .replace(/\[cite:\s*[\d,\s]+\]/g, "")
        // Normalize whitespace
        .replace(/\n{3,}/g, "\n\n")
        .trim();

      // Gemini sometimes returns duplicate JSON - extract ONLY the first complete JSON object
      const firstJsonMatch = cleaned.match(/^\{[\s\S]*?"bibliography"[\s\S]*?\]/);
      if (firstJsonMatch) {
        // Find where this first JSON ends (after the closing bracket of sources/bibliography array)
        const jsonEndMatch = cleaned.match(/("bibliography"\s*:\s*\[[^\]]*\]|\s*"sources"\s*:\s*\[[^\]]*\])\s*\}/);
        if (jsonEndMatch && jsonEndMatch.index !== undefined) {
          const endPos = jsonEndMatch.index + jsonEndMatch[0].length;
          cleaned = cleaned.substring(0, endPos);
          console.log("[WorkQueue] Extracted first JSON block, trimmed from", fullContent.length, "to", cleaned.length);
        }
      }

      // Try lenient JSON parse
      if (cleaned.trim().startsWith("{")) {
        try {
          let cleanedJson = cleaned
            .replace(/,\s*}/g, "}") // Remove trailing commas before }
            .replace(/,\s*]/g, "]") // Remove trailing commas before ]
            .replace(/[\x00-\x1F\x7F]/g, " "); // Remove control characters

          const parsed = JSON.parse(cleanedJson);

          // Build comprehensive markdown from all available fields
          const parts: string[] = [];

          // Helper to clean text of any remaining citation markers and escaped chars
          const cleanText = (text: string) => text
            .replace(/\[cite:\s*[\d,\s]+\]/g, "")
            .replace(/\\n/g, "\n")
            .replace(/\\"/g, '"')
            .replace(/\\\\/g, "\\")
            .trim();

          if (parsed.summary) {
            parts.push("## Executive Summary\n");
            parts.push(cleanText(parsed.summary));
            parts.push("\n");
          }

          if (parsed.findings && parsed.findings.length > 0) {
            parts.push("\n## Key Findings\n");
            parsed.findings.forEach((f: any, i: number) => {
              parts.push(`\n### ${i + 1}. ${cleanText(f.claim)}\n`);
              if (f.evidence) parts.push(`${cleanText(f.evidence)}\n`);
              if (f.source) parts.push(`**Source:** ${f.source}\n`);
              if (f.url) parts.push(`**URL:** ${f.url}\n`);
              if (f.author) parts.push(`**Author:** ${f.author}\n`);
              if (f.date) parts.push(`**Date:** ${f.date}\n`);
            });
          }

          if (parsed.analysis) {
            parts.push("\n## Analysis\n");
            parts.push(cleanText(parsed.analysis));
            parts.push("\n");
          }

          if (parsed.sources && parsed.sources.length > 0) {
            parts.push("\n## Sources\n");
            parsed.sources.forEach((s: string, i: number) => {
              parts.push(`${i + 1}. ${s}\n`);
            });
          }

          if (parsed.bibliography && parsed.bibliography.length > 0) {
            parts.push("\n## Bibliography\n");
            parsed.bibliography.forEach((b: string) => {
              parts.push(`- ${cleanText(b)}\n`);
            });
          }

          markdown = parts.join("\n");
          console.log("[WorkQueue] Lenient JSON parse succeeded", {
            pageId,
            markdownLength: markdown.length,
          });
        } catch (e2) {
          // JSON parse completely failed - extract prose instead of dumping raw JSON
          console.log("[WorkQueue] Lenient JSON parse failed, extracting prose", {
            pageId,
            error: (e2 as Error).message,
          });

          // Extract the summary text from the JSON string if possible
          const summaryMatch = cleaned.match(/"summary"\s*:\s*"((?:[^"\\]|\\.)*)"/);
          if (summaryMatch) {
            const summaryText = summaryMatch[1]
              .replace(/\\n/g, "\n")
              .replace(/\\"/g, '"')
              .replace(/\\\\/g, "\\")
              .replace(/\[cite:\s*[\d,\s]+\]/g, "")
              .trim();

            markdown = "## Research Summary\n\n" + summaryText;

            // Try to extract findings with FULL detail (claim, source, url)
            const findingsMatch = cleaned.match(/"findings"\s*:\s*\[([\s\S]*?)\]\s*(?:,\s*"sources"|,\s*"bibliography"|\s*\})/);
            if (findingsMatch) {
              // Extract each finding object with claim, source, and url
              const findingPattern = /\{\s*"claim"\s*:\s*"((?:[^"\\]|\\.)*)"\s*(?:,\s*"source"\s*:\s*"((?:[^"\\]|\\.)*)"\s*)?(?:,\s*"url"\s*:\s*"((?:[^"\\]|\\.)*)"\s*)?\s*[,}]/g;
              let match;
              const findings: Array<{ claim: string; source?: string; url?: string }> = [];
              while ((match = findingPattern.exec(findingsMatch[1])) !== null) {
                const claim = match[1]
                  .replace(/\\n/g, "\n")
                  .replace(/\\"/g, '"')
                  .replace(/\[cite:\s*[\d,\s]+\]/g, "")
                  .trim();
                if (claim.length > 10) {
                  findings.push({
                    claim,
                    source: match[2]?.replace(/\\"/g, '"').trim(),
                    url: match[3]?.trim(),
                  });
                }
              }
              if (findings.length > 0) {
                markdown += "\n\n## Key Findings\n\n";
                findings.forEach((f, i) => {
                  markdown += `### ${i + 1}. ${f.claim}\n`;
                  if (f.source) markdown += `**Source:** ${f.source}\n`;
                  if (f.url) markdown += `**URL:** ${f.url}\n`;
                  markdown += "\n";
                });
              }
            }

            // Try to extract sources array
            const sourcesMatch = cleaned.match(/"sources"\s*:\s*\[([\s\S]*?)\]/);
            if (sourcesMatch) {
              const urlPattern = /"(https?:\/\/[^"]+)"/g;
              let match;
              const sources: string[] = [];
              while ((match = urlPattern.exec(sourcesMatch[1])) !== null) {
                if (!sources.includes(match[1])) {
                  sources.push(match[1]);
                }
              }
              if (sources.length > 0) {
                markdown += "\n## Sources\n\n";
                sources.forEach((s, i) => {
                  markdown += `${i + 1}. ${s}\n`;
                });
              }
            }

            console.log("[WorkQueue] Extracted prose from JSON strings", {
              pageId,
              markdownLength: markdown.length,
            });
          } else {
            // Absolute fallback - just note that parsing failed
            markdown = "## Research Results\n\n*Research completed but output formatting failed. Raw data available in logs.*";
            console.log("[WorkQueue] Could not extract any usable content", { pageId });
          }
        }
      }
    }
  }

  // Fallback: Use structured data if rawResponse not available at all
  if (!markdown && (researchOutput?.summary || researchOutput?.findings?.length)) {
    console.log("[WorkQueue] Using structured fallback (no rawResponse)", { pageId });
    markdown = formatResearchAsMarkdown({
      summary: researchOutput?.summary || result.summary || "",
      findings: researchOutput?.findings || [],
      sources: researchOutput?.sources || [],
      query: researchOutput?.query || "",
    });
  }

  if (markdown) {
    console.log("[WorkQueue] Generated markdown", {
      pageId,
      markdownLength: markdown.length,
      preview: markdown.substring(0, 300),
    });

    // Convert Markdown to Notion blocks using martian + our limits shim
    const conversion = convertMarkdownToNotionBlocks(markdown);

    console.log("[WorkQueue] Markdown conversion result", {
      pageId,
      blockCount: conversion.blocks.length,
      stats: conversion.stats,
      warnings: conversion.warnings,
    });

    contentBlocks = conversion.blocks;
  }

  // Add bibliography section if present (deep research)
  if (researchOutput?.bibliography && researchOutput.bibliography.length > 0) {
    contentBlocks.push({
      object: "block",
      type: "heading_3",
      heading_3: {
        rich_text: [{ type: "text", text: { content: "Bibliography" } }],
      },
    });

    for (const citation of researchOutput.bibliography) {
      contentBlocks.push({
        object: "block",
        type: "paragraph",
        paragraph: {
          rich_text: [{ type: "text", text: { content: truncateText(citation, 1900) } }],
        },
      });
    }
  }

  // Add metadata footer
  if (researchOutput?.query || researchOutput?.depth) {
    contentBlocks.push({
      object: "block",
      type: "callout",
      callout: {
        rich_text: [{
          type: "text",
          text: { content: `Query: "${researchOutput.query || 'N/A'}" | Depth: ${researchOutput.depth || 'standard'}` },
        }],
        icon: { type: "emoji", emoji: "📋" },
        color: "gray_background",
      },
    });
  }

  // Add divider at end
  contentBlocks.push({
    object: "block",
    type: "divider",
    divider: {},
  });

  // Combine all blocks
  const allBlocks = [...headerBlocks, ...contentBlocks];

  // Batch blocks to respect Notion API limits (100 blocks per request)
  const batches = batchBlocksForApi(allBlocks);

  console.log("[WorkQueue] Appending blocks to page", {
    pageId,
    totalBlocks: allBlocks.length,
    batches: batches.length,
  });

  try {
    // Append each batch with retry logic
    let totalAppended = 0;
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      let retries = 3;
      let lastError: Error | null = null;

      while (retries > 0) {
        try {
          const appendResult = await notion.blocks.children.append({
            block_id: pageId,
            children: batch as any,
          });
          totalAppended += appendResult.results?.length || 0;
          break; // Success, exit retry loop
        } catch (error: any) {
          lastError = error;
          retries--;

          // Check if it's a rate limit error
          if (error?.code === "rate_limited" && retries > 0) {
            console.log("[WorkQueue] Rate limited, waiting before retry...", {
              pageId,
              batch: i + 1,
              retriesLeft: retries,
            });
            await new Promise((r) => setTimeout(r, 1000 * (4 - retries))); // Exponential backoff
            continue;
          }

          // For validation errors, log details but don't retry
          if (error?.code === "validation_error") {
            console.error("[WorkQueue] Validation error in batch", {
              pageId,
              batch: i + 1,
              error: error?.message,
              body: error?.body,
              blockTypes: batch.map((b: any) => b.type),
            });
            throw error; // Throw to trigger fallback
          }

          if (retries === 0) {
            throw error;
          }
        }
      }

      if (lastError && retries === 0) {
        throw lastError;
      }
    }

    console.log("[WorkQueue] Successfully appended all blocks", {
      pageId,
      totalAppended,
      batches: batches.length,
    });
  } catch (error: any) {
    console.error("[WorkQueue] Failed to append blocks, using fallback", {
      pageId,
      error: error?.message || error,
    });
    // FALLBACK: Write summary as comment so research isn't lost
    await writeResearchFallbackComment(pageId, result, error?.message || "Unknown error");
  }
}

/**
 * FALLBACK: Write research summary as comment if blocks fail
 * This ensures we never lose research results
 */
async function writeResearchFallbackComment(
  pageId: string,
  result: AgentResult,
  error: string
): Promise<void> {
  const notion = getNotionClient();
  const researchOutput = result.output as { summary?: string } | undefined;
  const summary = researchOutput?.summary || result.summary;

  if (!summary) return;

  try {
    // Truncate error to keep total under 2000 chars
    // Format: "[Fallback: {error}]\n\n{summary}"
    // Reserve ~100 chars for prefix, rest for summary
    const shortError = error.length > 80 ? error.substring(0, 77) + "..." : error;
    const prefix = `[Fallback: ${shortError}]\n\n`;
    const maxSummary = 2000 - prefix.length - 10; // 10 char buffer

    await notion.comments.create({
      parent: { page_id: pageId },
      rich_text: [
        {
          type: "text",
          text: {
            content: `${prefix}${truncateText(summary, maxSummary)}`,
          },
        },
      ],
    });
    console.log("[WorkQueue] Fallback: wrote summary as comment", { pageId });
  } catch (commentError) {
    console.error("[WorkQueue] Fallback comment also failed:", commentError);
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
// Dispatch Source Provenance
// ==========================================

/**
 * Append dispatch source provenance to Work Queue item Notes.
 *
 * Called after research completes or fails. Appends
 * "dispatched-from:<source> (<outcome>)" to whatever syncAgentComplete wrote.
 * Non-fatal — never blocks result delivery.
 *
 * @param workItemId - Notion page ID of the WQ item
 * @param source - Originating entry point identifier (e.g. 'content-confirm')
 * @param outcome - 'success' | 'failure'
 */
export async function appendDispatchNotes(
  workItemId: string,
  source: string,
  outcome: 'success' | 'failure'
): Promise<void> {
  const notion = getNotionClient();
  try {
    const page = await notion.pages.retrieve({ page_id: workItemId });
    const existing = extractRichText(page as any, 'Notes') || '';
    const appendLine = `dispatched-from:${source} (${outcome})`;
    const updated = existing ? `${existing}\n${appendLine}` : appendLine;
    await notion.pages.update({
      page_id: workItemId,
      properties: {
        Notes: { rich_text: [{ text: { content: truncateText(updated, 2000) } }] },
      },
    });
  } catch (error) {
    console.warn('[WorkQueue] Failed to append dispatch notes (non-fatal)', { workItemId, source, error });
  }
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
  console.log("[WorkQueue] Subscribing to agent events", { agentId: agent.id, workItemId });

  return registry.subscribe(agent.id, async (event: AgentEvent) => {
    console.log("[WorkQueue] Event received", { type: event.type, agentId: event.agentId });

    // Get latest agent state
    const currentAgent = await registry.status(agent.id);
    if (!currentAgent) {
      console.warn("[WorkQueue] Agent not found for event", { agentId: agent.id });
      return;
    }

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
        console.log("[WorkQueue] Handling completed event", { agentId: agent.id });
        const result = event.data as AgentResult;
        await syncAgentComplete(workItemId, currentAgent, result);
        console.log("[WorkQueue] Completed event handled", { agentId: agent.id });
        break;
      }

      case "failed": {
        console.log("[WorkQueue] Handling failed event", { agentId: agent.id });
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
 * Split text into chunks that fit Notion's block size limit
 */
function splitTextIntoChunks(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    // Try to split at sentence boundary
    let splitIndex = remaining.lastIndexOf('. ', maxLength);
    if (splitIndex === -1 || splitIndex < maxLength / 2) {
      // Try splitting at word boundary
      splitIndex = remaining.lastIndexOf(' ', maxLength);
    }
    if (splitIndex === -1 || splitIndex < maxLength / 2) {
      // Force split at maxLength
      splitIndex = maxLength;
    }

    chunks.push(remaining.substring(0, splitIndex + 1).trim());
    remaining = remaining.substring(splitIndex + 1).trim();
  }

  return chunks;
}

/**
 * Validate HTTP/HTTPS URL
 */
function isValidHttpUrl(str: string): boolean {
  if (!str) return false;
  try {
    const url = new URL(str);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Sanitize summary text for professional Notion display
 * Removes any JSON artifacts, escape sequences, and code block markers
 */
function sanitizeSummaryForDisplay(text: string): string {
  if (!text) return "";

  let cleaned = text;

  // Remove markdown code block markers
  cleaned = cleaned.replace(/```json\s*/gi, '');
  cleaned = cleaned.replace(/```\s*/g, '');

  // Remove JSON object wrappers if the summary starts with them
  if (cleaned.trim().startsWith('{')) {
    // Try to extract just the summary value from JSON
    const summaryMatch = cleaned.match(/"summary"\s*:\s*"([\s\S]*?)(?:"\s*,\s*"findings"|"\s*})/);
    if (summaryMatch) {
      cleaned = summaryMatch[1];
    }
  }

  // Clean escape sequences
  cleaned = cleaned
    .replace(/\\n\\n/g, '\n\n')
    .replace(/\\n/g, '\n')
    .replace(/\\"/g, '"')
    .replace(/\\t/g, ' ')
    .replace(/\\\\/g, '\\');

  // Remove any remaining JSON-like patterns
  cleaned = cleaned.replace(/"findings"\s*:\s*\[[\s\S]*$/g, ''); // Truncate at findings array
  cleaned = cleaned.replace(/^\s*\{\s*"summary"\s*:\s*"/g, '');  // Remove opening JSON
  cleaned = cleaned.replace(/"\s*,\s*"findings".*$/gs, '');      // Remove trailing JSON

  // Clean up whitespace
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();

  return cleaned;
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
  // Use actual URL from Notion API (includes workspace context) with fallback
  const url = (response as { url?: string }).url || getNotionPageUrl(pageId);

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
