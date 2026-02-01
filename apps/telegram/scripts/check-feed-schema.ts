#!/usr/bin/env npx tsx
import { Client } from '@notionhq/client';
import { config } from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env'), override: true });

const notion = new Client({ auth: process.env.NOTION_API_KEY });
const FEED_ID = '90b2b33f-4b44-4b42-870f-8d62fb8cbf18';

async function main() {
  const db = await notion.databases.retrieve({ database_id: FEED_ID });
  console.log('Feed 2.0 Properties:');
  for (const [name, prop] of Object.entries(db.properties)) {
    console.log(`  ${name}: ${(prop as any).type}`);
  }
}

main().catch(console.error);
