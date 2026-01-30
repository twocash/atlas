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
    console.log("\nDatabase IDs:");
    console.log(`  Inbox: ${process.env.NOTION_INBOX_DB || "f6f638c9-6aee-42a7-8137-df5b6a560f50"}`);
    console.log(`  Work Queue: ${process.env.NOTION_WORK_QUEUE_DB || "3d679030-b76b-43bd-92d8-1ac51abb4a28"}`);
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
