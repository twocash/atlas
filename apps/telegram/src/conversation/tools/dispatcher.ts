/**
 * Atlas Telegram Bot - Unified Dispatcher
 *
 * The ONLY way to start asynchronous work. Implements the "No Ticket, No Work" protocol.
 *
 * Routes:
 * - dev_bug → Pit Crew MCP (with Notion sync)
 * - research/content → Direct Notion Work Queue write
 *
 * Every dispatch MUST return a trackable URL or fail explicitly.
 */

import type Anthropic from '@anthropic-ai/sdk';
import { Client } from '@notionhq/client';
import { logger } from '../../logger';
import { executeMcpTool, isMcpTool, getMcpStatus } from '../../mcp';

// Database ID from docs/DATABASE-IDS-CANONICAL.md
const DB_WORK_QUEUE = '3d679030-b76b-43bd-92d8-1ac51abb4a28';

// Notion client (lazy loaded)
let _notion: Client | null = null;
function getNotionClient(): Client {
  if (!_notion) {
    const apiKey = process.env.NOTION_API_KEY;
    if (!apiKey) {
      throw new Error('NOTION_API_KEY environment variable is required');
    }
    _notion = new Client({ auth: apiKey });
  }
  return _notion;
}

// ==========================================
// Tool Definition
// ==========================================

export const DISPATCHER_TOOL: Anthropic.Tool = {
  name: 'submit_ticket',
  description: 'The ONLY way to start asynchronous work. Submits a ticket for Research, Dev bugs, or Content tasks. Returns a tracking URL. If no URL is returned, the dispatch FAILED.',
  input_schema: {
    type: 'object' as const,
    properties: {
      reasoning: {
        type: 'string',
        description: 'REQUIRED. Explain WHY you chose this category and HOW you fleshed out the description. Forces chain-of-thought before dispatch. NOT shown to user.',
      },
      category: {
        type: 'string',
        enum: ['research', 'dev_bug', 'content'],
        description: 'research: for deep dives and information gathering. dev_bug: for broken code/tools (routes to Pit Crew). content: for writing/drafting.',
      },
      title: {
        type: 'string',
        description: 'Descriptive title (NOT just the user\'s raw input). Should clearly describe the task.',
      },
      description: {
        type: 'string',
        description: 'EXPANDED context. For research: 3-5 specific questions. For bugs: repro steps, error messages. For content: tone, audience, key points.',
      },
      priority: {
        type: 'string',
        enum: ['P0', 'P1', 'P2'],
        description: 'P0=urgent/today, P1=this week, P2=this month',
      },
      require_review: {
        type: 'boolean',
        description: 'Set true for complex tasks requiring Jim approval before execution. Creates in "Captured" status. False = auto-execute in "Triaged" status (ready for worker pickup).',
      },
      pillar: {
        type: 'string',
        enum: ['Personal', 'The Grove', 'Consulting', 'Home/Garage'],
        description: 'Which life domain this belongs to. Default: The Grove',
      },
    },
    required: ['reasoning', 'category', 'title', 'description', 'priority'],
  },
};

// ==========================================
// Tool Executor
// ==========================================

export async function handleSubmitTicket(
  input: Record<string, unknown>
): Promise<{ success: boolean; result: unknown; error?: string }> {
  const reasoning = input.reasoning as string;
  const category = input.category as 'research' | 'dev_bug' | 'content';
  const title = input.title as string;
  const description = input.description as string;
  const priority = input.priority as 'P0' | 'P1' | 'P2';
  const requireReview = (input.require_review as boolean) ?? false;
  const pillar = (input.pillar as string) || 'The Grove';

  logger.info('[Dispatcher] Routing ticket', { category, title, priority, requireReview });
  logger.info('[Dispatcher] Reasoning', { reasoning: reasoning.substring(0, 200) });

  // ROUTE 1: Engineering (Pit Crew MCP)
  if (category === 'dev_bug') {
    return await routeToPitCrew({ title, description, priority });
  }

  // ROUTE 2: Operations (Work Queue / Research Worker)
  return await routeToWorkQueue({
    category,
    title,
    description,
    priority,
    requireReview,
    pillar,
    reasoning,
  });
}

