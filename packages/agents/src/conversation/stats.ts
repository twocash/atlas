/**
 * Atlas Telegram Bot - Stats & Token Tracking
 *
 * Track usage, costs, and generate weekly summaries.
 */

import { Client } from '@notionhq/client';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../logger';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import { NOTION_DB } from '@atlas/shared/config';

const notion = new Client({ auth: process.env.NOTION_API_KEY });

const DATA_DIR = join(__dirname, '../../data');
const STATS_FILE = join(DATA_DIR, 'stats.json');

// Canonical IDs from @atlas/shared/config
const FEED_DATABASE_ID = NOTION_DB.FEED;
const WORK_QUEUE_DATABASE_ID = NOTION_DB.WORK_QUEUE;

// Cost per 1M tokens (approximate)
const TOKEN_COSTS = {
  'claude-sonnet-4': { input: 3.00, output: 15.00 },
  'claude-haiku-4-5': { input: 1.00, output: 5.00 },
  'claude-opus-4': { input: 15.00, output: 75.00 },
};

interface DailyStats {
  date: string;
  requests: number;
  tokens: {
    input: number;
    output: number;
    total: number;
  };
  byPillar: Record<string, number>;
  byRequestType: Record<string, number>;
  estimatedCost: number;
}

interface StatsStore {
  daily: Record<string, DailyStats>;
  lastUpdated: string;
}

/**
 * Load stats from file
 */
async function loadStats(): Promise<StatsStore> {
  try {
    const data = await readFile(STATS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return {
      daily: {},
      lastUpdated: new Date().toISOString(),
    };
  }
}

/**
 * Save stats to file
 */
async function saveStats(stats: StatsStore): Promise<void> {
  try {
    await mkdir(DATA_DIR, { recursive: true });
    stats.lastUpdated = new Date().toISOString();
    await writeFile(STATS_FILE, JSON.stringify(stats, null, 2));
  } catch (error) {
    logger.error('Failed to save stats', { error });
  }
}

/**
 * Record token usage for a request
 */
export async function recordUsage(params: {
  inputTokens: number;
  outputTokens: number;
  pillar: string;
  requestType: string;
  model?: string;
}): Promise<void> {
  const stats = await loadStats();
  const today = new Date().toISOString().split('T')[0];

  if (!stats.daily[today]) {
    stats.daily[today] = {
      date: today,
      requests: 0,
      tokens: { input: 0, output: 0, total: 0 },
      byPillar: {},
      byRequestType: {},
      estimatedCost: 0,
    };
  }

  const daily = stats.daily[today];
  daily.requests++;
  daily.tokens.input += params.inputTokens;
  daily.tokens.output += params.outputTokens;
  daily.tokens.total += params.inputTokens + params.outputTokens;

  daily.byPillar[params.pillar] = (daily.byPillar[params.pillar] || 0) + 1;
  daily.byRequestType[params.requestType] = (daily.byRequestType[params.requestType] || 0) + 1;

  // Calculate cost
  const model = params.model || 'claude-sonnet-4';
  const costs = TOKEN_COSTS[model as keyof typeof TOKEN_COSTS] || TOKEN_COSTS['claude-sonnet-4'];
  daily.estimatedCost += (params.inputTokens / 1_000_000) * costs.input;
  daily.estimatedCost += (params.outputTokens / 1_000_000) * costs.output;

  await saveStats(stats);
}

/**
 * Get stats for a date range
 */
export async function getStats(days: number = 7): Promise<{
  totalRequests: number;
  totalTokens: number;
  totalCost: number;
  byPillar: Record<string, number>;
  byRequestType: Record<string, number>;
  dailyBreakdown: DailyStats[];
}> {
  const stats = await loadStats();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().split('T')[0];

  let totalRequests = 0;
  let totalTokens = 0;
  let totalCost = 0;
  const byPillar: Record<string, number> = {};
  const byRequestType: Record<string, number> = {};
  const dailyBreakdown: DailyStats[] = [];

  for (const [date, daily] of Object.entries(stats.daily)) {
    if (date >= cutoffStr) {
      totalRequests += daily.requests;
      totalTokens += daily.tokens.total;
      totalCost += daily.estimatedCost;

      for (const [pillar, count] of Object.entries(daily.byPillar)) {
        byPillar[pillar] = (byPillar[pillar] || 0) + count;
      }
      for (const [type, count] of Object.entries(daily.byRequestType)) {
        byRequestType[type] = (byRequestType[type] || 0) + count;
      }

      dailyBreakdown.push(daily);
    }
  }

  dailyBreakdown.sort((a, b) => b.date.localeCompare(a.date));

  return {
    totalRequests,
    totalTokens,
    totalCost,
    byPillar,
    byRequestType,
    dailyBreakdown,
  };
}

/**
 * Helper to get property values from Notion
 */
function getSelect(props: Record<string, unknown>, key: string): string | null {
  const prop = props[key] as { type?: string; select?: { name?: string } | null } | undefined;
  if (prop?.type === 'select' && prop.select?.name) {
    return prop.select.name;
  }
  return null;
}

function getTitle(props: Record<string, unknown>, key: string): string {
  const prop = props[key] as { type?: string; title?: Array<{ plain_text?: string }> } | undefined;
  if (prop?.type === 'title' && Array.isArray(prop.title) && prop.title[0]?.plain_text) {
    return prop.title[0].plain_text;
  }
  return 'Untitled';
}

/**
 * Get Work Queue stats from Notion
 */
export async function getWorkQueueStats(): Promise<{
  active: number;
  blocked: number;
  captured: number;
  completedThisWeek: number;
  p0Items: Array<{ task: string; pillar: string }>;
  byPillar: Record<string, number>;
  avgCycleTime: number | null;
}> {
  try {
    // Get active items
    const activeResults = await notion.databases.query({
      database_id: WORK_QUEUE_DATABASE_ID,
      filter: {
        or: [
          { property: 'Status', select: { equals: 'Active' } },
          { property: 'Status', select: { equals: 'Blocked' } },
          { property: 'Status', select: { equals: 'Captured' } },
        ],
      },
      page_size: 100,
    });

    let active = 0;
    let blocked = 0;
    let captured = 0;
    const p0Items: Array<{ task: string; pillar: string }> = [];
    const byPillar: Record<string, number> = {};

    for (const page of activeResults.results) {
      if ('properties' in page) {
        const props = page.properties as Record<string, unknown>;
        const status = getSelect(props, 'Status');
        const pillar = getSelect(props, 'Pillar') || 'Unknown';
        const priority = getSelect(props, 'Priority');
        const task = getTitle(props, 'Task');

        if (status === 'Active') active++;
        if (status === 'Blocked') blocked++;
        if (status === 'Captured') captured++;

        byPillar[pillar] = (byPillar[pillar] || 0) + 1;

        if (priority === 'P0') {
          p0Items.push({ task, pillar });
        }
      }
    }

    // Get completed this week
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);

    const completedResults = await notion.databases.query({
      database_id: WORK_QUEUE_DATABASE_ID,
      filter: {
        and: [
          { property: 'Status', select: { equals: 'Done' } },
          { property: 'Completed', date: { on_or_after: weekAgo.toISOString().split('T')[0] } },
        ],
      },
      page_size: 100,
    });

    return {
      active,
      blocked,
      captured,
      completedThisWeek: completedResults.results.length,
      p0Items,
      byPillar,
      avgCycleTime: null, // Would need to calculate from Cycle Time formula
    };
  } catch (error) {
    logger.error('Failed to get Work Queue stats', { error });
    return {
      active: 0,
      blocked: 0,
      captured: 0,
      completedThisWeek: 0,
      p0Items: [],
      byPillar: {},
      avgCycleTime: null,
    };
  }
}

