#!/usr/bin/env bun
/**
 * Update Routing Corpus from Corrections
 *
 * Queries Feed 2.0 for correction entries, generates corpus entries,
 * outputs diff for review. Run manually or as weekly job.
 *
 * Usage:
 *   bun run scripts/update-corpus-from-corrections.ts
 *   bun run scripts/update-corpus-from-corrections.ts --days 14
 *   bun run scripts/update-corpus-from-corrections.ts --dry-run
 *
 * @see STAB-002c correction-logger.ts for correction entry format
 * @see packages/agents/test/fixtures/routing-corpus.json
 */

import { parseArgs } from 'util';
import * as fs from 'fs';
import * as path from 'path';

// Parse CLI args
const { values: args } = parseArgs({
  args: process.argv.slice(2),
  options: {
    days: { type: 'string', default: '7' },
    'dry-run': { type: 'boolean', default: false },
    output: { type: 'string', default: '' },
  },
});

const DAYS_BACK = parseInt(args.days as string, 10);
const DRY_RUN = args['dry-run'];
const CORPUS_PATH = path.resolve(__dirname, '../packages/agents/test/fixtures/routing-corpus.json');
const FEED_DB_ID = '90b2b33f-4b44-4b42-870f-8d62fb8cbf18';

// Types matching correction-logger.ts
interface CorrectionEntry {
  id: string;
  properties: {
    Type: string;
    original_domain: string;
    corrected_domain: string;
    original_audience?: string;
    corrected_audience?: string;
    message_keywords: string[];
    message_hash: string;
    timestamp: string;
    source: 'explicit' | 'reclassification' | 'feedback';
  };
}

interface CorpusEntry {
  id: string;
  input: string;
  expected: {
    domain: string;
    audience: string;
    complexity: string;
    action: string;
    shouldCapture: boolean;
  };
  handoffs: Record<string, unknown>;
  meta: {
    addedAt: string;
    source: 'manual' | 'correction' | 'failure';
    notes?: string;
    relatedCorrection?: string;
  };
}

interface Corpus {
  version: string;
  updated: string;
  description: string;
  entries: CorpusEntry[];
}

// Notion client stub - replace with actual client
async function queryFeedCorrections(daysBack: number): Promise<CorrectionEntry[]> {
  // TODO: Wire to actual Notion client
  // This would be:
  //
  // const notion = new NotionClient();
  // const since = new Date();
  // since.setDate(since.getDate() - daysBack);
  //
  // return notion.queryDatabase(FEED_DB_ID, {
  //   filter: {
  //     and: [
  //       { property: 'Type', equals: 'correction' },
  //       { property: 'Created', on_or_after: since.toISOString() }
  //     ]
  //   }
  // });

  console.log(`📡 Querying Feed for corrections from last ${daysBack} days...`);
  console.log(`   Database: ${FEED_DB_ID}`);
  console.log('');

  // For now, return empty - replace with actual query
  console.log('⚠️  Notion client not wired. Replace stub in update-corpus-from-corrections.ts');
  console.log('');

  return [];
}

function reconstructInput(keywords: string[]): string {
  // Best-effort input reconstruction from keywords
  // In practice, you might want to store the original message hash
  // and look it up, or just use keywords as the test input
  return keywords.join(' ');
}

function keywordsMatch(input: string, keywords: string[]): boolean {
  const inputLower = input.toLowerCase();
  return keywords.every(kw => inputLower.includes(kw.toLowerCase()));
}

