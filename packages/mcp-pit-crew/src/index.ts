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
async function syncToNotion(discussion: Discussion): Promise<string | null> {
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

    const response = await notion.pages.create({
      parent: { database_id: DEV_PIPELINE_DATABASE_ID },
      properties: {
        'Discussion': { title: [{ text: { content: discussion.title } }] },
        'Type': { select: { name: typeMap[discussion.type] || 'Bug' } },
        'Priority': { select: { name: discussion.priority } },
        'Status': { select: { name: statusMap[discussion.status] || 'Dispatched' } },
        'Requestor': { select: { name: discussion.requestor === 'atlas' ? 'Atlas [Telegram]' : discussion.requestor } },
        'Handler': { select: { name: 'Pit Crew' } },
        'Thread': { rich_text: [{ text: { content: discussion.context.substring(0, 2000) } }] },
        'Dispatched': { date: { start: new Date().toISOString().split('T')[0] } },
      },
    });

    // Use actual URL from API response
    const url = (response as { url?: string }).url || `https://notion.so/${response.id.replace(/-/g, '')}`;
    console.error(`[PitCrew] Synced to Notion: ${url}`);
    return url;
  } catch (error) {
    console.error('[PitCrew] Notion sync FAILED:', error);
    return null;
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
      const notionUrl = await syncToNotion(discussion);

      if (!notionUrl) {
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

      // Update local record with Notion URL
      discussion.notion_url = notionUrl;
      await saveDiscussion(discussion);

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
