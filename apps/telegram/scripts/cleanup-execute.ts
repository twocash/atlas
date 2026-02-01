#!/usr/bin/env npx tsx
/**
 * Execute Dev Pipeline Cleanup
 * - Archive test items
 * - Archive duplicates (keep best version)
 * - Update items with proper documentation
 */

import { Client } from '@notionhq/client';
import { config } from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env'), override: true });

const notion = new Client({ auth: process.env.NOTION_API_KEY });

// Items to ARCHIVE (test items)
const TEST_ITEMS_TO_ARCHIVE = [
  '2fa780a7-8eef-8118-88b7-c1319c6af3c3', // TEST: Tool invocation verification
  '2fa780a7-8eef-81d7-a3d5-d2a649718324', // TEST: URL integrity verification
  '2fa780a7-8eef-81e1-ad39-d80cecbcc0d3', // TEST: Pit Crew Sync Validation
  '2fa780a7-8eef-81e3-a54f-d1e66c4d6154', // VALIDATION: Tool invocation test
];

// Duplicates to ARCHIVE (keeping the shipped/best version)
const DUPLICATES_TO_ARCHIVE = [
  // Atlas Dev Sprint Brief - keep 2fa780a7-8eef-81de (most detailed)
  '2fa780a7-8eef-810b-8098-def9fd863745',
  '2fa780a7-8eef-810f-b83e-ec81ac8ea1f0',

  // Grove Sprout Factory - keep 2fa780a7-8eef-81e7 (most detailed)
  '2fa780a7-8eef-8157-b7c3-e21275512d4e',

  // Zen of Atlas - keep 2fa780a7-8eef-8158 (first one)
  '2fa780a7-8eef-817a-b057-fc6918c36d5f',

  // Atlas Hourly Reflection - keep 2fa780a7-8eef-8166 (first one)
  '2fa780a7-8eef-81c8-80cb-ca3cbba4ea57',
  '2fa780a7-8eef-8193-b8fb-c5b320ce39df',

  // MCP Sprint - keep SHIPPED one (2fa780a7-8eef-8172), archive dispatched dupes
  '2fa780a7-8eef-8195-9444-e44279a619ea',
  '2fa780a7-8eef-81b2-8f89-f587707e60a6',
  '2fa780a7-8eef-8106-8207-cbbd8ed9513d',

  // Duplicate bug entry
  '2fa780a7-8eef-8194-8790-c2a3a8380476', // Duplicate of invalid URL bug
];

