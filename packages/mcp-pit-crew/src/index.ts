/**
 * Pit Crew MCP Server
 *
 * Shared communication bus for Atlas ↔ Pit Crew agent-to-agent coordination.
 * Both agents connect to this server to dispatch work, post updates, and track status.
 *
 * Backed by local JSON files with Notion sync for visibility/persistence.
 *
 * IMPORTANT: All logging must use console.error() to keep stdout clean for JSON-RPC
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { readFile, writeFile, mkdir, readdir } from 'fs/promises';
import { join } from 'path';
import { Client } from '@notionhq/client';

// === NOTION CLIENT ===
// Re-enabled for guaranteed URL return (Neuro-Link Sprint)
const notion = new Client({ auth: process.env.NOTION_API_KEY });
const DEV_PIPELINE_DATABASE_ID = 'ce6fbf1b-ee30-433d-a9e6-b338552de7c9';

// === CONFIGURATION ===

const DATA_DIR = process.env.PIT_CREW_DATA_DIR || './data/pit-crew';
const DISCUSSIONS_DIR = join(DATA_DIR, 'discussions');

// === TYPES ===

interface Message {
  timestamp: string;
  from: 'atlas' | 'pit-crew' | 'jim';
  content: string;
}

interface Discussion {
  id: string;
  title: string;
  type: 'bug' | 'feature' | 'question' | 'hotfix';
  priority: 'P0' | 'P1' | 'P2';
  status: 'dispatched' | 'in-progress' | 'needs-approval' | 'approved' | 'deployed' | 'closed';
  requestor: string;
  assignee: string;
  context: string;
  wq_url?: string;
  notion_url?: string;
  notion_page_id?: string;  // For appending messages to existing page
  output?: string;
  messages: Message[];
  created: string;
  updated: string;
}

// === STORAGE ===

async function ensureDataDir() {
  await mkdir(DISCUSSIONS_DIR, { recursive: true });
}

async function loadDiscussion(id: string): Promise<Discussion | null> {
  try {
    const content = await readFile(join(DISCUSSIONS_DIR, `${id}.json`), 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

async function saveDiscussion(discussion: Discussion): Promise<void> {
  discussion.updated = new Date().toISOString();
  await writeFile(
    join(DISCUSSIONS_DIR, `${discussion.id}.json`),
    JSON.stringify(discussion, null, 2)
  );
}

async function listDiscussions(): Promise<Discussion[]> {
  try {
    const files = await readdir(DISCUSSIONS_DIR);
    const discussions: Discussion[] = [];
    for (const file of files.filter(f => f.endsWith('.json'))) {
      const content = await readFile(join(DISCUSSIONS_DIR, file), 'utf-8');
      discussions.push(JSON.parse(content));
    }
    return discussions.sort((a, b) =>
      new Date(b.updated).getTime() - new Date(a.updated).getTime()
    );
  } catch {
    return [];
  }
}

function generateId(title: string): string {
  const date = new Date().toISOString().split('T')[0];
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').substring(0, 30);
  return `${date}-${slug}`;
}

// === NOTION SYNC (RE-ENABLED - Neuro-Link Sprint) ===

/**
 * Sync discussion to Notion Dev Pipeline
 *
 * CRITICAL: This sync is MANDATORY for the "No Ticket, No Work" protocol.
 * Every dispatch MUST return a notion_url or fail explicitly.
 *
 * The NOTION_API_KEY must be set in the MCP server's environment.
 */
/**
 * Parse context into structured sections for page body
 * Handles both raw text and Atlas-formatted context with **headers**
 */
function parseContextSections(context: string): { analysis?: string; specification?: string; raw?: string } {
  // Try to extract Atlas Analysis section
  const analysisMatch = context.match(/\*\*Atlas Analysis:\*\*\s*([\s\S]*?)(?=\*\*Task Specification:|$)/i);
  const specMatch = context.match(/\*\*Task Specification:\*\*\s*([\s\S]*?)$/i);

  if (analysisMatch || specMatch) {
    return {
      analysis: analysisMatch?.[1]?.trim(),
      specification: specMatch?.[1]?.trim(),
    };
  }

  // No structured sections - use raw content
  return { raw: context };
}

