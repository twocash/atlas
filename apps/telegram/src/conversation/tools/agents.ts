/**
 * Atlas Telegram Bot - Agent Dispatch Tools
 *
 * Tools for dispatching specialist agents (research, transcription, draft).
 */

import type Anthropic from '@anthropic-ai/sdk';
import { logger } from '../../logger';

export const AGENT_TOOLS: Anthropic.Tool[] = [
  {
    name: 'dispatch_research',
    description: 'Dispatch the Research Agent for deep investigation. ALWAYS ask user about depth and voice before calling unless they specified both.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'The research question or topic',
        },
        depth: {
          type: 'string',
          enum: ['light', 'standard', 'deep'],
          description: 'Research depth: light (quick facts), standard (synthesis), deep (academic rigor)',
        },
        voice: {
          type: 'string',
          enum: ['grove-analytical', 'linkedin-punchy', 'consulting', 'raw-notes', 'custom'],
          description: 'Output voice/style. Check data/skills/voices/ for definitions.',
        },
        focus: {
          type: 'string',
          description: 'Specific angle or focus area (optional)',
        },
        pillar: {
          type: 'string',
          enum: ['Personal', 'The Grove', 'Consulting', 'Home/Garage'],
          description: 'Which pillar this research is for',
        },
      },
      required: ['query', 'pillar', 'depth', 'voice'],
    },
  },
  {
    name: 'dispatch_transcription',
    description: 'Dispatch transcription for audio/video files. Extracts text, identifies speakers, and optionally summarizes.',
    input_schema: {
      type: 'object' as const,
      properties: {
        file_id: {
          type: 'string',
          description: 'Telegram file ID of the audio/video',
        },
        extract_action_items: {
          type: 'boolean',
          description: 'Whether to extract action items from the transcription',
        },
        summarize: {
          type: 'boolean',
          description: 'Whether to generate a summary',
        },
      },
      required: ['file_id'],
    },
  },
  {
    name: 'dispatch_draft',
    description: 'Dispatch the Draft Agent to create written content. Note: For polished content, this creates a Work Queue item for desktop follow-up with the Research Generator.',
    input_schema: {
      type: 'object' as const,
      properties: {
        topic: {
          type: 'string',
          description: 'What to write about',
        },
        format: {
          type: 'string',
          enum: ['blog', 'linkedin', 'email', 'memo', 'outline'],
          description: 'Output format',
        },
        voice: {
          type: 'string',
          enum: ['grove', 'consulting', 'linkedin', 'personal'],
          description: 'Voice/tone to use',
        },
        pillar: {
          type: 'string',
          enum: ['Personal', 'The Grove', 'Consulting', 'Home/Garage'],
          description: 'Which pillar this is for',
        },
        notes: {
          type: 'string',
          description: 'Additional context or requirements',
        },
      },
      required: ['topic', 'format', 'pillar'],
    },
  },
];

/**
 * Execute agent dispatch tools
 */
export async function executeAgentTools(
  toolName: string,
  input: Record<string, unknown>
): Promise<{ success: boolean; result: unknown; error?: string } | null> {
  switch (toolName) {
    case 'dispatch_research':
      return await executeDispatchResearch(input);
    case 'dispatch_transcription':
      return await executeDispatchTranscription(input);
    case 'dispatch_draft':
      return await executeDispatchDraft(input);
    default:
      return null;
  }
}

