#!/usr/bin/env npx tsx
/**
 * Work Queue 2.0 Cleanup Script
 *
 * Phases:
 * 1. Fresh Extract & Analysis - Complete picture of current state
 * 2. Garbage Identification - Find chat fragments, questions, meta-instructions
 * 3. Dev Pipeline Migration - Move dev items to Dev Pipeline
 * 4. Metadata Cleanup - Fix missing status/pillar/assignee
 * 5. Structural Fixes - Convert URLs, merge duplicates, close stale
 *
 * Usage:
 *   bun run scripts/work-queue-cleanup.ts --phase=1          # Analysis only
 *   bun run scripts/work-queue-cleanup.ts --phase=2 --dry-run  # Preview garbage
 *   bun run scripts/work-queue-cleanup.ts --phase=2          # Archive garbage
 *   bun run scripts/work-queue-cleanup.ts --phase=3          # Migrate dev items
 *   bun run scripts/work-queue-cleanup.ts --phase=4          # Fix metadata
 *   bun run scripts/work-queue-cleanup.ts --phase=5          # Structural fixes
 *   bun run scripts/work-queue-cleanup.ts --all              # Run all phases
 */

import { Client } from '@notionhq/client';
import { config } from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { writeFileSync, existsSync, readFileSync } from 'fs';
import { NOTION_DB } from '@atlas/shared/config';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env'), override: true });

const notion = new Client({ auth: process.env.NOTION_API_KEY });

// Canonical IDs from @atlas/shared/config
const WORK_QUEUE_ID = NOTION_DB.WORK_QUEUE;
const FEED_ID = NOTION_DB.FEED;
const DEV_PIPELINE_ID = NOTION_DB.DEV_PIPELINE;

// Parse command line args
const args = process.argv.slice(2);
const getArg = (name: string): string | null => {
  const arg = args.find(a => a.startsWith(`--${name}=`));
  return arg ? arg.split('=')[1] : null;
};
const hasFlag = (name: string): boolean => args.includes(`--${name}`);

const PHASE = getArg('phase') ? parseInt(getArg('phase')!) : null;
const DRY_RUN = hasFlag('dry-run');
const RUN_ALL = hasFlag('all');

interface WorkQueueItem {
  id: string;
  title: string;
  status: string;
  priority: string;
  type: string;
  pillar: string;
  assignee: string;
  notes: string;
  created: string;
  url: string;
}

interface CleanupAction {
  id: string;
  title: string;
  action: 'archive' | 'update' | 'migrate';
  reason: string;
  updates?: Record<string, any>;
}

// ============================================
// GARBAGE DETECTION PATTERNS
// ============================================