/**
 * Build Notion blocks for page body content
 * Creates properly formatted, editable content
 */
function buildPageBodyBlocks(context: string): Array<{
  object: 'block';
  type: string;
  [key: string]: unknown;
}> {
  const blocks: Array<{ object: 'block'; type: string; [key: string]: unknown }> = [];
  const sections = parseContextSections(context);

  if (sections.analysis) {
    blocks.push({
      object: 'block',
      type: 'heading_2',
      heading_2: {
        rich_text: [{ type: 'text', text: { content: '🤖 Atlas Analysis' } }],
      },
    });
    blocks.push({
      object: 'block',
      type: 'callout',
      callout: {
        rich_text: [{ type: 'text', text: { content: sections.analysis.substring(0, 2000) } }],
        icon: { type: 'emoji', emoji: '💡' },
      },
    });
  }

  if (sections.specification) {
    blocks.push({
      object: 'block',
      type: 'heading_2',
      heading_2: {
        rich_text: [{ type: 'text', text: { content: '📋 Task Specification' } }],
      },
    });
    // Split specification into paragraphs for better readability
    const paragraphs = sections.specification.split(/\n\n+/).filter(p => p.trim());
    for (const para of paragraphs.slice(0, 10)) { // Limit to 10 paragraphs
      blocks.push({
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [{ type: 'text', text: { content: para.substring(0, 2000) } }],
        },
      });
    }
  }

  if (sections.raw) {
    blocks.push({
      object: 'block',
      type: 'heading_2',
      heading_2: {
        rich_text: [{ type: 'text', text: { content: '📝 Context' } }],
      },
    });
    // Split raw content into paragraphs
    const paragraphs = sections.raw.split(/\n\n+/).filter(p => p.trim());
    for (const para of paragraphs.slice(0, 15)) { // Limit to 15 paragraphs
      blocks.push({
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [{ type: 'text', text: { content: para.substring(0, 2000) } }],
        },
      });
    }
  }

  // Add divider before work section
  blocks.push({
    object: 'block',
    type: 'divider',
    divider: {},
  });

  // Add placeholder for Pit Crew work
  blocks.push({
    object: 'block',
    type: 'heading_2',
    heading_2: {
      rich_text: [{ type: 'text', text: { content: '🔧 Pit Crew Work' } }],
    },
  });
  blocks.push({
    object: 'block',
    type: 'paragraph',
    paragraph: {
      rich_text: [{ type: 'text', text: { content: '(Pit Crew will document implementation notes here)' }, annotations: { italic: true, color: 'gray' } }],
    },
  });

  return blocks;
}

