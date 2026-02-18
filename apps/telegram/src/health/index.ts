/**
 * Atlas Telegram Bot - Health Checks
 *
 * Validates all services and configuration before startup.
 * Fails fast if critical dependencies are missing.
 */

// Export the notion-check module for direct access
export { checkNotionAccess, formatHealthCheck, ensureNotionAccess } from './notion-check';

// Export the critical path spike tests
export { runCriticalPathSpikes } from './critical-path-spike';

import { Client } from '@notionhq/client';
import { NOTION_DB } from '@atlas/shared/config';
import Anthropic from '@anthropic-ai/sdk';
import { readFile, access } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { constants } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_DIR = join(__dirname, '../../data');
const CONFIG_DIR = join(__dirname, '../../config');

export interface HealthCheckResult {
  name: string;
  status: 'pass' | 'fail' | 'warn';
  message: string;
  details?: unknown;
}

export interface HealthReport {
  overall: 'healthy' | 'degraded' | 'critical';
  timestamp: string;
  checks: HealthCheckResult[];
  canStart: boolean;
}

/**
 * Check if a file exists
 */
async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check environment variables
 */
async function checkEnvVars(): Promise<HealthCheckResult[]> {
  const results: HealthCheckResult[] = [];

  // Required vars
  const required = [
    'TELEGRAM_BOT_TOKEN',
    'TELEGRAM_ALLOWED_USERS',
    'NOTION_API_KEY',
    'ANTHROPIC_API_KEY',
  ];

  for (const varName of required) {
    const value = process.env[varName];
    if (!value) {
      results.push({
        name: `env:${varName}`,
        status: 'fail',
        message: `Missing required environment variable: ${varName}`,
      });
    } else if (value.length < 10) {
      results.push({
        name: `env:${varName}`,
        status: 'warn',
        message: `${varName} seems too short - may be invalid`,
      });
    } else {
      results.push({
        name: `env:${varName}`,
        status: 'pass',
        message: `${varName} is set (${value.length} chars)`,
      });
    }
  }

  // Optional vars
  const optional = ['ATLAS_NODE_NAME', 'ATLAS_CONVERSATIONAL_UX', 'CLAUDE_WORKING_DIR'];
  for (const varName of optional) {
    const value = process.env[varName];
    results.push({
      name: `env:${varName}`,
      status: value ? 'pass' : 'warn',
      message: value ? `${varName} = ${value}` : `${varName} not set (optional)`,
    });
  }

  return results;
}

/**
 * Check Notion connectivity
 */
async function checkNotion(): Promise<HealthCheckResult> {
  const apiKey = process.env.NOTION_API_KEY;
  if (!apiKey) {
    return {
      name: 'notion:connection',
      status: 'fail',
      message: 'NOTION_API_KEY not set',
    };
  }

  try {
    const notion = new Client({ auth: apiKey });
    const user = await notion.users.me({});

    return {
      name: 'notion:connection',
      status: 'pass',
      message: `Connected as ${user.name || user.id}`,
      details: { userId: user.id, type: user.type },
    };
  } catch (error: any) {
    return {
      name: 'notion:connection',
      status: 'fail',
      message: `Notion connection failed: ${error.code || error.message}`,
      details: { error: error.code, status: error.status },
    };
  }
}

/**
 * Check Claude API connectivity
 */
async function checkClaude(): Promise<HealthCheckResult[]> {
  const results: HealthCheckResult[] = [];
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return [{
      name: 'claude:connection',
      status: 'fail',
      message: 'ANTHROPIC_API_KEY not set',
    }];
  }

  const anthropic = new Anthropic({ apiKey });

  // Test Sonnet (primary model)
  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 10,
      messages: [{ role: 'user', content: 'Say "ok"' }],
    });
    results.push({
      name: 'claude:sonnet',
      status: 'pass',
      message: 'Claude Sonnet 4 connected',
      details: { model: 'claude-sonnet-4-20250514' },
    });
  } catch (error: any) {
    results.push({
      name: 'claude:sonnet',
      status: 'fail',
      message: `Claude Sonnet failed: ${error.error?.message || error.message}`,
      details: { error: error.error?.type },
    });
  }

  // Test Haiku (classification model) - use correct model ID
  try {
    const response = await anthropic.messages.create({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 10,
      messages: [{ role: 'user', content: 'Say "ok"' }],
    });
    results.push({
      name: 'claude:haiku',
      status: 'pass',
      message: 'Claude Haiku connected',
      details: { model: 'claude-3-5-haiku-20241022' },
    });
  } catch (error: any) {
    results.push({
      name: 'claude:haiku',
      status: 'warn',
      message: `Claude Haiku failed (will use Sonnet): ${error.error?.message || error.message}`,
      details: { error: error.error?.type },
    });
  }

  return results;
}

/**
 * Check data files exist
 */
