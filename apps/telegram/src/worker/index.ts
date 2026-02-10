/**
 * Atlas Telegram Bot - Worker Integration
 *
 * Integrates the background worker system with Telegram bot for:
 * - Manual /work command execution
 * - Notifications on task completion/failure
 * - Worker status reporting
 *
 * Uses packages/agents/src/worker.ts for actual execution.
 */

import type { Api } from 'grammy';
import { Client } from '@notionhq/client';
import { logger } from '../logger';
import { isFeatureEnabled } from '../config/features';
import { createActionFeedEntry } from '../notion';
import type { ActionDataReview } from '../types';

// ==========================================
// Configuration
// ==========================================

const WORK_QUEUE_DB_ID = '3d679030-b76b-43bd-92d8-1ac51abb4a28';

// ==========================================
// State
// ==========================================

let telegramApi: Api | null = null;
let jimChatId: number | null = null;
let isPolling = false;
let pollIntervalId: NodeJS.Timeout | null = null;

// ==========================================
// Initialization
// ==========================================

/**
 * Initialize the worker integration with Telegram API
 */
export function initWorker(api: Api, chatId: number): void {
  telegramApi = api;
  jimChatId = chatId;
  logger.info('[Worker] Initialized with Telegram API', { chatId });
}

// ==========================================
// Notion Client
// ==========================================

let notion: Client | null = null;

function getNotionClient(): Client {
  if (!notion) {
    notion = new Client({ auth: process.env.NOTION_API_KEY });
  }
  return notion;
}

// ==========================================
// Property Helpers
// ==========================================

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

// ==========================================
// Task Types
// ==========================================

interface WorkQueueTask {
  id: string;
  title: string;
  type: string;
  priority: string;
  pillar: string;
  url: string;
}

interface WorkerStatus {
  queueDepth: { triaged: number; active: number; captured: number };
  isPolling: boolean;
  lastRun: Date | null;
}

// ==========================================
// Task Discovery
// ==========================================

/**
 * Find the next task ready for execution
 * Status=Triaged AND Type=Research, sorted by Priority
 */
async function findNextTask(): Promise<WorkQueueTask | null> {
  const client = getNotionClient();

  try {
    const response = await client.databases.query({
      database_id: WORK_QUEUE_DB_ID,
      filter: {
        and: [
          { property: 'Status', select: { equals: 'Triaged' } },
          { property: 'Type', select: { equals: 'Research' } },
        ],
      },
      sorts: [
        { property: 'Priority', direction: 'ascending' },
        { property: 'Queued', direction: 'ascending' },
      ],
      page_size: 1,
    });

    if (response.results.length === 0) return null;

    const page = response.results[0] as { id: string; properties: Record<string, unknown>; url?: string };
    const props = page.properties;

    return {
      id: page.id,
      title: getTitle(props, 'Task'),
      type: getSelect(props, 'Type') || 'Research',
      priority: getSelect(props, 'Priority') || 'P2',
      pillar: getSelect(props, 'Pillar') || 'The Grove',
      url: page.url || '',
    };
  } catch (error) {
    logger.error('[Worker] Failed to find tasks', { error });
    return null;
  }
}

/**
 * Get queue depth statistics
 */
async function getQueueStats(): Promise<{ triaged: number; active: number; captured: number }> {
  const client = getNotionClient();

  try {
    const [triagedRes, activeRes, capturedRes] = await Promise.all([
      client.databases.query({
        database_id: WORK_QUEUE_DB_ID,
        filter: { property: 'Status', select: { equals: 'Triaged' } },
        page_size: 100,
      }),
      client.databases.query({
        database_id: WORK_QUEUE_DB_ID,
        filter: { property: 'Status', select: { equals: 'Active' } },
        page_size: 100,
      }),
      client.databases.query({
        database_id: WORK_QUEUE_DB_ID,
        filter: { property: 'Status', select: { equals: 'Captured' } },
        page_size: 100,
      }),
    ]);

    return {
      triaged: triagedRes.results.length,
      active: activeRes.results.length,
      captured: capturedRes.results.length,
    };
  } catch (error) {
    logger.error('[Worker] Failed to get queue stats', { error });
    return { triaged: 0, active: 0, captured: 0 };
  }
}

