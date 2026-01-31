/**
 * Test Notion Connection
 * 
 * Run with: bun run src/test-notion.ts
 */

import "dotenv/config";
import { testNotionConnection } from "./notion";

async function main() {
  console.log("Testing Notion connection...\n");

  const isConnected = await testNotionConnection();

  if (isConnected) {
    console.log("✅ Notion connection successful!");
    console.log("\nDatabase IDs (for Notion SDK):");
    console.log(`  Feed 2.0: 90b2b33f-4b44-4b42-870f-8d62fb8cbf18`);
    console.log(`  Work Queue 2.0: 3d679030-b76b-43bd-92d8-1ac51abb4a28`);
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
