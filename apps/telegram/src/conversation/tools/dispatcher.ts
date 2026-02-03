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

/**
 * Extract Notion page ID from URL
 * URL format: https://www.notion.so/Title-{32-char-id}
 */
function extractPageIdFromUrl(url: string): string | null {
  // Match the 32-character hex ID at the end of the URL
  const match = url.match(/([a-f0-9]{32})(?:\?|$)/i);
  if (match) {
    // Format as UUID: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
    const id = match[1];
    return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
  }
  return null;
}

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
  description: 'The ONLY way to start asynchronous work. Submits a ticket for Research, Dev bugs, or Content tasks. Returns a tracking URL. If no URL is returned, the dispatch FAILED. IMPORTANT: Include routing_confidence (0-100). If below 85%, user will be asked to choose the destination.',
  input_schema: {
    type: 'object' as const,
    properties: {
      reasoning: {
        type: 'string',
        description: 'REQUIRED. Explain WHY you chose this category and HOW you fleshed out the description. Forces chain-of-thought before dispatch. NOT shown to user.',
      },
      category: {
        type: 'string',
        enum: ['research', 'dev_bug', 'feature', 'content'],
        description: 'research: for deep dives and information gathering. dev_bug: for broken code/tools (routes to Pit Crew). feature: for new capabilities/integrations (routes to Pit Crew). content: for writing/drafting.',
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
      routing_confidence: {
        type: 'number',
        minimum: 0,
        maximum: 100,
        description: 'REQUIRED. Your confidence (0-100) that this category is correct. If below 85, user will be asked to choose between Pit Crew and Work Queue. Be honest - ambiguous tasks (could be bug OR feature, research OR build) should have low confidence.',
      },
      alternative_category: {
        type: 'string',
        enum: ['research', 'dev_bug', 'feature', 'content'],
        description: 'If routing_confidence < 85, provide the alternative category you considered. This will be shown as the second option.',
      },
    },
    required: ['reasoning', 'category', 'title', 'description', 'priority', 'routing_confidence'],
  },
};

// ==========================================
// Tool Executor
// ==========================================

// Confidence threshold for auto-routing (below this = ask user)
const ROUTING_CONFIDENCE_THRESHOLD = 85;