// ==========================================
// Telegram Notifications
// ==========================================

/**
 * Send a notification to Jim via Telegram
 */
async function notifyJim(message: string): Promise<void> {
  if (!telegramApi || !jimChatId) {
    logger.warn('[Worker] Cannot notify - Telegram not initialized');
    return;
  }

  try {
    await telegramApi.sendMessage(jimChatId, message, { parse_mode: 'HTML' });
  } catch (error) {
    logger.error('[Worker] Failed to send notification', { error });
  }
}

// ==========================================
// Worker Cycle
// ==========================================

let lastRunTime: Date | null = null;

/**
 * Lock a task by setting Status → Active
 */
async function lockTask(taskId: string): Promise<boolean> {
  const client = getNotionClient();
  try {
    await client.pages.update({
      page_id: taskId,
      properties: {
        Status: { select: { name: 'Active' } },
        Started: { date: { start: new Date().toISOString().split('T')[0] } },
      },
    });
    logger.info('[Worker] Locked task', { taskId });
    return true;
  } catch (error) {
    logger.error('[Worker] Failed to lock task', { taskId, error });
    return false;
  }
}

/**
 * Mark task as Done
 */
async function completeTask(taskId: string, notes?: string): Promise<void> {
  const client = getNotionClient();
  const properties: Record<string, unknown> = {
    Status: { select: { name: 'Done' } },
    Completed: { date: { start: new Date().toISOString().split('T')[0] } },
  };
  if (notes) {
    properties['Resolution Notes'] = { rich_text: [{ text: { content: notes.substring(0, 2000) } }] };
  }
  await client.pages.update({ page_id: taskId, properties });
}

/**
 * Mark task as Blocked
 */
async function blockTask(taskId: string, reason: string): Promise<void> {
  const client = getNotionClient();
  await client.pages.update({
    page_id: taskId,
    properties: {
      Status: { select: { name: 'Blocked' } },
      'Blocked Reason': { rich_text: [{ text: { content: reason.substring(0, 2000) } }] },
    },
  });
}

/**
 * Run one worker cycle - claim and execute a single task
 * Returns result message for caller
 */
