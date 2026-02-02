/**
 * Debug Deep Research Script
 *
 * Runs a deep research query and logs every step to diagnose
 * where content is being lost in the pipeline.
 *
 * Run from apps/telegram directory: bun run ../../packages/agents/scripts/debug-deep-research.ts
 */

import type { ResearchConfig } from "../src/agents/research";

async function main() {
  console.log("=".repeat(80));
  console.log("DEBUG: Deep Research Pipeline Analysis");
  console.log("=".repeat(80));

  // 1. Test voice loading
  console.log("\n[1] TESTING VOICE LOADING");
  const voicePath = "../../../apps/telegram/config/voice/grove.md";
  const fs = await import("fs/promises");
  const path = await import("path");

  try {
    const voiceContent = await fs.readFile(path.resolve(__dirname, voicePath), "utf-8");
    console.log("   Voice file loaded:", voiceContent.length, "chars");
    console.log("   Voice preview:", voiceContent.substring(0, 150));
  } catch (e) {
    console.log("   ERROR loading voice:", e);
  }

  // 2. Build research config
  console.log("\n[2] BUILDING RESEARCH CONFIG");
  const voiceContent = await fs.readFile(path.resolve(__dirname, voicePath), "utf-8");

  const config: ResearchConfig = {
    query: "The future of agentic AI and multi-agent systems",
    depth: "deep",
    voice: "custom",
    voiceInstructions: voiceContent,
  };

  console.log("   Query:", config.query);
  console.log("   Depth:", config.depth);
  console.log("   Voice:", config.voice);
  console.log("   Voice instructions length:", config.voiceInstructions?.length);

  // 3. Build prompt and check voice injection
  console.log("\n[3] CHECKING PROMPT CONSTRUCTION");
  const { buildResearchPrompt } = await import("../src/agents/research");

  // Note: buildResearchPrompt is not exported, so we'll check indirectly
  // by running executeResearch and logging

  // 4. Execute research
  console.log("\n[4] EXECUTING RESEARCH (this will take a while...)");
  const { AgentRegistry } = await import("../src/registry");
  const { executeResearch } = await import("../src/agents/research");

  const registry = new AgentRegistry();
  const agent = await registry.spawn({
    type: "research",
    name: "Debug Research",
    instructions: JSON.stringify(config),
    priority: "P1",
  });

  await registry.start(agent.id);

  const startTime = Date.now();
  const result = await executeResearch(config, agent, registry);
  const duration = Date.now() - startTime;

  console.log("\n[5] ANALYZING RESULTS");
  console.log("   Success:", result.success);
  console.log("   Duration:", Math.round(duration / 1000), "seconds");

  // Check result structure
  console.log("\n   Result structure:");
  console.log("   - result.summary length:", result.summary?.length || 0);
  console.log("   - result.output type:", typeof result.output);

  if (result.output && typeof result.output === "object") {
    const output = result.output as any;
    console.log("   - output.summary length:", output.summary?.length || 0);
    console.log("   - output.findings count:", output.findings?.length || 0);
    console.log("   - output.sources count:", output.sources?.length || 0);
    console.log("   - output.rawResponse length:", output.rawResponse?.length || 0);
    console.log("   - output.bibliography count:", output.bibliography?.length || 0);

    // Show actual content lengths
    console.log("\n[6] CONTENT ANALYSIS");

    if (output.summary) {
      console.log("\n   PARSED SUMMARY (" + output.summary.length + " chars):");
      console.log("   " + "=".repeat(60));
      // Show first 1000 chars
      console.log(output.summary.substring(0, 1000));
      if (output.summary.length > 1000) {
        console.log("   ... [" + (output.summary.length - 1000) + " more chars]");
      }
    }

    if (output.rawResponse) {
      console.log("\n   RAW RESPONSE (" + output.rawResponse.length + " chars):");
      console.log("   " + "=".repeat(60));
      // Show first 2000 chars
      console.log(output.rawResponse.substring(0, 2000));
      if (output.rawResponse.length > 2000) {
        console.log("   ... [" + (output.rawResponse.length - 2000) + " more chars]");
      }
    }

    if (output.findings?.length > 0) {
      console.log("\n   FINDINGS (" + output.findings.length + " total):");
      console.log("   " + "=".repeat(60));
      output.findings.slice(0, 5).forEach((f: any, i: number) => {
        console.log(`   ${i + 1}. ${f.claim?.substring(0, 100)}...`);
        console.log(`      Source: ${f.source}`);
      });
      if (output.findings.length > 5) {
        console.log(`   ... and ${output.findings.length - 5} more findings`);
      }
    }
  }

  // Check what would go to Notion
  console.log("\n[7] NOTION OUTPUT SIMULATION");
  console.log("   What workqueue.ts would receive:");
  console.log("   - result.summary (for Notes field, truncated):", result.summary?.substring(0, 200));
  console.log("   - rawResponse available for page body:", !!(result.output as any)?.rawResponse);

  console.log("\n" + "=".repeat(80));
  console.log("DEBUG COMPLETE");
  console.log("=".repeat(80));
}

main().catch(console.error);
