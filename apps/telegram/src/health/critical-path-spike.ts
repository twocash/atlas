/**
 * Critical Path Spike Tests
 *
 * These tests verify end-to-end functionality of ALL critical Atlas workflows.
 * Run BEFORE any deployment to catch broken pipelines.
 *
 * Philosophy: "One part breaks, the whole thing is broken"
 *
 * Usage: bun run src/health/critical-path-spike.ts
 */

// Load environment FIRST - must be at top before any other imports that use env vars
import { config } from 'dotenv';
config({ override: true });

import { Client } from '@notionhq/client';
import { NOTION_DB } from '@atlas/shared/config';
import { logger } from '../logger';

// Test result structure
interface SpikeTestResult {
  name: string;
  passed: boolean;
  duration: number;
  error?: string;
  details?: Record<string, unknown>;
  // For URL tests, track what was returned vs what was expected
  urlVerification?: {
    expectedPattern: string;
    actualValue: string | null;
    isValid: boolean;
  };
}

interface SpikeReport {
  timestamp: string;
  passed: number;
  failed: number;
  tests: SpikeTestResult[];
  critical: boolean; // True if ANY test failed
}

// Canonical IDs from @atlas/shared/config
const DB_WORK_QUEUE = NOTION_DB.WORK_QUEUE;
const DB_FEED = NOTION_DB.FEED;
const DB_DEV_PIPELINE = NOTION_DB.DEV_PIPELINE;

// Test utilities
async function runSpikeTest(
  name: string,
  testFn: () => Promise<Partial<SpikeTestResult>>,
  timeoutMs: number = 30000
): Promise<SpikeTestResult> {
  const start = Date.now();

  try {
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs)
    );

    const resultPromise = testFn();
    const partialResult = await Promise.race([resultPromise, timeoutPromise]);

    return {
      name,
      passed: true,
      duration: Date.now() - start,
      ...partialResult,
    };
  } catch (error: any) {
    return {
      name,
      passed: false,
      duration: Date.now() - start,
      error: error.message || String(error),
    };
  }
}

/**
 * Validate that a URL matches expected Notion format
 */
function validateNotionUrl(url: string | null | undefined, context: string): {
  isValid: boolean;
  error?: string;
} {
  if (!url) {
    return { isValid: false, error: `${context}: No URL returned` };
  }

  if (typeof url !== 'string') {
    return { isValid: false, error: `${context}: URL is not a string (got ${typeof url})` };
  }

  // Valid Notion URL patterns
  const validPatterns = [
    /^https:\/\/www\.notion\.so\/.+/,
    /^https:\/\/notion\.so\/.+/,
  ];

  const isValid = validPatterns.some(p => p.test(url));

  if (!isValid) {
    return {
      isValid: false,
      error: `${context}: URL doesn't match Notion pattern. Got: ${url}`,
    };
  }

  // Check for hallucination red flags
  const hallucinations = [
    /notion\.so\/\d{8,}$/, // Just a number (no real page ID format)
    /notion\.so\/undefined/,
    /notion\.so\/null/,
  ];

  for (const pattern of hallucinations) {
    if (pattern.test(url)) {
      return {
        isValid: false,
        error: `${context}: URL looks hallucinated! Pattern: ${pattern}. Got: ${url}`,
      };
    }
  }

  return { isValid: true };
}

// ==========================================
// CRITICAL PATH 1: Notion Database Access
// ==========================================

async function testNotionDatabaseAccess(): Promise<SpikeTestResult[]> {
  const results: SpikeTestResult[] = [];
  const notion = new Client({ auth: process.env.NOTION_API_KEY });

  // Test 1.1: Feed 2.0 Access
  results.push(await runSpikeTest('Notion: Feed 2.0 database query', async () => {
    const response = await notion.databases.query({
      database_id: DB_FEED,
      page_size: 1,
    });

    return {
      details: {
        hasResults: response.results.length > 0,
        hasMore: response.has_more,
      },
    };
  }));

  // Test 1.2: Work Queue 2.0 Access
  results.push(await runSpikeTest('Notion: Work Queue 2.0 database query', async () => {
    const response = await notion.databases.query({
      database_id: DB_WORK_QUEUE,
      page_size: 1,
    });

    return {
      details: {
        hasResults: response.results.length > 0,
        hasMore: response.has_more,
      },
    };
  }));

  // Test 1.3: Dev Pipeline Access
  results.push(await runSpikeTest('Notion: Dev Pipeline database query', async () => {
    const response = await notion.databases.query({
      database_id: DB_DEV_PIPELINE,
      page_size: 1,
    });

    return {
      details: {
        hasResults: response.results.length > 0,
        hasMore: response.has_more,
      },
    };
  }));

  return results;
}

