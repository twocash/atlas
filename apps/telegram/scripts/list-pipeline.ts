#!/usr/bin/env bun
/**
 * List Dev Pipeline items for priority analysis
 */
import { config } from 'dotenv';
config({ override: true });

import { Client } from '@notionhq/client';

const notion = new Client({ auth: process.env.NOTION_API_KEY });
const DEV_PIPELINE = 'ce6fbf1b-ee30-433d-a9e6-b338552de7c9';

const response = await notion.databases.query({
  database_id: DEV_PIPELINE,
  filter: {
    and: [
      { property: 'Status', select: { does_not_equal: 'Closed' } },
      { property: 'Status', select: { does_not_equal: 'Shipped' } }
    ]
  },
  sorts: [
    { property: 'Priority', direction: 'ascending' },
    { property: 'Dispatched', direction: 'ascending' }
  ]
});

console.log('\n═══════════════════════════════════════════════════════════════════════════════');
console.log('                         ATLAS DEV PIPELINE - OPEN ITEMS');
console.log('═══════════════════════════════════════════════════════════════════════════════\n');

console.log('Priority | Type     | Status          | Title');
console.log('─────────┼──────────┼─────────────────┼─────────────────────────────────────────────');

for (const page of response.results) {
  const props = (page as any).properties;
  const title = props.Discussion?.title?.[0]?.plain_text || 'Untitled';
  const status = props.Status?.select?.name || 'Unknown';
  const priority = props.Priority?.select?.name || 'P2';
  const type = props.Type?.select?.name || 'Bug';
  console.log(`${priority.padEnd(8)} | ${type.padEnd(8)} | ${status.padEnd(15)} | ${title.substring(0, 50)}`);
}

console.log('\n───────────────────────────────────────────────────────────────────────────────');
console.log(`Total: ${response.results.length} open items\n`);
