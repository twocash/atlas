/**
 * Atlas Database Diagnostic Test
 *
 * Tests direct access to Feed 2.0 and Work Queue 2.0 databases.
 * This is the DEFINITIVE test for Notion integration.
 *
 * Run with: bun run src/test-databases.ts
 *
 * CANONICAL DATA SOURCE IDs (NOT database page IDs!):
 * - Feed 2.0:       a7493abb-804a-4759-b6ac-aeca62ae23b8
 * - Work Queue 2.0: 6a8d9c43-b084-47b5-bc83-bc363640f2cd
 */

import "dotenv/config";
import { Client } from "@notionhq/client";

// CANONICAL DATA SOURCE IDs - DO NOT CHANGE
const FEED_DATABASE_ID = "a7493abb-804a-4759-b6ac-aeca62ae23b8";
const WORK_QUEUE_DATABASE_ID = "6a8d9c43-b084-47b5-bc83-bc363640f2cd";

// DEPRECATED - DO NOT USE
const DEPRECATED_INBOX_ID = "f6f638c9-6aee-42a7-8137-df5b6a560f50";

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  details?: Record<string, unknown>;
}

async function testDatabaseAccess(
  notion: Client,
  name: string,
  databaseId: string
): Promise<TestResult> {
  try {
    const db = await notion.databases.retrieve({ database_id: databaseId });

    // Extract property names to verify schema
    const properties = Object.keys((db as any).properties || {});

    return {
      name,
      passed: true,
      details: {
        title: (db as any).title?.[0]?.plain_text || "Unknown",
        propertyCount: properties.length,
        properties: properties.slice(0, 10), // First 10 properties
      },
    };
  } catch (error: any) {
    return {
      name,
      passed: false,
      error: error?.message || String(error),
      details: {
        code: error?.code,
        status: error?.status,
      },
    };
  }
}

async function testDatabaseQuery(
  notion: Client,
  name: string,
  databaseId: string,
  titleProperty: string
): Promise<TestResult> {
  try {
    const result = await notion.databases.query({
      database_id: databaseId,
      page_size: 1,
    });

    return {
      name: `${name} Query`,
      passed: true,
      details: {
        hasResults: result.results.length > 0,
        totalHint: result.has_more ? "more than 1" : result.results.length,
      },
    };
  } catch (error: any) {
    return {
      name: `${name} Query`,
      passed: false,
      error: error?.message || String(error),
    };
  }
}

async function testCreateAndDelete(
  notion: Client,
  databaseId: string,
  titleProperty: string
): Promise<TestResult> {
  const testTitle = `__TEST_ITEM_${Date.now()}__`;

  try {
    // Create test item
    const page = await notion.pages.create({
      parent: { database_id: databaseId },
      properties: {
        [titleProperty]: {
          title: [{ text: { content: testTitle } }],
        },
      },
    });

    const pageId = page.id;
    const pageUrl = `https://notion.so/${pageId.replace(/-/g, "")}`;

    // Archive (delete) the test item
    await notion.pages.update({
      page_id: pageId,
      archived: true,
    });

    return {
      name: "Create/Delete Test",
      passed: true,
      details: {
        createdId: pageId,
        url: pageUrl,
        archived: true,
      },
    };
  } catch (error: any) {
    return {
      name: "Create/Delete Test",
      passed: false,
      error: error?.message || String(error),
    };
  }
}