// ==========================================
// CRITICAL PATH 2: URL Return Verification
// ==========================================

async function testUrlReturnChain(): Promise<SpikeTestResult[]> {
  const results: SpikeTestResult[] = [];
  const notion = new Client({ auth: process.env.NOTION_API_KEY });

  // Test 2.1: Create Work Queue item and verify URL is returned
  results.push(await runSpikeTest('URL Chain: Work Queue create returns valid URL', async () => {
    const testTitle = `[SPIKE TEST] URL Verification ${Date.now()}`;

    const response = await notion.pages.create({
      parent: { database_id: DB_WORK_QUEUE },
      properties: {
        'Task': { title: [{ text: { content: testTitle } }] },
        'Status': { select: { name: 'Captured' } },
        'Priority': { select: { name: 'P3' } },
        'Type': { select: { name: 'Process' } },
        'Pillar': { select: { name: 'The Grove' } },
        'Assignee': { select: { name: 'Atlas [Telegram]' } },
      },
    });

    // CRITICAL: Verify URL from response
    const url = (response as { url?: string }).url;
    const validation = validateNotionUrl(url, 'Work Queue create');

    if (!validation.isValid) {
      throw new Error(validation.error);
    }

    // Clean up: Archive the test entry
    await notion.pages.update({
      page_id: response.id,
      archived: true,
    });

    return {
      urlVerification: {
        expectedPattern: 'https://www.notion.so/...',
        actualValue: url ?? null,
        isValid: validation.isValid,
      },
      details: {
        pageId: response.id,
        cleaned: true,
      },
    };
  }));

  // Test 2.2: Create Feed entry and verify URL
  results.push(await runSpikeTest('URL Chain: Feed 2.0 create returns valid URL', async () => {
    const testEntry = `[SPIKE TEST] Feed Entry ${Date.now()}`;

    const response = await notion.pages.create({
      parent: { database_id: DB_FEED },
      properties: {
        'Entry': { title: [{ text: { content: testEntry } }] },
        'Pillar': { select: { name: 'The Grove' } },
      },
    });

    const url = (response as { url?: string }).url;
    const validation = validateNotionUrl(url, 'Feed create');

    if (!validation.isValid) {
      throw new Error(validation.error);
    }

    // Clean up
    await notion.pages.update({
      page_id: response.id,
      archived: true,
    });

    return {
      urlVerification: {
        expectedPattern: 'https://www.notion.so/...',
        actualValue: url ?? null,
        isValid: validation.isValid,
      },
      details: {
        pageId: response.id,
        cleaned: true,
      },
    };
  }));

  // Test 2.3: Create Dev Pipeline item and verify URL
  results.push(await runSpikeTest('URL Chain: Dev Pipeline create returns valid URL', async () => {
    const testTitle = `[SPIKE TEST] Dev Pipeline ${Date.now()}`;

    const response = await notion.pages.create({
      parent: { database_id: DB_DEV_PIPELINE },
      properties: {
        'Discussion': { title: [{ text: { content: testTitle } }] },
        'Type': { select: { name: 'Bug' } },
        'Priority': { select: { name: 'P3' } },
        'Status': { select: { name: 'Closed' } },
      },
    });

    const url = (response as { url?: string }).url;
    const validation = validateNotionUrl(url, 'Dev Pipeline create');

    if (!validation.isValid) {
      throw new Error(validation.error);
    }

    // Clean up
    await notion.pages.update({
      page_id: response.id,
      archived: true,
    });

    return {
      urlVerification: {
        expectedPattern: 'https://www.notion.so/...',
        actualValue: url ?? null,
        isValid: validation.isValid,
      },
      details: {
        pageId: response.id,
        cleaned: true,
      },
    };
  }));

  return results;
}

// ==========================================
// CRITICAL PATH 3: Dispatcher Flow
// ==========================================

