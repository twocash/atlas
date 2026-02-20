/**
 * Self-Improvement Listener
 *
 * Polls Feed 2.0 for entries tagged "self-improvement" that haven't been resolved.
 * Auto-dispatches to pit crew for Zone 1/2 operations.
 *
 * Feed 2.0 Database ID: 90b2b33f-4b44-4b42-870f-8d62fb8cbf18
 *
 * Sprint: Pit Stop (Autonomous Skill Repair)
 */

import { Client } from '@notionhq/client';
import { logger } from '../logger';
import { getFeatureFlags, getSafetyLimits } from '../config/features';
import { classifyZone, createOperation, type PitCrewOperation } from '../skills/zone-classifier';
import { executeSwarmFix, type SwarmTask, type SwarmResult } from '../pit-crew/swarm-dispatch';
import { executeWithAPI } from '../pit-crew/api-dispatch';
import { NOTION_DB } from '@atlas/shared/config';

// ==========================================
// Constants
// ==========================================

/** Feed 2.0 Database ID (from @atlas/shared/config) */
const FEED_DB_ID = NOTION_DB.FEED;

/** Work Queue 2.0 Database ID (for creating tasks) */
const WORK_QUEUE_DB_ID = NOTION_DB.WORK_QUEUE;

// ==========================================
// State
// ==========================================

/** Track dispatched entries to prevent double-dispatch */
const dispatchedEntries = new Set<string>();

/** Listener interval handle */
let listenerInterval: NodeJS.Timeout | null = null;

/** Lazy-initialized Notion client */
let _notion: Client | null = null;

function getNotionClient(): Client {
  if (!_notion) {
    _notion = new Client({ auth: process.env.NOTION_API_KEY });
  }
  return _notion;
}

// ==========================================
// Feed Entry Interface
// ==========================================

interface FeedEntry {
  id: string;
  url: string;
  title: string;
  pillar?: string;
  requestType?: string;
  status?: string;
  keywords?: string[];
  content?: string;
}

// ==========================================
// Feed Polling
// ==========================================

/**
 * Query Feed 2.0 for self-improvement entries
 */
async function querySelfImprovementEntries(): Promise<FeedEntry[]> {
  const notion = getNotionClient();

  try {
    const response = await notion.databases.query({
      database_id: FEED_DB_ID,
      filter: {
        and: [
          {
            property: 'Keywords',
            multi_select: {
              contains: 'self-improvement',
            },
          },
          {
            property: 'Status',
            select: {
              does_not_equal: 'Resolved',
            },
          },
          {
            property: 'Action Status',
            select: {
              does_not_equal: 'Dismissed',
            },
          },
          {
            property: 'Action Status',
            select: {
              does_not_equal: 'Actioned',
            },
          },
          {
            property: 'Action Status',
            select: {
              does_not_equal: 'Expired',
            },
          },
        ],
      },
      page_size: 10, // Limit batch size
    });

    const entries: FeedEntry[] = [];

    for (const page of response.results) {
      if (page.object !== 'page' || !('properties' in page)) continue;

      const props = page.properties;

      // Extract title
      let title = 'Untitled';
      if ('Entry' in props && props.Entry.type === 'title') {
        title = props.Entry.title.map(t => t.plain_text).join('') || 'Untitled';
      }

      // Extract pillar
      let pillar: string | undefined;
      if ('Pillar' in props && props.Pillar.type === 'select' && props.Pillar.select) {
        pillar = props.Pillar.select.name;
      }

      // Extract request type
      let requestType: string | undefined;
      if ('Request Type' in props && props['Request Type'].type === 'select' && props['Request Type'].select) {
        requestType = props['Request Type'].select.name;
      }

      // Extract status
      let status: string | undefined;
      if ('Status' in props && props.Status.type === 'select' && props.Status.select) {
        status = props.Status.select.name;
      }

      // Extract keywords
      let keywords: string[] = [];
      if ('Keywords' in props && props.Keywords.type === 'multi_select') {
        keywords = props.Keywords.multi_select.map(k => k.name);
      }

      entries.push({
        id: page.id,
        url: (page as any).url,
        title,
        pillar,
        requestType,
        status,
        keywords,
      });
    }

    return entries;
  } catch (error) {
    logger.error('Failed to query Feed 2.0 for self-improvement entries', { error });
    return [];
  }
}