export async function runWorkerCycle(): Promise<string> {
  logger.info('[Worker] Starting cycle');
  lastRunTime = new Date();

  // Find next task
  const task = await findNextTask();

  if (!task) {
    return '\uD83D\uDCED No tasks ready for execution.';
  }

  // Lock the task (Triaged → Active)
  const locked = await lockTask(task.id);
  if (!locked) {
    return `\u274C Failed to lock task: ${task.title}`;
  }

  // Notify start
  const startMsg = `\u26A1 Working on: <b>${task.title}</b> (${task.priority})`;
  await notifyJim(startMsg);

  // Execute research using the agent system
  try {
    const { AgentRegistry } = await import('../../../../packages/agents/src/registry');
    const { executeResearch } = await import('../../../../packages/agents/src/agents/research');
    const { syncAgentComplete, syncAgentFailure } = await import('../../../../packages/agents/src/workqueue');

    const registry = new AgentRegistry();

    // Spawn agent
    const agent = await registry.spawn({
      type: 'research',
      name: `Research: ${task.title.substring(0, 50)}`,
      instructions: JSON.stringify({ query: task.title, depth: 'standard' }),
      priority: task.priority as 'P0' | 'P1' | 'P2',
      workItemId: task.id,
    });

    // Start agent
    await registry.start(agent.id);

    // Execute research
    logger.info('[Worker] Executing research', { taskId: task.id, agentId: agent.id });
    const result = await executeResearch(
      { query: task.title, depth: 'standard', voice: 'grove-analytical' },
      agent,
      registry
    );

    // Complete or fail - explicitly sync to Notion (don't rely on event subscription)
    if (result.success) {
      await registry.complete(agent.id, result);
      // Explicitly write results to Notion page body
      logger.info('[Worker] Writing results to Notion', { taskId: task.id, summaryLength: result.summary?.length });
      await syncAgentComplete(task.id, agent, result);

      // P3 Review Card — FAIL-OPEN: card failure does NOT block delivery
      if (isFeatureEnabled('reviewProducer')) {
        try {
          const reviewData: ActionDataReview = {
            wq_item_id: task.id,
            wq_title: task.title,
            output_url: task.url || undefined,
          };
          await createActionFeedEntry(
            'Review',
            reviewData,
            'worker',
            `Review: ${task.title}`,
            ['research-review']
          );
          logger.info('[Worker] Review card created', { taskId: task.id });
        } catch (reviewError) {
          logger.warn('[Worker] Review card creation failed (FAIL-OPEN)', { taskId: task.id, error: reviewError });
        }
      }

      const doneMsg = `\u2705 Done: <b>${task.title}</b>\n\u2192 ${task.url}`;
      await notifyJim(doneMsg);
      return doneMsg;
    } else {
      await registry.fail(agent.id, result.summary || 'Research failed', true);
      await syncAgentFailure(task.id, agent, result.summary || 'Research failed', true);
      const blockedMsg = `\u274C Blocked: <b>${task.title}</b>\n\u2192 ${result.summary || 'Research failed'}`;
      await notifyJim(blockedMsg);
      return blockedMsg;
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('[Worker] Execution failed', { taskId: task.id, error: errorMessage });

    // Mark task as blocked
    await blockTask(task.id, `Worker error: ${errorMessage}`);

    const failMsg = `\u274C Worker error: ${errorMessage}`;
    await notifyJim(failMsg);
    return failMsg;
  }
}

// ==========================================
// Polling Control
// ==========================================

const POLL_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes

/**
 * Start continuous polling
 * Runs an immediate cycle, then polls every POLL_INTERVAL_MS
 */
export async function startPolling(): Promise<string> {
  if (isPolling) {
    return 'Worker polling already running.';
  }

  isPolling = true;
  logger.info('[Worker] Polling started', { intervalMs: POLL_INTERVAL_MS });

  // Run immediate first cycle so user sees activity right away
  logger.info('[Worker] Running immediate first cycle...');
  let firstCycleResult = '';
  try {
    firstCycleResult = await runWorkerCycle();
    logger.info('[Worker] First cycle completed', { result: firstCycleResult.substring(0, 100) });
  } catch (error) {
    logger.error('[Worker] First cycle error', { error });
    firstCycleResult = `⚠️ First cycle error: ${error instanceof Error ? error.message : String(error)}`;
  }

  // Set up recurring polling
  pollIntervalId = setInterval(async () => {
    logger.info('[Worker] Polling cycle triggered');
    try {
      const result = await runWorkerCycle();
      logger.info('[Worker] Polling cycle completed', { result: result.substring(0, 100) });
    } catch (error) {
      logger.error('[Worker] Polling cycle error', { error });
    }
  }, POLL_INTERVAL_MS);

  return `✅ Worker polling started (every ${POLL_INTERVAL_MS / 1000 / 60} minutes).\n\n<b>First cycle:</b> ${firstCycleResult}`;
}

/**
 * Stop continuous polling
 */
export function stopPolling(): string {
  if (!isPolling) {
    return 'Worker polling is not running.';
  }

  if (pollIntervalId) {
    clearInterval(pollIntervalId);
    pollIntervalId = null;
  }

  isPolling = false;
  logger.info('[Worker] Polling stopped');
  return '\u2705 Worker polling stopped.';
}

/**
 * Get current worker status
 */
export async function getWorkerStatus(): Promise<WorkerStatus> {
  const queueDepth = await getQueueStats();
  return {
    queueDepth,
    isPolling,
    lastRun: lastRunTime,
  };
}

/**
 * Format worker status for display
 */
export async function formatWorkerStatus(): Promise<string> {
  const status = await getWorkerStatus();

  const lines = [
    '<b>Worker Status</b>',
    '',
    `<b>Queue Depth:</b>`,
    `   \u2022 Triaged (ready): ${status.queueDepth.triaged}`,
    `   \u2022 Active: ${status.queueDepth.active}`,
    `   \u2022 Captured (needs review): ${status.queueDepth.captured}`,
    '',
    `<b>Polling:</b> ${status.isPolling ? 'Running' : 'Stopped'}`,
    `<b>Last Run:</b> ${status.lastRun ? status.lastRun.toLocaleString() : 'Never'}`,
  ];

  return lines.join('\n');
}
