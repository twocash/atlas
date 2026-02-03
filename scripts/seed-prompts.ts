#!/usr/bin/env npx tsx
/**
 * Atlas System Prompts Seeder
 *
 * Populates the Atlas System Prompts database with initial prompts from prompts-v1.json.
 * Run after setup-prompts-db.ts has created the database.
 *
 * Usage:
 *   npx tsx scripts/seed-prompts.ts
 *
 * Prerequisites:
 *   - NOTION_API_KEY must be set
 *   - NOTION_PROMPTS_DB_ID must be set (from setup-prompts-db.ts output)
 *   - apps/telegram/data/migrations/prompts-v1.json must exist
 *
 * @see scripts/setup-prompts-db.ts to create the database first
 */

import { Client } from '@notionhq/client';
import { config } from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

// Dynamically resolve paths based on where script is run from
const isFromTelegram = __dirname.includes('telegram');
const envPath = isFromTelegram
  ? path.join(__dirname, '.env')
  : path.join(__dirname, '../apps/telegram/.env');
const promptsPath = isFromTelegram
  ? path.join(__dirname, 'data/migrations/prompts-v1.json')
  : path.join(__dirname, '../apps/telegram/data/migrations/prompts-v1.json');

// Load environment
config({ path: envPath });

// ==========================================
// Configuration
// ==========================================

const NOTION_API_KEY = process.env.NOTION_API_KEY;
const DATABASE_ID = process.env.NOTION_PROMPTS_DB_ID;
const PROMPTS_FILE = promptsPath;

/** Delay between API calls to respect rate limits (ms) */
const API_DELAY_MS = 200;

if (!NOTION_API_KEY) {
  console.error('❌ NOTION_API_KEY not found in environment');
  process.exit(1);
}

if (!DATABASE_ID) {
  console.error('❌ NOTION_PROMPTS_DB_ID not found in environment');
  console.error('   Run setup-prompts-db.ts first, then add the ID to .env');
  process.exit(1);
}

// ==========================================
// Types
// ==========================================

interface PromptRecord {
  id: string;
  capability: string;
  pillars: string[];
  useCase: string;
  stage?: string;
  promptText: string;
  modelConfig?: Record<string, unknown>;
  active: boolean;
  version: number;
}

// ==========================================
// Helpers
// ==========================================

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Create a display name from the prompt ID
 */
function createDisplayName(prompt: PromptRecord): string {
  // Convert id like "voice.grove-analytical" to "Voice: Grove Analytical"
  const parts = prompt.id.split('.');
  const formatted = parts.map(part =>
    part
      .split('-')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
  );
  return formatted.join(': ');
}

/**
 * Convert prompt text to Notion blocks
 * Simple markdown-style conversion for prompt content
 */
function promptTextToBlocks(promptText: string): any[] {
  const lines = promptText.split('\n');
  const blocks: any[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith('## ')) {
      blocks.push({
        object: 'block',
        type: 'heading_2',
        heading_2: {
          rich_text: [{ type: 'text', text: { content: trimmed.slice(3) } }],
        },
      });
    } else if (trimmed.startsWith('### ')) {
      blocks.push({
        object: 'block',
        type: 'heading_3',
        heading_3: {
          rich_text: [{ type: 'text', text: { content: trimmed.slice(4) } }],
        },
      });
    } else if (trimmed.startsWith('- ')) {
      blocks.push({
        object: 'block',
        type: 'bulleted_list_item',
        bulleted_list_item: {
          rich_text: [{ type: 'text', text: { content: trimmed.slice(2) } }],
        },
      });
    } else if (/^\d+\. /.test(trimmed)) {
      const content = trimmed.replace(/^\d+\. /, '');
      blocks.push({
        object: 'block',
        type: 'numbered_list_item',
        numbered_list_item: {
          rich_text: [{ type: 'text', text: { content } }],
        },
      });
    } else {
      blocks.push({
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [{ type: 'text', text: { content: trimmed } }],
        },
      });
    }
  }

  return blocks;
}