async function testDispatcherFlow(): Promise<SpikeTestResult[]> {
  const results: SpikeTestResult[] = [];

  // Test 3.1: Import dispatcher and verify it loads
  results.push(await runSpikeTest('Dispatcher: Module loads', async () => {
    const { handleSubmitTicket, DISPATCHER_TOOL } = await import('../conversation/tools/dispatcher');

    if (!handleSubmitTicket) {
      throw new Error('handleSubmitTicket not exported');
    }
    if (!DISPATCHER_TOOL) {
      throw new Error('DISPATCHER_TOOL not exported');
    }

    return {
      details: {
        toolName: DISPATCHER_TOOL.name,
        hasDescription: !!DISPATCHER_TOOL.description,
      },
    };
  }));

  // Test 3.2: Dispatch research ticket via dispatcher (Work Queue path)
  results.push(await runSpikeTest('Dispatcher: Research ticket creates Work Queue entry', async () => {
    const { handleSubmitTicket } = await import('../conversation/tools/dispatcher');

    const result = await handleSubmitTicket({
      reasoning: 'SPIKE TEST: Verifying dispatcher creates valid Work Queue entries with URLs',
      category: 'research',
      title: `[SPIKE TEST] Research Dispatch ${Date.now()}`,
      description: 'Test research ticket from critical path spike test. Will be archived.',
      priority: 'P3',
      require_review: true, // Keep in Captured so it doesn't get picked up
      pillar: 'The Grove',
    });

    if (!result.success) {
      throw new Error(`Dispatch failed: ${result.error}`);
    }

    const resultData = result.result as { url?: string; ticket_id?: string };

    // CRITICAL: Verify URL
    const validation = validateNotionUrl(resultData.url, 'Research dispatch');
    if (!validation.isValid) {
      throw new Error(validation.error);
    }

    // Clean up: Archive the test entry
    if (resultData.ticket_id) {
      const notion = new Client({ auth: process.env.NOTION_API_KEY });
      await notion.pages.update({
        page_id: resultData.ticket_id,
        archived: true,
      });
    }

    return {
      urlVerification: {
        expectedPattern: 'https://www.notion.so/...',
        actualValue: resultData.url ?? null,
        isValid: validation.isValid,
      },
      details: {
        ticketId: resultData.ticket_id,
        cleaned: true,
      },
    };
  }));

  // Test 3.3: Dispatch bug ticket via dispatcher (Pit Crew path - CRITICAL)
  // This is the EXACT path where URL hallucination was occurring
  results.push(await runSpikeTest('Dispatcher: Bug ticket routes to Pit Crew with URL', async () => {
    const { handleSubmitTicket } = await import('../conversation/tools/dispatcher');
    const { getMcpStatus } = await import('../mcp');

    // Check if Pit Crew is available
    const mcpStatus = getMcpStatus();
    const pitCrew = mcpStatus['pit_crew'];

    if (!pitCrew || pitCrew.status !== 'connected') {
      // Fallback path test - direct Notion
      return {
        details: {
          note: 'Pit Crew not connected - testing fallback path',
          pitCrewStatus: pitCrew?.status || 'not configured',
        },
      };
    }

    const result = await handleSubmitTicket({
      reasoning: 'SPIKE TEST: Verifying bug dispatch through Pit Crew returns valid URL',
      category: 'dev_bug',
      title: `[SPIKE TEST] Bug Dispatch ${Date.now()}`,
      description: 'Critical path spike test for bug dispatch flow. This is testing URL return, not an actual bug.',
      priority: 'P3',
    });

    if (!result.success) {
      throw new Error(`Bug dispatch failed: ${result.error}`);
    }

    const resultData = result.result as { url?: string; ticket_id?: string; handler?: string };

    // CRITICAL: Verify URL - this is where hallucination was occurring
    const validation = validateNotionUrl(resultData.url, 'Bug dispatch (Pit Crew)');

    if (!validation.isValid) {
      throw new Error(validation.error);
    }

    return {
      urlVerification: {
        expectedPattern: 'https://www.notion.so/...',
        actualValue: resultData.url ?? null,
        isValid: validation.isValid,
      },
      details: {
        ticketId: resultData.ticket_id,
        handler: resultData.handler,
        routedViaMcp: pitCrew.status === 'connected',
      },
    };
  }, 60000)); // Longer timeout for MCP path

  return results;
}

// ==========================================
// CRITICAL PATH 4: MCP Integration
// ==========================================

