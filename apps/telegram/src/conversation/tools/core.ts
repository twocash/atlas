/**
 * Atlas Telegram Bot - Core Tools
 *
 * Notion search, web search, work queue operations.
 */

import type Anthropic from '@anthropic-ai/sdk';
import { Client } from '@notionhq/client';
import { logger } from '../../logger';
import { logWQActivity, notionUrl, type Pillar } from '../audit';
import { searchNotion as globalNotionSearch } from '../../notion';

// Create Notion client - log the key prefix for debugging
const notionApiKey = process.env.NOTION_API_KEY;
console.log('[INIT] Notion client init, key prefix:', notionApiKey?.substring(0, 10) + '...');
const notion = new Client({ auth: notionApiKey });

// Notion Database IDs — verified via MCP search
const FEED_DATABASE_ID = '90b2b33f-4b44-4b42-870f-8d62fb8cbf18';
const WORK_QUEUE_DATABASE_ID = '3d679030-b76b-43bd-92d8-1ac51abb4a28';
// NO INBOX — Telegram replaces it per spec

// Helper to safely extract property values from Notion pages
function getTitle(props: Record<string, unknown>, key: string): string {
  const prop = props[key] as { type?: string; title?: Array<{ plain_text?: string }> } | undefined;
  if (prop?.type === 'title' && Array.isArray(prop.title) && prop.title[0]?.plain_text) {
    return prop.title[0].plain_text;
  }
  return 'Untitled';
}

function getSelect(props: Record<string, unknown>, key: string): string | null {
  const prop = props[key] as { type?: string; select?: { name?: string } | null } | undefined;
  if (prop?.type === 'select' && prop.select?.name) {
    return prop.select.name;
  }
  return null;
}