async function syncToNotion(discussion: Discussion): Promise<{ url: string; pageId: string } | null> {
  if (!process.env.NOTION_API_KEY) {
    console.error('[PitCrew] ERROR: NOTION_API_KEY not set - cannot sync to Notion');
    return null;
  }

  try {
    // Map discussion type to Dev Pipeline Type
    const typeMap: Record<Discussion['type'], string> = {
      'bug': 'Bug',
      'feature': 'Feature',
      'question': 'Question',
      'hotfix': 'Hotfix',
    };

    // Map discussion status to Dev Pipeline Status
    const statusMap: Record<Discussion['status'], string> = {
      'dispatched': 'Dispatched',
      'in-progress': 'In Progress',
      'needs-approval': 'Needs Approval',
      'approved': 'Approved',
      'deployed': 'Shipped',
      'closed': 'Closed',
    };

    // Build page body blocks from context
    const bodyBlocks = buildPageBodyBlocks(discussion.context);

    const response = await notion.pages.create({
      parent: { database_id: DEV_PIPELINE_DATABASE_ID },
      properties: {
        'Discussion': { title: [{ text: { content: discussion.title } }] },
        'Type': { select: { name: typeMap[discussion.type] || 'Bug' } },
        'Priority': { select: { name: discussion.priority } },
        'Status': { select: { name: statusMap[discussion.status] || 'Dispatched' } },
        'Requestor': { select: { name: discussion.requestor === 'atlas' ? 'Atlas [Telegram]' : discussion.requestor } },
        'Handler': { select: { name: 'Pit Crew' } },
        // Thread property now just holds a brief summary, not the full context
        'Thread': { rich_text: [{ text: { content: `See page body for full context. Discussion ID: ${discussion.id}` } }] },
        'Dispatched': { date: { start: new Date().toISOString().split('T')[0] } },
      },
      // CRITICAL: Add content to PAGE BODY, not just properties
      children: bodyBlocks,
    });

    // Use actual URL from API response
    const url = (response as { url?: string }).url || `https://notion.so/${response.id.replace(/-/g, '')}`;
    console.error(`[PitCrew] Synced to Notion with page body: ${url}`);
    return { url, pageId: response.id };
  } catch (error) {
    console.error('[PitCrew] Notion sync FAILED:', error);
    return null;
  }
}

/**
 * Append a message to an existing Notion page
 * This enables real-time collaboration between Atlas and Pit Crew
 */
async function appendMessageToNotion(
  pageId: string,
  message: Message
): Promise<boolean> {
  if (!process.env.NOTION_API_KEY) {
    console.error('[PitCrew] ERROR: NOTION_API_KEY not set - cannot append message');
    return false;
  }

  try {
    // Format timestamp for display
    const timestamp = new Date(message.timestamp).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });

    // Determine icon based on sender
    const senderIcons: Record<string, string> = {
      'atlas': '🤖',
      'pit-crew': '🔧',
      'jim': '👤',
    };
    const icon = senderIcons[message.from] || '💬';

    // Build message block
    await notion.blocks.children.append({
      block_id: pageId,
      children: [
        {
          object: 'block',
          type: 'callout',
          callout: {
            rich_text: [
              { type: 'text', text: { content: `[${timestamp}] ` }, annotations: { bold: true, color: 'gray' } },
              { type: 'text', text: { content: message.content.substring(0, 1900) } },
            ],
            icon: { type: 'emoji', emoji: icon as '🤖' | '🔧' | '👤' | '💬' },
            color: message.from === 'atlas' ? 'blue_background' : message.from === 'pit-crew' ? 'green_background' : 'default',
          },
        },
      ],
    });

    console.error(`[PitCrew] Appended message to Notion page ${pageId}`);
    return true;
  } catch (error) {
    console.error('[PitCrew] Failed to append message to Notion:', error);
    return false;
  }
}

/**
 * Update a Notion page's status property
 */
async function updateNotionStatus(
  pageId: string,
  status: Discussion['status'],
  output?: string
): Promise<boolean> {
  if (!process.env.NOTION_API_KEY) {
    console.error('[PitCrew] ERROR: NOTION_API_KEY not set - cannot update status');
    return false;
  }

  try {
    const statusMap: Record<Discussion['status'], string> = {
      'dispatched': 'Dispatched',
      'in-progress': 'In Progress',
      'needs-approval': 'Needs Approval',
      'approved': 'Approved',
      'deployed': 'Shipped',
      'closed': 'Closed',
    };

    const properties: Record<string, unknown> = {
      'Status': { select: { name: statusMap[status] || 'Dispatched' } },
    };

    // Add output URL if provided
    if (output) {
      properties['Output'] = { url: output };
    }

    await notion.pages.update({
      page_id: pageId,
      properties,
    });

    console.error(`[PitCrew] Updated Notion page status to ${status}`);
    return true;
  } catch (error) {
    console.error('[PitCrew] Failed to update Notion status:', error);
    return false;
  }
}

// === MCP SERVER ===

