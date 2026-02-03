#!/usr/bin/env npx tsx
import { config } from 'dotenv';
config({ override: true });
import { Client } from '@notionhq/client';

const notion = new Client({ auth: process.env.NOTION_API_KEY });

async function main() {
  const dbs = await notion.search({
    filter: { property: 'object', value: 'database' },
    page_size: 20,
  });

  console.log('=== ACTUAL DATABASES ===\n');
  for (const db of dbs.results as any[]) {
    const title = db.title?.[0]?.plain_text || 'Untitled';
    console.log(`${title}`);
    console.log(`  ID: ${db.id}`);
  }
  console.log(`\nTotal: ${dbs.results.length} databases`);
}

main().catch(console.error);
