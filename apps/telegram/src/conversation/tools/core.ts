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

// Notion DATA SOURCE IDs — from spec, verified correct
// Database page IDs for Notion SDK
const FEED_DATABASE_ID = '90b2b33f-4b44-4b42-870f-8d62fb8cbf18';
const WORK_QUEUE_DATABASE_ID = '3d679030-b76b-43bd-92d8-1ac51abb4a28';
const DEV_PIPELINE_DATABASE_ID = 'ce6fbf1b-ee30-433d-a9e6-b338552de7c9';
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

function getRichText(props: Record<string, unknown>, key: string): string | null {
  const prop = props[key] as { type?: string; rich_text?: Array<{ plain_text?: string }> } | undefined;
  if (prop?.type === 'rich_text' && Array.isArray(prop.rich_text) && prop.rich_text.length > 0) {
    return prop.rich_text.map(t => t.plain_text || '').join('');
  }
  return null;
}

function getDate(props: Record<string, unknown>, key: string): string | null {
  const prop = props[key] as { type?: string; date?: { start?: string } | null } | undefined;
  if (prop?.type === 'date' && prop.date?.start) {
    return prop.date.start;
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
    description: 'Update an existing Work Queue item. Can update ANY field from the Work Queue 2.0 schema.',
    input_schema: {
      type: 'object' as const,
      properties: {
        id: {
          type: 'string',
          description: 'Notion page ID of the item to update',
        },
        status: {
          type: 'string',
          enum: ['Captured', 'Active', 'Paused', 'Blocked', 'Done', 'Shipped', 'Triaged'],
          description: 'New status',
        },
        priority: {
          type: 'string',
          enum: ['P0', 'P1', 'P2', 'P3'],
          description: 'New priority',
        },
        pillar: {
          type: 'string',
          enum: ['Personal', 'The Grove', 'Consulting', 'Home/Garage'],
          description: 'Which life domain this belongs to',
        },
        assignee: {
          type: 'string',
          enum: ['Jim', 'Atlas [Telegram]', 'Atlas [laptop]', 'Atlas [grove-node-1]', 'Agent'],
          description: 'Who is responsible for this task',
        },
        type: {
          type: 'string',
          enum: ['Research', 'Build', 'Draft', 'Schedule', 'Answer', 'Process'],
          description: 'Type of work',
        },
        notes: {
          type: 'string',
          description: 'Task notes and context',
        },
        resolution_notes: {
          type: 'string',
          description: 'How the item was resolved (for Done/Shipped)',
        },
        blocked_reason: {
          type: 'string',
          description: 'Why this item is blocked (when status=Blocked)',
        },
        output: {
          type: 'string',
          description: 'URL to the output/deliverable (e.g., GitHub PR, published post)',
        },
        work_type: {
          type: 'string',
          description: 'Brief description of work type within pillar',
        },
        disposition: {
          type: 'string',
          enum: ['Completed', 'Dismissed', 'Deferred', 'Needs Rework', 'Published'],
          description: 'Final disposition of completed work',
        },
        was_reclassified: {
          type: 'boolean',
          description: 'Whether this item was reclassified from original pillar',
        },
        original_pillar: {
          type: 'string',
          enum: ['Personal', 'The Grove', 'Consulting', 'Home/Garage'],
          description: 'Original pillar before reclassification (set automatically when pillar changes)',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'work_queue_get',
    description: 'Get full details of a single Work Queue item by ID. Returns ALL properties including notes, assignee, blocked reason, dates, etc.',
    input_schema: {
      type: 'object' as const,
      properties: {
        id: {
          type: 'string',
          description: 'Notion page ID of the Work Queue item',
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
  // ==========================================
  // Broader Notion Access (Context & Awareness)
  // ==========================================
  {
    name: 'notion_fetch_page',
    description: 'Fetch full content of a Notion page by URL or ID. Use to read documents, drafts, notes, or any page content. Returns page properties and body text.',
    input_schema: {
      type: 'object' as const,
      properties: {
        page_id: {
          type: 'string',
          description: 'Notion page ID (with or without dashes) or full Notion URL',
        },
      },
      required: ['page_id'],
    },
  },
  {
    name: 'notion_list_databases',
    description: 'List all Notion databases Jim has shared with Atlas. Use to discover what databases exist beyond Feed/Work Queue.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'notion_query_database',
    description: 'Query any Notion database by name or ID. Use for databases beyond Feed/Work Queue - like projects, contacts, reading lists, etc.',
    input_schema: {
      type: 'object' as const,
      properties: {
        database: {
          type: 'string',
          description: 'Database name (e.g., "Projects", "Reading List") or database ID',
        },
        filter_property: {
          type: 'string',
          description: 'Property name to filter on (optional)',
        },
        filter_value: {
          type: 'string',
          description: 'Value to filter for (optional)',
        },
        limit: {
          type: 'number',
          description: 'Max results (default: 10)',
        },
      },
      required: ['database'],
    },
  },
  // ==========================================
  // Dev Pipeline (Atlas Development Tracking)
  // ==========================================
  {
    name: 'dev_pipeline_create',
    description: 'Create an item in the Atlas Dev Pipeline database. Use for bugs, features, and development tasks that go through the Pit Crew workflow.',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: {
          type: 'string',
          description: 'Title/name of the item (e.g., "BUG: MCP tools not working")',
        },
        type: {
          type: 'string',
          enum: ['Bug', 'Feature', 'Question', 'Hotfix'],
          description: 'Type of dev work',
        },
        priority: {
          type: 'string',
          enum: ['P0', 'P1', 'P2'],
          description: 'Priority level (P0=urgent, P1=this week, P2=backlog)',
        },
        status: {
          type: 'string',
          enum: ['Dispatched', 'In Progress', 'Needs Approval', 'Approved', 'Shipped', 'Closed'],
          description: 'Current status (default: Dispatched)',
        },
        thread: {
          type: 'string',
          description: 'Context/thread of discussion about this item',
        },
        resolution: {
          type: 'string',
          description: 'Resolution notes (for completed items)',
        },
        requestor: {
          type: 'string',
          enum: ['Jim', 'Atlas [Telegram]', 'Pit Crew'],
          description: 'Who requested this (default: Atlas [Telegram])',
        },
        handler: {
          type: 'string',
          enum: ['Jim', 'Pit Crew', 'Atlas [Telegram]'],
          description: 'Who is handling this (default: Pit Crew)',
        },
      },
      required: ['title', 'type', 'priority'],
    },
  },
  {
    name: 'dev_pipeline_list',
    description: 'List items from the Dev Pipeline with optional filters. Use to see bugs, features, and development tasks.',
    input_schema: {
      type: 'object' as const,
      properties: {
        status: {
          type: 'string',
          enum: ['Dispatched', 'In Progress', 'Needs Approval', 'Approved', 'Shipped', 'Closed'],
          description: 'Filter by status',
        },
        type: {
          type: 'string',
          enum: ['Bug', 'Feature', 'Question', 'Hotfix'],
          description: 'Filter by type',
        },
        priority: {
          type: 'string',
          enum: ['P0', 'P1', 'P2'],
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
  // ==========================================
  // Changelog (What's New)
  // ==========================================
  {
    name: 'get_changelog',
    description: 'Get recently shipped features and bug fixes from the Dev Pipeline. Use to understand what capabilities are now available or what was recently fixed.',
    input_schema: {
      type: 'object' as const,
      properties: {
        limit: {
          type: 'number',
          description: 'Max items to return (default: 10)',
        },
      },
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
    case 'work_queue_get':
      return await executeWorkQueueGet(input);
    case 'web_search':
      return await executeWebSearch(input);
    case 'get_status_summary':
      return await executeStatusSummary();
    // Broader Notion access
    case 'notion_fetch_page':
      return await executeNotionFetchPage(input);
    case 'notion_list_databases':
      return await executeNotionListDatabases();
    case 'notion_query_database':
      return await executeNotionQueryDatabase(input);
    // Dev Pipeline
    case 'dev_pipeline_create':
      return await executeDevPipelineCreate(input);
    case 'dev_pipeline_list':
      return await executeDevPipelineList(input);
    // Changelog
    case 'get_changelog':
      return await executeGetChangelog(input);
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

  logger.info('Notion search starting', { query, database, limit });
  const results: Array<{ title: string; url: string; database: string; status?: string; pillar?: string; type?: string }> = [];
  const errors: string[] = [];

  // Search Work Queue (isolated try/catch)
  if (database === 'all' || database === 'work_queue') {
    try {
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
            url: (page as { url?: string }).url || `https://notion.so/${page.id.replace(/-/g, '')}`,
            database: 'Work Queue',
            status: getSelect(props, 'Status') || undefined,
            pillar: getSelect(props, 'Pillar') || undefined,
          });
        }
      }
      logger.debug('WQ search complete', { count: wqResults.results.length });
    } catch (wqError: any) {
      logger.warn('Work Queue search failed', { error: wqError?.message });
      errors.push(`WQ: ${wqError?.message}`);
    }
  }

  // Search Feed (isolated try/catch)
  if (database === 'all' || database === 'feed') {
    try {
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
            url: (page as { url?: string }).url || `https://notion.so/${page.id.replace(/-/g, '')}`,
            database: 'Feed',
          });
        }
      }
      logger.debug('Feed search complete', { count: feedResults.results.length });
    } catch (feedError: any) {
      logger.warn('Feed search failed', { error: feedError?.message });
      errors.push(`Feed: ${feedError?.message}`);
    }
  }

  // ALWAYS search globally (this is the most important for finding docs/drafts)
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
            database: item.type === 'feed' ? 'Feed' : item.type === 'work' ? 'Work Queue' : 'Page',
            type: item.type,
          });
        }
      }
      logger.debug('Global search complete', { count: globalResults.length });
    } catch (globalError: any) {
      logger.warn('Global Notion search failed', { error: globalError?.message });
      errors.push(`Global: ${globalError?.message}`);
    }
  }

  // Return results even if some searches failed
  if (results.length === 0 && errors.length > 0) {
    return {
      success: false,
      result: [],
      error: `Search errors: ${errors.join('; ')}`
    };
  }

  logger.info('Notion search complete', { query, resultCount: results.length, errors: errors.length });
  return { success: true, result: results.slice(0, limit) };
}