const server = new Server(
  { name: 'pit-crew-mcp', version: '0.1.0' },
  { capabilities: { tools: {}, resources: {} } }
);

// --- TOOLS ---

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'dispatch_work',
      description: 'Dispatch a development request to Pit Crew. Creates a new discussion thread.',
      inputSchema: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['bug', 'feature', 'question', 'hotfix'] },
          title: { type: 'string', description: 'Brief title for the request' },
          context: { type: 'string', description: 'Full context: what happened, what you tried, relevant code paths' },
          priority: { type: 'string', enum: ['P0', 'P1', 'P2'], default: 'P2' },
          wq_url: { type: 'string', description: 'Link to Work Queue item (optional)' },
        },
        required: ['type', 'title', 'context'],
      },
    },
    {
      name: 'post_message',
      description: 'Post a message to an existing discussion thread.',
      inputSchema: {
        type: 'object',
        properties: {
          discussion_id: { type: 'string' },
          from: { type: 'string', enum: ['atlas', 'pit-crew', 'jim'] },
          message: { type: 'string' },
        },
        required: ['discussion_id', 'from', 'message'],
      },
    },
    {
      name: 'update_status',
      description: 'Update the status of a discussion. Use for workflow progression.',
      inputSchema: {
        type: 'object',
        properties: {
          discussion_id: { type: 'string' },
          status: {
            type: 'string',
            enum: ['dispatched', 'in-progress', 'needs-approval', 'approved', 'deployed', 'closed']
          },
          output: { type: 'string', description: 'Commit URL, PR link, or other output (optional)' },
        },
        required: ['discussion_id', 'status'],
      },
    },
    {
      name: 'get_discussion',
      description: 'Get full details of a discussion thread.',
      inputSchema: {
        type: 'object',
        properties: {
          discussion_id: { type: 'string' },
        },
        required: ['discussion_id'],
      },
    },
    {
      name: 'list_active',
      description: 'List all active (non-closed) discussions.',
      inputSchema: {
        type: 'object',
        properties: {
          status_filter: {
            type: 'string',
            enum: ['all', 'dispatched', 'in-progress', 'needs-approval', 'approved', 'deployed'],
            default: 'all'
          },
        },
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  await ensureDataDir();

  switch (name) {
    case 'dispatch_work': {
      const id = generateId(args?.title as string);
      const discussion: Discussion = {
        id,
        title: args?.title as string,
        type: args?.type as Discussion['type'],
        priority: (args?.priority as Discussion['priority']) || 'P2',
        status: 'dispatched',
        requestor: 'atlas',
        assignee: 'pit-crew',
        context: args?.context as string,
        wq_url: args?.wq_url as string | undefined,
        messages: [{
          timestamp: new Date().toISOString(),
          from: 'atlas',
          content: `**Dispatched:** ${args?.title}\n\n${args?.context}`,
        }],
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
      };

      // 1. Save local record (always works)
      await saveDiscussion(discussion);

      // 2. SYNC TO NOTION (MANDATORY - Neuro-Link Protocol)
      // If this fails, we return an error so Atlas knows the dispatch is incomplete
      const notionResult = await syncToNotion(discussion);

      if (!notionResult) {
        // CRITICAL: Return error if Notion sync failed
        // Atlas should NOT confirm dispatch without a trackable URL
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              discussion_id: id,
              error: `Created local record ${id} but FAILED to sync to Notion. Check NOTION_API_KEY environment variable.`,
            }),
          }],
        };
      }

      // Update local record with Notion URL and page ID
      discussion.notion_url = notionResult.url;
      discussion.notion_page_id = notionResult.pageId;
      await saveDiscussion(discussion);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            discussion_id: id,
            notion_url: notionResult.url,
            notion_page_id: notionResult.pageId,
            message: `Dispatched to Pit Crew: ${args?.title}`,
          }),
        }],
      };
    }

    case 'post_message': {
      const discussion = await loadDiscussion(args?.discussion_id as string);
      if (!discussion) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'Discussion not found' }) }],
        };
      }

      const newMessage: Message = {
        timestamp: new Date().toISOString(),
        from: args?.from as Message['from'],
        content: args?.message as string,
      };

      discussion.messages.push(newMessage);
      await saveDiscussion(discussion);

      // SYNC MESSAGE TO NOTION PAGE BODY
      // This enables real-time collaboration visible in Notion
      if (discussion.notion_page_id) {
        await appendMessageToNotion(discussion.notion_page_id, newMessage);
      } else {
        console.error('[PitCrew] Warning: No notion_page_id for discussion, message not synced to Notion');
      }

      return {
        content: [{ type: 'text', text: JSON.stringify({
          success: true,
          message: 'Message posted',
          synced_to_notion: !!discussion.notion_page_id,
          notion_url: discussion.notion_url,
        }) }],
      };
    }

    case 'update_status': {
      const discussion = await loadDiscussion(args?.discussion_id as string);
      if (!discussion) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'Discussion not found' }) }],
        };
      }

      const oldStatus = discussion.status;
      discussion.status = args?.status as Discussion['status'];
      if (args?.output) {
        discussion.output = args?.output as string;
      }

      // Auto-add status change message
      const statusMessage: Message = {
        timestamp: new Date().toISOString(),
        from: 'pit-crew',
        content: `**Status:** ${oldStatus} → ${discussion.status}${args?.output ? `\n**Output:** ${args?.output}` : ''}`,
      };
      discussion.messages.push(statusMessage);
      await saveDiscussion(discussion);

      // SYNC TO NOTION: Update status property AND append status message
      if (discussion.notion_page_id) {
        await updateNotionStatus(discussion.notion_page_id, discussion.status, args?.output as string | undefined);
        await appendMessageToNotion(discussion.notion_page_id, statusMessage);
      }

      return {
        content: [{ type: 'text', text: JSON.stringify({
          success: true,
          status: discussion.status,
          synced_to_notion: !!discussion.notion_page_id,
          notion_url: discussion.notion_url,
        }) }],
      };
    }

    case 'get_discussion': {
      const discussion = await loadDiscussion(args?.discussion_id as string);
      if (!discussion) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'Discussion not found' }) }],
        };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify({ success: true, discussion }) }],
      };
    }

    case 'list_active': {
      const all = await listDiscussions();
      const filter = args?.status_filter as string || 'all';
      const filtered = filter === 'all'
        ? all.filter(d => d.status !== 'closed')
        : all.filter(d => d.status === filter);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            count: filtered.length,
            discussions: filtered.map(d => ({
              id: d.id,
              title: d.title,
              type: d.type,
              status: d.status,
              priority: d.priority,
              updated: d.updated,
              notion_url: d.notion_url,
            })),
          }),
        }],
      };
    }

    default:
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: `Unknown tool: ${name}` }) }],
      };
  }
});

// --- RESOURCES ---

server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [
    {
      uri: 'pit-crew://discussions',
      name: 'Active Discussions',
      description: 'List of all active Pit Crew discussions',
      mimeType: 'application/json',
    },
  ],
}));

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;

  if (uri === 'pit-crew://discussions') {
    const discussions = await listDiscussions();
    const active = discussions.filter(d => d.status !== 'closed');
    return {
      contents: [{
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(active, null, 2),
      }],
    };
  }

  // pit-crew://discussion/{id}
  const match = uri.match(/^pit-crew:\/\/discussion\/(.+)$/);
  if (match) {
    const discussion = await loadDiscussion(match[1]);
    return {
      contents: [{
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(discussion, null, 2),
      }],
    };
  }

  throw new Error(`Unknown resource: ${uri}`);
});

// --- START ---

async function main() {
  await ensureDataDir();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[PitCrew] MCP server running');
}

main().catch(err => {
  console.error('[PitCrew] Fatal error:', err);
  process.exit(1);
});