async function executeDispatchResearch(
  input: Record<string, unknown>
): Promise<{ success: boolean; result: unknown; error?: string }> {
  const query = input.query as string;
  const depth = (input.depth as string) || 'standard';
  const voice = (input.voice as string) || 'grove-analytical';
  const focus = input.focus as string | undefined;
  const pillar = input.pillar as string;

  logger.info('Dispatching research agent', { query, depth, voice, pillar });

  try {
    // Import research agent components
    const { createResearchWorkItem, wireAgentToWorkQueue } = await import(
      '../../../../../packages/agents/src/workqueue'
    );
    const { AgentRegistry } = await import(
      '../../../../../packages/agents/src/registry'
    );
    const { executeResearch } = await import(
      '../../../../../packages/agents/src/agents/research'
    );

    // Create registry for this research task
    const registry = new AgentRegistry();

    // Create Work Queue item
    const { pageId: workItemId, url: notionUrl } = await createResearchWorkItem({
      query,
      depth: depth as 'light' | 'standard' | 'deep',
      focus,
      priority: depth === 'deep' ? 'P1' : 'P2',
    });

    logger.info('Work Queue item created', { workItemId, notionUrl });

    // Spawn the agent
    const agent = await registry.spawn({
      type: 'research',
      name: `Research: ${query.substring(0, 50)}`,
      instructions: JSON.stringify({ query, depth, voice, focus }),
      priority: depth === 'deep' ? 'P1' : 'P2',
      workItemId,
    });

    // Wire to Work Queue for status updates
    const subscription = await wireAgentToWorkQueue(agent, registry);

    // Start the agent
    await registry.start(agent.id);

    // Execute research (this does the actual Gemini call)
    logger.info('Executing research', { agentId: agent.id, query, voice });
    const result = await executeResearch(
      {
        query,
        depth: depth as 'light' | 'standard' | 'deep',
        focus,
        voice: voice as 'grove-analytical' | 'linkedin-punchy' | 'consulting' | 'raw-notes' | 'custom',
      },
      agent,
      registry
    );

    // Complete or fail the agent
    if (result.success) {
      logger.info('Research completed successfully', { agentId: agent.id });
      await registry.complete(agent.id, result);
    } else {
      logger.warn('Research failed', { agentId: agent.id, summary: result.summary });
      await registry.fail(agent.id, result.summary || 'Research failed', true);
    }

    // Cleanup subscription
    subscription.unsubscribe();

    // Return result
    const researchOutput = result.output as { summary?: string; findings?: any[]; sources?: string[] } | undefined;

    return {
      success: result.success,
      result: {
        message: result.success
          ? `Research complete! Found ${researchOutput?.sources?.length || 0} sources.`
          : `Research failed: ${result.summary}`,
        query,
        depth,
        voice,
        pillar,
        workQueueUrl: notionUrl,
        summary: researchOutput?.summary?.substring(0, 500),
        sourcesCount: researchOutput?.sources?.length || 0,
        findingsCount: researchOutput?.findings?.length || 0,
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Research dispatch failed', { error: errorMessage, query });

    return {
      success: false,
      result: {
        message: `Research dispatch failed: ${errorMessage}`,
        query,
      },
      error: errorMessage,
    };
  }
}

async function executeDispatchTranscription(
  input: Record<string, unknown>
): Promise<{ success: boolean; result: unknown; error?: string }> {
  const fileId = input.file_id as string;
  const extractActionItems = input.extract_action_items as boolean || false;
  const summarize = input.summarize as boolean || false;

  logger.info('Dispatching transcription', { fileId, extractActionItems, summarize });

  // Transcription requires downloading the file and processing
  // For now, create a work queue item
  return {
    success: true,
    result: {
      message: 'Transcription queued. Full transcription service coming in Phase 3.',
      fileId,
      options: { extractActionItems, summarize },
      note: 'For now, voice messages are noted but not transcribed automatically.',
    },
  };
}

async function executeDispatchDraft(
  input: Record<string, unknown>
): Promise<{ success: boolean; result: unknown; error?: string }> {
  const topic = input.topic as string;
  const format = input.format as string;
  const voice = input.voice as string || 'grove';
  const pillar = input.pillar as string;
  const notes = input.notes as string | undefined;

  logger.info('Dispatching draft agent', { topic, format, voice, pillar });

  // For polished content, we create a Work Queue item for desktop follow-up
  // The Research Generator lives on desktop, not in the Telegram bot
  const { Client } = await import('@notionhq/client');
  const notion = new Client({ auth: process.env.NOTION_API_KEY });

  const WORK_QUEUE_DATABASE_ID = '3d679030-b76b-43bd-92d8-1ac51abb4a28';

  try {
    const taskTitle = `Draft: ${topic} (${format})`;
    const taskNotes = [
      `Format: ${format}`,
      `Voice: ${voice}`,
      notes ? `Notes: ${notes}` : '',
      '',
      'Use Research Generator on desktop for polished output.',
    ].filter(Boolean).join('\n');

    const response = await notion.pages.create({
      parent: { database_id: WORK_QUEUE_DATABASE_ID },
      properties: {
        'Task': { title: [{ text: { content: taskTitle } }] },
        'Type': { select: { name: 'Draft' } },
        'Status': { select: { name: 'Captured' } },
        'Priority': { select: { name: 'P1' } },
        'Pillar': { select: { name: pillar } },
        'Assignee': { select: { name: 'Jim' } }, // Drafts go to Jim for desktop work
        'Notes': { rich_text: [{ text: { content: taskNotes } }] },
        'Queued': { date: { start: new Date().toISOString().split('T')[0] } },
      },
    });

    const url = `https://notion.so/${response.id.replace(/-/g, '')}`;

    return {
      success: true,
      result: {
        message: `Draft task created. Use Research Generator on desktop for polished ${format}.`,
        workQueueUrl: url,
        topic,
        format,
        voice,
      },
    };
  } catch (error) {
    logger.error('Draft dispatch failed', { error, topic });
    return { success: false, result: null, error: String(error) };
  }
}