async function executeWorkQueueList(
  input: Record<string, unknown>
): Promise<{ success: boolean; result: unknown; error?: string }> {
  const status = input.status as string | undefined;
  const pillar = input.pillar as string | undefined;
  const priority = input.priority as string | undefined;
  const limit = (input.limit as number) || 10;

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const filters: any[] = [];

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
          url: (page as { url?: string }).url || `https://notion.so/${page.id.replace(/-/g, '')}`,
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
    logger.info('WQ Create: Starting', { task, type, pillar, priority, dbId: WORK_QUEUE_DATABASE_ID });

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

    logger.info('WQ Create: Notion API returned', { pageId: response.id, object: response.object });

    // VERIFY the page actually exists
    try {
      const verification = await notion.pages.retrieve({ page_id: response.id });
      logger.info('WQ Create: Verified page exists', {
        pageId: response.id,
        verified: true,
        parent: 'parent' in verification ? verification.parent : 'unknown'
      });
    } catch (verifyError) {
      logger.error('WQ Create: VERIFICATION FAILED - Page does not exist!', {
        pageId: response.id,
        error: verifyError
      });
      return {
        success: false,
        result: null,
        error: `Page creation returned ID but page does not exist: ${response.id}`
      };
    }

    const wqUrl = notionUrl(response.id);

    // Log creation to Feed (non-blocking, errors are caught internally)
    const feedResult = await logWQActivity({
      action: 'created',
      wqItemId: response.id,
      wqTitle: task,
      pillar: pillar as Pillar,
      source: 'Telegram',
    });

    logger.info('WQ Create: Complete', { pageId: response.id, feedLogged: !!feedResult });

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
  } catch (error: any) {
    logger.error('Work queue create failed', {
      error: error?.message || String(error),
      code: error?.code,
      status: error?.status,
      task
    });
    return { success: false, result: null, error: String(error) };
  }
}

