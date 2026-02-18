#!/usr/bin/env bun
/**
 * Spike Test: Research → Notion Page Body
 *
 * Interactive CLI to test the complete research flow:
 * 1. Create Work Queue item (Status=Triaged, Type=Research)
 * 2. Execute research via Gemini
 * 3. Write results to page body as Notion blocks
 * 4. Verify blocks exist in page
 *
 * Usage:
 *   bun packages/agents/scripts/spike-research.ts "What is TypeScript 5.8?"
 *   bun packages/agents/scripts/spike-research.ts "Latest AI developments" --deep
 *   bun packages/agents/scripts/spike-research.ts "Bun vs Node" --light
 *
 * Options:
 *   --light     Quick research (2-3 sources)
 *   --standard  Thorough research (5-8 sources) [default]
 *   --deep      Academic research (10+ sources)
 *   --dry-run   Test parsing only, skip Notion writes
 */

import { Client } from '@notionhq/client';
import { NOTION_DB } from '@atlas/shared/config';
import type { ResearchConfig } from '../src/agents/research';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Load env from apps/telegram/.env
const envPath = resolve(__dirname, '../../../apps/telegram/.env');
try {
  const envContent = readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex > 0) {
        const key = trimmed.substring(0, eqIndex);
        let value = trimmed.substring(eqIndex + 1);
        // Remove quotes if present
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        process.env[key] = value;
      }
    }
  }
} catch (e) {
  console.error(`Warning: Could not load ${envPath}`);
}

// ==========================================
// Configuration
// ==========================================

const WORK_QUEUE_DB_ID = NOTION_DB.WORK_QUEUE;

// ==========================================
// CLI Parsing
// ==========================================

function parseArgs(): { query: string; depth: 'light' | 'standard' | 'deep'; dryRun: boolean } {
  const args = process.argv.slice(2);
  let query = '';
  let depth: 'light' | 'standard' | 'deep' = 'standard';
  let dryRun = false;

  for (const arg of args) {
    if (arg === '--light') depth = 'light';
    else if (arg === '--standard') depth = 'standard';
    else if (arg === '--deep') depth = 'deep';
    else if (arg === '--dry-run') dryRun = true;
    else if (!arg.startsWith('--')) query = arg;
  }

  if (!query) {
    console.error('Usage: bun spike-research.ts "Your research query" [--light|--standard|--deep] [--dry-run]');
    process.exit(1);
  }

  return { query, depth, dryRun };
}

// ==========================================
// Spike Test
// ==========================================

