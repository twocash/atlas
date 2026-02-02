/**
 * LIVE Test: Research Agent → Notion
 *
 * Actually runs the research agent and writes to Notion Work Queue.
 * Use for QA testing of the full pipeline.
 *
 * Run with: npx tsx packages/agents/test/research-live-test.ts
 */

import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load env manually (same as spike scripts)
const envPath = resolve(__dirname, '../../../apps/telegram/.env');
try {
  const envContent = readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex > 0) {
        const key = trimmed.substring(0, eqIndex);
        let value = trimmed.substring(eqIndex + 1);
        // Remove quotes if present
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        process.env[key] = value;
      }
    }
  }
  console.log("Loaded env from:", envPath);
} catch (e) {
  console.error("Failed to load .env:", e);
  process.exit(1);
}

console.log("=== LIVE RESEARCH TEST ===");
console.log("Time:", new Date().toISOString());
console.log("GEMINI_API_KEY:", process.env.GEMINI_API_KEY ? "SET" : "MISSING");
console.log("NOTION_API_KEY:", process.env.NOTION_API_KEY ? "SET" : "MISSING");

async function runLiveTest() {
  // Import the research agent and work queue
  const { AgentRegistry } = await import("../src/registry");
  const { createResearchWorkItem, wireAgentToWorkQueue } = await import("../src/workqueue");

  const registry = new AgentRegistry();

  // Test query
  const query = "GitHub Copilot pricing and features 2024";
  const depth = "light" as const;

  console.log("\n1. Creating Work Queue item...");
  const { pageId, url } = await createResearchWorkItem({
    query,
    depth,
  });
  console.log("   ✅ Work Queue item created");
  console.log("   Page ID:", pageId);
  console.log("   URL:", url);

  console.log("\n2. Running research agent...");

  // Spawn agent first
  const agent = await registry.spawn({
    type: "research",
    name: `Research: ${query.substring(0, 50)}`,
    instructions: JSON.stringify({ query, depth }),
    priority: "P1",
    workItemId: pageId,
  });

  // Wire to Work Queue BEFORE running (critical for Notion sync)
  console.log("   Wiring agent to Work Queue...");
  await wireAgentToWorkQueue(agent, registry);
  console.log("   ✅ Wired to Work Queue");

  // Now run the research
  const { executeResearch } = await import("../src/agents/research");
  await registry.start(agent.id);
  const result = await executeResearch({ query, depth }, agent, registry);

  // Complete or fail
  if (result.success) {
    await registry.complete(agent.id, result);
  } else {
    await registry.fail(agent.id, result.summary || "Research failed", true);
  }

  console.log("\n3. Results:");
  console.log("   Agent ID:", agent.id);
  console.log("   Success:", result.success);
  console.log("   Status:", agent.status);

  if (result.success) {
    const output = result.output as any;
    console.log("   Summary preview:", output?.summary?.substring(0, 200) + "...");
    console.log("   Findings:", output?.findings?.length || 0);
    console.log("   Sources:", output?.sources?.length || 0);
  } else {
    console.log("   Error:", result.summary);
  }

  console.log("\n========================================");
  console.log("📝 NOTION URL:", url);
  console.log("========================================");

  // Give time for async Notion writes to complete
  console.log("\nWaiting 3s for Notion writes to complete...");
  await new Promise(r => setTimeout(r, 3000));

  console.log("\n✅ Test complete! Check the Notion page above.");
}

runLiveTest().catch(err => {
  console.error("❌ Test failed:", err);
  process.exit(1);
});
