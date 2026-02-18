/**
 * Test Notion Connection
 * 
 * Run with: bun run src/test-notion.ts
 */

import { config } from "dotenv";
config({ override: true });
import { NOTION_DB } from '@atlas/shared/config';
import { testNotionConnection } from "./notion";

async function main() {
  console.log("Testing Notion connection...\n");

  const isConnected = await testNotionConnection();

  if (isConnected) {
    console.log("✅ Notion connection successful!");
    console.log("\nDatabase IDs (for Notion SDK):");
    console.log(`  Feed 2.0: ${NOTION_DB.FEED}`);
    console.log(`  Work Queue 2.0: ${NOTION_DB.WORK_QUEUE}`);
  } else {
    console.log("❌ Notion connection failed!");
    console.log("\nCheck:");
    console.log("  1. NOTION_API_KEY is set in .env");
    console.log("  2. Integration has access to the databases");
    console.log("  3. Database IDs are correct");
    process.exit(1);
  }
}

main();
