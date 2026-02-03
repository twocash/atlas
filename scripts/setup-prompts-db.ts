#!/usr/bin/env npx tsx
/**
 * Atlas System Prompts Database Setup
 *
 * Creates the "Atlas System Prompts" database in Notion with the required schema.
 * Run once to set up the database, then add the ID to .env as NOTION_PROMPTS_DB_ID.
 *
 * Usage:
 *   npx tsx scripts/setup-prompts-db.ts
 *
 * Prerequisites:
 *   - NOTION_API_KEY must be set in environment or apps/telegram/.env
 *   - NOTION_PARENT_PAGE_ID must be set (the page where the database will be created)
 *
 * @see apps/telegram/data/migrations/prompts-v1.json for seed data
 * @see scripts/seed-prompts.ts to populate with initial data
 */

import { Client } from '@notionhq/client';
import { config } from 'dotenv';
import * as path from 'path';

// Load environment from apps/telegram/.env
config({ path: path.join(__dirname, '../apps/telegram/.env') });

// ==========================================
// Configuration
// ==========================================

const NOTION_API_KEY = process.env.NOTION_API_KEY;
const PARENT_PAGE_ID = process.env.NOTION_PARENT_PAGE_ID;

if (!NOTION_API_KEY) {
  console.error('❌ NOTION_API_KEY not found in environment');
  console.error('   Set it in apps/telegram/.env or as an environment variable');
  process.exit(1);
}

if (!PARENT_PAGE_ID) {
  console.error('❌ NOTION_PARENT_PAGE_ID not found in environment');
  console.error('   This is the page ID where the database will be created');
  console.error('   Example: Add NOTION_PARENT_PAGE_ID=abc123... to apps/telegram/.env');
  process.exit(1);
}

// ==========================================
// Database Schema
// ==========================================

const DATABASE_TITLE = 'Atlas System Prompts';

const DATABASE_PROPERTIES = {
  // Title property (required)
  'Name': {
    title: {},
  },

  // ID - Immutable key: "research.grove.sprout"
  'ID': {
    rich_text: {},
  },

  // Capability - What system uses this prompt
  'Capability': {
    select: {
      options: [
        { name: 'Research Agent', color: 'blue' },
        { name: 'Voice', color: 'green' },
        { name: 'Classifier', color: 'purple' },
        { name: 'Refinery', color: 'orange' },
      ],
    },
  },

  // Pillar - Which life domains this applies to
  'Pillar': {
    multi_select: {
      options: [
        { name: 'The Grove', color: 'green' },
        { name: 'Consulting', color: 'blue' },
        { name: 'Personal', color: 'pink' },
        { name: 'Home/Garage', color: 'yellow' },
        { name: 'All', color: 'gray' },
      ],
    },
  },

  // Use Case - Specific intent within capability
  'Use Case': {
    select: {
      options: [
        { name: 'General', color: 'default' },
        { name: 'Sprout Generation', color: 'green' },
        { name: 'Market Analysis', color: 'blue' },
        { name: 'Competitor Research', color: 'purple' },
        { name: 'Technical Deep Dive', color: 'orange' },
        { name: 'Quick Summary', color: 'yellow' },
      ],
    },
  },

  // Stage - Pipeline stage
  'Stage': {
    select: {
      options: [
        { name: '1-Spark', color: 'yellow' },
        { name: '2-Research', color: 'blue' },
        { name: '3-Refine', color: 'purple' },
        { name: '4-Execute', color: 'green' },
      ],
    },
  },

  // Prompt Text - The actual template
  'Prompt Text': {
    rich_text: {},
  },

  // Model Config - JSON configuration
  'Model Config': {
    rich_text: {},
  },

  // Active - Kill switch
  'Active': {
    checkbox: {},
  },

  // Version - For tracking changes
  'Version': {
    number: {},
  },
};

// ==========================================
// Main
// ==========================================

async function main(): Promise<void> {
  console.log('🚀 Setting up Atlas System Prompts database...\n');

  const notion = new Client({ auth: NOTION_API_KEY });

  // Verify token
  try {
    const me = await notion.users.me({});
    console.log(`✅ Authenticated as: ${me.name || 'Unknown'}`);
  } catch (error) {
    console.error('❌ Failed to authenticate with Notion API');
    console.error('   Check that NOTION_API_KEY is valid');
    process.exit(1);
  }

  // Check parent page access
  try {
    const parentPage = await notion.pages.retrieve({ page_id: PARENT_PAGE_ID! });
    const title = (parentPage as any).properties?.title?.title?.[0]?.plain_text || 'Untitled';
    console.log(`✅ Parent page found: "${title}"`);
  } catch (error) {
    console.error(`❌ Cannot access parent page: ${PARENT_PAGE_ID}`);
    console.error('   Make sure the page is shared with your Notion integration');
    process.exit(1);
  }

  // Create database
  console.log('\n📦 Creating database...');

  try {
    const database = await notion.databases.create({
      parent: { page_id: PARENT_PAGE_ID! },
      title: [
        {
          type: 'text',
          text: { content: DATABASE_TITLE },
        },
      ],
      properties: DATABASE_PROPERTIES as any,
    });

    console.log('\n✅ Database created successfully!');
    console.log(`\n📋 Database ID: ${database.id}`);
    console.log(`\n🔗 URL: ${(database as any).url}`);

    console.log('\n─────────────────────────────────────────');
    console.log('📝 Next steps:');
    console.log('─────────────────────────────────────────');
    console.log(`\n1. Add to apps/telegram/.env:\n`);
    console.log(`   NOTION_PROMPTS_DB_ID=${database.id}\n`);
    console.log(`2. Run the seed script:\n`);
    console.log(`   npx tsx scripts/seed-prompts.ts\n`);
    console.log('─────────────────────────────────────────\n');

  } catch (error: any) {
    console.error('❌ Failed to create database:', error.message);
    if (error.code === 'validation_error') {
      console.error('   Schema validation failed. Check DATABASE_PROPERTIES.');
    }
    process.exit(1);
  }
}

main().catch(console.error);
