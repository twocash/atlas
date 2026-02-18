#!/usr/bin/env bun
/**
 * Triage Pattern Seeding Script
 *
 * Bootstrap the pattern cache from historical Feed 2.0 entries.
 * Finds entries that were manually classified/corrected and uses
 * them to seed the triage pattern cache for instant classification.
 *
 * Usage:
 *   bun run src/scripts/seed-triage-patterns.ts
 *
 * Options:
 *   --dry-run    Show what would be seeded without actually seeding
 *   --limit N    Limit to N entries (default: 100)
 *   --min-conf N Minimum confidence to seed (default: 0.8)
 */

import { Client } from '@notionhq/client';
import { NOTION_DB } from '@atlas/shared/config';
import { seedPatterns, type TriagePattern } from '../cognitive/triage-patterns';
import { generatePatternKey } from '../cognitive/triage-patterns';

// Feed 2.0 database ID (from @atlas/shared/config)
const FEED_DATABASE_ID = NOTION_DB.FEED;

// Parse command line args
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const limitIdx = args.indexOf('--limit');
const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) : 100;
const minConfIdx = args.indexOf('--min-conf');
const minConfidence = minConfIdx >= 0 ? parseFloat(args[minConfIdx + 1]) : 0.8;

interface FeedEntry {
  id: string;
  title: string;
  pillar: string;
  requestType: string;
  source: string;
  confidence?: number;
  classificationConfirmed?: boolean;
  keywords?: string[];
  createdTime: string;
}

/**
 * Extract text property from Notion rich_text field
 */
function getTextContent(richText: any[]): string {
  if (!richText || !Array.isArray(richText)) return '';
  return richText.map((t) => t.plain_text || '').join('');
}

/**
 * Query Feed 2.0 for entries that can be used as patterns
 *
 * We look for entries that:
 * 1. Have a high confidence score OR were confirmed
 * 2. Have a valid pillar classification
 * 3. Came from Telegram (user interactions, not automated)
 */
async function queryFeedEntries(): Promise<FeedEntry[]> {
  const notion = new Client({ auth: process.env.NOTION_API_KEY });
  const entries: FeedEntry[] = [];

  console.log('📊 Querying Feed 2.0 for pattern candidates...\n');

  try {
    // Query with filters
    const response = await notion.databases.query({
      database_id: FEED_DATABASE_ID,
      filter: {
        and: [
          // Only Telegram entries (user interactions)
          {
            property: 'Source',
            select: { equals: 'Telegram' },
          },
          // Has a pillar classification
          {
            property: 'Pillar',
            select: { is_not_empty: true },
          },
        ],
      },
      sorts: [
        { timestamp: 'created_time', direction: 'descending' },
      ],
      page_size: Math.min(limit, 100),
    });

    for (const page of response.results) {
      if (page.object !== 'page' || !('properties' in page)) continue;

      const props = page.properties as Record<string, any>;

      // Extract title
      const titleProp = props['Entry'];
      const title = titleProp?.title
        ? getTextContent(titleProp.title)
        : '';

      if (!title) continue;

      // Extract pillar
      const pillarProp = props['Pillar'];
      const pillar = pillarProp?.select?.name || '';

      if (!pillar) continue;

      // Extract request type
      const requestTypeProp = props['Request Type'];
      const requestType = requestTypeProp?.select?.name || 'Research';

      // Extract source
      const sourceProp = props['Source'];
      const source = sourceProp?.select?.name || '';

      // Extract confidence
      const confidenceProp = props['Confidence'];
      const confidence = confidenceProp?.number ?? undefined;

      // Extract classification confirmed
      const confirmedProp = props['Classification Confirmed'];
      const classificationConfirmed = confirmedProp?.checkbox ?? false;

      // Extract keywords
      const keywordsProp = props['Keywords'];
      const keywords = keywordsProp?.multi_select
        ? keywordsProp.multi_select.map((k: any) => k.name)
        : [];

      entries.push({
        id: page.id,
        title,
        pillar,
        requestType,
        source,
        confidence,
        classificationConfirmed,
        keywords,
        createdTime: (page as any).created_time,
      });
    }

    console.log(`Found ${entries.length} potential pattern candidates\n`);
    return entries;

  } catch (error) {
    console.error('Failed to query Feed 2.0:', error);
    throw error;
  }
}

