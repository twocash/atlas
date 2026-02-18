#!/usr/bin/env bun
import { config } from 'dotenv';
config({ override: true });

import { Client } from '@notionhq/client';
import { NOTION_DB } from '@atlas/shared/config';

const notion = new Client({ auth: process.env.NOTION_API_KEY });
const DEV_PIPELINE = NOTION_DB.DEV_PIPELINE;

const response = await notion.databases.query({
  database_id: DEV_PIPELINE,
  filter: {
    and: [
      { property: 'Priority', select: { equals: 'P0' } },
      { property: 'Status', select: { does_not_equal: 'Closed' } }
    ]
  }
});

console.log('\n═══════════════════════════════════════════════════════════════════════════════');
console.log('                         P0 CRITICAL BUGS - DETAILS');
console.log('═══════════════════════════════════════════════════════════════════════════════\n');

for (const page of response.results) {
  const props = (page as any).properties;
  const title = props.Discussion?.title?.[0]?.plain_text || 'Untitled';
  const status = props.Status?.select?.name || 'Unknown';
  const thread = props.Thread?.rich_text?.[0]?.plain_text || 'No context';
  const url = (page as any).url;

  console.log(`📛 ${title}`);
  console.log(`   Status: ${status}`);
  console.log(`   URL: ${url}`);
  console.log(`   Context: ${thread.substring(0, 500)}`);
  console.log('\n───────────────────────────────────────────────────────────────────────────────\n');
}

console.log(`Total P0 bugs: ${response.results.length}\n`);
