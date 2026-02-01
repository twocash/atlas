#!/usr/bin/env npx tsx
/**
 * Board Status - Query open items from Dev Pipeline and Work Queue
 */

import { config } from 'dotenv';
config({ override: true });

import { Client } from '@notionhq/client';

const notion = new Client({ auth: process.env.NOTION_API_KEY });

async function main() {
  // Dev Pipeline
  console.log('=== DEV PIPELINE (Open) ===\n');

  const devPipeline = await notion.databases.query({
    database_id: 'ce6fbf1b-ee30-433d-a9e6-b338552de7c9',
    filter: {
      property: 'Status',
      select: { does_not_equal: 'Closed' }
    },
    sorts: [{ property: 'Priority', direction: 'ascending' }],
    page_size: 20
  });

  for (const page of devPipeline.results) {
    const props = (page as any).properties;
    const title = props.Discussion?.title?.[0]?.plain_text || 'Untitled';
    const status = props.Status?.select?.name || 'Unknown';
    const priority = props.Priority?.select?.name || '?';
    const type = props.Type?.select?.name || '?';
    const id = page.id;
    console.log(`[${priority}] ${status.padEnd(15)} | ${type.padEnd(10)} | ${title}`);
    console.log(`    ID: ${id}`);
  }

  // Work Queue
  console.log('\n=== WORK QUEUE (Open) ===\n');

  const workQueue = await notion.databases.query({
    database_id: '3d679030-b76b-43bd-92d8-1ac51abb4a28',
    // Status is a "status" property type in Work Queue 2.0
    sorts: [{ property: 'Priority', direction: 'ascending' }],
    page_size: 20
  });

  for (const page of workQueue.results) {
    const props = (page as any).properties;
    const title = props.Task?.title?.[0]?.plain_text || 'Untitled';
    const status = props.Status?.status?.name || 'Unknown';
    const priority = props.Priority?.select?.name || '?';
    const pillar = props.Pillar?.select?.name || '?';
    const id = page.id;
    console.log(`[${priority}] ${status.padEnd(10)} | ${pillar.padEnd(12)} | ${title}`);
    console.log(`    ID: ${id}`);
  }

  console.log(`\nDev Pipeline: ${devPipeline.results.length} open`);
  console.log(`Work Queue: ${workQueue.results.length} open`);
}

main().catch(console.error);
