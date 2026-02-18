/**
 * Master Blaster V2 - E2E Test Cleanup
 *
 * Removes test entries from Feed 2.0 and Work Queue 2.0.
 * Finds entries tagged with test markers and archives them.
 *
 * Run: bun run scripts/e2e-cleanup.ts
 */

import { Client } from '@notionhq/client';
import { TEST_MARKERS } from './e2e-test-matrix';
import { NOTION_DB } from '@atlas/shared/config';

// ==========================================
// Config — Canonical IDs from @atlas/shared/config
// ==========================================

const FEED_DB = NOTION_DB.FEED;
const WORK_QUEUE_DB = NOTION_DB.WORK_QUEUE;

// ==========================================
// Notion Client
// ==========================================

const notion = new Client({
  auth: process.env.NOTION_TOKEN,
});

// ==========================================
// Cleanup Functions
// ==========================================

async function findTestEntries(databaseId: string, titleProperty: string): Promise<string[]> {
  const pageIds: string[] = [];

  try {
    // Query for entries with test prefix in title
    const response = await notion.databases.query({
      database_id: databaseId,
      filter: {
        property: titleProperty,
        title: {
          starts_with: TEST_MARKERS.titlePrefix,
        },
      },
    });

    for (const page of response.results) {
      pageIds.push(page.id);
    }

    console.log(`Found ${pageIds.length} test entries in ${titleProperty === 'Entry' ? 'Feed' : 'Work Queue'}`);
  } catch (err) {
    console.error(`Error querying database:`, err);
  }

  return pageIds;
}

async function archivePages(pageIds: string[]): Promise<number> {
  let archived = 0;

  for (const pageId of pageIds) {
    try {
      await notion.pages.update({
        page_id: pageId,
        archived: true,
      });
      archived++;
    } catch (err) {
      console.error(`Failed to archive ${pageId}:`, err);
    }
  }

  return archived;
}

// ==========================================
// Main
// ==========================================

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');

  console.log('\n' + '='.repeat(60));
  console.log('MASTER BLASTER V2 - E2E CLEANUP');
  console.log('='.repeat(60) + '\n');

  if (dryRun) {
    console.log('DRY RUN MODE - No changes will be made\n');
  }

  console.log(`Looking for entries with prefix: "${TEST_MARKERS.titlePrefix}"\n`);

  // Find test entries in Feed
  const feedEntries = await findTestEntries(FEED_DB, 'Entry');

  // Find test entries in Work Queue
  const wqEntries = await findTestEntries(WORK_QUEUE_DB, 'Task');

  const totalEntries = feedEntries.length + wqEntries.length;

  if (totalEntries === 0) {
    console.log('\nNo test entries found. Nothing to clean up.');
    return;
  }

  console.log(`\nTotal entries to archive: ${totalEntries}`);

  if (dryRun) {
    console.log('\nDry run complete. Run without --dry-run to actually archive.');
    return;
  }

  // Confirm before proceeding
  console.log('\nArchiving entries...\n');

  const feedArchived = await archivePages(feedEntries);
  const wqArchived = await archivePages(wqEntries);

  console.log('\n' + '='.repeat(60));
  console.log('CLEANUP COMPLETE');
  console.log('='.repeat(60));
  console.log(`Feed entries archived: ${feedArchived}`);
  console.log(`Work Queue entries archived: ${wqArchived}`);
  console.log(`Total archived: ${feedArchived + wqArchived}`);
  console.log('='.repeat(60) + '\n');
}

main().catch(err => {
  console.error('Cleanup failed:', err);
  process.exit(1);
});
