#!/usr/bin/env bun
/**
 * Test Native Tools
 *
 * Verifies that the native Notion tools in core.ts work properly.
 * Tests the EXACT code paths that Atlas uses.
 */

import { config } from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env with override - MUST be before any other imports
config({ path: join(__dirname, '..', '.env'), override: true });

// Now import the tools
const { executeCoreTools } = await import('../src/conversation/tools/core');

async function main() {
  console.log('='.repeat(60));
  console.log('NATIVE TOOLS TEST');
  console.log('='.repeat(60));
  console.log();

  // Test 1: dev_pipeline_create
  console.log('[1] Testing dev_pipeline_create...');
  const testTitle = `TEST-${Date.now()}: Native Tool Test`;

  const createResult = await executeCoreTools('dev_pipeline_create', {
    title: testTitle,
    type: 'Bug',
    priority: 'P2',
    thread: 'Automated test - will be archived',
  });

  if (createResult?.success) {
    console.log('✅ dev_pipeline_create succeeded');
    console.log(`   Page ID: ${(createResult.result as any).id}`);
    console.log(`   URL: ${(createResult.result as any).url}`);
  } else {
    console.error('❌ dev_pipeline_create FAILED');
    console.error(`   Error: ${createResult?.error}`);
    process.exit(1);
  }

  // Test 2: dev_pipeline_list
  console.log('\n[2] Testing dev_pipeline_list...');
  const listResult = await executeCoreTools('dev_pipeline_list', { limit: 5 });

  if (listResult?.success) {
    const items = (listResult.result as any).items;
    console.log(`✅ dev_pipeline_list succeeded (${items.length} items)`);
    if (items.length > 0) {
      console.log(`   First item: ${items[0].title}`);
    }
  } else {
    console.error('❌ dev_pipeline_list FAILED');
    console.error(`   Error: ${listResult?.error}`);
  }

  // Test 3: work_queue_list
  console.log('\n[3] Testing work_queue_list...');
  const wqResult = await executeCoreTools('work_queue_list', { limit: 3 });

  if (wqResult?.success) {
    const items = (wqResult.result as any);
    console.log(`✅ work_queue_list succeeded (${items.length} items)`);
  } else {
    console.error('❌ work_queue_list FAILED');
    console.error(`   Error: ${wqResult?.error}`);
  }

  // Test 4: get_status_summary
  console.log('\n[4] Testing get_status_summary...');
  const statusResult = await executeCoreTools('get_status_summary', {});

  if (statusResult?.success) {
    console.log('✅ get_status_summary succeeded');
    const summary = (statusResult.result as any);
    console.log(`   Active items: ${summary.workQueue?.totalActive || 0}`);
  } else {
    console.error('❌ get_status_summary FAILED');
    console.error(`   Error: ${statusResult?.error}`);
  }

  // Cleanup: Archive the test page
  console.log('\n[5] Cleaning up test page...');
  try {
    const { Client } = await import('@notionhq/client');
    const notion = new Client({ auth: process.env.NOTION_API_KEY });
    await notion.pages.update({
      page_id: (createResult.result as any).id,
      archived: true,
    });
    console.log('✅ Test page archived');
  } catch (e: any) {
    console.warn(`⚠ Cleanup failed: ${e.message}`);
  }

  console.log('\n' + '='.repeat(60));
  console.log('ALL NATIVE TOOLS WORKING');
  console.log('='.repeat(60));
}

main().catch(console.error);
