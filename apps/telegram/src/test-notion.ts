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
    console.log("\nData Source IDs (canonical):");
    console.log(`  Feed 2.0: a7493abb-804a-4759-b6ac-aeca62ae23b8`);
    console.log(`  Work Queue 2.0: 6a8d9c43-b084-47b5-bc83-bc363640f2cd`);
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