/**
 * Get page content (body text) for additional context
 */
async function getPageContent(pageId: string): Promise<string> {
  const notion = getNotionClient();

  try {
    const blocks = await notion.blocks.children.list({
      block_id: pageId,
      page_size: 50,
    });

    const textParts: string[] = [];

    for (const block of blocks.results) {
      if (!('type' in block)) continue;

      // Extract text from various block types
      if (block.type === 'paragraph' && block.paragraph.rich_text) {
        textParts.push(block.paragraph.rich_text.map(t => t.plain_text).join(''));
      } else if (block.type === 'callout' && block.callout.rich_text) {
        textParts.push(block.callout.rich_text.map(t => t.plain_text).join(''));
      } else if (block.type === 'code' && block.code.rich_text) {
        textParts.push(block.code.rich_text.map(t => t.plain_text).join(''));
      } else if (block.type === 'bulleted_list_item' && block.bulleted_list_item.rich_text) {
        textParts.push('- ' + block.bulleted_list_item.rich_text.map(t => t.plain_text).join(''));
      }
    }

    return textParts.join('\n').trim();
  } catch (error) {
    logger.warn('Failed to get page content', { pageId, error });
    return '';
  }
}

// ==========================================
// Dispatch Logic
// ==========================================

/**
 * Parse a self-improvement entry and determine the operation type
 */
function parseEntryToOperation(entry: FeedEntry, content: string): PitCrewOperation | null {
  const lowerContent = content.toLowerCase();
  const lowerTitle = entry.title.toLowerCase();

  // Determine operation type from content
  let type: PitCrewOperation['type'] = 'code-fix';
  let tier: 0 | 1 | 2 = 1;
  const targetFiles: string[] = [];

  // Look for skill-related patterns
  if (lowerTitle.includes('skill') || lowerContent.includes('skill')) {
    if (lowerContent.includes('create') || lowerContent.includes('new skill')) {
      type = 'skill-create';
    } else if (lowerContent.includes('edit') || lowerContent.includes('update') || lowerContent.includes('fix')) {
      type = 'skill-edit';
    } else if (lowerContent.includes('delete') || lowerContent.includes('remove')) {
      type = 'skill-delete';
    }

    // Default to skill files
    targetFiles.push('data/skills/');

    // Tier 0 for read-only skills, Tier 1 for others
    if (lowerContent.includes('read-only') || lowerContent.includes('tier 0')) {
      tier = 0;
    }
  }

  // Look for config patterns
  if (lowerContent.includes('config') || lowerContent.includes('setting')) {
    type = 'config-change';
    targetFiles.push('src/skills/');
  }

  // Extract specific file paths if mentioned
  const filePattern = /(?:src\/|data\/)[a-zA-Z0-9_\-\/\.]+/g;
  const mentionedFiles = content.match(filePattern);
  if (mentionedFiles) {
    targetFiles.push(...mentionedFiles);
  }

  // If no files detected, this entry might not be actionable
  if (targetFiles.length === 0) {
    return null;
  }

  return createOperation({
    type,
    tier,
    targetFiles: [...new Set(targetFiles)], // Dedupe
    description: entry.title,
    skillName: extractSkillName(content),
    context: content,
  });
}

/**
 * Extract skill name from content if present
 */
function extractSkillName(content: string): string | undefined {
  // Look for patterns like "skill: name" or "skill-name"
  const patterns = [
    /skill[:\s]+([a-z0-9\-_]+)/i,
    /([a-z0-9\-]+)-skill/i,
  ];

  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (match) {
      return match[1];
    }
  }

  return undefined;
}

/**
 * Split multi-file operations into single-file tasks for faster swarm execution.
 * Each file gets its own Claude Code session to prevent timeouts.
 */