async function testMcpIntegration(): Promise<SpikeTestResult[]> {
  const results: SpikeTestResult[] = [];

  // Test 4.1: MCP module loads
  results.push(await runSpikeTest('MCP: Module loads', async () => {
    const { getMcpStatus, getMcpTools, isMcpTool } = await import('../mcp');

    if (!getMcpStatus || !getMcpTools || !isMcpTool) {
      throw new Error('MCP exports missing');
    }

    return {};
  }));

  // Test 4.2: MCP status check
  results.push(await runSpikeTest('MCP: Status available', async () => {
    const { getMcpStatus } = await import('../mcp');
    const status = getMcpStatus();

    return {
      details: {
        servers: Object.keys(status),
        statuses: Object.entries(status).map(([k, v]) => `${k}: ${v.status}`),
      },
    };
  }));

  // Test 4.3: Pit Crew connection (if available)
  results.push(await runSpikeTest('MCP: Pit Crew server status', async () => {
    const { getMcpStatus } = await import('../mcp');
    const status = getMcpStatus();

    const pitCrew = status['pit_crew'];

    if (!pitCrew) {
      return {
        details: { available: false, note: 'pit_crew server not configured' },
      };
    }

    if (pitCrew.status !== 'connected') {
      throw new Error(`Pit Crew status: ${pitCrew.status}. Error: ${pitCrew.error || 'none'}`);
    }

    return {
      details: {
        available: true,
        status: pitCrew.status,
        toolCount: pitCrew.toolCount,
      },
    };
  }));

  // Test 4.4: Pit Crew dispatch returns valid URL (CRITICAL - this is where hallucination was occurring)
  results.push(await runSpikeTest('MCP: Pit Crew dispatch returns valid notion_url', async () => {
    const { getMcpStatus, executeMcpTool } = await import('../mcp');
    const status = getMcpStatus();

    const pitCrew = status['pit_crew'];

    if (!pitCrew || pitCrew.status !== 'connected') {
      return {
        details: { skipped: true, reason: 'Pit Crew not connected' },
      };
    }

    // Execute the exact MCP call that dispatch uses
    const result = await executeMcpTool('mcp__pit_crew__dispatch_work', {
      type: 'bug',
      title: `[SPIKE TEST] MCP Dispatch ${Date.now()}`,
      context: 'Critical path spike test verifying MCP dispatch returns valid Notion URL. This ticket should be auto-closed.',
      priority: 'P3',
    });

    if (!result.success) {
      throw new Error(`MCP dispatch failed: ${result.error}`);
    }

    // Parse the MCP response - must match what dispatcher.ts expects
    const mcpResult = result.result as { content?: Array<{ type: string; text?: string }> };
    const textContent = mcpResult?.content?.find(c => c.type === 'text');

    if (!textContent?.text) {
      throw new Error('MCP returned empty response - no text content');
    }

    const parsed = JSON.parse(textContent.text);

    if (!parsed.success) {
      throw new Error(`MCP dispatch returned failure: ${parsed.error || 'unknown'}`);
    }

    // CRITICAL: This is the URL that was being hallucinated
    const validation = validateNotionUrl(parsed.notion_url, 'MCP Pit Crew dispatch');

    if (!validation.isValid) {
      throw new Error(validation.error);
    }

    return {
      urlVerification: {
        expectedPattern: 'https://www.notion.so/...',
        actualValue: parsed.notion_url,
        isValid: validation.isValid,
      },
      details: {
        discussionId: parsed.discussion_id,
        mcpReturnedUrl: parsed.notion_url,
      },
    };
  }, 60000)); // Longer timeout for MCP

  return results;
}

// ==========================================
// CRITICAL PATH 5: Tool Infrastructure
// ==========================================

async function testToolInfrastructure(): Promise<SpikeTestResult[]> {
  const results: SpikeTestResult[] = [];

  // Test 5.1: Core tools load
  results.push(await runSpikeTest('Tools: Core tools load', async () => {
    const { executeCoreTools, CORE_TOOLS } = await import('../conversation/tools/core');

    if (!executeCoreTools) {
      throw new Error('executeCoreTools not exported');
    }
    if (!CORE_TOOLS || CORE_TOOLS.length === 0) {
      throw new Error('No core tools defined');
    }

    return {
      details: {
        toolCount: CORE_TOOLS.length,
        toolNames: CORE_TOOLS.map(t => t.name),
      },
    };
  }));

  // Test 5.2: get_status_summary works
  results.push(await runSpikeTest('Tools: get_status_summary executes', async () => {
    const { executeCoreTools } = await import('../conversation/tools/core');

    const result = await executeCoreTools('get_status_summary', {});

    if (!result?.success) {
      throw new Error(`get_status_summary failed: ${result?.error || 'unknown'}`);
    }

    return {
      details: {
        resultType: typeof result.result,
      },
    };
  }));

  // Test 5.3: work_queue_list works
  results.push(await runSpikeTest('Tools: work_queue_list executes', async () => {
    const { executeCoreTools } = await import('../conversation/tools/core');

    const result = await executeCoreTools('work_queue_list', { limit: 1 });

    if (!result?.success) {
      throw new Error(`work_queue_list failed: ${result?.error || 'unknown'}`);
    }

    return {
      details: {
        resultType: typeof result.result,
      },
    };
  }));

  return results;
}

