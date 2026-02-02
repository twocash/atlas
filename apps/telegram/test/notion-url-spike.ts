/**
 * Spike Test: Notion URL Intelligence
 *
 * Tests the Notion URL detection and lookup functionality.
 *
 * Run: bun run spike test/notion-url-spike.ts
 */

import { Client } from '@notionhq/client';

// Verify environment is loaded
if (!process.env.NOTION_API_KEY) {
  console.error('❌ NOTION_API_KEY not set. Load .env first.');
  process.exit(1);
}

// Import after env check
import {
  isNotionUrl,
  extractPageId,
  lookupNotionPage,
  formatNotionPreview,
  buildNotionKeyboard,
  generateNotionRequestId,
} from '../src/conversation/notion-url';

// Test URLs (use real ones from your workspace)
const TEST_URLS = {
  // Work Queue item (replace with a real one from your workspace)
  workQueue: 'https://www.notion.so/SPIKE-TEST-Minimal-Entry-2fb780a78eef8106a259d5637cefaf7f',
  // Feed item (replace with a real one)
  feed: 'https://www.notion.so/SPIKE-TEST-Classify-First-Flow-Test-2fb780a78eef812291fbe95ea3589734',
  // Invalid URL
  invalid: 'https://google.com/search?q=test',
  // Notion URL with different format
  notionAlt: 'https://notion.so/Some-Page-abc123def456789012345678901234ab',
};

async function main() {
  console.log('=== NOTION URL INTELLIGENCE SPIKE TEST ===\n');

  // Test 1: URL Detection
  console.log('1. Testing URL detection...');
  console.log(`   notion.so URL: ${isNotionUrl(TEST_URLS.workQueue) ? '✅' : '❌'} isNotionUrl`);
  console.log(`   google.com URL: ${!isNotionUrl(TEST_URLS.invalid) ? '✅' : '❌'} NOT isNotionUrl`);

  // Test 2: Page ID Extraction
  console.log('\n2. Testing page ID extraction...');
  const pageId = extractPageId(TEST_URLS.workQueue);
  console.log(`   URL: ${TEST_URLS.workQueue.substring(0, 60)}...`);
  console.log(`   Extracted ID: ${pageId || 'FAILED'}`);
  if (pageId) {
    console.log(`   ✅ Page ID extracted successfully`);
  } else {
    console.log(`   ❌ Failed to extract page ID`);
  }

  // Test 3: Work Queue Lookup
  console.log('\n3. Testing Work Queue item lookup...');
  try {
    const wqInfo = await lookupNotionPage(TEST_URLS.workQueue);
    if (wqInfo) {
      console.log(`   ✅ Found Work Queue item!`);
      console.log(`      Type: ${wqInfo.type}`);
      console.log(`      Title: ${wqInfo.title}`);
      console.log(`      Status: ${wqInfo.status || 'N/A'}`);
      console.log(`      Pillar: ${wqInfo.pillar || 'N/A'}`);
      console.log(`      Content length: ${wqInfo.content?.length || 0} chars`);

      // Test preview formatting
      console.log('\n   Preview:');
      const preview = formatNotionPreview(wqInfo);
      console.log('   ' + preview.split('\n').join('\n   '));

      // Test keyboard building
      const requestId = generateNotionRequestId();
      const keyboard = buildNotionKeyboard(requestId, wqInfo);
      console.log(`\n   ✅ Keyboard built with ${keyboard.inline_keyboard.length} rows`);
    } else {
      console.log(`   ❌ Work Queue lookup returned null`);
    }
  } catch (error: any) {
    console.log(`   ❌ Work Queue lookup failed: ${error.message}`);
  }

  // Test 4: Feed Item Lookup
  console.log('\n4. Testing Feed item lookup...');
  try {
    const feedInfo = await lookupNotionPage(TEST_URLS.feed);
    if (feedInfo) {
      console.log(`   ✅ Found Feed item!`);
      console.log(`      Type: ${feedInfo.type}`);
      console.log(`      Title: ${feedInfo.title}`);
      console.log(`      Pillar: ${feedInfo.pillar || 'N/A'}`);
      console.log(`      Author: ${feedInfo.author || 'N/A'}`);
    } else {
      console.log(`   ❌ Feed lookup returned null`);
    }
  } catch (error: any) {
    console.log(`   ❌ Feed lookup failed: ${error.message}`);
  }

  // Test 5: Page ID extraction edge cases
  console.log('\n5. Testing page ID extraction edge cases...');
  const edgeCases = [
    'https://www.notion.so/Page-Title-abc123def456789012345678901234ab',
    'https://notion.so/workspace/Page-abc123def456789012345678901234ab',
    'https://www.notion.so/2fb780a7-8eef-8106-a259-d5637cefaf7f',
  ];

  for (const url of edgeCases) {
    const id = extractPageId(url);
    console.log(`   ${url.substring(20, 60)}... → ${id ? id.substring(0, 20) + '...' : 'FAILED'}`);
  }

  // Test 6: Context injection format
  console.log('\n6. Testing context injection format...');
  const { getPageContentForContext } = await import('../src/conversation/notion-url');
  const wqInfo = await lookupNotionPage(TEST_URLS.workQueue);
  if (wqInfo) {
    const context = getPageContentForContext(wqInfo);
    console.log('   Context for injection:');
    console.log('   ' + context.split('\n').slice(0, 5).join('\n   ') + '\n   ...');
    console.log(`   ✅ Context generated (${context.length} chars)`);
  }

  console.log('\n=== SPIKE TEST COMPLETE ===');
}

main().catch(console.error);
