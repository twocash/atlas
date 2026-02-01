#!/usr/bin/env npx tsx
import { Client } from '@notionhq/client';
import { config } from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env'), override: true });

const notion = new Client({ auth: process.env.NOTION_API_KEY });
const WORK_QUEUE_ID = '3d679030-b76b-43bd-92d8-1ac51abb4a28';

async function main() {
  // Check a specific garbage item that should be archived
  const garbageId = '2f9780a7-8eef-813f-8ec0-ee6f49a27dcc'; // 'try agani'

  try {
    const page = await notion.pages.retrieve({ page_id: garbageId }) as any;
    console.log('Checking "try agani" page:');
    console.log('  Archived:', page.archived);
    console.log('  Title:', page.properties.Task?.title?.[0]?.plain_text);
  } catch (e: any) {
    console.log('Error checking garbage item:', e.message);
  }

  // Query Work Queue - Notion queries don't include archived by default
  let allResults: any[] = [];
  let cursor: string | undefined = undefined;

  do {
    const response = await notion.databases.query({
      database_id: WORK_QUEUE_ID,
      page_size: 100,
      start_cursor: cursor,
    });
    allResults = allResults.concat(response.results);
    cursor = response.has_more ? response.next_cursor as string : undefined;
  } while (cursor);

  console.log('\nWork Queue items (non-archived):', allResults.length);

  // Count by status
  const byStatus: Record<string, number> = {};
  for (const page of allResults as any[]) {
    const status = page.properties.Status?.status?.name || page.properties.Status?.select?.name || '?';
    byStatus[status] = (byStatus[status] || 0) + 1;
  }

  console.log('\nBy status:');
  for (const [status, count] of Object.entries(byStatus)) {
    console.log(`  ${status}: ${count}`);
  }
}

main().catch(console.error);
