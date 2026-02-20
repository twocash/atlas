/**
 * bridge_update_memory — Self-modification tool for Bridge Claude.
 *
 * Writes structured corrections, learnings, and patterns to the
 * MEMORY Notion page (bridge.memory in System Prompts DB).
 *
 * Writes are async fire-and-forget — Bridge Claude confirms conversationally
 * before the write completes. Failure to write triggers a console error
 * and surfaces on next memory read (ADR-008).
 *
 * The MEMORY page has three sections: Corrections, Learnings, Patterns.
 * Each entry includes an ISO timestamp and source context.
 */

import { Client } from '@notionhq/client';

/** The Notion page ID for bridge.memory — set after first resolution */
let memoryPageId: string | null = null;

/** Memory entry types */
export type MemoryType = 'correction' | 'learning' | 'pattern';

export interface MemoryWriteParams {
  type: MemoryType;
  content: string;
  context: string;  // What triggered this — page URL, conversation topic
}

export interface MemoryWriteResult {
  success: boolean;
  error?: string;
}

/** Section headers in the MEMORY page (must match Notion structure) */
const SECTION_HEADERS: Record<MemoryType, string> = {
  correction: '## Corrections',
  learning: '## Learnings',
  pattern: '## Patterns',
};

/**
 * Resolve the MEMORY page ID from the System Prompts DB.
 * Caches the result for the session lifetime.
 */
async function resolveMemoryPageId(notion: Client): Promise<string | null> {
  if (memoryPageId) return memoryPageId;

  const dbId = process.env.NOTION_PROMPTS_DB_ID || '2fc780a78eef8196b29bdb4a6adfdc27';

  try {
    const response = await notion.databases.query({
      database_id: dbId,
      filter: {
        property: 'ID',
        rich_text: { equals: 'bridge.memory' },
      },
      page_size: 1,
    });

    if (response.results.length > 0) {
      memoryPageId = response.results[0].id;
      return memoryPageId;
    }

    console.error('[bridge-memory] bridge.memory entry not found in System Prompts DB');
    return null;
  } catch (error) {
    console.error('[bridge-memory] Failed to resolve MEMORY page ID:', error);
    return null;
  }
}

/**
 * Write a memory entry to the MEMORY Notion page.
 *
 * Appends a new bullet point under the appropriate section with
 * ISO timestamp and source context.
 *
 * This is fire-and-forget from Bridge Claude's perspective —
 * the tool confirms success/failure but the conversation doesn't block.
 */
export async function writeMemory(params: MemoryWriteParams): Promise<MemoryWriteResult> {
  const apiKey = process.env.NOTION_API_KEY;
  if (!apiKey) {
    const error = 'NOTION_API_KEY not set — cannot write to MEMORY';
    console.error(`[bridge-memory] ${error}`);
    return { success: false, error };
  }

  const notion = new Client({ auth: apiKey });
  const pageId = await resolveMemoryPageId(notion);

  if (!pageId) {
    return { success: false, error: 'Could not resolve bridge.memory page ID' };
  }

  const timestamp = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const entryText = `[${timestamp}] ${params.content} (context: ${params.context})`;

  try {
    // Append a bulleted list item to the page
    await notion.blocks.children.append({
      block_id: pageId,
      children: [
        {
          type: 'bulleted_list_item',
          bulleted_list_item: {
            rich_text: [
              {
                type: 'text',
                text: { content: entryText },
              },
            ],
          },
        },
      ],
    });

    console.log(`[bridge-memory] Written ${params.type}: ${params.content.slice(0, 80)}`);
    return { success: true };
  } catch (error: any) {
    const errorMsg = `Failed to write to MEMORY: ${error.message}`;
    console.error(`[bridge-memory] ${errorMsg}`);
    return { success: false, error: errorMsg };
  }
}

/**
 * MCP tool schema for bridge_update_memory.
 * Used by the MCP server to register this tool.
 */
export const BRIDGE_MEMORY_TOOL_SCHEMA = {
  name: 'bridge_update_memory',
  description:
    'Write a correction, learning, or pattern to Bridge Claude\'s persistent memory. ' +
    'Use this when Jim corrects you, when you learn a preference, or when you observe ' +
    'a repeated interaction pattern. Memory persists across sessions via Notion.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      type: {
        type: 'string',
        enum: ['correction', 'learning', 'pattern'],
        description: 'The type of memory entry',
      },
      content: {
        type: 'string',
        description: 'The memory to persist (e.g., "Jim prefers bullet points over paragraphs")',
      },
      context: {
        type: 'string',
        description: 'What triggered this memory (e.g., page URL, conversation topic)',
      },
    },
    required: ['type', 'content', 'context'],
  },
};

/**
 * Handle a bridge_update_memory tool call from Claude Code.
 */
export async function handleBridgeMemoryTool(
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const params: MemoryWriteParams = {
    type: args.type as MemoryType,
    content: args.content as string,
    context: args.context as string,
  };

  const result = await writeMemory(params);

  if (result.success) {
    return {
      content: [{
        type: 'text',
        text: `Memory persisted (${params.type}): ${params.content}`,
      }],
    };
  }

  return {
    content: [{
      type: 'text',
      text: `Failed to persist memory: ${result.error}`,
    }],
  };
}