async function checkDataFiles(): Promise<HealthCheckResult[]> {
  const results: HealthCheckResult[] = [];

  const requiredFiles = [
    { path: join(DATA_DIR, 'SOUL.md'), name: 'SOUL.md' },
    { path: join(DATA_DIR, 'USER.md'), name: 'USER.md' },
    { path: join(DATA_DIR, 'MEMORY.md'), name: 'MEMORY.md' },
  ];

  for (const file of requiredFiles) {
    const exists = await fileExists(file.path);
    if (exists) {
      try {
        const content = await readFile(file.path, 'utf-8');
        results.push({
          name: `data:${file.name}`,
          status: 'pass',
          message: `${file.name} exists (${content.length} bytes)`,
        });
      } catch (error) {
        results.push({
          name: `data:${file.name}`,
          status: 'warn',
          message: `${file.name} exists but unreadable`,
        });
      }
    } else {
      results.push({
        name: `data:${file.name}`,
        status: 'fail',
        message: `${file.name} missing`,
      });
    }
  }

  // Check directories
  const requiredDirs = ['conversations', 'skills', 'memory', 'temp', 'exports'];
  for (const dir of requiredDirs) {
    const exists = await fileExists(join(DATA_DIR, dir));
    results.push({
      name: `data:${dir}/`,
      status: exists ? 'pass' : 'warn',
      message: exists ? `${dir}/ exists` : `${dir}/ missing (will be created)`,
    });
  }

  return results;
}

/**
 * Check voice config files
 */
async function checkVoiceConfigs(): Promise<HealthCheckResult[]> {
  const results: HealthCheckResult[] = [];

  const voiceFiles = ['grove.md', 'consulting.md', 'linkedin.md', 'personal.md'];
  const voiceDir = join(CONFIG_DIR, 'voice');

  for (const file of voiceFiles) {
    const path = join(voiceDir, file);
    const exists = await fileExists(path);
    results.push({
      name: `voice:${file}`,
      status: exists ? 'pass' : 'warn',
      message: exists ? `${file} loaded` : `${file} missing (optional)`,
    });
  }

  // Check editorial memory symlink
  const editorialPath = join(voiceDir, 'editorial_memory.md');
  const exists = await fileExists(editorialPath);
  if (exists) {
    try {
      const content = await readFile(editorialPath, 'utf-8');
      results.push({
        name: 'voice:editorial_memory.md',
        status: 'pass',
        message: `editorial_memory.md linked (${content.length} bytes)`,
      });
    } catch {
      results.push({
        name: 'voice:editorial_memory.md',
        status: 'warn',
        message: 'editorial_memory.md symlink broken',
      });
    }
  } else {
    results.push({
      name: 'voice:editorial_memory.md',
      status: 'warn',
      message: 'editorial_memory.md not linked (optional)',
    });
  }

  return results;
}

/**
 * Check Notion database access - THIS IS CRITICAL, RUN FIRST
 * Uses the SAME tool functions that the bot uses, not separate queries
 */
async function checkNotionDatabases(): Promise<HealthCheckResult[]> {
  const results: HealthCheckResult[] = [];

  // First, verify raw database access using verifyDatabaseAccess
  const { verifyDatabaseAccess } = await import('../conversation/audit');
  console.log('[HEALTH] Verifying raw database access (Feed 2.0 + Work Queue 2.0)...');
  const dbAccess = await verifyDatabaseAccess();

  // NOTE: If these fail, it's almost NEVER a sharing issue. It's almost ALWAYS
  // code using the WRONG database ID (drift toward legacy Inbox IDs).
  // See CLAUDE.md "CRITICAL: Database Access Errors" section.
  results.push({
    name: 'notion:feed_database',
    status: dbAccess.feed ? 'pass' : 'fail',
    message: dbAccess.feed
      ? 'Feed 2.0 database accessible'
      : 'Feed 2.0 NOT accessible - CHECK FOR WRONG DATABASE ID IN CODE (not sharing)',
    details: { databaseId: NOTION_DB.FEED }
  });

  results.push({
    name: 'notion:wq_database',
    status: dbAccess.workQueue ? 'pass' : 'fail',
    message: dbAccess.workQueue
      ? 'Work Queue 2.0 database accessible'
      : 'Work Queue 2.0 NOT accessible - CHECK FOR WRONG DATABASE ID IN CODE (not sharing)',
    details: { databaseId: NOTION_DB.WORK_QUEUE }
  });

  // Import and call the actual tool functions to test the real code paths
  const { executeCoreTools } = await import('../conversation/tools/core');

  // Test get_status_summary - queries Work Queue (no Inbox per spec)
  console.log('[HEALTH] Testing get_status_summary (same route as tools)...');
  const statusResult = await executeCoreTools('get_status_summary', {});

  if (statusResult?.success) {
    results.push({
      name: 'notion:get_status_summary',
      status: 'pass',
      message: 'Status summary tool works (Work Queue accessible)',
      details: statusResult.result,
    });
  } else {
    results.push({
      name: 'notion:get_status_summary',
      status: 'fail',
      message: `Status summary failed: ${statusResult?.error || 'unknown error'}`,
    });
  }

  // Test work_queue_list - queries Work Queue with filters
  console.log('[HEALTH] Testing work_queue_list (same route as tools)...');
  const wqResult = await executeCoreTools('work_queue_list', { limit: 1 });

  if (wqResult?.success) {
    results.push({
      name: 'notion:work_queue_list',
      status: 'pass',
      message: 'Work Queue list tool works',
    });
  } else {
    results.push({
      name: 'notion:work_queue_list',
      status: 'fail',
      message: `Work Queue list failed: ${wqResult?.error || 'unknown error'}`,
    });
  }

  // NO inbox_list — Telegram replaces Inbox per spec

  return results;
}

