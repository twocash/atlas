/**
 * Test: Verify notion_append actually writes content to a Notion page
 *
 * This test:
 * 1. Creates a test page in Feed 2.0
 * 2. Appends analysis content using notion_append
 * 3. Fetches the page and verifies content appears
 * 4. Cleans up by archiving the test page
 *
 * Run: bun run scripts/test-notion-append.ts
 */

import { config } from 'dotenv';
config({ override: true });

const FEED_DATABASE_ID = '90b2b33f-4b44-4b42-870f-8d62fb8cbf18';

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║     NOTION APPEND INTEGRATION TEST                           ║');
  console.log('║     Creates page → appends content → verifies → cleans up    ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  const { Client } = await import('@notionhq/client');
  const notion = new Client({ auth: process.env.NOTION_API_KEY });

  let testPageId: string | null = null;

  try {
    // Step 1: Create a test page
    console.log('📋 Step 1: Creating test page in Feed 2.0...');
    const createResponse = await notion.pages.create({
      parent: { database_id: FEED_DATABASE_ID },
      properties: {
        'Entry': {
          title: [{ text: { content: `[TEST] Notion Append Test ${new Date().toISOString()}` } }],
        },
        'Pillar': { select: { name: 'The Grove' } },
        'Status': { select: { name: 'Test' } },
        'Source': { select: { name: 'Test Script' } },
      },
    });

    testPageId = createResponse.id;
    console.log(`   ✅ Test page created: ${testPageId}\n`);

    // Step 2: Import and use the actual notion_append function
    console.log('📋 Step 2: Appending analysis content...');
    const { executeTool } = await import('../src/conversation/tools');

    const analysisContent = `# Threads Post Analysis

## **Author**
testuser - Test content creator

## **Main Message**
This is a test of the notion_append function to verify content is written correctly to Notion pages. The markdown should be converted to proper Notion blocks.

## **Key Insights**
- First insight: The parsing should work
- Second insight: Bullets should appear as bullets
- Third insight: Headings should be headings

## **Suggested Actions**
1. Verify this appears correctly
2. Check the formatting
3. Confirm the fix works`;

    const appendResult = await executeTool('notion_append', {
      pageId: testPageId,
      heading: '🧵 Test Analysis',
      callout: 'Pillar: The Grove | Depth: deep | Method: Test',
      calloutEmoji: '📋',
      content: analysisContent,
    });

    console.log(`   Append result: ${appendResult.success ? '✅ SUCCESS' : '❌ FAILED'}`);
    if (!appendResult.success) {
      console.log(`   Error: ${appendResult.error}`);
    } else {
      console.log(`   Blocks added: ${(appendResult.result as any)?.blocksAdded || 'unknown'}`);
    }
    console.log('');

    // Step 3: Fetch and verify content
    console.log('📋 Step 3: Fetching page to verify content...');
    const blocks = await notion.blocks.children.list({ block_id: testPageId });

    console.log(`   Total blocks on page: ${blocks.results.length}`);

    // Check for expected block types
    const blockTypes = blocks.results.map((b: any) => b.type);
    console.log(`   Block types: ${blockTypes.join(', ')}`);

    const hasHeading = blockTypes.some(t => t.includes('heading'));
    const hasBullets = blockTypes.includes('bulleted_list_item');
    const hasNumbered = blockTypes.includes('numbered_list_item');
    const hasCallout = blockTypes.includes('callout');

    console.log(`\n   Content verification:`);
    console.log(`   - Has headings: ${hasHeading ? '✅' : '❌'}`);
    console.log(`   - Has bullets: ${hasBullets ? '✅' : '❌'}`);
    console.log(`   - Has numbered list: ${hasNumbered ? '✅' : '❌'}`);
    console.log(`   - Has callout: ${hasCallout ? '✅' : '❌'}`);

    // Show first few blocks
    console.log(`\n   First 5 blocks:`);
    for (let i = 0; i < Math.min(5, blocks.results.length); i++) {
      const block = blocks.results[i] as any;
      const text = block[block.type]?.rich_text?.[0]?.text?.content || '';
      console.log(`   ${i + 1}. [${block.type}] ${text.substring(0, 50)}...`);
    }

    const success = hasHeading && hasBullets && hasNumbered && hasCallout;

    console.log('\n' + '═'.repeat(60));
    console.log(`RESULT: ${success ? '✅ PASS - Content properly formatted' : '❌ FAIL - Missing expected content'}`);
    console.log('═'.repeat(60));

    // Step 4: Cleanup
    console.log('\n📋 Step 4: Cleaning up (archiving test page)...');
    await notion.pages.update({
      page_id: testPageId,
      archived: true,
    });
    console.log('   ✅ Test page archived');

    process.exit(success ? 0 : 1);

  } catch (error) {
    console.error('\n❌ Test failed with error:', error);

    // Cleanup on error
    if (testPageId) {
      try {
        await notion.pages.update({ page_id: testPageId, archived: true });
        console.log('   Test page archived');
      } catch {
        // Ignore cleanup errors
      }
    }

    process.exit(1);
  }
}

main();