function splitOperationByFile(operation: PitCrewOperation): PitCrewOperation[] {
  // Filter out directory-level paths (e.g., "data/skills/")
  const specificFiles = operation.targetFiles.filter(f => !f.endsWith('/'));

  // If no specific files, return original (directory-only operation)
  if (specificFiles.length === 0) {
    return [operation];
  }

  // If exactly one specific file, return operation with just that file
  if (specificFiles.length === 1) {
    return [{
      ...operation,
      targetFiles: specificFiles,
    }];
  }

  // Multiple files: split into separate operations
  return specificFiles.map(file => ({
    ...operation,
    targetFiles: [file],
    description: `${operation.description} [file: ${file}]`,
  }));
}

/**
 * Update Feed entry status to "Dispatched"
 */
async function markEntryDispatched(entryId: string): Promise<void> {
  const notion = getNotionClient();

  try {
    await notion.pages.update({
      page_id: entryId,
      properties: {
        Status: {
          select: { name: 'Dispatched' },
        },
      },
    });
  } catch (error) {
    logger.warn('Failed to update Feed entry status', { entryId, error });
  }
}

/**
 * Create a Work Queue item for manual handling
 */
async function createWorkQueueItem(
  entry: FeedEntry,
  _operation: PitCrewOperation, // Kept for potential future use (e.g., adding target files to WQ)
  zone: string,
  reason: string
): Promise<void> {
  const notion = getNotionClient();

  try {
    await notion.pages.create({
      parent: { database_id: WORK_QUEUE_DB_ID },
      properties: {
        Task: {
          title: [{ text: { content: `[Auto] ${entry.title}` } }],
        },
        Status: {
          select: { name: 'Captured' },
        },
        Priority: {
          select: { name: 'P1' },
        },
        Type: {
          select: { name: 'Build' },
        },
        Pillar: {
          select: { name: entry.pillar || 'The Grove' },
        },
        Assignee: {
          select: { name: 'Atlas [Telegram]' },
        },
      },
      children: [
        {
          type: 'callout',
          callout: {
            icon: { emoji: '🔧' },
            color: 'blue_background',
            rich_text: [
              { type: 'text', text: { content: `Zone: ${zone}\nReason: ${reason}` } },
            ],
          },
        },
        {
          type: 'paragraph',
          paragraph: {
            rich_text: [
              { type: 'text', text: { content: `Source: ` } },
              { type: 'text', text: { content: entry.title, link: { url: entry.url } } },
            ],
          },
        },
      ],
    });

    logger.info('Created Work Queue item for manual handling', {
      entry: entry.id,
      title: entry.title,
      zone,
    });
  } catch (error) {
    logger.error('Failed to create Work Queue item', { entry: entry.id, error });
  }
}

/**
 * Process a single self-improvement entry
 */
async function processEntry(entry: FeedEntry): Promise<void> {
  // Skip if already dispatched or currently processing
  if (dispatchedEntries.has(entry.id)) {
    return;
  }

  // Mark immediately to prevent re-dispatch during async processing
  dispatchedEntries.add(entry.id);

  logger.info('Processing self-improvement entry', {
    id: entry.id,
    title: entry.title,
    pillar: entry.pillar,
  });

  // Get page content for context
  const content = await getPageContent(entry.id);

  // Parse to operation
  const baseOperation = parseEntryToOperation(entry, content || entry.title);

  if (!baseOperation) {
    logger.info('Entry not actionable (no target files detected)', { id: entry.id });
    return;
  }

  // Split multi-file operations into single-file tasks for faster execution
  const operations = splitOperationByFile(baseOperation);

  logger.info('Processing operations for entry', {
    entry: entry.id,
    operationCount: operations.length,
    files: operations.map(op => op.targetFiles[0]),
  });

  // Process each operation (single file per swarm dispatch)
  for (const operation of operations) {
    // Classify the zone
    const classification = classifyZone(operation);
    const { zone } = classification;

    logger.info('Zone classification for self-improvement', {
      entry: entry.id,
      zone,
      rule: classification.ruleApplied,
      reason: classification.reason,
      targetFile: operation.targetFiles[0],
    });

    // Handle based on zone and swarm dispatch flag
    const flags = getFeatureFlags();

    if ((zone === 'auto-execute' || zone === 'auto-notify') && flags.swarmDispatch) {
      // Create swarm task and dispatch
      const task: SwarmTask = {
        feedEntryId: entry.id,
        operation,
        zone,
        context: content || entry.title,
        targetSkill: operation.skillName,
      };

      // Use API Direct dispatch if enabled, otherwise fall back to CLI
      const result: SwarmResult = flags.apiSwarmDispatch
        ? await executeWithAPI(task)
        : await executeSwarmFix(task);

      if (result.success) {
        logger.info('Swarm fix succeeded', {
          entry: entry.id,
          filesChanged: result.filesChanged,
          commitHash: result.commitHash,
        });

        // Only mark as dispatched after ALL operations complete (last one)
        if (operation === operations[operations.length - 1]) {
          await markEntryDispatched(entry.id);
        }
      } else {
        logger.warn('Swarm fix failed, creating Work Queue item', {
          entry: entry.id,
          error: result.error,
          targetFile: operation.targetFiles[0],
        });

        // Create Work Queue item for manual handling
        await createWorkQueueItem(
          entry,
          operation,
          zone,
          result.error || 'Swarm execution failed'
        );
      }
    } else if (zone === 'approve' || !flags.swarmDispatch) {
      // Create Work Queue item for manual handling
      await createWorkQueueItem(
        entry,
        operation,
        zone,
        flags.swarmDispatch ? classification.reason : 'Swarm dispatch disabled'
      );
    }
  }
}