async function executeWorkQueueUpdate(
  input: Record<string, unknown>
): Promise<{ success: boolean; result: unknown; error?: string }> {
  const id = input.id as string;
  // Extract ALL Work Queue 2.0 schema fields
  const status = input.status as string | undefined;
  const priority = input.priority as string | undefined;
  const pillar = input.pillar as string | undefined;
  const assignee = input.assignee as string | undefined;
  const type = input.type as string | undefined;
  const notes = input.notes as string | undefined;
  const resolutionNotes = input.resolution_notes as string | undefined;
  const blockedReason = input.blocked_reason as string | undefined;
  const output = input.output as string | undefined;
  const workType = input.work_type as string | undefined;
  const disposition = input.disposition as string | undefined;
  const wasReclassified = input.was_reclassified as boolean | undefined;
  const originalPillar = input.original_pillar as string | undefined;

  try {
    // First, fetch the current WQ item to get title, pillar, and current values
    const currentPage = await notion.pages.retrieve({ page_id: id });
    let wqTitle = 'Unknown';
    let wqPillar: Pillar = 'The Grove';
    let oldPriority: string | null = null;
    let oldStatus: string | null = null;
    let oldPillar: string | null = null;

    if ('properties' in currentPage) {
      const props = currentPage.properties as Record<string, unknown>;
      wqTitle = getTitle(props, 'Task');
      wqPillar = (getSelect(props, 'Pillar') as Pillar) || 'The Grove';
      oldPriority = getSelect(props, 'Priority');
      oldStatus = getSelect(props, 'Status');
      oldPillar = getSelect(props, 'Pillar');
    }

    const properties: Record<string, unknown> = {};

    // Status with automatic date tracking
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
    // Pillar with automatic reclassification tracking
    if (pillar) {
      properties['Pillar'] = { select: { name: pillar } };
      // If pillar is changing, track the reclassification
      if (oldPillar && pillar !== oldPillar) {
        properties['Original Pillar'] = { select: { name: oldPillar } };
        properties['Was Reclassified'] = { checkbox: true };
      }
      wqPillar = pillar as Pillar; // Update for Feed logging
    }
    if (assignee) {
      properties['Assignee'] = { select: { name: assignee } };
    }
    if (type) {
      properties['Type'] = { select: { name: type } };
    }
    if (notes) {
      properties['Notes'] = { rich_text: [{ text: { content: notes } }] };
    }
    if (resolutionNotes) {
      properties['Resolution Notes'] = { rich_text: [{ text: { content: resolutionNotes } }] };
    }
    if (blockedReason) {
      properties['Blocked Reason'] = { rich_text: [{ text: { content: blockedReason } }] };
    }
    // Output is a URL type, not rich_text
    if (output) {
      properties['Output'] = { url: output };
    }
    if (workType) {
      properties['Work Type'] = { rich_text: [{ text: { content: workType } }] };
    }
    if (disposition) {
      properties['Disposition'] = { select: { name: disposition } };
    }
    // Manual override for reclassification tracking
    if (wasReclassified !== undefined) {
      properties['Was Reclassified'] = { checkbox: wasReclassified };
    }
    if (originalPillar) {
      properties['Original Pillar'] = { select: { name: originalPillar } };
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

async function executeWorkQueueGet(
  input: Record<string, unknown>
): Promise<{ success: boolean; result: unknown; error?: string }> {
  const id = input.id as string;

  try {
    const page = await notion.pages.retrieve({ page_id: id });

    if (!('properties' in page)) {
      return { success: false, result: null, error: 'Page has no properties' };
    }

    const props = page.properties as Record<string, unknown>;

    // Extract all relevant properties
    const item = {
      id: page.id,
      url: (page as { url?: string }).url || `https://notion.so/${page.id.replace(/-/g, '')}`,
      task: getTitle(props, 'Task'),
      status: getSelect(props, 'Status'),
      priority: getSelect(props, 'Priority'),
      pillar: getSelect(props, 'Pillar'),
      type: getSelect(props, 'Type'),
      assignee: getSelect(props, 'Assignee'),
      notes: getRichText(props, 'Notes'),
      blockedReason: getRichText(props, 'Blocked Reason'),
      resolutionNotes: getRichText(props, 'Resolution Notes'),
      output: getRichText(props, 'Output'),
      queued: getDate(props, 'Queued'),
      started: getDate(props, 'Started'),
      completed: getDate(props, 'Completed'),
    };

    return { success: true, result: item };
  } catch (error) {
    logger.error('Work queue get failed', { error, id });
    return { success: false, result: null, error: String(error) };
  }
}

/**
 * Execute web search using Gemini Flash with Google Search grounding.
 * Fast, low-cost, and leverages Jim's Google credits.
 */
async function executeWebSearch(
  input: Record<string, unknown>
): Promise<{ success: boolean; result: unknown; error?: string }> {
  const query = input.query as string;
  const numResults = (input.num_results as number) || 5;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    logger.warn('Web search: GEMINI_API_KEY not set');
    return {
      success: false,
      result: null,
      error: 'Web search requires GEMINI_API_KEY environment variable. Use /agent research for deep research instead.',
    };
  }

  const startTime = Date.now();

  try {
    // Dynamic import for Google Generative AI SDK
    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(apiKey);

    // Use Gemini Flash with Google Search grounding enabled at model level
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.0-flash',
      tools: [{ googleSearch: {} } as any], // Grounding tool at model level
    });

    // Request with search-focused prompt
    const result = await model.generateContent(
      `Search the web for current information and provide a concise, factual answer for: ${query}`
    );

    const response = result.response;
    const text = response.text();
    const latencyMs = Date.now() - startTime;

    // Extract grounding citations
    const candidate = response.candidates?.[0];
    const groundingMetadata = (candidate as any)?.groundingMetadata;
    const citations: Array<{ url: string; title: string }> = [];

    if (groundingMetadata?.groundingChunks) {
      for (const chunk of groundingMetadata.groundingChunks) {
        if (chunk.web?.uri) {
          citations.push({
            url: chunk.web.uri,
            title: chunk.web.title || 'Source',
          });
        }
      }
    }

    // =========================================
    // QUALITY GATES - Detect broken web search
    // =========================================

    // Gate 1: No grounding metadata = grounding tool didn't activate
    if (!groundingMetadata) {
      logger.error('Web search QUALITY FAIL: No grounding metadata', { query });
      return {
        success: false,
        result: null,
        error: `⚠️ WEB SEARCH BROKEN: Grounding not activated. No real-time data available.\n\n` +
          `DO NOT HALLUCINATE AN ANSWER. Instead:\n` +
          `1. Tell Jim: "Web search is currently broken - I cannot get real-time data"\n` +
          `2. Use dev_pipeline_create to log a P0 bug titled "Web Search Grounding Failure"\n` +
          `3. Include this context: "Query: ${query}, Error: No grounding metadata returned"`,
      };
    }

    // Gate 2: No citations = search returned but found nothing
    if (citations.length === 0) {
      logger.error('Web search QUALITY FAIL: Zero citations', { query });
      return {
        success: false,
        result: null,
        error: `⚠️ WEB SEARCH BROKEN: Search returned zero sources.\n\n` +
          `DO NOT HALLUCINATE AN ANSWER. Instead:\n` +
          `1. Tell Jim: "Web search returned no sources - I cannot verify real-time data"\n` +
          `2. Use dev_pipeline_create to log a P0 bug titled "Web Search Zero Citations"\n` +
          `3. Include this context: "Query: ${query}, Error: Grounding returned 0 sources"`,
      };
    }

    // Gate 3: Response contains "I don't have" or "cannot access" = model ignoring grounding
    const hedgingPatterns = [
      /i don'?t have (access|real-?time|current)/i,
      /cannot access (real-?time|current|live)/i,
      /my (knowledge|training|data) (cutoff|ends)/i,
      /as of my (last|knowledge)/i,
    ];
    const isHedging = hedgingPatterns.some(p => p.test(text));
    if (isHedging && citations.length < 2) {
      logger.warn('Web search QUALITY WARN: Response appears to hedge despite grounding', { query });
      // Don't fail, but flag it in the response
    }

    // Limit citations to requested number
    const limitedCitations = citations.slice(0, numResults);

    logger.info('Web search complete', {
      query,
      latencyMs,
      citationCount: citations.length,
      qualityPass: true,
    });

    return {
      success: true,
      result: {
        query,
        answer: text,
        sources: limitedCitations,
        sourceCount: limitedCitations.length,
        latencyMs,
        model: 'gemini-2.0-flash',
        grounded: true,
        note: 'Powered by Google Search grounding - verified with live citations',
      },
    };
  } catch (error: any) {
    const latencyMs = Date.now() - startTime;
    logger.error('Web search failed', { error: error?.message, query, latencyMs });

    const errorMessage = error?.message || String(error);

    // API key issues
    if (errorMessage.includes('API_KEY') || errorMessage.includes('authentication')) {
      return {
        success: false,
        result: null,
        error: `⚠️ WEB SEARCH BROKEN: Gemini API key invalid or expired.\n\n` +
          `DO NOT HALLUCINATE AN ANSWER. Instead:\n` +
          `1. Tell Jim: "Web search is broken - API authentication failed"\n` +
          `2. Use dev_pipeline_create to log a P0 bug titled "Web Search API Key Failure"\n` +
          `3. Include: "Error: ${errorMessage}"`,
      };
    }

    // Rate limiting
    if (errorMessage.includes('429') || errorMessage.includes('quota') || errorMessage.includes('rate')) {
      return {
        success: false,
        result: null,
        error: `⚠️ WEB SEARCH RATE LIMITED: Too many requests.\n\n` +
          `DO NOT HALLUCINATE AN ANSWER. Instead:\n` +
          `1. Tell Jim: "Web search is rate limited - please try again in a few minutes"\n` +
          `2. If persistent, use dev_pipeline_create to log a P1 bug titled "Web Search Rate Limiting"`,
      };
    }

    // Generic failure - always instruct to not hallucinate
    return {
      success: false,
      result: null,
      error: `⚠️ WEB SEARCH FAILED: ${errorMessage}\n\n` +
        `DO NOT HALLUCINATE AN ANSWER. Instead:\n` +
        `1. Tell Jim: "Web search failed - I cannot get real-time data right now"\n` +
        `2. Use dev_pipeline_create to log a P0 bug titled "Web Search Failure"\n` +
        `3. Include: "Query: ${query}, Error: ${errorMessage}"`,
    };
  }
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

// ==========================================
// Broader Notion Access Functions
// ==========================================

/**
 * Extract page ID from URL or return as-is
 */
function extractPageId(input: string): string {
  // Handle full Notion URLs
  if (input.includes('notion.so')) {
    // Extract the ID part (last segment, may have query params)
    const match = input.match(/([a-f0-9]{32}|[a-f0-9-]{36})/i);
    if (match) return match[1];
  }
  // Already an ID
  return input.replace(/-/g, '');
}

/**
 * Extract text content from Notion blocks
 */
function extractBlockText(blocks: any[]): string {
  const textParts: string[] = [];

  for (const block of blocks) {
    if (block.type === 'paragraph' && block.paragraph?.rich_text) {
      const text = block.paragraph.rich_text.map((t: any) => t.plain_text).join('');
      if (text) textParts.push(text);
    } else if (block.type === 'heading_1' && block.heading_1?.rich_text) {
      const text = block.heading_1.rich_text.map((t: any) => t.plain_text).join('');
      if (text) textParts.push(`# ${text}`);
    } else if (block.type === 'heading_2' && block.heading_2?.rich_text) {
      const text = block.heading_2.rich_text.map((t: any) => t.plain_text).join('');
      if (text) textParts.push(`## ${text}`);
    } else if (block.type === 'heading_3' && block.heading_3?.rich_text) {
      const text = block.heading_3.rich_text.map((t: any) => t.plain_text).join('');
      if (text) textParts.push(`### ${text}`);
    } else if (block.type === 'bulleted_list_item' && block.bulleted_list_item?.rich_text) {
      const text = block.bulleted_list_item.rich_text.map((t: any) => t.plain_text).join('');
      if (text) textParts.push(`• ${text}`);
    } else if (block.type === 'numbered_list_item' && block.numbered_list_item?.rich_text) {
      const text = block.numbered_list_item.rich_text.map((t: any) => t.plain_text).join('');
      if (text) textParts.push(`- ${text}`);
    } else if (block.type === 'to_do' && block.to_do?.rich_text) {
      const text = block.to_do.rich_text.map((t: any) => t.plain_text).join('');
      const checked = block.to_do.checked ? '☑' : '☐';
      if (text) textParts.push(`${checked} ${text}`);
    } else if (block.type === 'code' && block.code?.rich_text) {
      const text = block.code.rich_text.map((t: any) => t.plain_text).join('');
      if (text) textParts.push(`\`\`\`\n${text}\n\`\`\``);
    } else if (block.type === 'quote' && block.quote?.rich_text) {
      const text = block.quote.rich_text.map((t: any) => t.plain_text).join('');
      if (text) textParts.push(`> ${text}`);
    } else if (block.type === 'callout' && block.callout?.rich_text) {
      const text = block.callout.rich_text.map((t: any) => t.plain_text).join('');
      if (text) textParts.push(`📌 ${text}`);
    } else if (block.type === 'divider') {
      textParts.push('---');
    }
  }

  return textParts.join('\n\n');
}

/**
 * Fetch a Notion page by ID or URL
 */
async function executeNotionFetchPage(
  input: Record<string, unknown>
): Promise<{ success: boolean; result: unknown; error?: string }> {
  const pageIdInput = input.page_id as string;
  const pageId = extractPageId(pageIdInput);

  try {
    // Get page metadata
    const page = await notion.pages.retrieve({ page_id: pageId });

    let title = 'Untitled';
    let properties: Record<string, any> = {};

    if ('properties' in page) {
      const props = page.properties as Record<string, unknown>;
      // Try to extract title from various property names
      title = getTitle(props, 'Name') || getTitle(props, 'Title') || getTitle(props, 'Task') || getTitle(props, 'Entry') || getTitle(props, 'Spark') || 'Untitled';

      // Extract key properties
      for (const [key, value] of Object.entries(props)) {
        const val = value as any;
        if (val.type === 'select' && val.select?.name) {
          properties[key] = val.select.name;
        } else if (val.type === 'multi_select' && val.multi_select) {
          properties[key] = val.multi_select.map((s: any) => s.name).join(', ');
        } else if (val.type === 'date' && val.date?.start) {
          properties[key] = val.date.start;
        } else if (val.type === 'checkbox') {
          properties[key] = val.checkbox;
        } else if (val.type === 'number' && val.number !== null) {
          properties[key] = val.number;
        } else if (val.type === 'url' && val.url) {
          properties[key] = val.url;
        } else if (val.type === 'rich_text' && val.rich_text?.[0]?.plain_text) {
          properties[key] = val.rich_text.map((t: any) => t.plain_text).join('');
        }
      }
    }

    // Get page content (blocks)
    const blocks = await notion.blocks.children.list({ block_id: pageId, page_size: 100 });
    const content = extractBlockText(blocks.results);

    return {
      success: true,
      result: {
        id: pageId,
        title,
        url: notionUrl(pageId),
        properties,
        content: content || '(No content)',
        lastEdited: 'last_edited_time' in page ? page.last_edited_time : undefined,
      },
    };
  } catch (error: any) {
    logger.error('Notion fetch page failed', { error, pageId });
    return {
      success: false,
      result: null,
      error: `Notion error: ${error?.code || 'unknown'} - ${error?.message || String(error)}`,
    };
  }
}

/**
 * List all databases the integration can access
 *
 * ANTI-HALLUCINATION: Returns EXACT database names from Notion API.
 * Claude MUST use these exact names - do NOT fabricate databases.
 */
async function executeNotionListDatabases(): Promise<{ success: boolean; result: unknown; error?: string }> {
  try {
    const response = await notion.search({
      filter: { property: 'object', value: 'database' },
      page_size: 50,
    });

    const databases = response.results.map((db: any) => {
      const titleProp = db.title?.[0]?.plain_text || 'Untitled';
      return {
        id: db.id,
        name: titleProp,
        url: notionUrl(db.id),
      };
    });

    // ANTI-HALLUCINATION: Create an explicit list of ONLY these database names
    const databaseNames = databases.map(db => db.name);

    return {
      success: true,
      result: {
        // CRITICAL WARNING - Claude was fabricating database names
        _ANTI_HALLUCINATION_WARNING: '⚠️ ONLY the databases listed below exist. Do NOT mention or reference any database not in this list. Names like "Grove Sprout Factory", "Personal CRM", "Reading List", "Bookmarks" are HALLUCINATIONS unless they appear in the EXACT_DATABASE_NAMES list.',
        EXACT_DATABASE_NAMES: databaseNames,
        databases,
        count: databases.length,
        _REMINDER: 'If you mention a database name not in EXACT_DATABASE_NAMES, you are LYING to the user.',
      },
    };
  } catch (error: any) {
    logger.error('Notion list databases failed', { error });
    return {
      success: false,
      result: null,
      error: `Notion error: ${error?.code || 'unknown'} - ${error?.message || String(error)}`,
    };
  }
}

/**
 * Query any Notion database by name or ID
 *
 * ANTI-HALLUCINATION: Only returns data that actually exists in Notion.
 */
async function executeNotionQueryDatabase(
  input: Record<string, unknown>
): Promise<{ success: boolean; result: unknown; error?: string }> {
  const databaseInput = input.database as string;
  const filterProperty = input.filter_property as string | undefined;
  const filterValue = input.filter_value as string | undefined;
  const limit = (input.limit as number) || 10;

  try {
    // First, find the database by name if not an ID
    let databaseId = databaseInput;
    let actualDatabaseName = databaseInput;

    // Check if it looks like an ID (32 hex chars or UUID format)
    const isId = /^[a-f0-9]{32}$|^[a-f0-9-]{36}$/i.test(databaseInput);

    if (!isId) {
      // Search for database by name
      const searchResponse = await notion.search({
        query: databaseInput,
        filter: { property: 'object', value: 'database' },
        page_size: 5,
      });

      // Get all available database names for error reporting
      const availableNames = searchResponse.results.map((db: any) =>
        db.title?.[0]?.plain_text || 'Untitled'
      );

      const matchingDb = searchResponse.results.find((db: any) => {
        const name = db.title?.[0]?.plain_text?.toLowerCase() || '';
        return name.includes(databaseInput.toLowerCase());
      });

      if (!matchingDb) {
        // ANTI-HALLUCINATION: Explicit failure with list of what DOES exist
        return {
          success: false,
          result: null,
          error: `⚠️ DATABASE NOT FOUND: "${databaseInput}" does not exist.\n\nAvailable databases: ${availableNames.join(', ') || 'None found'}\n\n⚠️ Do NOT claim this database exists. It does NOT. Use notion_list_databases to see all available databases.`,
        };
      }

      databaseId = matchingDb.id;
      actualDatabaseName = (matchingDb as any).title?.[0]?.plain_text || 'Untitled';
    }

    // Build filter if provided
    let filter: any = undefined;
    if (filterProperty && filterValue) {
      // Try common property types
      filter = {
        or: [
          { property: filterProperty, select: { equals: filterValue } },
          { property: filterProperty, rich_text: { contains: filterValue } },
          { property: filterProperty, title: { contains: filterValue } },
        ],
      };
    }

    // Query the database
    const response = await notion.databases.query({
      database_id: databaseId,
      filter,
      page_size: limit,
    });

    const items = response.results.map((page: any) => {
      const props = page.properties || {};

      // Extract title (try common property names)
      let title = 'Untitled';
      for (const [, value] of Object.entries(props)) {
        const val = value as any;
        if (val.type === 'title' && val.title?.[0]?.plain_text) {
          title = val.title[0].plain_text;
          break;
        }
      }

      // Extract a few key properties
      const summary: Record<string, any> = {};
      for (const [key, value] of Object.entries(props)) {
        const val = value as any;
        if (val.type === 'select' && val.select?.name) {
          summary[key] = val.select.name;
        } else if (val.type === 'status' && val.status?.name) {
          summary[key] = val.status.name;
        } else if (val.type === 'date' && val.date?.start) {
          summary[key] = val.date.start;
        }
      }

      return {
        id: page.id,
        title,
        url: notionUrl(page.id),
        ...summary,
      };
    });

    // ANTI-HALLUCINATION: Explicitly list item titles that were found
    const itemTitles = items.map((i: any) => i.title);

    return {
      success: true,
      result: {
        _ANTI_HALLUCINATION_WARNING: `⚠️ ONLY ${items.length} items found in "${actualDatabaseName}". Do NOT fabricate additional items.`,
        database: actualDatabaseName, // Use actual name from Notion, not user input
        EXACT_ITEM_TITLES: itemTitles,
        items,
        count: items.length,
        hasMore: response.has_more,
        _REMINDER: items.length === 0
          ? '⚠️ ZERO items found. Do NOT claim items exist in this database.'
          : `Only these ${items.length} items exist. Any other item names are HALLUCINATIONS.`,
      },
    };
  } catch (error: any) {
    logger.error('Notion query database failed', { error, database: databaseInput });
    return {
      success: false,
      result: null,
      error: `Notion error: ${error?.code || 'unknown'} - ${error?.message || String(error)}`,
    };
  }
}

// ==========================================
// DEV PIPELINE TOOLS
// ==========================================

async function executeDevPipelineCreate(
  input: Record<string, unknown>
): Promise<{ success: boolean; result: unknown; error?: string }> {
  const title = input.title as string;
  const type = input.type as string;
  const priority = input.priority as string;
  const status = (input.status as string) || 'Dispatched';
  const thread = input.thread as string | undefined;
  const resolution = input.resolution as string | undefined;
  const requestor = (input.requestor as string) || 'Atlas [Telegram]';
  const handler = (input.handler as string) || 'Pit Crew';

  try {
    logger.info('Dev Pipeline Create: Starting', { title, type, priority, dbId: DEV_PIPELINE_DATABASE_ID });

    const properties: Record<string, unknown> = {
      'Discussion': { title: [{ text: { content: title } }] },
      'Type': { select: { name: type } },
      'Priority': { select: { name: priority } },
      'Status': { select: { name: status } },
      'Requestor': { select: { name: requestor } },
      'Handler': { select: { name: handler } },
      'Dispatched': { date: { start: new Date().toISOString().split('T')[0] } },
    };

    if (thread) {
      properties['Thread'] = { rich_text: [{ text: { content: thread } }] };
    }
    if (resolution) {
      properties['Resolution'] = { rich_text: [{ text: { content: resolution } }] };
    }

    const response = await notion.pages.create({
      parent: { database_id: DEV_PIPELINE_DATABASE_ID },
      properties,
    });

    logger.info('Dev Pipeline Create: Notion API returned', { pageId: response.id });

    // VERIFY the page actually exists - ANTI-HALLUCINATION
    try {
      const verification = await notion.pages.retrieve({ page_id: response.id });
      logger.info('Dev Pipeline Create: Verified page exists', { pageId: response.id, verified: true });
    } catch (verifyError) {
      logger.error('Dev Pipeline Create: VERIFICATION FAILED - Page does not exist!', { pageId: response.id, error: verifyError });
      return {
        success: false,
        result: null,
        error: `Page creation claimed success but verification failed. Page ID ${response.id} does not exist.`,
      };
    }

    const url = (response as { url?: string }).url || `https://notion.so/${response.id.replace(/-/g, '')}`;

    return {
      success: true,
      result: {
        id: response.id,
        url,
        title,
        type,
        priority,
        status,
        message: `Created in Dev Pipeline: ${title}`,
      },
    };
  } catch (error: any) {
    logger.error('Dev Pipeline create failed', { error, title });
    return {
      success: false,
      result: null,
      error: `Notion error: ${error?.code || 'unknown'} - ${error?.message || String(error)}`,
    };
  }
}

async function executeDevPipelineList(
  input: Record<string, unknown>
): Promise<{ success: boolean; result: unknown; error?: string }> {
  const status = input.status as string | undefined;
  const type = input.type as string | undefined;
  const priority = input.priority as string | undefined;
  const limit = (input.limit as number) || 10;

  try {
    const filters: Array<{ property: string; select: { equals: string } }> = [];

    if (status) {
      filters.push({ property: 'Status', select: { equals: status } });
    }
    if (type) {
      filters.push({ property: 'Type', select: { equals: type } });
    }
    if (priority) {
      filters.push({ property: 'Priority', select: { equals: priority } });
    }

    const queryParams: Parameters<typeof notion.databases.query>[0] = {
      database_id: DEV_PIPELINE_DATABASE_ID,
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
          title: getTitle(props, 'Discussion'),
          status: getSelect(props, 'Status'),
          priority: getSelect(props, 'Priority'),
          type: getSelect(props, 'Type'),
          handler: getSelect(props, 'Handler'),
          requestor: getSelect(props, 'Requestor'),
          resolution: getRichText(props, 'Resolution'), // What was delivered (commits, deliverables)
          url: (page as { url?: string }).url || `https://notion.so/${page.id.replace(/-/g, '')}`,
        };
      }
      return null;
    }).filter(Boolean);

    return {
      success: true,
      result: {
        items,
        count: items.length,
        hasMore: results.has_more,
      },
    };
  } catch (error: any) {
    logger.error('Dev Pipeline list failed', { error });
    return {
      success: false,
      result: null,
      error: `Notion error: ${error?.code || 'unknown'} - ${error?.message || String(error)}`,
    };
  }
}