async function runSpike() {
  const { query, depth, dryRun } = parseArgs();

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║          SPIKE: Research → Notion Page Body                  ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`[SPIKE] Query: "${query}"`);
  console.log(`[SPIKE] Depth: ${depth}`);
  console.log(`[SPIKE] Dry run: ${dryRun}`);
  console.log('');

  // Check environment
  console.log('[SPIKE] Checking environment...');
  const envChecks = {
    NOTION_API_KEY: !!process.env.NOTION_API_KEY,
    GEMINI_API_KEY: !!process.env.GEMINI_API_KEY,
  };
  console.log(`  NOTION_API_KEY: ${envChecks.NOTION_API_KEY ? '✅ SET' : '❌ MISSING'}`);
  console.log(`  GEMINI_API_KEY: ${envChecks.GEMINI_API_KEY ? '✅ SET' : '❌ MISSING'}`);

  if (!envChecks.NOTION_API_KEY || !envChecks.GEMINI_API_KEY) {
    console.error('\n❌ Missing required environment variables');
    process.exit(1);
  }
  console.log('');

  // Import research and workqueue modules
  console.log('[SPIKE] Loading modules...');
  const { executeResearch } = await import('../src/agents/research');
  const { createResearchWorkItem, syncAgentSpawn, syncAgentComplete, wireAgentToWorkQueue } = await import('../src/workqueue');
  const { AgentRegistry } = await import('../src/registry');
  console.log('  ✅ Modules loaded');
  console.log('');

  // Step 1: Create Work Queue item
  console.log('[SPIKE] Step 1: Creating Work Queue item...');
  let pageId: string;
  let pageUrl: string;

  if (dryRun) {
    pageId = 'dry-run-page-id';
    pageUrl = 'https://notion.so/dry-run';
    console.log('  [DRY RUN] Skipping Notion page creation');
  } else {
    try {
      const result = await createResearchWorkItem({
        query,
        depth,
      });
      pageId = result.pageId;
      pageUrl = result.url;
      console.log(`  ✅ Page created: ${pageUrl}`);
    } catch (error: any) {
      console.error(`  ❌ Failed to create Work Queue item: ${error?.message || error}`);
      console.error(`  Stack: ${error?.stack}`);
      process.exit(1);
    }
  }
  console.log('');

  // Step 2: Create registry and agent
  console.log('[SPIKE] Step 2: Setting up agent...');
  const registry = new AgentRegistry();
  const agent = await registry.spawn({
    type: 'research',
    name: `Spike: ${query.substring(0, 30)}`,
    instructions: JSON.stringify({ query, depth }),
    priority: 'P2',
    workItemId: pageId,
  });
  console.log(`  ✅ Agent spawned: ${agent.id}`);

  // Wire to Work Queue (unless dry run)
  if (!dryRun) {
    try {
      await syncAgentSpawn(pageId, agent);
      console.log('  ✅ Agent synced to Work Queue');
    } catch (error: any) {
      console.error(`  ⚠️ Failed to sync spawn: ${error?.message}`);
    }
  }
  console.log('');

  // Step 3: Execute research
  console.log('[SPIKE] Step 3: Running research...');
  const startTime = Date.now();

  const config: ResearchConfig = {
    query,
    depth,
  };

  // Start the agent
  await registry.start(agent.id);

  try {
    const result = await executeResearch(config, agent, registry);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    if (result.success) {
      const output = result.output as any;
      console.log(`  ✅ Research complete in ${elapsed}s`);
      console.log(`     Summary length: ${output?.summary?.length || 0} chars`);
      console.log(`     Findings: ${output?.findings?.length || 0}`);
      console.log(`     Sources: ${output?.sources?.length || 0}`);
      console.log('');

      // Show summary preview
      if (output?.summary) {
        console.log('[SPIKE] Summary preview:');
        console.log('─'.repeat(60));
        console.log(output.summary.substring(0, 500) + (output.summary.length > 500 ? '...' : ''));
        console.log('─'.repeat(60));
        console.log('');
      }

      // Step 4: Write to page body
      console.log('[SPIKE] Step 4: Writing to page body...');
      if (dryRun) {
        console.log('  [DRY RUN] Skipping Notion block writes');
      } else {
        try {
          // Mark agent as complete - this triggers block write
          await registry.complete(agent.id, result);
          await syncAgentComplete(pageId, agent, result);
          console.log('  ✅ Results written to page body');
        } catch (error: any) {
          console.error(`  ❌ Failed to write results: ${error?.message}`);
          console.error(`  Stack: ${error?.stack?.substring(0, 500)}`);
        }
      }
      console.log('');

      // Step 5: Verify blocks
      console.log('[SPIKE] Step 5: Verifying blocks...');
      if (dryRun) {
        console.log('  [DRY RUN] Skipping verification');
      } else {
        try {
          const notion = new Client({ auth: process.env.NOTION_API_KEY });
          const blocks = await notion.blocks.children.list({ block_id: pageId });

          const blockTypes: Record<string, number> = {};
          for (const block of blocks.results as any[]) {
            const type = block.type || 'unknown';
            blockTypes[type] = (blockTypes[type] || 0) + 1;
          }

          console.log(`  ✅ Found ${blocks.results.length} blocks in page`);
          console.log(`  Block types: ${JSON.stringify(blockTypes)}`);
        } catch (error: any) {
          console.error(`  ⚠️ Could not verify blocks: ${error?.message}`);
        }
      }
      console.log('');

      // Final summary
      console.log('╔══════════════════════════════════════════════════════════════╗');
      console.log('║                      SPIKE RESULT                            ║');
      console.log('╚══════════════════════════════════════════════════════════════╝');
      console.log('');
      console.log(`  ✅ SUCCESS`);
      console.log(`  Query: "${query}"`);
      console.log(`  Depth: ${depth}`);
      console.log(`  Duration: ${elapsed}s`);
      console.log(`  Summary: ${output?.summary?.length || 0} chars`);
      console.log(`  Findings: ${output?.findings?.length || 0}`);
      console.log(`  Sources: ${output?.sources?.length || 0}`);
      if (!dryRun) {
        console.log(`  Page: ${pageUrl}`);
      }
      console.log('');

    } else {
      console.error(`  ❌ Research failed: ${result.summary}`);
      process.exit(1);
    }

  } catch (error: any) {
    console.error(`  ❌ Research error: ${error?.message}`);
    console.error(`  Stack: ${error?.stack}`);
    process.exit(1);
  }
}

// Run the spike
runSpike().catch((error) => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