export async function handleSubmitTicket(
  input: Record<string, unknown>
): Promise<{ success: boolean; result: unknown; error?: string; needsChoice?: boolean }> {
  const reasoning = input.reasoning as string;
  const category = input.category as 'research' | 'dev_bug' | 'feature' | 'content';
  const title = input.title as string;
  const description = input.description as string;
  const priority = input.priority as 'P0' | 'P1' | 'P2';
  const requireReview = (input.require_review as boolean) ?? false;
  const pillar = (input.pillar as string) || 'The Grove';
  const routingConfidence = (input.routing_confidence as number) ?? 100;
  const alternativeCategory = input.alternative_category as string | undefined;

  logger.info('[Dispatcher] Routing ticket', { category, title, priority, requireReview, routingConfidence });
  logger.info('[Dispatcher] Reasoning', { reasoning: reasoning.substring(0, 200) });

  // LOW CONFIDENCE: Return choice response instead of auto-routing
  if (routingConfidence < ROUTING_CONFIDENCE_THRESHOLD) {
    // Determine alternative category if not provided
    const isPitCrewCategory = category === 'dev_bug' || category === 'feature';
    const defaultAlternative = isPitCrewCategory ? 'research' : 'dev_bug';
    const alternative = alternativeCategory || defaultAlternative;

    logger.info('[Dispatcher] Low confidence routing - requesting user choice', {
      confidence: routingConfidence,
      suggested: category,
      alternative,
    });

    return {
      success: false,
      needsChoice: true,
      result: {
        needsChoice: true,
        routingConfidence,
        suggestedCategory: category,
        alternativeCategory: alternative,
        title,
        description,
        priority,
        requireReview,
        pillar,
        reasoning,
        message: `Routing confidence ${routingConfidence}% is below threshold. User needs to choose between ${category} (→ ${isPitCrewCategory ? 'Pit Crew' : 'Work Queue'}) and ${alternative}.`,
      },
    };
  }

  // ROUTE 1: Engineering (Pit Crew MCP) - bugs AND features
  if (category === 'dev_bug' || category === 'feature') {
    const ticketType = category === 'feature' ? 'feature' : 'bug';
    return await routeToPitCrew({ title, description, priority, ticketType, reasoning });
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
  ticketType: 'bug' | 'feature';
  reasoning: string;
}): Promise<{ success: boolean; result: unknown; error?: string }> {
  const { title, description, priority, ticketType, reasoning } = params;

  // Check if Pit Crew MCP is connected
  const mcpStatus = getMcpStatus();
  const pitCrewStatus = mcpStatus['pit_crew'];

  if (!pitCrewStatus || pitCrewStatus.status !== 'connected') {
    logger.warn('[Dispatcher] Pit Crew MCP not connected, falling back to direct Notion');
    // Fallback: Create directly in Dev Pipeline via Notion SDK
    return await createDirectDevPipelineItem({ title, description, priority, ticketType, reasoning });
  }

  try {
    // Build rich context: reasoning (why) + description (what)
    const fullContext = `**Atlas Analysis:**\n${reasoning}\n\n**Task Specification:**\n${description}`;

    const result = await executeMcpTool('mcp__pit_crew__dispatch_work', {
      type: ticketType,
      title,
      context: fullContext,
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

    // APPEND RICH CONTENT TO PAGE BODY
    // Pit Crew creates the page, but we add the full analysis as blocks
    try {
      const pageId = parsed.notion_page_id || extractPageIdFromUrl(parsed.notion_url);
      if (pageId) {
        const notion = getNotionClient();
        await notion.blocks.children.append({
          block_id: pageId,
          children: [
            {
              object: 'block',
              type: 'heading_3',
              heading_3: {
                rich_text: [{ type: 'text', text: { content: '🤖 Atlas Analysis' } }],
              },
            },
            {
              object: 'block',
              type: 'callout',
              callout: {
                rich_text: [{ type: 'text', text: { content: reasoning.substring(0, 2000) } }],
                icon: { type: 'emoji', emoji: '💡' },
              },
            },
            {
              object: 'block',
              type: 'heading_3',
              heading_3: {
                rich_text: [{ type: 'text', text: { content: '📋 Task Specification' } }],
              },
            },
            {
              object: 'block',
              type: 'paragraph',
              paragraph: {
                rich_text: [{ type: 'text', text: { content: description.substring(0, 2000) } }],
              },
            },
          ],
        });
        logger.info('[Dispatcher] Appended rich content to page body', { pageId });
      }
    } catch (appendErr) {
      // Non-fatal - page was created, just couldn't append rich content
      logger.warn('[Dispatcher] Failed to append rich content to page body', { error: appendErr });
    }

    const typeLabel = ticketType === 'feature' ? 'Feature' : 'Bug';
    return {
      success: true,
      result: {
        ticket_id: parsed.discussion_id,
        url: parsed.notion_url,
        status: 'Dispatched',
        handler: 'Pit Crew',
        type: typeLabel,
        message: `${typeLabel} dispatched to Pit Crew: ${title}`,
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
  ticketType: 'bug' | 'feature';
  reasoning: string;
}): Promise<{ success: boolean; result: unknown; error?: string }> {
  const { title, description, priority, ticketType, reasoning } = params;

  try {
    const notion = getNotionClient();

    // Map ticket type to Notion select value
    const typeLabel = ticketType === 'feature' ? 'Feature' : 'Bug';

    const response = await notion.pages.create({
      parent: { database_id: DEV_PIPELINE_DATABASE_ID },
      properties: {
        'Discussion': { title: [{ text: { content: title } }] },
        'Type': { select: { name: typeLabel } },
        'Priority': { select: { name: priority } },
        'Status': { select: { name: 'Dispatched' } },
        'Requestor': { select: { name: 'Atlas [Telegram]' } },
        'Handler': { select: { name: 'Pit Crew' } },
        'Thread': { rich_text: [{ text: { content: `**Atlas Analysis:**\n${reasoning}\n\n**Task Specification:**\n${description}`.substring(0, 2000) } }] },
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
        type: typeLabel,
        message: `${typeLabel} created in Dev Pipeline (direct): ${title}`,
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
      'Status': { select: { name: initialStatus } },
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