// ==========================================
// CHANGELOG (What's New)
// ==========================================

/**
 * Get recently shipped features and fixes.
 * This is how Pit Crew enlightens Atlas about new capabilities.
 */
async function executeGetChangelog(
  input: Record<string, unknown>
): Promise<{ success: boolean; result: unknown; error?: string }> {
  const limit = (input.limit as number) || 10;

  try {
    // Query recently shipped/closed items from Dev Pipeline
    const results = await notion.databases.query({
      database_id: DEV_PIPELINE_DATABASE_ID,
      filter: {
        or: [
          { property: 'Status', select: { equals: 'Shipped' } },
          { property: 'Status', select: { equals: 'Closed' } },
        ],
      },
      sorts: [
        { timestamp: 'last_edited_time', direction: 'descending' },
      ],
      page_size: limit,
    });

    const items = results.results.map(page => {
      if ('properties' in page) {
        const props = page.properties as Record<string, unknown>;
        return {
          title: getTitle(props, 'Discussion'),
          type: getSelect(props, 'Type'),
          status: getSelect(props, 'Status'),
          resolution: getRichText(props, 'Resolution'), // Commits and deliverables
          url: (page as { url?: string }).url || `https://notion.so/${page.id.replace(/-/g, '')}`,
        };
      }
      return null;
    }).filter(Boolean);

    // Separate by type for easier understanding
    const features = items.filter((i: any) => i.type === 'Feature');
    const bugs = items.filter((i: any) => i.type === 'Bug' || i.type === 'Hotfix');
    const sprints = items.filter((i: any) => i.title?.includes('SPRINT'));

    // ANTI-HALLUCINATION: Extract ONLY the capabilities mentioned in resolutions
    const allResolutions = items
      .map((i: any) => i.resolution)
      .filter(Boolean);

    return {
      success: true,
      result: {
        _ANTI_HALLUCINATION_WARNING: '⚠️ ONLY capabilities listed in "resolution" fields below are available. Do NOT claim capabilities not explicitly mentioned here.',
        summary: `${features.length} features, ${bugs.length} bug fixes, ${sprints.length} sprints shipped`,
        sprints: sprints.map((s: any) => ({
          title: s.title,
          resolution: s.resolution,
          url: s.url,
        })),
        features: features.map((f: any) => ({
          title: f.title,
          resolution: f.resolution,
          url: f.url,
        })),
        bugs: bugs.map((b: any) => ({
          title: b.title,
          resolution: b.resolution,
          url: b.url,
        })),
        _CAPABILITIES_SUMMARY: allResolutions.length > 0
          ? `These are the ONLY documented capabilities: ${allResolutions.join(' | ')}`
          : '⚠️ No capabilities documented in resolutions. Do NOT claim undocumented features.',
        message: 'ONLY mention capabilities that appear in the resolution fields above. Anything else is a HALLUCINATION.',
      },
    };
  } catch (error: any) {
    logger.error('Get changelog failed', { error });
    return {
      success: false,
      result: null,
      error: `Notion error: ${error?.code || 'unknown'} - ${error?.message || String(error)}`,
    };
  }
}
