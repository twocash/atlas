/**
 * Atlas Telegram Bot - Health Command
 *
 * Comprehensive system health check including:
 * - Database connectivity
 * - Schema validation (Work Queue Status type)
 * - Gemini API connectivity
 * - Claude API connectivity
 * - MCP connectivity (if available)
 * - Pending research items count
 *
 * Per SOP-001: Added to /help in help.ts
 */

import type { Context } from 'grammy';
import { Client } from '@notionhq/client';
import { NOTION_DB } from '@atlas/shared/config';
import { logger } from '../logger';

// Canonical IDs from @atlas/shared/config
const FEED_DATABASE_ID = NOTION_DB.FEED;
const WORK_QUEUE_DATABASE_ID = NOTION_DB.WORK_QUEUE;
const DEV_PIPELINE_DATABASE_ID = NOTION_DB.DEV_PIPELINE;

let notion: Client | null = null;

function getNotionClient(): Client {
  if (!notion) {
    notion = new Client({ auth: process.env.NOTION_API_KEY });
  }
  return notion;
}

interface HealthResult {
  status: 'ok' | 'warn' | 'error';
  message: string;
}

/**
 * Check database connectivity
 */
async function checkDatabases(): Promise<HealthResult> {
  const client = getNotionClient();
  const results: string[] = [];
  let hasError = false;

  // Feed 2.0
  try {
    await client.databases.retrieve({ database_id: FEED_DATABASE_ID });
    results.push('Feed: OK');
  } catch (error: any) {
    results.push(`Feed: FAIL (${error?.code || 'unknown'})`);
    hasError = true;
  }

  // Work Queue 2.0
  try {
    await client.databases.retrieve({ database_id: WORK_QUEUE_DATABASE_ID });
    results.push('WQ: OK');
  } catch (error: any) {
    results.push(`WQ: FAIL (${error?.code || 'unknown'})`);
    hasError = true;
  }

  // Dev Pipeline
  try {
    await client.databases.retrieve({ database_id: DEV_PIPELINE_DATABASE_ID });
    results.push('DevPipe: OK');
  } catch (error: any) {
    results.push(`DevPipe: FAIL (${error?.code || 'unknown'})`);
    hasError = true;
  }

  return {
    status: hasError ? 'error' : 'ok',
    message: results.join(', '),
  };
}

/**
 * Validate Work Queue Status schema works with select type
 */
async function checkStatusSchema(): Promise<HealthResult> {
  const client = getNotionClient();

  try {
    // Work Queue Status is a select type property
    await client.databases.query({
      database_id: WORK_QUEUE_DATABASE_ID,
      filter: { property: 'Status', select: { equals: 'Captured' } },
      page_size: 1,
    });
    return { status: 'ok', message: 'Status schema: OK' };
  } catch (error: any) {
    const msg = error?.message || String(error);
    return {
      status: 'warn',
      message: `Schema check failed: ${msg.substring(0, 50)}`,
    };
  }
}

/**
 * Check Claude API connectivity
 */
async function checkClaude(): Promise<HealthResult> {
  try {
    const { testClaudeConnection } = await import('../claude');
    const ok = await testClaudeConnection();
    return {
      status: ok ? 'ok' : 'error',
      message: ok ? 'Claude: OK' : 'Claude: FAIL',
    };
  } catch {
    return { status: 'error', message: 'Claude: FAIL' };
  }
}

/**
 * Check Gemini API key presence (used for research)
 */
async function checkGemini(): Promise<HealthResult> {
  const hasKey = !!process.env.GEMINI_API_KEY;
  if (!hasKey) {
    return { status: 'warn', message: 'Gemini: NOT CONFIGURED' };
  }

  // Optionally test connectivity with a simple request
  try {
    // Just check that the key is present - don't make an actual API call
    // to avoid burning tokens on health checks
    return { status: 'ok', message: 'Gemini: KEY PRESENT' };
  } catch {
    return { status: 'warn', message: 'Gemini: UNKNOWN' };
  }
}

/**
 * Check for pending Triaged research items in Work Queue
 */
async function checkPendingResearch(): Promise<HealthResult> {
  const client = getNotionClient();

  try {
    const response = await client.databases.query({
      database_id: WORK_QUEUE_DATABASE_ID,
      filter: {
        and: [
          { property: 'Status', select: { equals: 'Triaged' } },
          { property: 'Type', select: { equals: 'Research' } },
        ],
      },
      page_size: 10,
    });

    const count = response.results.length;
    if (count === 0) {
      return { status: 'ok', message: 'Pending research: 0' };
    } else if (count < 5) {
      return { status: 'ok', message: `Pending research: ${count}` };
    } else {
      return { status: 'warn', message: `Pending research: ${count} (backlog)` };
    }
  } catch (error: any) {
    return { status: 'warn', message: `Pending research: check failed` };
  }
}