async function main() {
  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log("║         ATLAS DATABASE DIAGNOSTIC TEST                      ║");
  console.log("╚════════════════════════════════════════════════════════════╝\n");

  // Check API key
  const apiKey = process.env.NOTION_API_KEY;
  if (!apiKey) {
    console.log("❌ NOTION_API_KEY not set in environment");
    process.exit(1);
  }

  console.log(`API Key: ${apiKey.substring(0, 12)}...${apiKey.substring(apiKey.length - 4)}`);
  console.log("");

  const notion = new Client({ auth: apiKey });
  const results: TestResult[] = [];

  // Test 1: Feed 2.0 Access
  console.log("Testing Feed 2.0...");
  console.log(`  ID: ${FEED_DATABASE_ID}`);
  const feedAccess = await testDatabaseAccess(notion, "Feed 2.0 Access", FEED_DATABASE_ID);
  results.push(feedAccess);
  console.log(`  ${feedAccess.passed ? "✅" : "❌"} ${feedAccess.name}`);
  if (feedAccess.details) {
    console.log(`     Title: ${feedAccess.details.title}`);
    console.log(`     Properties: ${feedAccess.details.propertyCount}`);
  }
  if (feedAccess.error) {
    console.log(`     Error: ${feedAccess.error}`);
  }
  console.log("");

  // Test 2: Work Queue 2.0 Access
  console.log("Testing Work Queue 2.0...");
  console.log(`  ID: ${WORK_QUEUE_DATABASE_ID}`);
  const wqAccess = await testDatabaseAccess(notion, "Work Queue 2.0 Access", WORK_QUEUE_DATABASE_ID);
  results.push(wqAccess);
  console.log(`  ${wqAccess.passed ? "✅" : "❌"} ${wqAccess.name}`);
  if (wqAccess.details) {
    console.log(`     Title: ${wqAccess.details.title}`);
    console.log(`     Properties: ${wqAccess.details.propertyCount}`);
  }
  if (wqAccess.error) {
    console.log(`     Error: ${wqAccess.error}`);
  }
  console.log("");

  // Test 3: Feed Query
  if (feedAccess.passed) {
    const feedQuery = await testDatabaseQuery(notion, "Feed 2.0", FEED_DATABASE_ID, "Entry");
    results.push(feedQuery);
    console.log(`  ${feedQuery.passed ? "✅" : "❌"} ${feedQuery.name}`);
  }

  // Test 4: WQ Query
  if (wqAccess.passed) {
    const wqQuery = await testDatabaseQuery(notion, "Work Queue 2.0", WORK_QUEUE_DATABASE_ID, "Task");
    results.push(wqQuery);
    console.log(`  ${wqQuery.passed ? "✅" : "❌"} ${wqQuery.name}`);
  }
  console.log("");

  // Test 5: Create/Delete on WQ (only if access works)
  if (wqAccess.passed) {
    console.log("Testing Create/Archive on Work Queue 2.0...");
    const createTest = await testCreateAndDelete(notion, WORK_QUEUE_DATABASE_ID, "Task");
    results.push(createTest);
    console.log(`  ${createTest.passed ? "✅" : "❌"} ${createTest.name}`);
    if (createTest.details) {
      console.log(`     Created & archived: ${createTest.details.createdId}`);
    }
    if (createTest.error) {
      console.log(`     Error: ${createTest.error}`);
    }
  }
  console.log("");

  // Check for deprecated Inbox usage
  console.log("Checking for deprecated Inbox 2.0...");
  const inboxCheck = await testDatabaseAccess(notion, "Inbox 2.0 (DEPRECATED)", DEPRECATED_INBOX_ID);
  if (inboxCheck.passed) {
    console.log("  ⚠️  Inbox 2.0 is accessible - this database should NOT be used");
    console.log("     The codebase should use Feed 2.0 + Work Queue 2.0 only");
  } else {
    console.log("  ✅ Inbox 2.0 not accessible (expected if properly deprecated)");
  }
  console.log("");

  // Summary
  console.log("════════════════════════════════════════════════════════════");
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log("");

  if (failed > 0) {
    console.log("❌ DIAGNOSTIC FAILED");
    console.log("");
    console.log("If Feed 2.0 or Work Queue 2.0 access failed:");
    console.log("1. Open the database in Notion");
    console.log("2. Click Share → Connections");
    console.log("3. Add your integration");
    console.log("");
    console.log("Database URLs:");
    console.log(`  Feed 2.0: https://notion.so/${FEED_DATABASE_ID.replace(/-/g, "")}`);
    console.log(`  WQ 2.0:   https://notion.so/${WORK_QUEUE_DATABASE_ID.replace(/-/g, "")}`);
    process.exit(1);
  } else {
    console.log("✅ ALL TESTS PASSED");
    console.log("");
    console.log("Feed 2.0 and Work Queue 2.0 are properly configured.");
  }
}

main().catch(console.error);
