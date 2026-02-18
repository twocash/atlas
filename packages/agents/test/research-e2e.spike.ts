/**
 * Spike Test: Research → Notion Page Body
 *
 * Verifies the complete flow:
 * 1. Create Work Queue item (Status=Triaged, Type=Research)
 * 2. Execute research via Gemini
 * 3. Write results to page body as Notion blocks
 * 4. Verify blocks exist in page
 *
 * This is an INTEGRATION test that hits real APIs.
 * Run with: bun packages/agents/test/research-e2e.spike.ts
 *
 * Environment required:
 *   NOTION_API_KEY - Notion integration token
 *   GEMINI_API_KEY - Google AI API key
 */

import { Client } from '@notionhq/client';
import { NOTION_DB } from '@atlas/shared/config';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Load env from apps/telegram/.env
const envPath = resolve(__dirname, '../../../apps/telegram/.env');
try {
  const envContent = readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex > 0) {
        const key = trimmed.substring(0, eqIndex);
        let value = trimmed.substring(eqIndex + 1);
        // Remove quotes if present
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        process.env[key] = value;
      }
    }
  }
} catch (e) {
  console.error(`Warning: Could not load ${envPath}`);
}

// ==========================================
// Test Configuration
// ==========================================

const TEST_QUERY = 'What are the key features of Bun 1.2 runtime?';
const TEST_DEPTH = 'light' as const; // Use light for faster tests
const WORK_QUEUE_DB_ID = NOTION_DB.WORK_QUEUE;

// ==========================================
// Test Runner
// ==========================================

interface TestResult {
  name: string;
  passed: boolean;
  message: string;
  duration?: number;
}

const results: TestResult[] = [];

function logTest(name: string, passed: boolean, message: string, duration?: number) {
  results.push({ name, passed, message, duration });
  const icon = passed ? '✅' : '❌';
  const durationStr = duration ? ` (${(duration / 1000).toFixed(1)}s)` : '';
  console.log(`${icon} ${name}${durationStr}`);
  if (!passed) {
    console.log(`   ${message}`);
  }
}

// ==========================================
// Test Cases
// ==========================================

async function testEnvironment(): Promise<boolean> {
  const start = Date.now();
  const hasNotion = !!process.env.NOTION_API_KEY;
  const hasGemini = !!process.env.GEMINI_API_KEY;

  if (!hasNotion || !hasGemini) {
    logTest('Environment', false, `Missing: ${!hasNotion ? 'NOTION_API_KEY ' : ''}${!hasGemini ? 'GEMINI_API_KEY' : ''}`, Date.now() - start);
    return false;
  }

  logTest('Environment', true, 'All required env vars present', Date.now() - start);
  return true;
}

async function testNotionConnection(): Promise<boolean> {
  const start = Date.now();
  try {
    const notion = new Client({ auth: process.env.NOTION_API_KEY });
    await notion.databases.retrieve({ database_id: WORK_QUEUE_DB_ID });
    logTest('Notion Connection', true, 'Work Queue 2.0 accessible', Date.now() - start);
    return true;
  } catch (error: any) {
    logTest('Notion Connection', false, `Failed: ${error?.message || error}`, Date.now() - start);
    return false;
  }
}

async function testCreateWorkItem(): Promise<{ pageId: string; url: string } | null> {
  const start = Date.now();
  try {
    const { createResearchWorkItem } = await import('../src/workqueue');
    const result = await createResearchWorkItem({
      query: `[SPIKE TEST] ${TEST_QUERY}`,
      depth: TEST_DEPTH,
    });
    logTest('Create Work Item', true, `Page: ${result.pageId.substring(0, 8)}...`, Date.now() - start);
    return result;
  } catch (error: any) {
    logTest('Create Work Item', false, `Failed: ${error?.message || error}`, Date.now() - start);
    return null;
  }
}

async function testResearchExecution(pageId: string): Promise<any> {
  const start = Date.now();
  try {
    const { executeResearch } = await import('../src/agents/research');
    const { AgentRegistry } = await import('../src/registry');

    const registry = new AgentRegistry();
    const agent = await registry.spawn({
      type: 'research',
      name: `Spike Test: ${TEST_QUERY.substring(0, 20)}`,
      instructions: JSON.stringify({ query: TEST_QUERY, depth: TEST_DEPTH }),
      priority: 'P2',
      workItemId: pageId,
    });

    await registry.start(agent.id);

    const result = await executeResearch(
      { query: TEST_QUERY, depth: TEST_DEPTH },
      agent,
      registry
    );

    if (result.success) {
      const output = result.output as any;
      const summaryLen = output?.summary?.length || 0;
      const findingsCount = output?.findings?.length || 0;

      if (summaryLen > 50) {
        logTest('Research Execution', true, `${summaryLen} char summary, ${findingsCount} findings`, Date.now() - start);
        return { agent, result };
      } else {
        logTest('Research Execution', false, `Summary too short: ${summaryLen} chars`, Date.now() - start);
        return null;
      }
    } else {
      logTest('Research Execution', false, `Failed: ${result.summary}`, Date.now() - start);
      return null;
    }
  } catch (error: any) {
    logTest('Research Execution', false, `Error: ${error?.message || error}`, Date.now() - start);
    return null;
  }
}