export const CORE_TOOLS: Anthropic.Tool[] = [
  {
    name: 'notion_search',
    description: 'Search Notion for pages, documents, drafts, or any content. Searches Feed, Work Queue, AND all other pages in the workspace. Use for finding documents, drafts, notes, or looking up past work.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Search query text',
        },
        database: {
          type: 'string',
          enum: ['feed', 'work_queue', 'global', 'all'],
          description: 'Which to search: feed, work_queue, global (all pages), or all (default: all)',
        },
        limit: {
          type: 'number',
          description: 'Max results to return (default: 10)',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'work_queue_list',
    description: 'List items from the Work Queue with optional filters. Use to show active tasks, blocked items, or backlog.',
    input_schema: {
      type: 'object' as const,
      properties: {
        status: {
          type: 'string',
          enum: ['Captured', 'Active', 'Paused', 'Blocked', 'Done', 'Shipped'],
          description: 'Filter by status',
        },
        pillar: {
          type: 'string',
          enum: ['Personal', 'The Grove', 'Consulting', 'Home/Garage'],
          description: 'Filter by pillar',
        },
        priority: {
          type: 'string',
          enum: ['P0', 'P1', 'P2', 'P3'],
          description: 'Filter by priority',
        },
        limit: {
          type: 'number',
          description: 'Max results (default: 10)',
        },
      },
      required: [],
    },
  },
  {
    name: 'work_queue_create',
    description: 'Create a new item in the Work Queue. Use when Jim wants to add a task or capture something for later.',
    input_schema: {
      type: 'object' as const,
      properties: {
        task: {
          type: 'string',
          description: 'Task title/description',
        },
        type: {
          type: 'string',
          enum: ['Research', 'Build', 'Draft', 'Schedule', 'Answer', 'Process'],
          description: 'Type of work',
        },
        pillar: {
          type: 'string',
          enum: ['Personal', 'The Grove', 'Consulting', 'Home/Garage'],
          description: 'Which pillar this belongs to',
        },
        priority: {
          type: 'string',
          enum: ['P0', 'P1', 'P2', 'P3'],
          description: 'Priority level (default: P2)',
        },
        notes: {
          type: 'string',
          description: 'Additional notes or context',
        },
      },
      required: ['task', 'type', 'pillar'],
    },
  },
  {
    name: 'work_queue_update',
    description: 'Update an existing Work Queue item. Use when marking tasks done, changing status, or adding notes.',
    input_schema: {
      type: 'object' as const,
      properties: {
        id: {
          type: 'string',
          description: 'Notion page ID of the item to update',
        },
        status: {
          type: 'string',
          enum: ['Captured', 'Active', 'Paused', 'Blocked', 'Done', 'Shipped'],
          description: 'New status',
        },
        priority: {
          type: 'string',
          enum: ['P0', 'P1', 'P2', 'P3'],
          description: 'New priority',
        },
        notes: {
          type: 'string',
          description: 'Add to notes field',
        },
        resolution_notes: {
          type: 'string',
          description: 'How the item was resolved (for Done/Shipped)',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'web_search',
    description: 'Search the web for current information. Use for research, fact-checking, or finding recent news.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Search query',
        },
        num_results: {
          type: 'number',
          description: 'Number of results (default: 5)',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_status_summary',
    description: 'Get a dashboard summary of the work queue and priorities. Use when Jim asks "what\'s on my plate" or "status".',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
];

/**
 * Execute core tools
 */
export async function executeCoreTools(
  toolName: string,
  input: Record<string, unknown>
): Promise<{ success: boolean; result: unknown; error?: string } | null> {
  switch (toolName) {
    case 'notion_search':
      return await executeNotionSearch(input);
    case 'work_queue_list':
      return await executeWorkQueueList(input);
    case 'work_queue_create':
      return await executeWorkQueueCreate(input);
    case 'work_queue_update':
      return await executeWorkQueueUpdate(input);
    case 'web_search':
      return await executeWebSearch(input);
    case 'get_status_summary':
      return await executeStatusSummary();
    default:
      return null; // Not a core tool
  }
}

async function executeNotionSearch(
  input: Record<string, unknown>
): Promise<{ success: boolean; result: unknown; error?: string }> {
  const query = input.query as string;
  const database = (input.database as string) || 'all';
  const limit = (input.limit as number) || 10;

  try {
    const results: Array<{ title: string; url: string; database: string; status?: string; pillar?: string; type?: string }> = [];

    // Search Work Queue
    if (database === 'all' || database === 'work_queue') {
      const wqResults = await notion.databases.query({
        database_id: WORK_QUEUE_DATABASE_ID,
        filter: {
          property: 'Task',
          title: { contains: query },
        },
        page_size: limit,
      });

      for (const page of wqResults.results) {
        if ('properties' in page) {
          const props = page.properties as Record<string, unknown>;
          results.push({
            title: getTitle(props, 'Task'),
            url: `https://notion.so/${page.id.replace(/-/g, '')}`,
            database: 'Work Queue',
            status: getSelect(props, 'Status') || undefined,
            pillar: getSelect(props, 'Pillar') || undefined,
          });
        }
      }
    }

    // Search Feed
    if (database === 'all' || database === 'feed') {
      const feedResults = await notion.databases.query({
        database_id: FEED_DATABASE_ID,
        filter: {
          property: 'Entry',
          title: { contains: query },
        },
        page_size: limit,
      });

      for (const page of feedResults.results) {
        if ('properties' in page) {
          const props = page.properties as Record<string, unknown>;
          results.push({
            title: getTitle(props, 'Entry'),
            url: `https://notion.so/${page.id.replace(/-/g, '')}`,
            database: 'Feed',
          });
        }
      }
    }

    // ALSO search globally across all Notion pages
    if (database === 'all' || database === 'global') {
      try {
        const globalResults = await globalNotionSearch(query);
        for (const item of globalResults) {
          // Avoid duplicates from WQ/Feed
          const alreadyFound = results.some(r => r.url === item.url);
          if (!alreadyFound) {
            results.push({
              title: item.title,
              url: item.url,
              database: item.type === 'inbox' ? 'Inbox' : item.type === 'work' ? 'Work Queue' : 'Page',
              type: item.type,
            });
          }
        }
      } catch (globalError) {
        logger.warn('Global Notion search failed, continuing with database results', { globalError });
      }
    }

    return { success: true, result: results.slice(0, limit) };
  } catch (error: any) {
    const errorInfo = {
      message: error?.message,
      code: error?.code,
      status: error?.status,
    };
    logger.error('Notion search failed', { error: errorInfo, query });
    return {
      success: false,
      result: null,
      error: `Notion error: ${error?.code || 'unknown'} - ${error?.message || String(error)}`
    };
  }
}

async function executeWorkQueueList(
  input: Record<string, unknown>
): Promise<{ success: boolean; result: unknown; error?: string }> {
  const status = input.status as string | undefined;
  const pillar = input.pillar as string | undefined;
  const priority = input.priority as string | undefined;
  const limit = (input.limit as number) || 10;

  try {
    const filters: Array<{ property: string; select: { equals: string } }> = [];

    if (status) {
      filters.push({ property: 'Status', select: { equals: status } });
    }
    if (pillar) {
      filters.push({ property: 'Pillar', select: { equals: pillar } });
    }
    if (priority) {
      filters.push({ property: 'Priority', select: { equals: priority } });
    }

    const queryParams: Parameters<typeof notion.databases.query>[0] = {
      database_id: WORK_QUEUE_DATABASE_ID,
      page_size: limit,
      sorts: [{ property: 'Priority', direction: 'ascending' }],
    };

    if (filters.length > 0) {
      queryParams.filter = filters.length === 1
        ? filters[0]
        : { and: filters };
    }

    const results = await notion.databases.query(queryParams);

    const items = results.results.map(page => {
      if ('properties' in page) {
        const props = page.properties as Record<string, unknown>;
        return {
          id: page.id,
          task: getTitle(props, 'Task'),
          status: getSelect(props, 'Status'),
          priority: getSelect(props, 'Priority'),
          pillar: getSelect(props, 'Pillar'),
          type: getSelect(props, 'Type'),
          url: `https://notion.so/${page.id.replace(/-/g, '')}`,
        };
      }
      return null;
    }).filter(Boolean);

    return { success: true, result: items };
  } catch (error) {
    logger.error('Work queue list failed', { error });
    return { success: false, result: null, error: String(error) };
  }
}

async function executeWorkQueueCreate(
  input: Record<string, unknown>
): Promise<{ success: boolean; result: unknown; error?: string }> {
  const task = input.task as string;
  const type = input.type as string;
  const pillar = input.pillar as string;
  const priority = (input.priority as string) || 'P2';
  const notes = input.notes as string | undefined;

  try {
    const response = await notion.pages.create({
      parent: { database_id: WORK_QUEUE_DATABASE_ID },
      properties: {
        'Task': { title: [{ text: { content: task } }] },
        'Type': { select: { name: type } },
        'Status': { select: { name: 'Captured' } },
        'Priority': { select: { name: priority } },
        'Pillar': { select: { name: pillar } },
        'Assignee': { select: { name: 'Atlas [Telegram]' } },
        'Queued': { date: { start: new Date().toISOString().split('T')[0] } },
        ...(notes && { 'Notes': { rich_text: [{ text: { content: notes } }] } }),
      },
    });

    const wqUrl = notionUrl(response.id);

    // Log creation to Feed
    const feedResult = await logWQActivity({
      action: 'created',
      wqItemId: response.id,
      wqTitle: task,
      pillar: pillar as Pillar,
      source: 'Telegram',
    });

    return {
      success: true,
      result: {
        id: response.id,
        url: wqUrl,
        task,
        status: 'Captured',
        feedId: feedResult?.feedId,
        feedUrl: feedResult?.feedUrl,
      },
    };
  } catch (error) {
    logger.error('Work queue create failed', { error, task });
    return { success: false, result: null, error: String(error) };
  }
}

async function executeWorkQueueUpdate(
  input: Record<string, unknown>
): Promise<{ success: boolean; result: unknown; error?: string }> {
  const id = input.id as string;
  const status = input.status as string | undefined;
  const priority = input.priority as string | undefined;
  const notes = input.notes as string | undefined;
  const resolutionNotes = input.resolution_notes as string | undefined;

  try {
    // First, fetch the current WQ item to get title, pillar, and current values
    const currentPage = await notion.pages.retrieve({ page_id: id });
    let wqTitle = 'Unknown';
    let wqPillar: Pillar = 'The Grove';
    let oldPriority: string | null = null;
    let oldStatus: string | null = null;

    if ('properties' in currentPage) {
      const props = currentPage.properties as Record<string, unknown>;
      wqTitle = getTitle(props, 'Task');
      wqPillar = (getSelect(props, 'Pillar') as Pillar) || 'The Grove';
      oldPriority = getSelect(props, 'Priority');
      oldStatus = getSelect(props, 'Status');
    }

    const properties: Record<string, unknown> = {};

    if (status) {
      properties['Status'] = { select: { name: status } };
      if (status === 'Done' || status === 'Shipped') {
        properties['Completed'] = { date: { start: new Date().toISOString().split('T')[0] } };
      }
      if (status === 'Active') {
        properties['Started'] = { date: { start: new Date().toISOString().split('T')[0] } };
      }
    }
    if (priority) {
      properties['Priority'] = { select: { name: priority } };
    }
    if (notes) {
      properties['Notes'] = { rich_text: [{ text: { content: notes } }] };
    }
    if (resolutionNotes) {
      properties['Resolution Notes'] = { rich_text: [{ text: { content: resolutionNotes } }] };
    }

    await notion.pages.update({
      page_id: id,
      properties: properties as any,
    });

    const wqUrl = notionUrl(id);

    // Log activity to Feed based on what changed
    let feedResult = null;
    if (status && status !== oldStatus) {
      // Status change - use descriptive action
      const statusLabel = status === 'Done' ? 'Completed' :
                         status === 'Active' ? 'Started' :
                         status === 'Blocked' ? 'Blocked' :
                         status === 'Paused' ? 'Paused' : 'Updated';
      feedResult = await logWQActivity({
        action: 'status_change',
        wqItemId: id,
        wqTitle,
        details: statusLabel,
        pillar: wqPillar,
        source: 'Telegram',
      });
    } else if (priority && priority !== oldPriority) {
      // Priority change
      feedResult = await logWQActivity({
        action: 'priority_change',
        wqItemId: id,
        wqTitle,
        details: `${oldPriority}→${priority}`,
        pillar: wqPillar,
        source: 'Telegram',
      });
    } else if (notes || resolutionNotes) {
      // Notes update
      feedResult = await logWQActivity({
        action: 'updated',
        wqItemId: id,
        wqTitle,
        pillar: wqPillar,
        source: 'Telegram',
      });
    }

    return {
      success: true,
      result: {
        id,
        url: wqUrl,
        title: wqTitle,
        updated: Object.keys(properties),
        feedId: feedResult?.feedId,
        feedUrl: feedResult?.feedUrl,
      },
    };
  } catch (error) {
    logger.error('Work queue update failed', { error, id });
    return { success: false, result: null, error: String(error) };
  }
}

async function executeWebSearch(
  input: Record<string, unknown>
): Promise<{ success: boolean; result: unknown; error?: string }> {
  const query = input.query as string;

  // For now, return a stub - could integrate with Gemini grounding or a search API
  return {
    success: true,
    result: {
      message: 'Web search not yet implemented. Use /agent research for deep research.',
      query,
      suggestion: `Try: /agent research "${query}"`,
    },
  };
}

async function executeStatusSummary(): Promise<{ success: boolean; result: unknown; error?: string }> {
  try {
    const statusCounts: Record<string, number> = {};
    const pillarCounts: Record<string, number> = {};
    const p0Items: Array<{ task: string; pillar: string }> = [];

    // Query Work Queue ONLY — no Inbox per spec
    const activeResults = await notion.databases.query({
      database_id: WORK_QUEUE_DATABASE_ID,
      filter: {
        or: [
          { property: 'Status', select: { equals: 'Active' } },
          { property: 'Status', select: { equals: 'Blocked' } },
          { property: 'Status', select: { equals: 'Captured' } },
        ],
      },
      page_size: 50,
    });

    for (const page of activeResults.results) {
      if ('properties' in page) {
        const props = page.properties as Record<string, unknown>;
        const status = getSelect(props, 'Status') || 'Unknown';
        const pillar = getSelect(props, 'Pillar') || 'Unknown';
        const priority = getSelect(props, 'Priority');
        const task = getTitle(props, 'Task');

        statusCounts[status] = (statusCounts[status] || 0) + 1;
        pillarCounts[pillar] = (pillarCounts[pillar] || 0) + 1;

        if (priority === 'P0') {
          p0Items.push({ task, pillar });
        }
      }
    }

    return {
      success: true,
      result: {
        workQueue: {
          totalActive: activeResults.results.length,
          byStatus: statusCounts,
          byPillar: pillarCounts,
        },
        p0Items,
        summary: p0Items.length > 0
          ? `${p0Items.length} P0 items need attention`
          : 'No P0 items. Queue is manageable.',
      },
    };
  } catch (error: any) {
    logger.error('Status summary failed', { error });
    return {
      success: false,
      result: null,
      error: `Notion error: ${error?.code || 'unknown'} - ${error?.message || String(error)}`
    };
  }
}