/**
 * Check AnythingLLM RAG server connectivity
 */
async function checkAnythingLlm(): Promise<HealthResult> {
  const baseUrl = process.env.ANYTHINGLLM_BASE_URL;
  if (!baseUrl) {
    return { status: 'warn', message: 'AnythingLLM: NOT CONFIGURED' };
  }

  try {
    const response = await fetch(`${baseUrl}/api/ping`, {
      signal: AbortSignal.timeout(3000),
    });
    if (response.ok) {
      const data = await response.json() as { online?: boolean };
      if (data.online) {
        return { status: 'ok', message: 'AnythingLLM: online' };
      }
      return { status: 'warn', message: 'AnythingLLM: unexpected response' };
    }
    return { status: 'warn', message: `AnythingLLM: HTTP ${response.status}` };
  } catch (error: any) {
    const msg = error?.cause?.code || error?.message || 'connection failed';
    return { status: 'warn', message: `AnythingLLM: OFFLINE (${msg.substring(0, 30)})` };
  }
}

/**
 * Check MCP/Pit Crew connectivity (if available)
 */
async function checkMcp(): Promise<HealthResult> {
  // MCP status comes from mcp module
  try {
    const { getMcpStatus } = await import('../mcp');
    const status = getMcpStatus();
    const pitCrew = status['pit_crew'];

    if (pitCrew?.status === 'connected') {
      return { status: 'ok', message: 'Pit Crew: connected' };
    } else if (pitCrew) {
      return { status: 'warn', message: `Pit Crew: ${pitCrew.status}` };
    }
    return { status: 'warn', message: 'Pit Crew: not configured' };
  } catch {
    return { status: 'warn', message: 'Pit Crew: not available' };
  }
}

/**
 * Format health check results for Telegram
 */
function formatResults(results: Record<string, HealthResult>): string {
  const lines: string[] = ['<b>Atlas Health Check</b>', ''];

  const statusIcons: Record<string, string> = {
    ok: '\u2705',     // ✅
    warn: '\u26A0\uFE0F',   // ⚠️
    error: '\u274C',  // ❌
  };

  for (const [name, result] of Object.entries(results)) {
    const icon = statusIcons[result.status] || '\u2753'; // ❓
    lines.push(`${icon} <b>${name}:</b> ${result.message}`);
  }

  // Overall status
  const hasError = Object.values(results).some(r => r.status === 'error');
  const hasWarn = Object.values(results).some(r => r.status === 'warn');

  lines.push('');
  if (hasError) {
    lines.push('\u274C <b>Status: UNHEALTHY</b>');
    lines.push('Check logs for details.');
  } else if (hasWarn) {
    lines.push('\u26A0\uFE0F <b>Status: DEGRADED</b>');
  } else {
    lines.push('\u2705 <b>Status: HEALTHY</b>');
  }

  return lines.join('\n');
}

/**
 * Handle /health command
 */
export async function handleHealthCommand(ctx: Context): Promise<void> {
  await ctx.replyWithChatAction('typing');

  const results: Record<string, HealthResult> = {};

  // Run checks in parallel where possible
  const [dbResult, schemaResult, claudeResult, geminiResult, mcpResult, researchResult, anythingLlmResult] = await Promise.all([
    checkDatabases(),
    checkStatusSchema(),
    checkClaude(),
    checkGemini(),
    checkMcp(),
    checkPendingResearch(),
    checkAnythingLlm(),
  ]);

  results['Databases'] = dbResult;
  results['Schema'] = schemaResult;
  results['Claude'] = claudeResult;
  results['Gemini'] = geminiResult;
  results['MCP'] = mcpResult;
  results['Research'] = researchResult;
  results['AnythingLLM'] = anythingLlmResult;

  // Log results
  logger.info('Health check completed', {
    databases: dbResult.status,
    schema: schemaResult.status,
    claude: claudeResult.status,
    gemini: geminiResult.status,
    mcp: mcpResult.status,
    research: researchResult.status,
    anythingLlm: anythingLlmResult.status,
  });

  const message = formatResults(results);
  await ctx.reply(message, { parse_mode: 'HTML' });
}
