#!/usr/bin/env bun
/**
 * Daily Routing Sample
 *
 * Samples random Feed entries from last 24h for human review.
 * 5 minutes/day compounds into quality over time.
 *
 * Usage:
 *   bun run scripts/daily-sample.ts
 *   bun run scripts/daily-sample.ts --count 10
 *   bun run scripts/daily-sample.ts --hours 48
 *
 * Review Process:
 *   1. Look at each entry
 *   2. Rate: good / bad / okay
 *   3. If bad, identify which handoff failed
 *   4. Bad entries become correction candidates
 */

import { parseArgs } from 'util';

// Parse CLI args
const { values: args } = parseArgs({
  args: process.argv.slice(2),
  options: {
    count: { type: 'string', default: '5' },
    hours: { type: 'string', default: '24' },
    format: { type: 'string', default: 'interactive' }, // or 'json'
  },
});

const SAMPLE_COUNT = parseInt(args.count as string, 10);
const HOURS_BACK = parseInt(args.hours as string, 10);
const FEED_DB_ID = '90b2b33f-4b44-4b42-870f-8d62fb8cbf18';

interface FeedEntry {
  id: string;
  input: string;
  domain: string;
  audience: string;
  complexity: string;
  action: string;
  pillar: string;
  slots: {
    identity: { status: string };
    voice: { status: string };
    domainRag: { status: string; workspace?: string };
    pov: { status: string };
    browser: { status: string };
  };
  output?: string;
  timestamp: string;
}

function pickRandom<T>(arr: T[], count: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

function formatSlotHealth(slots: FeedEntry['slots']): string {
  const statuses = [
    `id:${slots.identity?.status || '?'}`,
    `voice:${slots.voice?.status || '?'}`,
    `rag:${slots.domainRag?.status || '?'}`,
    `pov:${slots.pov?.status || '?'}`,
  ];

  const healthy = statuses.filter(s => s.includes('success')).length;
  const icon = healthy === 4 ? '🟢' : healthy >= 2 ? '🟡' : '🔴';

  return `${icon} ${statuses.join(' | ')}`;
}

function truncate(str: string, len: number): string {
  if (!str) return '(empty)';
  if (str.length <= len) return str;
  return str.slice(0, len - 3) + '...';
}

async function queryRecentFeedEntries(hoursBack: number): Promise<FeedEntry[]> {
  // TODO: Wire to actual Notion client
  // This would query Feed 2.0 for entries in the time window

  console.log(`📡 Querying Feed for entries from last ${hoursBack} hours...`);
  console.log(`   Database: ${FEED_DB_ID}`);
  console.log('');

  // Mock data for demonstration
  const mockEntries: FeedEntry[] = [
    {
      id: 'entry-001',
      input: 'Research concentration risk for Chase',
      domain: 'grove',
      audience: 'client',
      complexity: 'moderate',
      action: 'act',
      pillar: 'The Grove',
      slots: {
        identity: { status: 'success' },
        voice: { status: 'success' },
        domainRag: { status: 'success', workspace: 'grove-technical' },
        pov: { status: 'success' },
        browser: { status: 'empty' },
      },
      output: 'Analysis of infrastructure concentration risk across major cloud providers...',
      timestamp: new Date().toISOString(),
    },
    {
      id: 'entry-002',
      input: 'add milk to grocery list',
      domain: 'personal',
      audience: 'self',
      complexity: 'simple',
      action: 'act',
      pillar: 'Personal',
      slots: {
        identity: { status: 'success' },
        voice: { status: 'success' },
        domainRag: { status: 'empty' },
        pov: { status: 'empty' },
        browser: { status: 'empty' },
      },
      output: 'Added milk to your grocery list.',
      timestamp: new Date().toISOString(),
    },
  ];

  console.log('⚠️  Using mock data. Wire Notion client for real entries.');
  console.log('');

  return mockEntries;
}

async function main() {
  console.log('');
  console.log('═'.repeat(60));
  console.log('📋 DAILY ROUTING SAMPLE');
  console.log('═'.repeat(60));
  console.log(`   Sampling ${SAMPLE_COUNT} entries from last ${HOURS_BACK} hours`);
  console.log('');

  // Query entries
  const entries = await queryRecentFeedEntries(HOURS_BACK);

  if (entries.length === 0) {
    console.log('No entries found in time window.');
    return;
  }

  // Sample
  const sample = pickRandom(entries, Math.min(SAMPLE_COUNT, entries.length));

  console.log(`Found ${entries.length} entries, sampling ${sample.length}`);
  console.log('');
  console.log('─'.repeat(60));
  console.log('');

  // Display each entry for review
  for (let i = 0; i < sample.length; i++) {
    const entry = sample[i];

    console.log(`[${i + 1}/${sample.length}] ${entry.id}`);
    console.log('─'.repeat(40));
    console.log('');
    console.log(`📝 Input:      "${truncate(entry.input, 60)}"`);
    console.log('');
    console.log(`   Domain:     ${entry.domain}`);
    console.log(`   Audience:   ${entry.audience}`);
    console.log(`   Complexity: ${entry.complexity}`);
    console.log(`   Action:     ${entry.action}`);
    console.log(`   Pillar:     ${entry.pillar}`);
    console.log('');
    console.log(`   Slots:      ${formatSlotHealth(entry.slots)}`);

    if (entry.slots.domainRag?.workspace) {
      console.log(`   RAG:        ${entry.slots.domainRag.workspace}`);
    }

    console.log('');
    console.log(`📤 Output:     "${truncate(entry.output || '', 80)}"`);
    console.log('');
    console.log('   Rate:  [good]  [bad]  [okay]');
    console.log('');

    if (i < sample.length - 1) {
      console.log('   If bad, which handoff?');
      console.log('   [ ] domain   [ ] audience   [ ] slot   [ ] drafter   [ ] other');
      console.log('');
      console.log('═'.repeat(60));
      console.log('');
    }
  }

  // Summary
  console.log('─'.repeat(60));
  console.log('REVIEW COMPLETE');
  console.log('─'.repeat(60));
  console.log('');
  console.log('Next steps for bad entries:');
  console.log('');
  console.log('1. Identify the failed handoff');
  console.log('');
  console.log('2. If routing was wrong:');
  console.log('   - In Atlas: "that should have been [domain]"');
  console.log('   - This logs a correction to Feed');
  console.log('   - Weekly: run update-corpus-from-corrections.ts');
  console.log('');
  console.log('3. If slot failed:');
  console.log('   - Check AnythingLLM / POV Library health');
  console.log('   - File bug if systemic');
  console.log('');
  console.log('4. If drafter/voice was wrong:');
  console.log('   - Check audience inference');
  console.log('   - May need audience signal rules update');
  console.log('');
  console.log('Time spent: ~5 minutes. Quality compounds.');
  console.log('');
}

main().catch(console.error);