// ==========================================
// Route: Pit Crew (Dev Bugs)
// ==========================================

async function routeToPitCrew(params: {
  title: string;
  description: string;
  priority: 'P0' | 'P1' | 'P2';
}): Promise<{ success: boolean; result: unknown; error?: string }> {
  const { title, description, priority } = params;

  // Check if Pit Crew MCP is connected
  const mcpStatus = getMcpStatus();
  const pitCrewStatus = mcpStatus['pit_crew'];

  if (!pitCrewStatus || pitCrewStatus.status !== 'connected') {
    logger.warn('[Dispatcher] Pit Crew MCP not connected, falling back to direct Notion');
    // Fallback: Create directly in Dev Pipeline via Notion SDK
    return await createDirectDevPipelineItem({ title, description, priority });
  }

  try {
    const result = await executeMcpTool('mcp__pit_crew__dispatch_work', {
      type: 'bug',
      title,
      context: description,
      priority,
    });

    // Parse the MCP response
    if (!result.success) {
      logger.error('[Dispatcher] Pit Crew dispatch failed', { error: result.error });
      return {
        success: false,
        result: null,
        error: `Pit Crew dispatch failed: ${result.error}`,
      };
    }

    // Extract the response content
    const mcpResult = result.result as { content?: Array<{ type: string; text?: string }> };
    const textContent = mcpResult?.content?.find(c => c.type === 'text');
    if (!textContent?.text) {
      return {
        success: false,
        result: null,
        error: 'Pit Crew returned empty response',
      };
    }

    const parsed = JSON.parse(textContent.text);

    if (!parsed.success) {
      return {
        success: false,
        result: parsed,
        error: parsed.error || 'Pit Crew dispatch failed',
      };
    }

    // CRITICAL: Verify we got a Notion URL
    if (!parsed.notion_url) {
      return {
        success: false,
        result: parsed,
        error: `Pit Crew created local record ${parsed.discussion_id} but FAILED to sync to Notion. No trackable URL.`,
      };
    }

    return {
      success: true,
      result: {
        ticket_id: parsed.discussion_id,
        url: parsed.notion_url,
        status: 'Dispatched',
        handler: 'Pit Crew',
        message: `Bug dispatched to Pit Crew: ${title}`,
      },
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.error('[Dispatcher] Pit Crew MCP error', { error: errorMessage });
    return {
      success: false,
      result: null,
      error: `Pit Crew MCP error: ${errorMessage}`,
    };
  }
}

// ==========================================
// Fallback: Direct Dev Pipeline Creation
// ==========================================

const DEV_PIPELINE_DATABASE_ID = 'ce6fbf1b-ee30-433d-a9e6-b338552de7c9';

async function createDirectDevPipelineItem(params: {
  title: string;
  description: string;
  priority: 'P0' | 'P1' | 'P2';
}): Promise<{ success: boolean; result: unknown; error?: string }> {
  const { title, description, priority } = params;

  try {
    const notion = getNotionClient();

    const response = await notion.pages.create({
      parent: { database_id: DEV_PIPELINE_DATABASE_ID },
      properties: {
        'Discussion': { title: [{ text: { content: title } }] },
        'Type': { select: { name: 'Bug' } },
        'Priority': { select: { name: priority } },
        'Status': { select: { name: 'Dispatched' } },
        'Requestor': { select: { name: 'Atlas [Telegram]' } },
        'Handler': { select: { name: 'Pit Crew' } },
        'Thread': { rich_text: [{ text: { content: description.substring(0, 2000) } }] },
        'Dispatched': { date: { start: new Date().toISOString().split('T')[0] } },
      },
    });

    const url = (response as { url?: string }).url || `https://notion.so/${response.id.replace(/-/g, '')}`;

    return {
      success: true,
      result: {
        ticket_id: response.id,
        url,
        status: 'Dispatched',
        handler: 'Pit Crew',
        message: `Bug created in Dev Pipeline (direct): ${title}`,
      },
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.error('[Dispatcher] Direct Dev Pipeline creation failed', { error: errorMessage });
    return {
      success: false,
      result: null,
      error: `Failed to create Dev Pipeline item: ${errorMessage}`,
    };
  }
}

// ==========================================
// Route: Work Queue (Research/Content)
// ==========================================

async function routeToWorkQueue(params: {
  category: 'research' | 'content';
  title: string;
  description: string;
  priority: 'P0' | 'P1' | 'P2';
  requireReview: boolean;
  pillar: string;
  reasoning: string;
}): Promise<{ success: boolean; result: unknown; error?: string }> {
  const { category, title, description, priority, requireReview, pillar, reasoning } = params;

  try {
    const notion = getNotionClient();

    // Map category to Work Queue Type
    const typeMap: Record<string, string> = {
      'research': 'Research',
      'content': 'Draft',
    };

    // REVIEW GATE: Complex tasks go to Captured, routine to Triaged
    // Status is a "status" property type in Work Queue 2.0 schema
    // "Triaged" = Classified and ready for work (worker will pick up)
    // "Captured" = Needs human review before execution
    const initialStatus = requireReview ? 'Captured' : 'Triaged';

    // Build properties
    const properties: Record<string, unknown> = {
      'Task': { title: [{ text: { content: title } }] },
      'Status': { status: { name: initialStatus } },
      'Priority': { select: { name: priority } },
      'Type': { select: { name: typeMap[category] || 'Research' } },
      'Pillar': { select: { name: pillar } },
      'Assignee': { select: { name: 'Atlas [Telegram]' } },
      'Queued': { date: { start: new Date().toISOString().split('T')[0] } },
    };

    // Create page with body content
    const response = await notion.pages.create({
      parent: { database_id: DB_WORK_QUEUE },
      properties,
      children: [
        {
          object: 'block',
          type: 'heading_3',
          heading_3: {
            rich_text: [{ type: 'text', text: { content: 'Atlas Reasoning' } }],
          },
        },
        {
          object: 'block',
          type: 'callout',
          callout: {
            rich_text: [{ type: 'text', text: { content: reasoning } }],
            icon: { type: 'emoji', emoji: '🤖' },
          },
        },
        {
          object: 'block',
          type: 'heading_3',
          heading_3: {
            rich_text: [{ type: 'text', text: { content: 'Task Specification' } }],
          },
        },
        {
          object: 'block',
          type: 'paragraph',
          paragraph: {
            rich_text: [{ type: 'text', text: { content: description } }],
          },
        },
      ],
    });

    // CRITICAL: Get the actual URL from Notion
    const url = (response as { url?: string }).url;

    if (!url) {
      return {
        success: false,
        result: { id: response.id },
        error: `Created Work Queue item ${response.id} but failed to get URL. Check Notion API response.`,
      };
    }

    const message = requireReview
      ? 'Ticket created in CAPTURED status. Review and update to Triaged when ready for execution.'
      : 'Ticket created in TRIAGED status. The Active Worker will pick this up.';

    return {
      success: true,
      result: {
        ticket_id: response.id,
        url,
        status: initialStatus,
        type: typeMap[category],
        message,
      },
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.error('[Dispatcher] Work Queue creation failed', { error: errorMessage });
    return {
      success: false,
      result: null,
      error: `Failed to create Work Queue item: ${errorMessage}`,
    };
  }
}

// ==========================================
// Tool Definitions Export (for index.ts)
// ==========================================

export const DISPATCHER_TOOLS: Anthropic.Tool[] = [DISPATCHER_TOOL];

/**
 * Execute dispatcher tools
 */
export async function executeDispatcherTools(
  toolName: string,
  input: Record<string, unknown>
): Promise<{ success: boolean; result: unknown; error?: string } | null> {
  if (toolName === 'submit_ticket') {
    return await handleSubmitTicket(input);
  }
  return null; // Not a dispatcher tool
}