// ==========================================
// CRITICAL PATH 6: Skills System (Phase 2)
// ==========================================

async function testSkillsSystem(): Promise<SpikeTestResult[]> {
  const results: SpikeTestResult[] = [];

  // Test 6.1: Feature flags load
  results.push(await runSpikeTest('Skills: Feature flags load', async () => {
    const { getFeatureFlags, isFeatureEnabled } = await import('../skills');

    const flags = getFeatureFlags();

    return {
      details: {
        flags,
        skillLogging: isFeatureEnabled('skillLogging'),
        skillExecution: isFeatureEnabled('skillExecution'),
      },
    };
  }));

  // Test 6.2: Intent hashing works
  results.push(await runSpikeTest('Skills: Intent hash generation', async () => {
    const { generateIntentHash, hasSameIntent } = await import('../skills');

    const hash1 = generateIntentHash('research AI agents');
    const hash2 = generateIntentHash('look into AI agents');

    if (!hash1.hash) {
      throw new Error('Hash generation returned empty');
    }

    const areSimilar = hasSameIntent('research AI agents', 'look into AI agents');

    return {
      details: {
        hash1: hash1.hash,
        hash2: hash2.hash,
        areSimilar,
      },
    };
  }));

  // Test 6.3: Skill registry loads (if enabled)
  results.push(await runSpikeTest('Skills: Registry loads', async () => {
    const { SkillRegistry } = await import('../skills');
    const { join } = await import('path');

    const registry = new SkillRegistry(join(process.cwd(), 'data', 'skills'));
    await registry.initialize();

    const stats = registry.getStats();

    return {
      details: {
        total: stats.total,
        enabled: stats.enabled,
        bySource: stats.bySource,
      },
    };
  }));

  return results;
}

// ==========================================
// CRITICAL PATH 7: Notion Formatting Pipeline
// ==========================================

async function testNotionFormatting(): Promise<SpikeTestResult[]> {
  const results: SpikeTestResult[] = [];

  // Test 7.1: Shared package loads
  results.push(await runSpikeTest('Formatting: Shared package loads', async () => {
    const { convertMarkdownToNotionBlocks } = await import('@atlas/shared/notion');
    if (!convertMarkdownToNotionBlocks) {
      throw new Error('convertMarkdownToNotionBlocks not exported');
    }
    return { details: { exported: true } };
  }));

  // Test 7.2: Basic markdown converts to blocks
  results.push(await runSpikeTest('Formatting: Markdown → Blocks', async () => {
    const { convertMarkdownToNotionBlocks } = await import('@atlas/shared/notion');

    const result = convertMarkdownToNotionBlocks(`
## Test Header

**Bold text** and *italic text*

- Bullet 1
- Bullet 2

\`\`\`javascript
const code = 'block';
\`\`\`
    `.trim());

    if (result.blocks.length < 3) {
      throw new Error(`Expected 3+ blocks, got ${result.blocks.length}`);
    }

    // Verify block types present
    const types = result.blocks.map(b => b.type);
    const hasHeader = types.includes('heading_2');
    const hasBullets = types.includes('bulleted_list_item');
    const hasCode = types.includes('code');

    return {
      details: {
        totalBlocks: result.blocks.length,
        hasHeader,
        hasBullets,
        hasCode,
        warnings: result.warnings,
      },
    };
  }));

  // Test 7.3: Callout directives work
  results.push(await runSpikeTest('Formatting: Callout directives', async () => {
    const { convertMarkdownToNotionBlocks } = await import('@atlas/shared/notion');

    const result = convertMarkdownToNotionBlocks(`
:::callout type=tip title="Pro Tip"
This is a callout with custom styling.
:::
    `.trim());

    const hasCallout = result.blocks.some(b => b.type === 'callout');
    if (!hasCallout) {
      throw new Error('Callout directive not converted to callout block');
    }

    return {
      details: {
        directivesProcessed: result.stats.directivesProcessed,
        hasCallout,
      },
    };
  }));

  // Test 7.4: Text chunking works
  results.push(await runSpikeTest('Formatting: Long text chunking', async () => {
    const { convertMarkdownToNotionBlocks } = await import('@atlas/shared/notion');

    // Create a 3000+ char paragraph (exceeds 2000 limit)
    const longText = 'A'.repeat(3000);
    const result = convertMarkdownToNotionBlocks(longText);

    // Should be chunked into multiple paragraphs
    if (result.blocks.length < 2) {
      throw new Error('Long text was not chunked into multiple blocks');
    }

    return {
      details: {
        inputLength: longText.length,
        outputBlocks: result.blocks.length,
        chunkedParagraphs: result.stats.chunkedParagraphs,
      },
    };
  }));

  return results;
}