const GARBAGE_PATTERNS = {
  // Questions (ends in ?)
  questions: /\?$/,

  // Short chat fragments (under 40 chars, no action words)
  shortFragments: /^.{1,40}$/,

  // Meta-instructions to Atlas
  metaInstructions: /^(delete|remove|can you|could you|please|try again|check|what about|how did|did you|just|ok\.|yes!|yes,|cool\.|remember that|fire it up|note|ok i)/i,

  // Truncated chat captures (starts with context words)
  truncatedChat: /^(now i|both of|not done|shouldn't|i think|i want|yeah|there is|i need|i updated|given your|can we|wanna)/i,

  // URL-only titles
  urlOnly: /^https?:\/\/[^\s]+$/,

  // Code snippets
  codeSnippets: /^(import|const|function|class|export|interface|\{|\[)/,

  // Status check / casual chat
  casualChat: /^(check|status|how|what|cool|thanks|great|ok|hey|hi|hello)/i,
};

const ACTION_WORDS = ['research', 'build', 'draft', 'create', 'implement', 'fix', 'bug', 'sprint', 'design', 'setup', 'install', 'evaluate', 'publish', 'update'];

function isGarbage(item: WorkQueueItem): { isGarbage: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const title = item.title.trim();
  const lowerTitle = title.toLowerCase();

  // Skip items with clear action prefixes - these are legitimate tasks
  if (/^(research:|build:|draft:|sprint:|bug:|feature:|install:|setup:|evaluate:|publish:|design:|create:|poc:|blog:|position paper:|technical|sovereign ai|vision doc)/i.test(title)) {
    return { isGarbage: false, reasons: [] };
  }

  // Skip items that are already Done with proper types (Research, Build, Draft)
  if (item.status === 'Done' && ['Research', 'Build', 'Draft'].includes(item.type)) {
    return { isGarbage: false, reasons: [] };
  }

  // Questions with no action words
  if (GARBAGE_PATTERNS.questions.test(title) && !ACTION_WORDS.some(w => lowerTitle.includes(w))) {
    reasons.push('Question (no action)');
  }

  // Meta-instructions to Atlas
  if (GARBAGE_PATTERNS.metaInstructions.test(title)) {
    reasons.push('Meta-instruction/chat');
  }

  // Truncated chat captures
  if (GARBAGE_PATTERNS.truncatedChat.test(title)) {
    reasons.push('Truncated chat capture');
  }

  // Very short fragments (under 25 chars) without action words
  if (title.length < 25 && !ACTION_WORDS.some(w => lowerTitle.includes(w))) {
    reasons.push('Very short fragment');
  }

  // Single character or number
  if (/^[0-9]$/.test(title) || title.length <= 3) {
    reasons.push('Single char/number');
  }

  // Code snippets
  if (GARBAGE_PATTERNS.codeSnippets.test(title)) {
    reasons.push('Code snippet');
  }

  // Misclassified Home/Garage chat (Process/Answer type with no home keywords)
  if (item.pillar === 'Home/Garage' && (item.type === 'Process' || item.type === 'Answer') && !lowerTitle.includes('permit') && !lowerTitle.includes('garage') && !lowerTitle.includes('house') && !lowerTitle.includes('repair')) {
    reasons.push('Misclassified Home/Garage');
  }

  // Require at least 2 reasons OR strong single indicators
  const strongIndicators = ['Single char/number', 'Code snippet', 'Very short fragment'];
  const hasStrongIndicator = reasons.some(r => strongIndicators.includes(r));

  return { isGarbage: reasons.length >= 2 || hasStrongIndicator, reasons };
}

function isDevItem(item: WorkQueueItem): boolean {
  const title = item.title.toLowerCase();
  const notes = (item.notes || '').toLowerCase();

  // Skip chat fragments that accidentally got Dev flags
  if (/^(can you|could you|why did|i want|i need|ok\.|both of|use dev|test migration|add one more|item 2:)/i.test(item.title)) {
    return false;
  }

  // Skip URL-only titles
  if (/^https?:\/\//i.test(item.title)) {
    return false;
  }

  // Bug indicators - must start with Bug: or Script failed:
  if (/^(bug:|script failed:)/i.test(item.title)) return true;

  // Sprint indicators - must start with Sprint:
  if (/^sprint:/i.test(item.title) && (item.pillar === 'The Grove' || item.pillar === 'Atlas Dev')) return true;

  // Atlas Dev pillar with Build type
  if (item.pillar === 'Atlas Dev' && item.type === 'Build') return true;

  // Pit Crew assignee with Build type
  if (item.assignee === 'Pit Crew' && item.type === 'Build') return true;

  // Feature indicators - must start with Feature: or Hotfix:
  if (/^(feature:|hotfix:)/i.test(item.title)) return true;

  // Design items for Atlas infrastructure
  if (/^design (atlas|cross-database|grove)/i.test(item.title)) return true;

  // Create Grove Sprout Factory views
  if (/^create grove sprout factory/i.test(item.title)) return true;

  return false;
}

// ============================================
// PILLAR ROUTING RULES
// ============================================

function inferPillar(item: WorkQueueItem): string | null {
  const title = item.title.toLowerCase();
  const notes = (item.notes || '').toLowerCase();
  const combined = `${title} ${notes}`;

  // Check for Grove/AI context FIRST (higher priority)
  if (/ai|llm|research|grove|atlas|blog|draft|mcp|agent|anthropic|claude|sovereign|install.*mcp|install.*grove|setup.*mcp/.test(combined)) return 'The Grove';

  // Explicit routing rules from CLAUDE.md
  if (/permit|garage|house|repair|renovation|vehicle/.test(combined) && !/grove|mcp|atlas/.test(combined)) return 'Home/Garage';
  if (/drumwave|take flight|client/.test(combined)) return 'Consulting';
  if (/gym|health|family|fitness|personal finance/.test(combined)) return 'Personal';

  // Type-based inference
  if (item.type === 'Research' || item.type === 'Draft') return 'The Grove';
  if (item.type === 'Build' && /atlas|mcp|notion|tooling|install/.test(combined)) return 'The Grove';

  return null;
}

// ============================================
// DATA EXTRACTION (with pagination)
// ============================================

async function extractAllItems(): Promise<WorkQueueItem[]> {
  const items: WorkQueueItem[] = [];
  let cursor: string | undefined;

  console.log('📥 Extracting all Work Queue items (with pagination)...');

  do {
    const response = await notion.databases.query({
      database_id: WORK_QUEUE_ID,
      page_size: 100,
      start_cursor: cursor,
    });

    for (const page of response.results as any[]) {
      items.push({
        id: page.id,
        title: page.properties.Task?.title?.[0]?.plain_text || 'Untitled',
        status: page.properties.Status?.select?.name || '?',
        priority: page.properties.Priority?.select?.name || '?',
        type: page.properties.Type?.select?.name || '?',
        pillar: page.properties.Pillar?.select?.name || '?',
        assignee: page.properties.Assignee?.select?.name || '?',
        notes: page.properties.Notes?.rich_text?.[0]?.plain_text || '',
        created: page.created_time?.split('T')[0] || 'unknown',
        url: `https://notion.so/${page.id.replace(/-/g, '')}`,
      });
    }

    cursor = response.has_more ? response.next_cursor ?? undefined : undefined;
    console.log(`  ...extracted ${items.length} items`);
  } while (cursor);

  return items;
}

async function getExistingDevPipelineItems(): Promise<Set<string>> {
  const titles = new Set<string>();
  let cursor: string | undefined;

  do {
    const response = await notion.databases.query({
      database_id: DEV_PIPELINE_ID,
      page_size: 100,
      start_cursor: cursor,
    });

    for (const page of response.results as any[]) {
      const title = page.properties.Discussion?.title?.[0]?.plain_text || '';
      titles.add(title.toLowerCase().trim());
    }

    cursor = response.has_more ? response.next_cursor ?? undefined : undefined;
  } while (cursor);

  return titles;
}

// ============================================
// PHASE 1: Analysis
// ============================================

async function phase1Analysis() {
  console.log('\n' + '='.repeat(60));
  console.log('PHASE 1: FRESH EXTRACT & ANALYSIS');
  console.log('='.repeat(60));

  const items = await extractAllItems();

  // Save to file for offline analysis
  const outputPath = join(__dirname, 'work-queue-full-extract.json');
  writeFileSync(outputPath, JSON.stringify(items, null, 2));
  console.log(`\n📁 Full extract saved to: ${outputPath}`);

  // Status distribution
  const byStatus: Record<string, number> = {};
  const byPillar: Record<string, number> = {};
  const byType: Record<string, number> = {};

  for (const item of items) {
    byStatus[item.status] = (byStatus[item.status] || 0) + 1;
    byPillar[item.pillar] = (byPillar[item.pillar] || 0) + 1;
    byType[item.type] = (byType[item.type] || 0) + 1;
  }

  console.log('\n📊 STATUS DISTRIBUTION:');
  for (const [status, count] of Object.entries(byStatus).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${status.padEnd(15)} ${count}`);
  }

  console.log('\n📊 PILLAR DISTRIBUTION:');
  for (const [pillar, count] of Object.entries(byPillar).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${pillar.padEnd(15)} ${count}`);
  }

  console.log('\n📊 TYPE DISTRIBUTION:');
  for (const [type, count] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${type.padEnd(15)} ${count}`);
  }

  // Identify problems
  const problemItems = {
    missingStatus: items.filter(i => i.status === '?'),
    missingPillar: items.filter(i => i.pillar === '?'),
    missingAssignee: items.filter(i => i.assignee === '?'),
    garbage: items.filter(i => isGarbage(i).isGarbage),
    devItems: items.filter(i => isDevItem(i)),
    done: items.filter(i => i.status === 'Done'),
  };

  console.log('\n🔍 PROBLEM CATEGORIES:');
  console.log(`  Missing Status (?)      ${problemItems.missingStatus.length}`);
  console.log(`  Missing Pillar (?)      ${problemItems.missingPillar.length}`);
  console.log(`  Missing Assignee (?)    ${problemItems.missingAssignee.length}`);
  console.log(`  Garbage (chat/meta)     ${problemItems.garbage.length}`);
  console.log(`  Dev Items (migrate)     ${problemItems.devItems.length}`);
  console.log(`  Done (potential close)  ${problemItems.done.length}`);

  console.log('\n📋 TOTAL ITEMS:', items.length);

  return items;
}

// ============================================
// PHASE 2: Garbage Cleanup
// ============================================

async function phase2GarbageCleanup() {
  console.log('\n' + '='.repeat(60));
  console.log('PHASE 2: GARBAGE IDENTIFICATION & CLEANUP');
  console.log('='.repeat(60));

  const items = await extractAllItems();
  const garbageItems: { item: WorkQueueItem; reasons: string[] }[] = [];

  for (const item of items) {
    // Skip already-archived items (status = Done with certain patterns)
    if (item.status === 'Done' && item.type === 'Answer') continue;

    const result = isGarbage(item);
    if (result.isGarbage) {
      garbageItems.push({ item, reasons: result.reasons });
    }
  }

  console.log(`\n🗑️ GARBAGE ITEMS IDENTIFIED: ${garbageItems.length}`);
  console.log('');

  for (const { item, reasons } of garbageItems) {
    console.log(`[${item.id.substring(0, 8)}] ${item.title.substring(0, 50)}`);
    console.log(`  Status: ${item.status} | Pillar: ${item.pillar} | Type: ${item.type}`);
    console.log(`  Reasons: ${reasons.join(', ')}`);
    console.log('');
  }

  if (DRY_RUN) {
    console.log('🔒 DRY RUN - No changes made');
    console.log(`Would archive ${garbageItems.length} items`);
    return;
  }

  // Archive garbage items
  console.log('\n📦 ARCHIVING GARBAGE ITEMS...');
  let archived = 0;
  let failed = 0;

  for (const { item, reasons } of garbageItems) {
    try {
      await notion.pages.update({
        page_id: item.id,
        archived: true,
      });
      archived++;
      console.log(`  ✓ Archived: ${item.title.substring(0, 40)}`);
    } catch (e: any) {
      failed++;
      console.log(`  ✗ Failed: ${item.title.substring(0, 40)} - ${e.message}`);
    }
  }

  console.log(`\n✅ Archived: ${archived} | Failed: ${failed}`);

  // Log to Feed
  await logToFeed(`Work Queue Cleanup (Phase 2): Archived ${archived} garbage items (chat fragments, meta-instructions, questions)`);
}

// ============================================
// PHASE 3: Dev Pipeline Migration
// ============================================

async function phase3DevMigration() {
  console.log('\n' + '='.repeat(60));
  console.log('PHASE 3: DEV PIPELINE MIGRATION');
  console.log('='.repeat(60));

  const items = await extractAllItems();
  const existingDevTitles = await getExistingDevPipelineItems();

  const devItems = items.filter(i => isDevItem(i) && i.status !== 'Done');

  console.log(`\n🔧 DEV ITEMS IDENTIFIED: ${devItems.length}`);
  console.log(`📋 Existing Dev Pipeline items: ${existingDevTitles.size}`);
  console.log('');

  const toMigrate: WorkQueueItem[] = [];
  const alreadyExists: WorkQueueItem[] = [];

  for (const item of devItems) {
    const normalizedTitle = item.title.toLowerCase().trim();
    if (existingDevTitles.has(normalizedTitle)) {
      alreadyExists.push(item);
    } else {
      toMigrate.push(item);
    }
  }

  console.log(`To migrate: ${toMigrate.length}`);
  console.log(`Already in Dev Pipeline: ${alreadyExists.length}`);
  console.log('');

  for (const item of toMigrate) {
    console.log(`[MIGRATE] ${item.title.substring(0, 50)}`);
    console.log(`  Status: ${item.status} | Priority: ${item.priority}`);
  }

  for (const item of alreadyExists) {
    console.log(`[EXISTS] ${item.title.substring(0, 50)}`);
  }

  if (DRY_RUN) {
    console.log('\n🔒 DRY RUN - No changes made');
    return;
  }

  // Create items in Dev Pipeline and archive from Work Queue
  console.log('\n📦 MIGRATING TO DEV PIPELINE...');
  let migrated = 0;
  let failed = 0;

  for (const item of toMigrate) {
    try {
      // Determine type for Dev Pipeline
      let devType = 'BUG';
      if (/sprint/i.test(item.title)) devType = 'SPRINT';
      if (/feature/i.test(item.title)) devType = 'FEATURE';
      if (/hotfix/i.test(item.title)) devType = 'HOTFIX';

      // Create in Dev Pipeline
      await notion.pages.create({
        parent: { database_id: DEV_PIPELINE_ID },
        properties: {
          'Discussion': { title: [{ text: { content: item.title } }] },
          'Type': { select: { name: devType } },
          'Priority': { select: { name: item.priority !== '?' ? item.priority : 'P2' } },
          'Status': { select: { name: 'Captured' } },
        },
      });

      // Archive from Work Queue
      await notion.pages.update({
        page_id: item.id,
        archived: true,
      });

      migrated++;
      console.log(`  ✓ Migrated: ${item.title.substring(0, 40)}`);
    } catch (e: any) {
      failed++;
      console.log(`  ✗ Failed: ${item.title.substring(0, 40)} - ${e.message}`);
    }
  }

  // Archive items that already exist
  for (const item of alreadyExists) {
    try {
      await notion.pages.update({
        page_id: item.id,
        archived: true,
      });
      console.log(`  ✓ Archived (exists): ${item.title.substring(0, 40)}`);
    } catch (e: any) {
      console.log(`  ✗ Failed archive: ${item.title.substring(0, 40)}`);
    }
  }

  console.log(`\n✅ Migrated: ${migrated} | Failed: ${failed}`);

  await logToFeed(`Work Queue Cleanup (Phase 3): Migrated ${migrated} dev items to Dev Pipeline`);
}

// ============================================
// PHASE 4: Metadata Cleanup
// ============================================

async function phase4MetadataCleanup() {
  console.log('\n' + '='.repeat(60));
  console.log('PHASE 4: METADATA CLEANUP');
  console.log('='.repeat(60));

  const items = await extractAllItems();
  const updates: CleanupAction[] = [];

  for (const item of items) {
    const updateProps: Record<string, any> = {};
    const reasons: string[] = [];

    // Fix missing status
    if (item.status === '?') {
      updateProps.Status = { select: { name: 'Captured' } };
      reasons.push('status: ? → Captured');
    }

    // Fix missing pillar
    if (item.pillar === '?') {
      const inferred = inferPillar(item);
      if (inferred) {
        updateProps.Pillar = { select: { name: inferred } };
        reasons.push(`pillar: ? → ${inferred}`);
      }
    }

    // Fix missing assignee (default based on pillar/type)
    if (item.assignee === '?' && Object.keys(updateProps).length > 0) {
      if (item.type === 'Research' || item.type === 'Draft') {
        updateProps.Assignee = { select: { name: 'Atlas [Telegram]' } };
        reasons.push('assignee: ? → Atlas [Telegram]');
      } else if (item.type === 'Build') {
        updateProps.Assignee = { select: { name: 'Jim' } };
        reasons.push('assignee: ? → Jim');
      }
    }

    if (Object.keys(updateProps).length > 0) {
      updates.push({
        id: item.id,
        title: item.title,
        action: 'update',
        reason: reasons.join(', '),
        updates: updateProps,
      });
    }
  }

  console.log(`\n📝 ITEMS TO UPDATE: ${updates.length}`);
  console.log('');

  for (const update of updates) {
    console.log(`[${update.id.substring(0, 8)}] ${update.title.substring(0, 45)}`);
    console.log(`  ${update.reason}`);
  }

  if (DRY_RUN) {
    console.log('\n🔒 DRY RUN - No changes made');
    return;
  }

  console.log('\n📝 APPLYING UPDATES...');
  let updated = 0;
  let failed = 0;

  for (const action of updates) {
    try {
      await notion.pages.update({
        page_id: action.id,
        properties: action.updates!,
      });
      updated++;
      console.log(`  ✓ Updated: ${action.title.substring(0, 40)}`);
    } catch (e: any) {
      failed++;
      console.log(`  ✗ Failed: ${action.title.substring(0, 40)} - ${e.message}`);
    }
  }

  console.log(`\n✅ Updated: ${updated} | Failed: ${failed}`);

  await logToFeed(`Work Queue Cleanup (Phase 4): Updated metadata on ${updated} items`);
}

// ============================================
// PHASE 5: Structural Fixes
// ============================================

async function phase5StructuralFixes() {
  console.log('\n' + '='.repeat(60));
  console.log('PHASE 5: STRUCTURAL FIXES');
  console.log('='.repeat(60));

  const items = await extractAllItems();

  // Find URL-only titles
  const urlOnlyItems = items.filter(i => GARBAGE_PATTERNS.urlOnly.test(i.title));

  // Find potential duplicates
  const titleMap: Map<string, WorkQueueItem[]> = new Map();
  for (const item of items) {
    const key = item.title.toLowerCase()
      .replace(/research:|build:|draft:|sprint:|bug:/gi, '')
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 40);

    if (!titleMap.has(key)) titleMap.set(key, []);
    titleMap.get(key)!.push(item);
  }

  const duplicateGroups = Array.from(titleMap.entries())
    .filter(([_, items]) => items.length > 1);

  console.log(`\n🔗 URL-ONLY TITLES: ${urlOnlyItems.length}`);
  for (const item of urlOnlyItems) {
    console.log(`  [${item.id.substring(0, 8)}] ${item.title.substring(0, 60)}`);
  }

  console.log(`\n🔀 DUPLICATE GROUPS: ${duplicateGroups.length}`);
  for (const [key, items] of duplicateGroups) {
    console.log(`\n  "${key}" (${items.length} items):`);
    for (const item of items) {
      console.log(`    [${item.status}] ${item.title.substring(0, 45)}`);
    }
  }

  if (DRY_RUN) {
    console.log('\n🔒 DRY RUN - No changes made');
    console.log('Manual review recommended for URL-only and duplicates');
    return;
  }

  // Convert URL-only to Research tasks
  console.log('\n📝 CONVERTING URL-ONLY TO RESEARCH...');
  for (const item of urlOnlyItems) {
    try {
      // Extract domain for title
      const url = new URL(item.title);
      const domain = url.hostname.replace('www.', '');
      const newTitle = `Research: ${domain} content`;

      await notion.pages.update({
        page_id: item.id,
        properties: {
          'Task': { title: [{ text: { content: newTitle } }] },
          'Type': { select: { name: 'Research' } },
          'Notes': { rich_text: [{ text: { content: `Original URL: ${item.title}\n\n${item.notes}` } }] },
        },
      });
      console.log(`  ✓ Converted: ${domain}`);
    } catch (e: any) {
      console.log(`  ✗ Failed: ${item.title.substring(0, 40)} - ${e.message}`);
    }
  }

  // For duplicates, keep the one with most metadata and archive others
  console.log('\n📦 MERGING DUPLICATES...');
  for (const [key, dupes] of duplicateGroups) {
    // Score each by metadata completeness
    const scored = dupes.map(d => ({
      item: d,
      score: (d.status !== '?' ? 1 : 0) + (d.pillar !== '?' ? 1 : 0) + (d.notes.length > 10 ? 1 : 0) + (d.status === 'Done' ? 2 : 0),
    })).sort((a, b) => b.score - a.score);

    const keep = scored[0].item;
    const archive = scored.slice(1).map(s => s.item);

    console.log(`  Keeping: ${keep.title.substring(0, 40)} (score: ${scored[0].score})`);

    for (const item of archive) {
      try {
        await notion.pages.update({
          page_id: item.id,
          archived: true,
        });
        console.log(`    ✓ Archived duplicate: ${item.id.substring(0, 8)}`);
      } catch (e: any) {
        console.log(`    ✗ Failed: ${item.id.substring(0, 8)}`);
      }
    }
  }

  await logToFeed(`Work Queue Cleanup (Phase 5): Converted ${urlOnlyItems.length} URL-only items, merged ${duplicateGroups.length} duplicate groups`);
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

async function logToFeed(message: string) {
  try {
    await notion.pages.create({
      parent: { database_id: FEED_ID },
      properties: {
        'Entry': { title: [{ text: { content: message } }] },
        'Source': { select: { name: 'System' } },
        'Status': { select: { name: 'Done' } },
        'Date': { date: { start: new Date().toISOString() } },
      },
    });
    console.log(`\n📝 Logged to Feed: ${message.substring(0, 50)}...`);
  } catch (e) {
    console.log(`\n⚠️ Failed to log to Feed`);
  }
}

// ============================================
// MAIN
// ============================================

async function main() {
  console.log('='.repeat(60));
  console.log('WORK QUEUE 2.0 CLEANUP');
  console.log('Date:', new Date().toISOString().split('T')[0]);
  console.log('Mode:', DRY_RUN ? 'DRY RUN' : 'EXECUTE');
  console.log('='.repeat(60));

  if (!PHASE && !RUN_ALL) {
    console.log('\nUsage:');
    console.log('  --phase=1        Analysis only');
    console.log('  --phase=2        Garbage cleanup');
    console.log('  --phase=3        Dev pipeline migration');
    console.log('  --phase=4        Metadata cleanup');
    console.log('  --phase=5        Structural fixes');
    console.log('  --all            Run all phases');
    console.log('  --dry-run        Preview without changes');
    return;
  }

  if (RUN_ALL || PHASE === 1) await phase1Analysis();
  if (RUN_ALL || PHASE === 2) await phase2GarbageCleanup();
  if (RUN_ALL || PHASE === 3) await phase3DevMigration();
  if (RUN_ALL || PHASE === 4) await phase4MetadataCleanup();
  if (RUN_ALL || PHASE === 5) await phase5StructuralFixes();

  console.log('\n' + '='.repeat(60));
  console.log('CLEANUP COMPLETE');
  console.log('='.repeat(60));
}

main().catch(console.error);
