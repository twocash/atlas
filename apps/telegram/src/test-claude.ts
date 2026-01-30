/**
 * Test Claude Connection
 * 
 * Run with: bun run src/test-claude.ts
 */

import "dotenv/config";
import { testClaudeConnection, classifyWithClaude } from "./claude";

async function main() {
  console.log("Testing Claude connection...\n");

  const isConnected = await testClaudeConnection();

  if (!isConnected) {
    console.log("❌ Claude connection failed!");
    console.log("\nCheck:");
    console.log("  1. ANTHROPIC_API_KEY is set in .env");
    console.log("  2. Or run `claude` CLI and authenticate");
    process.exit(1);
  }

  console.log("✅ Claude connection successful!\n");
  console.log("Testing classification...\n");

  // Test classification
  const testUrl = {
    url: "https://github.com/anthropics/anthropic-cookbook",
    title: "anthropic-cookbook: A collection of notebooks/recipes for Anthropic's Claude",
    description: "Examples and guides for building with Claude",
    bodySnippet: "This repository contains a collection of notebooks and recipes for working with Claude...",
    fetchedAt: new Date(),
    success: true,
  };

  const result = await classifyWithClaude(
    "Check this out - could be useful for Atlas",
    testUrl
  );

  console.log("Classification result:");
  console.log(`  Pillar: ${result.pillar}`);
  console.log(`  Intent: ${result.intent}`);
  console.log(`  Confidence: ${result.confidence}%`);
  console.log(`  Reasoning: ${result.reasoning}`);
  console.log(`  Suggested title: ${result.suggestedTitle}`);
  console.log(`  Tags: ${result.tags.join(", ") || "(none)"}`);
}

main();