/**
 * Poll and dispatch self-improvement entries
 */
async function pollAndDispatch(): Promise<void> {
  const entries = await querySelfImprovementEntries();

  if (entries.length === 0) {
    logger.debug('No self-improvement entries to process');
    return;
  }

  logger.info('Found self-improvement entries', { count: entries.length });

  for (const entry of entries) {
    try {
      await processEntry(entry);
    } catch (error) {
      logger.error('Error processing self-improvement entry', { entry: entry.id, error });
    }
  }
}

// ==========================================
// Public API
// ==========================================

/**
 * Start the self-improvement listener
 *
 * @returns The interval handle for stopping
 */
export function startSelfImprovementListener(): NodeJS.Timeout {
  if (listenerInterval) {
    logger.warn('Self-improvement listener already running');
    return listenerInterval;
  }

  const limits = getSafetyLimits();
  const flags = getFeatureFlags();

  if (!flags.selfImprovementListener) {
    logger.info('Self-improvement listener disabled (ATLAS_SELF_IMPROVEMENT_LISTENER=false)');
    // Return a dummy interval that does nothing
    return setInterval(() => {}, 60 * 60 * 1000);
  }

  logger.info('Starting self-improvement listener', {
    pollIntervalMs: limits.selfImprovementPollIntervalMs,
    swarmDispatchEnabled: flags.swarmDispatch,
  });

  // Initial poll
  pollAndDispatch().catch(error => {
    logger.error('Initial self-improvement poll failed', { error });
  });

  // Start interval
  listenerInterval = setInterval(async () => {
    const flags = getFeatureFlags();
    if (!flags.selfImprovementListener) {
      return;
    }

    try {
      await pollAndDispatch();
    } catch (error) {
      logger.error('Self-improvement listener error', { error });
    }
  }, limits.selfImprovementPollIntervalMs);

  return listenerInterval;
}

/**
 * Stop the self-improvement listener
 */
export function stopSelfImprovementListener(): void {
  if (listenerInterval) {
    clearInterval(listenerInterval);
    listenerInterval = null;
    logger.info('Self-improvement listener stopped');
  }
}

/**
 * Get listener status
 */
export function getSelfImprovementListenerStatus(): {
  running: boolean;
  processedCount: number;
  pollIntervalMs: number;
} {
  const limits = getSafetyLimits();

  return {
    running: listenerInterval !== null,
    processedCount: dispatchedEntries.size,
    pollIntervalMs: limits.selfImprovementPollIntervalMs,
  };
}

/**
 * Force a poll cycle (for testing/debugging)
 */
export async function forcePoll(): Promise<void> {
  await pollAndDispatch();
}