async function testWriteToPage(pageId: string, agent: any, result: any): Promise<boolean> {
  const start = Date.now();
  try {
    const { syncAgentComplete } = await import('../src/workqueue');
    await syncAgentComplete(pageId, agent, result);
    logTest('Write to Page Body', true, 'syncAgentComplete succeeded', Date.now() - start);
    return true;
  } catch (error: any) {
    logTest('Write to Page Body', false, `Failed: ${error?.message || error}`, Date.now() - start);
    return false;
  }
}

async function testVerifyBlocks(pageId: string): Promise<boolean> {
  const start = Date.now();
  try {
    const notion = new Client({ auth: process.env.NOTION_API_KEY });
    const blocks = await notion.blocks.children.list({ block_id: pageId });

    const blockTypes: Record<string, number> = {};
    for (const block of blocks.results as any[]) {
      const type = block.type || 'unknown';
      blockTypes[type] = (blockTypes[type] || 0) + 1;
    }

    const totalBlocks = blocks.results.length;
    const hasHeading = (blockTypes['heading_2'] || 0) > 0;
    const hasCallout = (blockTypes['callout'] || 0) > 0;

    if (totalBlocks >= 3 && hasHeading && hasCallout) {
      logTest('Verify Blocks', true, `${totalBlocks} blocks: ${JSON.stringify(blockTypes)}`, Date.now() - start);
      return true;
    } else {
      logTest('Verify Blocks', false, `Only ${totalBlocks} blocks, types: ${JSON.stringify(blockTypes)}`, Date.now() - start);
      return false;
    }
  } catch (error: any) {
    logTest('Verify Blocks', false, `Failed: ${error?.message || error}`, Date.now() - start);
    return false;
  }
}

async function testCleanup(pageId: string): Promise<void> {
  // Note: We don't delete the page - it serves as evidence of the test run
  // The page will have "[SPIKE TEST]" prefix for easy identification
  console.log(`\n📋 Test page: https://notion.so/${pageId.replace(/-/g, '')}`);
}

// ==========================================
// Main Test Runner
// ==========================================

async function runAllTests() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║     SPIKE TEST: Research → Notion Page Body (E2E)            ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`Query: "${TEST_QUERY}"`);
  console.log(`Depth: ${TEST_DEPTH}`);
  console.log('');
  console.log('─'.repeat(60));
  console.log('');

  const startTime = Date.now();

  // Pre-flight checks
  if (!await testEnvironment()) {
    console.log('\n❌ Pre-flight failed. Set required environment variables.');
    process.exit(1);
  }

  if (!await testNotionConnection()) {
    console.log('\n❌ Pre-flight failed. Check Notion API key and database sharing.');
    process.exit(1);
  }

  console.log('');

  // Main test flow
  const workItem = await testCreateWorkItem();
  if (!workItem) {
    console.log('\n❌ Cannot proceed without Work Queue item.');
    process.exit(1);
  }

  const researchResult = await testResearchExecution(workItem.pageId);
  if (!researchResult) {
    console.log('\n❌ Research failed. Check Gemini API key.');
    process.exit(1);
  }

  const writeSuccess = await testWriteToPage(workItem.pageId, researchResult.agent, researchResult.result);

  // Give Notion a moment to process
  await new Promise(r => setTimeout(r, 1000));

  const blocksVerified = await testVerifyBlocks(workItem.pageId);

  await testCleanup(workItem.pageId);

  // Summary
  console.log('');
  console.log('─'.repeat(60));
  console.log('');

  const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1);
  const passed = results.filter(r => r.passed).length;
  const total = results.length;

  if (passed === total) {
    console.log(`✅ ALL TESTS PASSED (${passed}/${total}) in ${totalDuration}s`);
    console.log('');
    console.log('Research → Notion page body flow is working correctly.');
    process.exit(0);
  } else {
    console.log(`❌ TESTS FAILED (${passed}/${total}) in ${totalDuration}s`);
    console.log('');
    console.log('Failed tests:');
    for (const r of results.filter(r => !r.passed)) {
      console.log(`  - ${r.name}: ${r.message}`);
    }
    process.exit(1);
  }
}

// Run tests
runAllTests().catch((error) => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
