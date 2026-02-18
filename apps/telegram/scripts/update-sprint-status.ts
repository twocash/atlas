#!/usr/bin/env npx tsx
/**
 * Update Sprint Status - Sync Dev Pipeline with actual completion
 */

import { config } from 'dotenv';
config({ override: true });

import { Client } from '@notionhq/client';
import { NOTION_DB } from '@atlas/shared/config';

const notion = new Client({ auth: process.env.NOTION_API_KEY });
const DEV_PIPELINE_ID = NOTION_DB.DEV_PIPELINE;
const WORK_QUEUE_ID = NOTION_DB.WORK_QUEUE;

interface UpdateItem {
  id: string;
  title: string;
  newStatus: string;
  resolution?: string;
}

const devPipelineUpdates: UpdateItem[] = [
  {
    id: '2fa780a7-8eef-80e9-9bed-cda54e633800',
    title: 'Atlas Neuro-Link Sprint',
    newStatus: 'Shipped',
    resolution: `SHIPPED 2026-02-01

Commits:
- 6b1ccc5 feat(neuro-link): unified dispatcher + dotenv override fix
- f310a44 feat(health): add startup integrity check for database schema
- fd4f929 fix(handler): make URLs UNMISSABLE in tool results to prevent hallucination

Delivered:
- submit_ticket unified dispatcher (routes dev_bug→Pit Crew, research/content→WQ)
- Task Architect pattern with required reasoning field
- Review gate system (require_review flag)
- Startup integrity check (refuses boot on corrupted schema)
- Dotenv override fix (prevents stale env vars)
- URL hallucination prevention (URLs now unmissable in tool results)`
  },
  {
    id: '2fa780a7-8eef-8136-af8e-e913bf9629b8',
    title: 'Atlas Health Check Battery',
    newStatus: 'Shipped',
    resolution: `SHIPPED 2026-02-01

Commit: f310a44 feat(health): add startup integrity check for database schema

Delivered:
- Startup integrity check validates Work Queue 2.0 and Dev Pipeline schemas
- Atlas refuses to boot if required columns missing
- Clear error messages guide schema fixes
- "The final lock on the door" - no more silent failures`
  },
];

// Items to close (already Shipped → Closed)
const itemsToClose = [
  '2fa780a7-8eef-8172-844d-e67d866094fb', // MCP Sprint
  '2fa780a7-8eef-8157-8a9e-e06108efad6c', // P0 BUG: fabricates tool results
  '2fa780a7-8eef-8187-a0d2-cf22d5ea7372', // BUG: sees zero items
  '2fa780a7-8eef-8149-a38b-c5db24f3bd52', // BUG: MCP 404 errors
  '2fa780a7-8eef-810f-9896-c6bc5e47bf68', // BUG: hallucinates writes
  '2fa780a7-8eef-8143-b2a7-dbc86cc3dda8', // BUG: claims no access
  '2fa780a7-8eef-812d-9e51-e147793b2b57', // CRITICAL: invalid URLs
  '2fa780a7-8eef-819b-b46a-e6f84e4fbf6f', // Agent SDK Integration
  '2fa780a7-8eef-815d-b435-fe29f8387cc1', // Dev Machine Setup
  '2fa780a7-8eef-8103-96c4-e019f3f8d901', // Failsafe Docs
  '2fa780a7-8eef-81b8-92f7-ca8a310e671f', // Feed as Activity Log
  '2fa780a7-8eef-816e-b3e4-ea74d31bd7d7', // Daily Briefing
  '2fa780a7-8eef-8156-8522-e87e13ff0128', // Skills endpoint bug
];

async function main() {
  console.log('=== Updating Dev Pipeline ===\n');

  // Update sprints to Shipped with resolution
  for (const item of devPipelineUpdates) {
    try {
      await notion.pages.update({
        page_id: item.id,
        properties: {
          'Status': { select: { name: item.newStatus } },
          ...(item.resolution && {
            'Resolution': { rich_text: [{ text: { content: item.resolution.substring(0, 2000) } }] }
          }),
        },
      });
      console.log(`✅ ${item.title} → ${item.newStatus}`);
    } catch (err: any) {
      console.log(`❌ ${item.title}: ${err.message}`);
    }
  }

  // Close shipped items
  console.log('\n=== Closing Shipped Items ===\n');
  for (const id of itemsToClose) {
    try {
      // First fetch to get title
      const page = await notion.pages.retrieve({ page_id: id });
      const title = (page as any).properties?.Discussion?.title?.[0]?.plain_text || 'Unknown';

      await notion.pages.update({
        page_id: id,
        properties: {
          'Status': { select: { name: 'Closed' } },
        },
      });
      console.log(`✅ Closed: ${title.substring(0, 50)}...`);
    } catch (err: any) {
      console.log(`❌ ${id}: ${err.message}`);
    }
  }

  // Update Work Queue items
  console.log('\n=== Updating Work Queue ===\n');

  const wqUpdates = [
    {
      id: '2f9780a7-8eef-8153-ae19-d1cc7051448a',
      title: 'SPRINT: Atlas MCP Client Enablement',
      status: 'Done',
      resolution: 'Shipped - MCP client fully operational with pit-crew and notion servers'
    },
    {
      id: '2f9780a7-8eef-8108-b9c3-f1eecd7f9c2a',
      title: 'Fix Atlas broken Notion URL generation',
      status: 'Done',
      resolution: 'Fixed in fd4f929 - URLs now unmissable in tool results'
    },
  ];

  for (const item of wqUpdates) {
    try {
      await notion.pages.update({
        page_id: item.id,
        properties: {
          'Status': { select: { name: item.status } },
          'Resolution Notes': { rich_text: [{ text: { content: item.resolution } }] },
          'Completed': { date: { start: new Date().toISOString().split('T')[0] } },
        },
      });
      console.log(`✅ WQ: ${item.title} → ${item.status}`);
    } catch (err: any) {
      console.log(`❌ WQ ${item.title}: ${err.message}`);
    }
  }

  console.log('\n✅ Sprint status sync complete!');
}

main().catch(console.error);
