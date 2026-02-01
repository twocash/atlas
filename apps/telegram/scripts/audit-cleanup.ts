#!/usr/bin/env npx tsx
/**
 * Audit and Cleanup Script for Atlas Databases
 * Identifies duplicates, test items, and provides cleanup recommendations
 */

import { Client } from '@notionhq/client';
import { config } from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env'), override: true });

const notion = new Client({ auth: process.env.NOTION_API_KEY });

const DEV_PIPELINE_ID = 'ce6fbf1b-ee30-433d-a9e6-b338552de7c9';
const WORK_QUEUE_ID = '3d679030-b76b-43bd-92d8-1ac51abb4a28';

interface Item {
  id: string;
  title: string;
  status: string;
  priority: string;
  type: string;
}

async function auditDevPipeline(): Promise<Item[]> {
  const results = await notion.databases.query({
    database_id: DEV_PIPELINE_ID,
    page_size: 100,
  });

  return results.results.map((page: any) => ({
    id: page.id,
    title: page.properties.Discussion?.title?.[0]?.plain_text || 'Untitled',
    status: page.properties.Status?.select?.name || 'Unknown',
    priority: page.properties.Priority?.select?.name || '?',
    type: page.properties.Type?.select?.name || '?',
  }));
}

async function main() {
  console.log('=' .repeat(60));
  console.log('ATLAS DATABASE CLEANUP AUDIT');
  console.log('=' .repeat(60));

  // Audit Dev Pipeline
  console.log('\n📋 DEV PIPELINE AUDIT\n');
  const dpItems = await auditDevPipeline();
  console.log(`Total items: ${dpItems.length}`);

  // Group by status
  const byStatus: Record<string, Item[]> = {};
  for (const item of dpItems) {
    if (!byStatus[item.status]) byStatus[item.status] = [];
    byStatus[item.status].push(item);
  }

  console.log('\n--- BY STATUS ---');
  for (const [status, items] of Object.entries(byStatus)) {
    console.log(`${status}: ${items.length}`);
  }

  // Find test items
  console.log('\n--- TEST/VALIDATION ITEMS (DELETE CANDIDATES) ---');
  const testItems = dpItems.filter(i => /test|validation|delete me/i.test(i.title));
  if (testItems.length === 0) {
    console.log('None found');
  } else {
    for (const item of testItems) {
      console.log(`  [${item.id.substring(0,8)}] ${item.status}: ${item.title}`);
    }
  }

  // Find duplicates
  console.log('\n--- POTENTIAL DUPLICATES ---');
  const titleMap: Record<string, Item[]> = {};
  for (const item of dpItems) {
    const key = item.title.toLowerCase()
      .replace(/sprint:|bug:|feature:|hotfix:/gi, '')
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 30);
    if (!titleMap[key]) titleMap[key] = [];
    titleMap[key].push(item);
  }

  let dupeCount = 0;
  for (const [key, items] of Object.entries(titleMap)) {
    if (items.length > 1) {
      dupeCount++;
      console.log(`\nDuplicate group "${key}" (${items.length} items):`);
      for (const item of items) {
        console.log(`  [${item.priority}] ${item.status}: ${item.title.substring(0, 45)}`);
      }
    }
  }
  if (dupeCount === 0) console.log('No duplicates found');

  // Summary
  console.log('\n' + '=' .repeat(60));
  console.log('CLEANUP SUMMARY');
  console.log('=' .repeat(60));
  console.log(`Test items to delete: ${testItems.length}`);
  console.log(`Duplicate groups: ${dupeCount}`);
  console.log(`Total items: ${dpItems.length}`);
  console.log(`Active (Dispatched/In Progress): ${(byStatus['Dispatched']?.length || 0) + (byStatus['In Progress']?.length || 0)}`);
  console.log(`Shipped/Closed: ${(byStatus['Shipped']?.length || 0) + (byStatus['Closed']?.length || 0)}`);
}

main().catch(console.error);
