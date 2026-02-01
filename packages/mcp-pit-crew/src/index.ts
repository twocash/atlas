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
import { Client as NotionClient } from '@notionhq/client';

// === CONFIGURATION ===

const DATA_DIR = process.env.PIT_CREW_DATA_DIR || './data/pit-crew';
const DISCUSSIONS_DIR = join(DATA_DIR, 'discussions');
const NOTION_API_KEY = process.env.NOTION_API_KEY;
// Atlas Dev Pipeline database PAGE ID (not data source ID)
const NOTION_PIPELINE_DB = process.env.NOTION_PIPELINE_DB || 'ce6fbf1bee30433da9e6b338552de7c9';

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

// === NOTION SYNC ===

/**
 * Retry wrapper for Notion API calls.
 * Handles 429 (rate limit) and transient errors gracefully.
 */
async function safeNotionCall<T>(
  operation: () => Promise<T>,
  maxRetries = 3
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (err: unknown) {
      const error = err as { status?: number; message?: string };
      lastError = err instanceof Error ? err : new Error(String(err));

      if (error.status === 429) {
        // Rate limited - exponential backoff
        const delay = Math.pow(2, attempt) * 1000;
        console.error(`[PitCrew] Notion rate limit. Waiting ${delay / 1000}s (attempt ${attempt}/${maxRetries})...`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }

      if (error.status && error.status >= 500) {
        // Server error - retry with backoff
        const delay = attempt * 1000;
        console.error(`[PitCrew] Notion server error (${error.status}). Retrying in ${delay / 1000}s...`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }

      // Non-retryable error
      throw err;
    }
  }

  throw lastError ?? new Error('Notion call failed after max retries');
}

async function syncToNotion(discussion: Discussion): Promise<string | null> {
  if (!NOTION_API_KEY) {
    console.error('[PitCrew] NOTION_API_KEY not set - skipping Notion sync');
    return null;
  }
  if (!NOTION_PIPELINE_DB) {
    console.error('[PitCrew] NOTION_PIPELINE_DB not set - skipping Notion sync');
    return null;
  }
  console.error(`[PitCrew] Syncing to Notion DB: ${NOTION_PIPELINE_DB.substring(0, 8)}...`);

  const notion = new NotionClient({ auth: NOTION_API_KEY });

  // Format thread as markdown
  const threadMd = discussion.messages
    .map(m => `**${m.from}** (${m.timestamp}):\n${m.content}`)
    .join('\n\n---\n\n');

  try {
    // Check if page exists (by title match - simple approach)
    if (discussion.notion_url) {
      // Update existing page
      const pageId = discussion.notion_url.split('/').pop()?.split('-').pop() || '';
      await safeNotionCall(() => notion.pages.update({
        page_id: pageId,
        properties: {
          'Status': { select: { name: formatStatus(discussion.status) } },
          'Thread': { rich_text: [{ text: { content: threadMd.substring(0, 2000) } }] },
          'Output': discussion.output ? { url: discussion.output } : { url: null },
        },
      }));
      return discussion.notion_url;
    } else {
      // Map internal values to Notion select options
      const requestorMap: Record<string, string> = {
        'atlas': 'Atlas [Telegram]',
        'jim': 'Jim',
      };
      const handlerMap: Record<string, string> = {
        'pit-crew': 'Pit Crew',
      };
      const typeMap: Record<string, string> = {
        'bug': 'Bug',
        'feature': 'Feature',
        'hotfix': 'Hotfix',
        'question': 'Question',
      };

      // Create new page
      const response = await safeNotionCall(() => notion.pages.create({
        parent: { database_id: NOTION_PIPELINE_DB },
        properties: {
          'Discussion': { title: [{ text: { content: discussion.title } }] },
          'Status': { select: { name: formatStatus(discussion.status) } },
          'Type': { select: { name: typeMap[discussion.type] || capitalize(discussion.type) } },
          'Priority': { select: { name: discussion.priority } },
          'Requestor': { select: { name: requestorMap[discussion.requestor] || discussion.requestor } },
          'Handler': { select: { name: handlerMap[discussion.assignee] || discussion.assignee } },
          'Thread': { rich_text: [{ text: { content: threadMd.substring(0, 2000) } }] },
          'Work Queue': discussion.wq_url ? { url: discussion.wq_url } : { url: null },
          'Dispatched': { date: { start: discussion.created.split('T')[0] } },
          'Discussion ID': { rich_text: [{ text: { content: discussion.id } }] },
        },
      }));
      const url = (response as { url?: string }).url || null;
      console.error(`[PitCrew] Created Notion page: ${url}`);
      return url;
    }
  } catch (error: any) {
    console.error('[PitCrew] Notion sync failed:', error?.message || error);
    console.error('[PitCrew] Error details:', JSON.stringify(error?.body || error, null, 2));
    return null;
  }
}

function formatStatus(status: string): string {
  return status.split('-').map(capitalize).join(' ');
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
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

      await saveDiscussion(discussion);
      const notionUrl = await syncToNotion(discussion);
      if (notionUrl) {
        discussion.notion_url = notionUrl;
        await saveDiscussion(discussion);
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            discussion_id: id,
            notion_url: notionUrl,
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

      discussion.messages.push({
        timestamp: new Date().toISOString(),
        from: args?.from as Message['from'],
        content: args?.message as string,
      });

      await saveDiscussion(discussion);
      await syncToNotion(discussion);

      return {
        content: [{ type: 'text', text: JSON.stringify({ success: true, message: 'Message posted' }) }],
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
      discussion.messages.push({
        timestamp: new Date().toISOString(),
        from: 'pit-crew',
        content: `**Status:** ${oldStatus} → ${discussion.status}${args?.output ? `\n**Output:** ${args?.output}` : ''}`,
      });

      await saveDiscussion(discussion);
      await syncToNotion(discussion);

      return {
        content: [{ type: 'text', text: JSON.stringify({ success: true, status: discussion.status }) }],
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