// Items to UPDATE with better documentation
const ITEMS_TO_UPDATE = [
  {
    id: '2fa780a7-8eef-8172-844d-e67d866094fb', // MCP Sprint SHIPPED
    resolution: `SPRINT COMPLETE ✅

**What it unlocked:**
- Atlas can now connect to external MCP servers (Notion, Pit Crew)
- 27 MCP tools available for agentic workflows
- Foundation for future tool integrations

**Key deliverables:**
- MCP client infrastructure in handler.ts
- Two servers connected: pit_crew + notion
- Hybrid tool system (native + MCP)

**Commit:** Multiple commits culminating in c153151`,
  },
  {
    id: '2fa780a7-8eef-810f-9896-c6bc5e47bf68', // Hallucination bug SHIPPED
    resolution: `FIXED ✅

**Root cause:** Claude was generating fake tool results in text instead of using tool_use blocks (toolIterations=0).

**Fix applied:**
1. Added MANDATORY TOOL INVOCATION RULE to system prompt
2. Added forced tool_choice for create/add operations
3. Added URL INTEGRITY RULE requiring exact URL copying
4. Tool results now prefix failures with explicit warnings

**What it unlocked:**
- Reliable Notion operations
- No more ghost pages or fake URLs
- Verifiable tool execution (toolIterations > 0)

**Commit:** c153151`,
  },
  {
    id: '2fa780a7-8eef-812d-9e51-e147793b2b57', // Invalid URLs SHIPPED
    resolution: `FIXED ✅

**Root cause:** Token mismatch - .env had wrong Notion token, plus dotenv wasn't overriding system env vars.

**Fix applied:**
1. Updated .env with correct "My Boy Atlas" integration token
2. Added \`config({ override: true })\` to dotenv loading
3. Fixed MCP infrastructure (DB IDs, property mappings)

**What it unlocked:**
- Valid Notion URLs that actually work
- Proper database connectivity
- Eliminated 404 errors

**Commit:** f78b468, 68be0ac`,
  },
  {
    id: '2fa780a7-8eef-8143-b2a7-dbc86cc3dda8', // No access bug SHIPPED
    resolution: `FIXED ✅

**Root cause:** Conflicting Notion write paths - pit-crew-mcp had broken syncToNotion() competing with working MCP plugin.

**Fix applied:**
- Removed broken syncToNotion() from pit-crew-mcp
- Notion MCP plugin is now canonical path for all writes

**What it unlocked:**
- Single source of truth for Notion writes
- Eliminated "no access" false errors`,
  },
  {
    id: '2fa780a7-8eef-8149-a38b-c5db24f3bd52', // MCP 404 bug SHIPPED
    resolution: `FIXED ✅

**Root cause:** executeMcpTool() wasn't checking isError flag or scanning content for error patterns.

**Fix applied:**
- Added isError flag check in MCP result handling
- Added content scanning for error patterns (404, object_not_found)
- Explicit error propagation

**Commit:** 68be0ac`,
  },
  {
    id: '2fa780a7-8eef-8157-8a9e-e06108efad6c', // Tool fabrication SHIPPED
    resolution: `FIXED ✅

**Root cause:** Claude generating fake tool outputs in text (toolIterations=0) instead of using tool_use mechanism.

**Fix applied:**
1. MANDATORY TOOL INVOCATION RULE in prompt
2. Forced \`tool_choice: { type: 'any' }\` for create/add patterns
3. SELF-CHECK protocol before responding
4. URL INTEGRITY RULE

**Verification:** toolIterations now > 0 when tools execute

**Commit:** c153151`,
  },
  {
    id: '2fa780a7-8eef-8187-a0d2-cf22d5ea7372', // Zero items bug SHIPPED
    resolution: `FIXED ✅

**Root cause:** Two issues - wrong token in .env, and dotenv not overriding system env vars.

**Fix applied:**
1. Corrected NOTION_API_KEY in .env
2. Added \`override: true\` to dotenv config

**What it unlocked:**
- Atlas can see all Dev Pipeline items
- Proper integration connectivity`,
  },
  {
    id: '2fa780a7-8eef-8179-b7ca-f0f8f56e238f', // pit-crew sync SHIPPED
    resolution: `FIXED ✅

**Decision:** Removed syncToNotion() entirely from pit-crew-mcp. Notion MCP plugin handles all writes.

**Rationale:** One canonical path prevents conflicts and "no access" false errors.`,
  },
];

async function archiveItems(ids: string[], label: string) {
  console.log(`\n📦 Archiving ${label}...`);
  for (const id of ids) {
    try {
      await notion.pages.update({
        page_id: id,
        archived: true,
      });
      console.log(`  ✓ Archived ${id.substring(0, 8)}`);
    } catch (e: any) {
      console.log(`  ✗ Failed ${id.substring(0, 8)}: ${e.message}`);
    }
  }
}

async function updateItems() {
  console.log('\n📝 Updating items with documentation...');
  for (const item of ITEMS_TO_UPDATE) {
    try {
      await notion.pages.update({
        page_id: item.id,
        properties: {
          'Resolution': { rich_text: [{ text: { content: item.resolution } }] },
        },
      });
      console.log(`  ✓ Updated ${item.id.substring(0, 8)}`);
    } catch (e: any) {
      console.log(`  ✗ Failed ${item.id.substring(0, 8)}: ${e.message}`);
    }
  }
}

async function main() {
  console.log('=' .repeat(60));
  console.log('DEV PIPELINE CLEANUP EXECUTION');
  console.log('=' .repeat(60));

  await archiveItems(TEST_ITEMS_TO_ARCHIVE, 'test items');
  await archiveItems(DUPLICATES_TO_ARCHIVE, 'duplicates');
  await updateItems();

  console.log('\n' + '=' .repeat(60));
  console.log('CLEANUP COMPLETE');
  console.log('=' .repeat(60));
}

main().catch(console.error);