/**
 * Run all health checks
 */
export async function runHealthChecks(): Promise<HealthReport> {
  const checks: HealthCheckResult[] = [];

  // Run all checks - DATABASE ACCESS FIRST (most critical)
  checks.push(...await checkEnvVars());
  checks.push(await checkNotion());
  checks.push(...await checkNotionDatabases()); // Databases BEFORE Claude - if these fail, bot is broken
  checks.push(...await checkClaude());
  checks.push(...await checkDataFiles());
  checks.push(...await checkVoiceConfigs());

  // Determine overall status
  const failCount = checks.filter(c => c.status === 'fail').length;
  const warnCount = checks.filter(c => c.status === 'warn').length;

  let overall: 'healthy' | 'degraded' | 'critical';
  let canStart = true;

  // Critical failures that prevent startup
  // NOTE: Feed is NOT critical - bot can function with Work Queue only
  const criticalChecks = [
    'env:TELEGRAM_BOT_TOKEN',
    'env:ANTHROPIC_API_KEY',
    'notion:wq_database',        // Work Queue 2.0 database raw access
    'notion:get_status_summary', // Work Queue access via tools
    'notion:work_queue_list',    // Work Queue access via tools
    'claude:sonnet',
  ];

  const criticalFails = checks.filter(
    c => criticalChecks.includes(c.name) && c.status === 'fail'
  );

  if (criticalFails.length > 0) {
    overall = 'critical';
    canStart = false;
  } else if (failCount > 0) {
    overall = 'degraded';
    canStart = true; // Can start but with reduced functionality
  } else if (warnCount > 0) {
    overall = 'degraded';
    canStart = true;
  } else {
    overall = 'healthy';
    canStart = true;
  }

  return {
    overall,
    timestamp: new Date().toISOString(),
    checks,
    canStart,
  };
}

/**
 * Format health report for console output
 */
export function formatHealthReport(report: HealthReport): string {
  const lines: string[] = [];

  lines.push('');
  lines.push('═══════════════════════════════════════════════════════════');
  lines.push('                    ATLAS HEALTH CHECK                      ');
  lines.push('═══════════════════════════════════════════════════════════');
  lines.push('');

  const statusIcon = {
    pass: '✓',
    fail: '✗',
    warn: '⚠',
  };

  const statusColor = {
    pass: '\x1b[32m', // green
    fail: '\x1b[31m', // red
    warn: '\x1b[33m', // yellow
  };

  const reset = '\x1b[0m';

  // Group by category
  const categories: Record<string, HealthCheckResult[]> = {};
  for (const check of report.checks) {
    const category = check.name.split(':')[0];
    if (!categories[category]) categories[category] = [];
    categories[category].push(check);
  }

  for (const [category, checks] of Object.entries(categories)) {
    lines.push(`  ${category.toUpperCase()}`);
    lines.push(`  ${'─'.repeat(50)}`);

    for (const check of checks) {
      const icon = statusIcon[check.status];
      const color = statusColor[check.status];
      const name = check.name.split(':')[1];
      lines.push(`  ${color}${icon}${reset} ${name.padEnd(25)} ${check.message}`);
    }
    lines.push('');
  }

  // Summary
  const passCount = report.checks.filter(c => c.status === 'pass').length;
  const failCount = report.checks.filter(c => c.status === 'fail').length;
  const warnCount = report.checks.filter(c => c.status === 'warn').length;

  lines.push('═══════════════════════════════════════════════════════════');

  const overallColor = report.overall === 'healthy' ? '\x1b[32m' :
                       report.overall === 'degraded' ? '\x1b[33m' : '\x1b[31m';

  lines.push(`  Status: ${overallColor}${report.overall.toUpperCase()}${reset}`);
  lines.push(`  Passed: ${passCount}  Warnings: ${warnCount}  Failed: ${failCount}`);
  lines.push(`  Can Start: ${report.canStart ? 'YES' : 'NO'}`);
  lines.push('═══════════════════════════════════════════════════════════');
  lines.push('');

  return lines.join('\n');
}

/**
 * Run health check and exit if critical
 */
export async function healthCheckOrDie(): Promise<void> {
  const report = await runHealthChecks();
  console.log(formatHealthReport(report));

  if (!report.canStart) {
    console.error('\n❌ Critical health check failures. Cannot start.\n');
    process.exit(1);
  }

  if (report.overall === 'degraded') {
    console.warn('\n⚠️  Starting with degraded functionality.\n');
  }
}
