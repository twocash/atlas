#!/usr/bin/env npx tsx
/**
 * Audit Work Queue 2.0 - Get all details for migration planning
 */

import { Client } from '@notionhq/client';
import { config } from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { writeFileSync } from 'fs';
import { NOTION_DB } from '@atlas/shared/config';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env'), override: true });

const notion = new Client({ auth: process.env.NOTION_API_KEY });
const WORK_QUEUE_ID = NOTION_DB.WORK_QUEUE;

async function main() {
  const results = await notion.databases.query({
    database_id: WORK_QUEUE_ID,
    page_size: 100,
  });

  const items = results.results.map((page: any) => ({
    id: page.id,
    title: page.properties.Task?.title?.[0]?.plain_text || 'Untitled',
    status: page.properties.Status?.status?.name || page.properties.Status?.select?.name || '?',
    priority: page.properties.Priority?.select?.name || '?',
    type: page.properties.Type?.select?.name || '?',
    pillar: page.properties.Pillar?.select?.name || '?',
    assignee: page.properties.Assignee?.select?.name || '?',
    notes: (page.properties.Notes?.rich_text?.[0]?.plain_text || '').substring(0, 150),
    created: page.created_time?.substring(0, 10),
    url: page.url,
  }));

  // Save full data
  writeFileSync(join(__dirname, 'work-queue-audit.json'), JSON.stringify(items, null, 2));
  console.log('Exported', items.length, 'items to work-queue-audit.json');
  console.log();

  // Group by status
  const byStatus: Record<string, any[]> = {};
  for (const item of items) {
    if (!byStatus[item.status]) byStatus[item.status] = [];
    byStatus[item.status].push(item);
  }

  console.log('=== BY STATUS ===');
  for (const [status, sitems] of Object.entries(byStatus)) {
    console.log(`${status}: ${sitems.length}`);
  }

  // Group by pillar
  const byPillar: Record<string, any[]> = {};
  for (const item of items) {
    if (!byPillar[item.pillar]) byPillar[item.pillar] = [];
    byPillar[item.pillar].push(item);
  }

  console.log('\n=== BY PILLAR ===');
  for (const [pillar, pitems] of Object.entries(byPillar)) {
    console.log(`${pillar}: ${pitems.length}`);
  }

  // Group by type
  const byType: Record<string, any[]> = {};
  for (const item of items) {
    if (!byType[item.type]) byType[item.type] = [];
    byType[item.type].push(item);
  }

  console.log('\n=== BY TYPE ===');
  for (const [type, titems] of Object.entries(byType)) {
    console.log(`${type}: ${titems.length}`);
  }

  console.log('\n=== ALL ITEMS ===');
  for (const item of items) {
    console.log('---');
    console.log(`[${item.priority}] ${item.status}: ${item.title}`);
    console.log(`  ID: ${item.id.substring(0,8)}`);
    console.log(`  Type: ${item.type} | Pillar: ${item.pillar} | Assignee: ${item.assignee}`);
    console.log(`  Created: ${item.created}`);
    if (item.notes) console.log(`  Notes: ${item.notes}...`);
  }

  // Find potential dev pipeline items (bugs, features, sprints, test items)
  console.log('\n=== DEV PIPELINE CANDIDATES ===');
  const devCandidates = items.filter(i =>
    /bug|sprint|mcp|test|feature|atlas|notion|hallucin|tool/i.test(i.title) ||
    /bug|sprint|mcp|test|feature|atlas|notion|hallucin|tool/i.test(i.notes)
  );
  console.log(`Found ${devCandidates.length} potential Dev Pipeline items:`);
  for (const item of devCandidates) {
    console.log(`  [${item.priority}] ${item.status}: ${item.title}`);
  }

  // Find duplicates
  console.log('\n=== POTENTIAL DUPLICATES ===');
  const titleMap: Record<string, any[]> = {};
  for (const item of items) {
    const key = item.title.toLowerCase()
      .replace(/sprint:|bug:|feature:|hotfix:/gi, '')
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 30);
    if (!titleMap[key]) titleMap[key] = [];
    titleMap[key].push(item);
  }

  let dupeCount = 0;
  for (const [key, ditems] of Object.entries(titleMap)) {
    if (ditems.length > 1) {
      dupeCount++;
      console.log(`\nDuplicate group "${key}" (${ditems.length} items):`);
      for (const item of ditems) {
        console.log(`  [${item.priority}] ${item.status}: ${item.title.substring(0, 50)}`);
      }
    }
  }
  if (dupeCount === 0) console.log('No duplicates found');

  // Find test items
  console.log('\n=== TEST/VALIDATION ITEMS ===');
  const testItems = items.filter(i => /test|validation|delete me/i.test(i.title));
  if (testItems.length === 0) {
    console.log('None found');
  } else {
    for (const item of testItems) {
      console.log(`  [${item.id.substring(0,8)}] ${item.status}: ${item.title}`);
    }
  }
}

main().catch(console.error);
