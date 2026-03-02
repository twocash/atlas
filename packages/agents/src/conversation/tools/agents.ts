/**
 * Atlas Telegram Bot - Agent Dispatch Tools
 *
 * Tools for dispatching specialist agents (research, transcription, draft).
 */

import type Anthropic from '@anthropic-ai/sdk';
import { NOTION_DB } from '@atlas/shared/config';
import { logger } from '../../logger';

export const AGENT_TOOLS: Anthropic.Tool[] = [
  {
    name: 'dispatch_research',
    // TODO: ADR-001 — consider Notion-governed tool descriptions
    description: 'Research any topic with real web sources and citations. Creates a Notion Work Queue entry with structured findings. Defaults: depth=standard, voice=atlas-research. Call immediately — do not ask about depth/voice unless user wants to customize.',
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
          enum: ['atlas-research', 'linkedin-punchy', 'consulting', 'raw-notes', 'custom'],
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
      required: ['query', 'pillar'],
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
  const voice = (input.voice as string) || 'atlas-research';
  const focus = input.focus as string | undefined;
  const pillar = input.pillar as string;

  logger.info('Dispatching research agent', { query, depth, voice, pillar });

  try {
    // 1. Create Work Queue item (still needed for URL)
    const { createResearchWorkItem } = await import('../../workqueue');
    const { pageId: workItemId, url: notionUrl } = await createResearchWorkItem({
      query,
      depth: depth as 'light' | 'standard' | 'deep',
      focus,
      priority: depth === 'deep' ? 'P1' : 'P2',
    });

    logger.info('Work Queue item created', { workItemId, notionUrl });

    // 2. Delegate to canonical orchestrator (single research path)
    const { AgentRegistry } = await import('../../registry');
    const { orchestrateResearch } = await import('../../orchestration/research-orchestrator');

    const registry = new AgentRegistry();
    const orchResult = await orchestrateResearch(
      {
        config: {
          query,
          depth: depth as 'light' | 'standard' | 'deep',
          focus,
          voice: voice as 'atlas-research' | 'linkedin-punchy' | 'consulting' | 'raw-notes' | 'custom',
          pillar: pillar as 'Personal' | 'The Grove' | 'Consulting' | 'Home/Garage',
        },
        workItemId,
        source: 'tool-dispatch',
      },
      registry,
    );

    const { result, assessment } = orchResult;
    const researchOutput = result.output as { summary?: string; findings?: any[]; sources?: string[]; bibliography?: any[] } | undefined;

    // 3. Format result in the same shape (backward compat for tool loop)
    const isLowConfidence = assessment
      ? (assessment.confidence === 'speculative' || assessment.confidence === 'insufficient')
      : !result.success;

    const caveatLines = isLowConfidence && assessment
      ? ['\n\n⚠️ MANDATORY CAVEAT:', assessment.calibration.caveat, 'Sources: ' + assessment.confidence]
      : [];
    const andonEnforcement = caveatLines.join('\n');

    return {
      success: result.success,
      result: {
        message: result.success && assessment
          ? `${assessment.calibration.emoji} ${assessment.calibration.label} — ${researchOutput?.sources?.length || 0} sources analyzed.${andonEnforcement}`
          : `Research failed: ${result.summary}`,
        query,
        depth,
        voice,
        pillar,
        workQueueUrl: notionUrl,
        summary: isLowConfidence && assessment
          ? `⚠️ LOW CONFIDENCE — ${assessment.calibration.caveat}\n\n${researchOutput?.summary?.substring(0, 400) || ''}`
          : researchOutput?.summary?.substring(0, 500),
        sourcesCount: researchOutput?.sources?.length || 0,
        findingsCount: researchOutput?.findings?.length || 0,
        andonConfidence: assessment?.confidence ?? 'insufficient',
        andonLabel: assessment?.calibration.label ?? 'Research Incomplete',
        andonCaveat: assessment?.calibration.caveat ?? null,
        andonRouting: assessment?.routing ?? 'clarify',
        andonEmoji: assessment?.calibration.emoji ?? '⚠️',
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

  const WORK_QUEUE_DATABASE_ID = NOTION_DB.WORK_QUEUE;

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

    // Use the actual URL from Notion API (includes workspace context)
    const url = (response as { url?: string }).url || '';

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