/**
 * Format stats for Telegram display
 */
export async function formatStatsMessage(days: number = 7): Promise<string> {
  const usageStats = await getStats(days);
  const wqStats = await getWorkQueueStats();

  const now = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const dateRange = `${startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;

  let message = `📊 Atlas Stats (${dateRange})\n`;
  message += `${'─'.repeat(32)}\n\n`;

  // Request breakdown
  message += `📥 Requests: ${usageStats.totalRequests} total\n`;
  if (Object.keys(usageStats.byPillar).length > 0) {
    const pillarEntries = Object.entries(usageStats.byPillar)
      .sort((a, b) => b[1] - a[1]);
    for (const [pillar, count] of pillarEntries) {
      const pct = Math.round((count / usageStats.totalRequests) * 100);
      message += `   • ${pillar}: ${count} (${pct}%)\n`;
    }
  }
  message += '\n';

  // Work Queue status
  message += `📋 Work Queue:\n`;
  message += `   • Active: ${wqStats.active}\n`;
  message += `   • Blocked: ${wqStats.blocked}\n`;
  message += `   • Captured: ${wqStats.captured}\n`;
  message += `   • Done this week: ${wqStats.completedThisWeek}\n`;
  message += '\n';

  // P0 items
  if (wqStats.p0Items.length > 0) {
    message += `🔥 P0 Items (${wqStats.p0Items.length}):\n`;
    for (const item of wqStats.p0Items.slice(0, 5)) {
      message += `   • ${item.task.substring(0, 40)}${item.task.length > 40 ? '...' : ''}\n`;
    }
    message += '\n';
  }

  // Token usage
  message += `💰 Token Usage:\n`;
  message += `   • Total: ${(usageStats.totalTokens / 1000).toFixed(1)}K tokens\n`;
  message += `   • Est. cost: $${usageStats.totalCost.toFixed(2)}\n`;

  return message;
}

/**
 * Detect patterns in recent activity (for skill suggestions)
 */
export async function detectPatterns(): Promise<Array<{
  pattern: string;
  frequency: number;
  suggestion: string;
}>> {
  // Query recent Feed entries to find repeating patterns
  const patterns: Array<{ pattern: string; frequency: number; suggestion: string }> = [];

  try {
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 30); // Look at last 30 days

    const results = await notion.databases.query({
      database_id: FEED_DATABASE_ID,
      filter: {
        property: 'Date',
        date: { on_or_after: weekAgo.toISOString().split('T')[0] },
      },
      page_size: 100,
    });

    // Count work types
    const workTypeCounts: Record<string, number> = {};
    for (const page of results.results) {
      if ('properties' in page) {
        const props = page.properties as Record<string, unknown>;
        const workTypeProp = props['Work Type'] as { type?: string; rich_text?: Array<{ plain_text?: string }> } | undefined;
        if (workTypeProp?.type === 'rich_text' && workTypeProp.rich_text?.[0]?.plain_text) {
          const workType = workTypeProp.rich_text[0].plain_text.toLowerCase();
          workTypeCounts[workType] = (workTypeCounts[workType] || 0) + 1;
        }
      }
    }

    // Find patterns (work types that appear 4+ times)
    for (const [workType, count] of Object.entries(workTypeCounts)) {
      if (count >= 4) {
        patterns.push({
          pattern: workType,
          frequency: count,
          suggestion: `Create a skill for "${workType}" — appeared ${count} times in 30 days`,
        });
      }
    }
  } catch (error) {
    logger.error('Pattern detection failed', { error });
  }

  return patterns;
}
