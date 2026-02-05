/**
 * Debug script to test Notion prompt fetching
 */

import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(import.meta.dir, '..', '.env'), override: true });

import { Client } from '@notionhq/client';

async function main() {
  const notion = new Client({ auth: process.env.NOTION_API_KEY });
  const databaseId = process.env.NOTION_PROMPTS_DB_ID;

  console.log('Database ID:', databaseId);
  console.log('API Key prefix:', process.env.NOTION_API_KEY?.substring(0, 10) + '...');

  // Test 1: Simple query to get any page
  console.log('\n--- Test 1: Get any page from database ---');
  try {
    const result = await notion.databases.query({
      database_id: databaseId!,
      page_size: 1,
    });
    console.log('Found', result.results.length, 'pages');
    if (result.results.length > 0) {
      const page = result.results[0] as any;
      console.log('First page properties:', Object.keys(page.properties));
      console.log('ID property:', page.properties['ID']);
    }
  } catch (error: any) {
    console.error('Error:', error.message);
  }

  // Test 2: Query with ID filter
  console.log('\n--- Test 2: Query with ID filter ---');
  const testId = 'drafter.the-grove.capture';
  try {
    const result = await notion.databases.query({
      database_id: databaseId!,
      filter: {
        property: 'ID',
        rich_text: { equals: testId },
      },
      page_size: 1,
    });
    console.log('Found', result.results.length, 'pages for ID:', testId);
    if (result.results.length > 0) {
      const page = result.results[0] as any;
      console.log('Page title:', page.properties['Name']?.title?.[0]?.text?.content);
      console.log('ID value:', page.properties['ID']?.rich_text?.[0]?.text?.content);
    }
  } catch (error: any) {
    console.error('Error:', error.message);
  }

  // Test 3: List all pages and their IDs
  console.log('\n--- Test 3: List first 5 pages with IDs ---');
  try {
    const result = await notion.databases.query({
      database_id: databaseId!,
      page_size: 5,
    });
    for (const page of result.results) {
      const p = page as any;
      const name = p.properties['Name']?.title?.[0]?.text?.content || 'No name';
      const id = p.properties['ID']?.rich_text?.[0]?.text?.content || 'No ID';
      console.log(`  ${name} => ID: "${id}"`);
    }
  } catch (error: any) {
    console.error('Error:', error.message);
  }
}

main();