/**
 * Convert Feed entries to triage patterns
 */
function entriesToPatterns(entries: FeedEntry[]): TriagePattern[] {
  const patternMap = new Map<string, TriagePattern>();

  for (const entry of entries) {
    // Skip entries without sufficient confidence
    if (entry.confidence !== undefined && entry.confidence < minConfidence) {
      continue;
    }

    // Generate pattern key from title
    const patternKey = generatePatternKey(entry.title);

    // Determine intent from request type
    const intent = inferIntent(entry.requestType);

    // Get or create pattern
    const existing = patternMap.get(patternKey);

    if (existing) {
      // Increment count and add example
      existing.confirmCount++;
      if (!existing.examples.includes(entry.title) && existing.examples.length < 3) {
        existing.examples.unshift(entry.title);
      }
      // Update lastSeen if newer
      if (entry.createdTime > existing.lastSeen) {
        existing.lastSeen = entry.createdTime;
      }
    } else {
      // Create new pattern
      patternMap.set(patternKey, {
        patternKey,
        confirmedResult: {
          intent,
          pillar: entry.pillar as any,
          requestType: entry.requestType as any,
          keywords: entry.keywords,
        },
        confirmCount: 1,
        correctionCount: 0,
        lastSeen: entry.createdTime,
        examples: [entry.title],
      });
    }
  }

  return Array.from(patternMap.values());
}

/**
 * Infer intent from request type
 */
function inferIntent(requestType: string): 'command' | 'capture' | 'query' | 'clarify' {
  switch (requestType.toLowerCase()) {
    case 'build':
    case 'process':
      return 'command';
    case 'answer':
      return 'query';
    default:
      return 'capture';
  }
}

/**
 * Main bootstrap process
 */
async function main() {
  console.log('🌱 Triage Pattern Seeding Script\n');
  console.log(`Options:`);
  console.log(`  --dry-run: ${dryRun}`);
  console.log(`  --limit: ${limit}`);
  console.log(`  --min-conf: ${minConfidence}\n`);

  // Check for API key
  if (!process.env.NOTION_API_KEY) {
    console.error('❌ NOTION_API_KEY environment variable not set');
    process.exit(1);
  }

  // Query Feed entries
  const entries = await queryFeedEntries();

  if (entries.length === 0) {
    console.log('No entries found to seed patterns from.');
    return;
  }

  // Convert to patterns
  const patterns = entriesToPatterns(entries);

  // Filter patterns with enough confirmations
  const qualifiedPatterns = patterns.filter((p) => p.confirmCount >= 2);

  console.log(`📋 Pattern Summary:`);
  console.log(`  Total unique patterns: ${patterns.length}`);
  console.log(`  Qualified patterns (≥2 confirmations): ${qualifiedPatterns.length}\n`);

  if (qualifiedPatterns.length === 0) {
    console.log('No patterns qualified for seeding (need at least 2 confirmations).');
    return;
  }

  // Show patterns
  console.log('🔍 Qualified Patterns:\n');
  for (const pattern of qualifiedPatterns.slice(0, 20)) {
    const pillar = pattern.confirmedResult.pillar || 'Unknown';
    const intent = pattern.confirmedResult.intent || 'capture';
    console.log(`  ${pattern.patternKey}`);
    console.log(`    Intent: ${intent}, Pillar: ${pillar}`);
    console.log(`    Confirmations: ${pattern.confirmCount}`);
    console.log(`    Example: "${pattern.examples[0]?.substring(0, 60)}..."\n`);
  }

  if (qualifiedPatterns.length > 20) {
    console.log(`  ... and ${qualifiedPatterns.length - 20} more patterns\n`);
  }

  // Seed patterns
  if (dryRun) {
    console.log('🔸 DRY RUN - No patterns seeded\n');
  } else {
    console.log('💾 Seeding patterns...\n');
    seedPatterns(qualifiedPatterns);
    console.log(`✅ Seeded ${qualifiedPatterns.length} patterns to cache\n`);
  }

  console.log('Done!');
}

// Run
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