function generateCorpusEntry(correction: CorrectionEntry): CorpusEntry {
  const keywords = correction.properties.message_keywords;
  const timestamp = new Date().toISOString().split('T')[0];

  return {
    id: `correction-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    input: reconstructInput(keywords),
    expected: {
      domain: correction.properties.corrected_domain,
      audience: correction.properties.corrected_audience || 'self',
      complexity: 'simple', // Conservative default
      action: 'act',
      shouldCapture: true,
    },
    handoffs: {},
    meta: {
      addedAt: timestamp,
      source: 'correction',
      notes: `Auto-generated from correction. Original domain: ${correction.properties.original_domain}`,
      relatedCorrection: correction.id,
    },
  };
}

async function main() {
  console.log('═'.repeat(60));
  console.log('📋 UPDATE ROUTING CORPUS FROM CORRECTIONS');
  console.log('═'.repeat(60));
  console.log('');

  // Load existing corpus
  let corpus: Corpus;
  try {
    const raw = fs.readFileSync(CORPUS_PATH, 'utf-8');
    corpus = JSON.parse(raw);
    console.log(`✓ Loaded corpus: ${corpus.entries.length} entries`);
  } catch (e) {
    console.error(`✗ Failed to load corpus from ${CORPUS_PATH}`);
    console.error(e);
    process.exit(1);
  }

  // Query corrections
  const corrections = await queryFeedCorrections(DAYS_BACK);
  console.log(`✓ Found ${corrections.length} corrections in last ${DAYS_BACK} days`);
  console.log('');

  if (corrections.length === 0) {
    console.log('No corrections to process. Corpus is up to date.');
    return;
  }

  // Process corrections
  const newEntries: CorpusEntry[] = [];
  const skipped: Array<{ reason: string; keywords: string[] }> = [];

  for (const correction of corrections) {
    const keywords = correction.properties.message_keywords;

    // Check if pattern already covered
    const existingEntry = corpus.entries.find(e => keywordsMatch(e.input, keywords));
    if (existingEntry) {
      skipped.push({ reason: `Already covered by ${existingEntry.id}`, keywords });
      continue;
    }

    // Check for duplicate in new entries
    const duplicateNew = newEntries.find(e => keywordsMatch(e.input, keywords));
    if (duplicateNew) {
      skipped.push({ reason: `Duplicate of new entry ${duplicateNew.id}`, keywords });
      continue;
    }

    // Generate new entry
    const entry = generateCorpusEntry(correction);
    newEntries.push(entry);
  }

  // Report
  console.log('─'.repeat(60));
  console.log('RESULTS');
  console.log('─'.repeat(60));
  console.log('');

  if (skipped.length > 0) {
    console.log(`⏭️  Skipped: ${skipped.length}`);
    for (const { reason, keywords } of skipped) {
      console.log(`   - "${keywords.join(', ')}": ${reason}`);
    }
    console.log('');
  }

  if (newEntries.length === 0) {
    console.log('✓ No new entries to add. Corpus is up to date.');
    return;
  }

  console.log(`✅ New entries: ${newEntries.length}`);
  console.log('');
  console.log('─'.repeat(60));
  console.log('NEW ENTRIES (review before adding)');
  console.log('─'.repeat(60));
  console.log('');
  console.log(JSON.stringify(newEntries, null, 2));
  console.log('');

  if (DRY_RUN) {
    console.log('─'.repeat(60));
    console.log('DRY RUN - No changes made');
    console.log('─'.repeat(60));
    console.log('');
    console.log('To apply changes, run without --dry-run flag.');
    return;
  }

  // Prompt for confirmation
  console.log('─'.repeat(60));
  console.log('NEXT STEPS');
  console.log('─'.repeat(60));
  console.log('');
  console.log('1. Review the entries above');
  console.log('2. Copy the JSON and add to routing-corpus.json manually, OR');
  console.log('3. Run with --output flag to write to a file:');
  console.log(`   bun run scripts/update-corpus-from-corrections.ts --output new-entries.json`);
  console.log('');
  console.log('4. After adding to corpus:');
  console.log('   bun test packages/agents/test/routing-corpus.test.ts');
  console.log('');
  console.log('5. Commit with message:');
  console.log('   git commit -m "test: add corpus entries from corrections"');
  console.log('');

  // Write to file if --output specified
  if (args.output) {
    const outputPath = path.resolve(args.output as string);
    fs.writeFileSync(outputPath, JSON.stringify(newEntries, null, 2));
    console.log(`✓ Written to ${outputPath}`);
  }
}

main().catch(console.error);