/**
 * Create a Notion page for a prompt (with prompt text in body)
 */
async function createPromptPage(
  notion: Client,
  databaseId: string,
  prompt: PromptRecord
): Promise<string> {
  const displayName = createDisplayName(prompt);

  const properties: Record<string, any> = {
    // Title (Name)
    Name: {
      title: [{ text: { content: displayName } }],
    },
    // ID
    ID: {
      rich_text: [{ text: { content: prompt.id } }],
    },
    // Capability
    Capability: {
      select: { name: prompt.capability },
    },
    // Pillar (multi-select)
    Pillar: {
      multi_select: prompt.pillars.map(p => ({ name: p })),
    },
    // Use Case
    'Use Case': {
      select: { name: prompt.useCase },
    },
    // Active
    Active: {
      checkbox: prompt.active,
    },
    // Version
    Version: {
      number: prompt.version,
    },
  };

  // Optional: Stage
  if (prompt.stage) {
    properties.Stage = {
      select: { name: prompt.stage },
    };
  }

  // Optional: Model Config
  if (prompt.modelConfig) {
    properties['Model Config'] = {
      rich_text: [{ text: { content: JSON.stringify(prompt.modelConfig) } }],
    };
  }

  // Convert prompt text to page body blocks
  const children = promptTextToBlocks(prompt.promptText);

  const page = await notion.pages.create({
    parent: { database_id: databaseId },
    properties,
    children,
  });

  return page.id;
}

// ==========================================
// Main
// ==========================================

async function main(): Promise<void> {
  console.log('🌱 Seeding Atlas System Prompts database...\n');

  // Load prompts from JSON
  if (!fs.existsSync(PROMPTS_FILE)) {
    console.error(`❌ Prompts file not found: ${PROMPTS_FILE}`);
    process.exit(1);
  }

  const prompts: PromptRecord[] = JSON.parse(fs.readFileSync(PROMPTS_FILE, 'utf-8'));
  console.log(`📦 Loaded ${prompts.length} prompts from prompts-v1.json\n`);

  const notion = new Client({ auth: NOTION_API_KEY });

  // Verify database access
  try {
    await notion.databases.retrieve({ database_id: DATABASE_ID! });
    console.log('✅ Database accessible\n');
  } catch (error) {
    console.error(`❌ Cannot access database: ${DATABASE_ID}`);
    console.error('   Make sure the database exists and is shared with your integration');
    process.exit(1);
  }

  // Check for existing prompts
  const existingResponse = await notion.databases.query({
    database_id: DATABASE_ID!,
    page_size: 1,
  });

  if (existingResponse.results.length > 0) {
    console.log('⚠️  Database already has entries.');
    console.log('   To re-seed, manually delete existing entries first.\n');
    console.log('   Continuing to add new prompts (duplicates may occur)...\n');
  }

  // Create prompts
  let created = 0;
  let failed = 0;

  for (const prompt of prompts) {
    try {
      const pageId = await createPromptPage(notion, DATABASE_ID!, prompt);
      created++;
      console.log(`✅ [${created}/${prompts.length}] ${prompt.id}`);

      // Rate limiting
      await sleep(API_DELAY_MS);
    } catch (error: any) {
      failed++;
      console.error(`❌ Failed: ${prompt.id} - ${error.message}`);
    }
  }

  console.log('\n─────────────────────────────────────────');
  console.log(`✅ Created: ${created}`);
  if (failed > 0) {
    console.log(`❌ Failed: ${failed}`);
  }
  console.log('─────────────────────────────────────────\n');

  if (created === prompts.length) {
    console.log('🎉 Database seeded successfully!');
    console.log('\nNext steps:');
    console.log('1. Verify prompts in Notion');
    console.log('2. Test PromptManager with: bun run test:prompts');
  }
}

main().catch(console.error);
