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
    console.log(`  Inbox: ${process.env.NOTION_INBOX_DB || "04c04ac3-b974-4b7a-9651-e024ee484630"}`);
    console.log(`  Work Queue: ${process.env.NOTION_WORK_QUEUE_DB || "6a8d9c43-b084-47b5-bc83-bc363640f2cd"}`);
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
