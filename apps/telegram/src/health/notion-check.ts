/**
 * Notion Access Health Check
 *
 * Verifies Atlas has proper access to all critical Notion databases.
 * Run on startup or on-demand to catch access issues early.
 */

import { Client } from '@notionhq/client';
import { logger } from '../logger';

// Canonical database IDs - DO NOT CHANGE without updating MEMORY.md
const DATABASES = {
  WORK_QUEUE: '3d679030-b76b-43bd-92d8-1ac51abb4a28',
  FEED: '90b2b33f-4b44-4b42-870f-8d62fb8cbf18',
  DEV_PIPELINE: 'ce6fbf1b-ee30-433d-a9e6-b338552de7c9',
  // SYSTEM_PROMPTS will be set after running scripts/setup-prompts-db.ts
  // SYSTEM_PROMPTS: process.env.NOTION_PROMPTS_DB_ID || '',
} as const;

interface HealthCheckResult {
  success: boolean;
  integration: string;
  databases: Record<string, {
    accessible: boolean;
    itemCount?: number;
    error?: string;
  }>;
  timestamp: string;
}

/**
 * Run Notion health check
 */
export async function checkNotionAccess(): Promise<HealthCheckResult> {
  const notion = new Client({ auth: process.env.NOTION_API_KEY });

  const result: HealthCheckResult = {
    success: true,
    integration: '',
    databases: {},
    timestamp: new Date().toISOString(),
  };

  // Check 1: Verify token and get integration name
  try {
    const me = await notion.users.me({});
    result.integration = me.name || 'Unknown';
    logger.info('[Notion Health] Integration verified', { name: result.integration });
  } catch (error) {
    result.success = false;
    result.integration = `ERROR: ${error}`;
    logger.error('[Notion Health] Token verification failed', { error });
    return result;
  }

  // Check 2: Verify access to each database
  for (const [name, id] of Object.entries(DATABASES)) {
    try {
      // Query with page_size=1 just to verify access
      const response = await notion.databases.query({
        database_id: id,
        page_size: 1,
      });

      result.databases[name] = {
        accessible: true,
        itemCount: response.results.length > 0 ?
          (response.has_more ? '1+' : response.results.length) as unknown as number : 0,
      };
      logger.info(`[Notion Health] ${name} accessible`, { id });
    } catch (error: any) {
      result.success = false;
      result.databases[name] = {
        accessible: false,
        error: error.code || error.message || String(error),
      };
      logger.error(`[Notion Health] ${name} NOT accessible`, { id, error: error.code });
    }
  }

  return result;
}

/**
 * Format health check result for display
 */
export function formatHealthCheck(result: HealthCheckResult): string {
  const lines: string[] = [];

  lines.push(`<b>Notion Health Check</b>`);
  lines.push(`Integration: ${result.integration}`);
  lines.push(`Overall: ${result.success ? '✅ HEALTHY' : '❌ ISSUES DETECTED'}`);
  lines.push('');

  lines.push('<b>Databases:</b>');
  for (const [name, status] of Object.entries(result.databases)) {
    if (status.accessible) {
      lines.push(`✅ ${name}: OK`);
    } else {
      lines.push(`❌ ${name}: ${status.error}`);
    }
  }

  return lines.join('\n');
}

/**
 * Run health check and throw if critical failures
 */
export async function ensureNotionAccess(): Promise<void> {
  const result = await checkNotionAccess();

  if (!result.success) {
    const failedDbs = Object.entries(result.databases)
      .filter(([_, s]) => !s.accessible)
      .map(([name, s]) => `${name}: ${s.error}`)
      .join(', ');

    throw new Error(`Notion access check failed: ${failedDbs}`);
  }

  logger.info('[Notion Health] All databases accessible');
}
