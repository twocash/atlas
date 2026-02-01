#!/usr/bin/env npx tsx
/**
 * Query current Dev Pipeline state
 */

import { Client } from '@notionhq/client';
import { config } from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env'), override: true });

const notion = new Client({ auth: process.env.NOTION_API_KEY });
const DEV_PIPELINE_ID = 'ce6fbf1b-ee30-433d-a9e6-b338552de7c9';

async function main() {
  const results = await notion.databases.query({
    database_id: DEV_PIPELINE_ID,
    page_size: 100,
  });

  console.log('=== CURRENT DEV PIPELINE ===');
  console.log('Total items:', results.results.length);
  console.log();

  for (const page of results.results as any[]) {
    const p = page.properties;
    const title = p.Discussion?.title?.[0]?.plain_text || 'Untitled';
    const status = p.Status?.select?.name || '?';
    const priority = p.Priority?.select?.name || '?';
    const type = p.Type?.select?.name || '?';
    const thread = (p.Thread?.rich_text?.[0]?.plain_text || '').substring(0, 80);
    console.log(`[${priority}] ${status} | ${type}: ${title}`);
    if (thread) console.log(`    Thread: ${thread}...`);
  }
}

main().catch(console.error);
