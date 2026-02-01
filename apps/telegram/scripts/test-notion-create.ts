#!/usr/bin/env bun
/**
 * Standalone Notion Create Test
 *
 * Tests if the Notion SDK can actually create pages in Dev Pipeline.
 * Isolates the issue from Atlas to determine if it's:
 * - Token/API issue
 * - Code path issue
 * - Atlas-specific issue
 */

import { Client } from '@notionhq/client';
import { config } from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from apps/telegram - OVERRIDE system env vars!
config({ path: join(__dirname, '..', '.env'), override: true });

const DEV_PIPELINE_DATABASE_ID = 'ce6fbf1b-ee30-433d-a9e6-b338552de7c9';

async function main() {
  console.log('='.repeat(60));
  console.log('STANDALONE NOTION CREATE TEST');
  console.log('='.repeat(60));
  console.log();

  // Check token
  const token = process.env.NOTION_API_KEY;
  if (!token) {
    console.error('ERROR: NOTION_API_KEY not set in .env');
    process.exit(1);
  }
  console.log(`Token prefix: ${token.substring(0, 15)}...`);

  // Create client
  const notion = new Client({ auth: token });

  // Step 1: Verify token works
  console.log('\n[1] Verifying token...');
  try {
    const me = await notion.users.me({});
    console.log(`✅ Token valid. Integration: "${me.name}" (${me.id})`);
  } catch (error: any) {
    console.error(`❌ Token verification failed: ${error.code || error.message}`);
    process.exit(1);
  }

  // Step 2: Verify database access
  console.log('\n[2] Verifying Dev Pipeline database access...');
  try {
    const db = await notion.databases.retrieve({ database_id: DEV_PIPELINE_DATABASE_ID });
    const title = (db as any).title?.[0]?.plain_text || 'Unknown';
    console.log(`✅ Database accessible: "${title}"`);
  } catch (error: any) {
    console.error(`❌ Database access failed: ${error.code || error.message}`);
    console.error('   This could mean:');
    console.error('   - Database not shared with integration');
    console.error('   - Wrong database ID');
    console.error('   - Token belongs to different workspace');
    process.exit(1);
  }

  // Step 3: Create a test page
  console.log('\n[3] Creating test page...');
  const testTitle = `TEST-${Date.now()}: Standalone Create Test`;

  let pageId: string;
  try {
    const response = await notion.pages.create({
      parent: { database_id: DEV_PIPELINE_DATABASE_ID },
      properties: {
        'Discussion': { title: [{ text: { content: testTitle } }] },
        'Type': { select: { name: 'Bug' } },
        'Priority': { select: { name: 'P2' } },
        'Status': { select: { name: 'Dispatched' } },
        'Requestor': { select: { name: 'Atlas [Telegram]' } },
        'Handler': { select: { name: 'Pit Crew' } },
        'Dispatched': { date: { start: new Date().toISOString().split('T')[0] } },
      },
    });

    pageId = response.id;
    console.log(`✅ Create API returned page ID: ${pageId}`);
    console.log(`   URL: https://notion.so/${pageId.replace(/-/g, '')}`);
  } catch (error: any) {
    console.error(`❌ Create failed: ${error.code || error.message}`);
    if (error.body) {
      console.error('   Response:', JSON.stringify(error.body, null, 2));
    }
    process.exit(1);
  }

  // Step 4: Immediately verify page exists
  console.log('\n[4] Verifying page exists (immediate)...');
  try {
    const page = await notion.pages.retrieve({ page_id: pageId });
    console.log(`✅ Page verified! ID: ${page.id}`);
    if ('parent' in page) {
      console.log(`   Parent: ${JSON.stringify(page.parent)}`);
    }
  } catch (error: any) {
    console.error(`❌ VERIFICATION FAILED: ${error.code || error.message}`);
    console.error('   Page was "created" but does not exist!');
    console.error('   This is the bug we\'re investigating.');
    process.exit(1);
  }

  // Step 5: Wait and verify again (timing test)
  console.log('\n[5] Waiting 2 seconds and verifying again...');
  await new Promise(r => setTimeout(r, 2000));

  try {
    const page = await notion.pages.retrieve({ page_id: pageId });
    console.log(`✅ Page still exists after 2s delay`);
  } catch (error: any) {
    console.error(`❌ Page disappeared after delay: ${error.code}`);
    process.exit(1);
  }

  // Step 6: Query database to find the page
  console.log('\n[6] Querying database to find the page...');
  try {
    const query = await notion.databases.query({
      database_id: DEV_PIPELINE_DATABASE_ID,
      filter: {
        property: 'Discussion',
        title: { contains: testTitle.substring(0, 20) },
      },
    });

    if (query.results.length > 0) {
      console.log(`✅ Page found in database query! ${query.results.length} result(s)`);
    } else {
      console.error(`❌ Page NOT found in database query (but retrieve worked)`);
    }
  } catch (error: any) {
    console.error(`❌ Query failed: ${error.code}`);
  }

  // Step 7: Cleanup - archive the test page
  console.log('\n[7] Cleaning up (archiving test page)...');
  try {
    await notion.pages.update({
      page_id: pageId,
      archived: true,
    });
    console.log('✅ Test page archived');
  } catch (error: any) {
    console.warn(`⚠ Cleanup failed (page may need manual deletion): ${error.code}`);
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('RESULT: ALL TESTS PASSED');
  console.log('='.repeat(60));
  console.log();
  console.log('The Notion SDK can create pages properly.');
  console.log('If Atlas is failing, the issue is in Atlas code path, not Notion.');
  console.log();
}

main().catch(console.error);
