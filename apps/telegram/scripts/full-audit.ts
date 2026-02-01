#!/usr/bin/env npx tsx
/**
 * Full Dev Pipeline Audit - Get all details for cleanup
 */

import { Client } from '@notionhq/client';
import { config } from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { writeFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env'), override: true });

const notion = new Client({ auth: process.env.NOTION_API_KEY });
const DEV_PIPELINE_ID = 'ce6fbf1b-ee30-433d-a9e6-b338552de7c9';

async function main() {
  const results = await notion.databases.query({
    database_id: DEV_PIPELINE_ID,
    page_size: 100,
  });

  const items = results.results.map((page: any) => ({
    id: page.id,
    title: page.properties.Discussion?.title?.[0]?.plain_text || 'Untitled',
    status: page.properties.Status?.select?.name || 'Unknown',
    priority: page.properties.Priority?.select?.name || '?',
    type: page.properties.Type?.select?.name || '?',
    handler: page.properties.Handler?.select?.name || null,
    requestor: page.properties.Requestor?.select?.name || null,
    thread: page.properties.Thread?.rich_text?.[0]?.plain_text || null,
    resolution: page.properties.Resolution?.rich_text?.[0]?.plain_text || null,
    dispatched: page.properties.Dispatched?.date?.start || null,
    resolved: page.properties.Resolved?.date?.start || null,
    output: page.properties.Output?.url || null,
    url: page.url,
  }));

  // Output as JSON for processing
  writeFileSync(join(__dirname, 'pipeline-audit.json'), JSON.stringify(items, null, 2));

  console.log('Exported', items.length, 'items to pipeline-audit.json');

  // Also print summary
  for (const item of items) {
    console.log(`\n[${item.priority}] ${item.status}: ${item.title}`);
    console.log(`  ID: ${item.id}`);
    console.log(`  Type: ${item.type}`);
    if (item.resolution) console.log(`  Resolution: ${item.resolution.substring(0, 100)}...`);
    if (item.thread) console.log(`  Thread: ${item.thread.substring(0, 100)}...`);
  }
}

main().catch(console.error);