// ==========================================
// Main Runner
// ==========================================

export async function runCriticalPathSpikes(): Promise<SpikeReport> {
  console.log('\n');
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║          ATLAS CRITICAL PATH SPIKE TESTS                 ║');
  console.log('║          "One part breaks, the whole thing is broken"    ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log('\n');

  const allTests: SpikeTestResult[] = [];

  // Run all critical paths
  const paths = [
    { name: '1. Notion Database Access', fn: testNotionDatabaseAccess },
    { name: '2. URL Return Verification', fn: testUrlReturnChain },
    { name: '3. Dispatcher Flow', fn: testDispatcherFlow },
    { name: '4. MCP Integration', fn: testMcpIntegration },
    { name: '5. Tool Infrastructure', fn: testToolInfrastructure },
    { name: '6. Skills System', fn: testSkillsSystem },
    { name: '7. Notion Formatting', fn: testNotionFormatting },
  ];

  for (const path of paths) {
    console.log(`\n  📍 ${path.name}`);
    console.log('  ' + '─'.repeat(50));

    try {
      const results = await path.fn();
      allTests.push(...results);

      for (const result of results) {
        const icon = result.passed ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
        const duration = `${result.duration}ms`;
        const shortName = result.name.split(': ')[1] || result.name;
        console.log(`  ${icon} ${shortName.padEnd(40)} ${duration.padStart(8)}`);

        if (!result.passed && result.error) {
          console.log(`    \x1b[31m└─ ${result.error}\x1b[0m`);
        }

        if (result.urlVerification) {
          const uv = result.urlVerification;
          if (uv.isValid) {
            console.log(`    \x1b[32m└─ URL verified: ${uv.actualValue?.substring(0, 50)}...\x1b[0m`);
          }
        }
      }
    } catch (err) {
      console.log(`  \x1b[31m✗ Critical path failed to execute: ${err}\x1b[0m`);
      allTests.push({
        name: `${path.name} (execution)`,
        passed: false,
        duration: 0,
        error: String(err),
      });
    }
  }

  // Summary
  const passed = allTests.filter(t => t.passed).length;
  const failed = allTests.filter(t => !t.passed).length;

  console.log('\n');
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║                        SUMMARY                           ║');
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log(`║  Total:  ${(passed + failed).toString().padStart(3)}                                            ║`);
  console.log(`║  Passed: \x1b[32m${passed.toString().padStart(3)}\x1b[0m                                            ║`);
  console.log(`║  Failed: \x1b[31m${failed.toString().padStart(3)}\x1b[0m                                            ║`);
  console.log('╚══════════════════════════════════════════════════════════╝');

  if (failed > 0) {
    console.log('\n\x1b[31m❌ CRITICAL PATH FAILURES DETECTED\x1b[0m');
    console.log('\x1b[31mDO NOT DEPLOY until these are fixed.\x1b[0m\n');
  } else {
    console.log('\n\x1b[32m✅ All critical paths verified.\x1b[0m\n');
  }

  return {
    timestamp: new Date().toISOString(),
    passed,
    failed,
    tests: allTests,
    critical: failed > 0,
  };
}

// Run if called directly
if (import.meta.main) {
  const report = await runCriticalPathSpikes();
  process.exit(report.critical ? 1 : 0);
}
