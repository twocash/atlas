/**
 * Spike Test: OpenClaw Skills Research
 *
 * Runs deep research and shows EXACTLY what goes to Notion
 */

import { config } from "dotenv";
import path from "path";
import fs from "fs/promises";

// Load environment variables from apps/telegram/.env
// __dirname in this context is packages/agents/scripts, so go up 3 levels to atlas root
const envPath = path.resolve(__dirname, "../../../apps/telegram/.env");
console.log("__dirname:", __dirname);
console.log("Resolved envPath:", envPath);

// Check if file exists before loading
import { existsSync } from "fs";
if (!existsSync(envPath)) {
  console.error("ERROR: .env file not found at", envPath);
  process.exit(1);
}

config({ path: envPath, override: true });

console.log("Environment loaded from:", envPath);
console.log("NOTION_API_KEY:", process.env.NOTION_API_KEY ? `Set (${process.env.NOTION_API_KEY.length} chars)` : "NOT SET");
console.log("GEMINI_API_KEY:", process.env.GEMINI_API_KEY ? `Set (${process.env.GEMINI_API_KEY.length} chars)` : "NOT SET");

import type { ResearchConfig } from "../src/agents/research";

async function main() {
  console.log("=".repeat(80));
  console.log("SPIKE: OpenClaw Skills Deep Research");
  console.log("=".repeat(80));

  // Load voice
  const voicePath = path.resolve(__dirname, "../../../apps/telegram/config/voice/grove.md");
  const voiceContent = await fs.readFile(voicePath, "utf-8");
  console.log("\n[1] Voice loaded:", voiceContent.length, "chars");

  // Build config
  const config: ResearchConfig = {
    query: "the rise of openclaw skills and the top ten most interesting skills that have emerged at places like https://github.com/openclaw/skills/tree/main/skills",
    depth: "deep",
    voice: "custom",
    voiceInstructions: voiceContent,
  };

  console.log("\n[2] Config:", {
    query: config.query,
    depth: config.depth,
    voice: config.voice,
    voiceInstructionsLength: config.voiceInstructions?.length,
  });

  // Execute research
  console.log("\n[3] Executing deep research (this takes 1-2 minutes)...\n");

  const { AgentRegistry } = await import("../src/registry");
  const { executeResearch } = await import("../src/agents/research");

  const registry = new AgentRegistry();
  const agent = await registry.spawn({
    type: "research",
    name: "Spike: OpenClaw",
    instructions: JSON.stringify(config),
    priority: "P1",
  });

  await registry.start(agent.id);
  const startTime = Date.now();
  const result = await executeResearch(config, agent, registry);
  const duration = Math.round((Date.now() - startTime) / 1000);

  console.log("\n[4] Research complete in", duration, "seconds");
  console.log("    Success:", result.success);

  // Analyze output
  const output = result.output as any;
  console.log("\n[5] OUTPUT ANALYSIS:");
  console.log("    result.summary length:", result.summary?.length || 0);
  console.log("    output.summary length:", output?.summary?.length || 0);
  console.log("    output.findings count:", output?.findings?.length || 0);
  console.log("    output.sources count:", output?.sources?.length || 0);
  console.log("    output.rawResponse length:", output?.rawResponse?.length || 0);

  // Now simulate EXACTLY what workqueue does
  console.log("\n" + "=".repeat(80));
  console.log("SIMULATING WORKQUEUE NOTION OUTPUT");
  console.log("=".repeat(80));

  const researchOutput = output;
  let markdown = "";

  if (researchOutput?.rawResponse && researchOutput.rawResponse.length > 500) {
    console.log("\n[6] Processing rawResponse for Notion...");

    let fullContent = researchOutput.rawResponse;
    let jsonParsed = false;

    try {
      const jsonMatch = fullContent.match(/```json\s*([\s\S]*?)\s*```/);
      const jsonText = jsonMatch ? jsonMatch[1] : fullContent;
      const jsonObjectMatch = jsonText.match(/\{[\s\S]*\}/);

      if (jsonObjectMatch) {
        const parsed = JSON.parse(jsonObjectMatch[0]);

        const parts: string[] = [];

        if (parsed.summary) {
          parts.push("## Executive Summary\n");
          parts.push(parsed.summary);
          parts.push("\n");
        }

        if (parsed.findings && parsed.findings.length > 0) {
          parts.push("\n## Key Findings\n");
          parsed.findings.forEach((f: any, i: number) => {
            parts.push(`\n### ${i + 1}. ${f.claim}\n`);
            if (f.source) parts.push(`**Source:** ${f.source}\n`);
            if (f.url) parts.push(`**URL:** ${f.url}\n`);
            if (f.author) parts.push(`**Author:** ${f.author}\n`);
            if (f.date) parts.push(`**Date:** ${f.date}\n`);
          });
        }

        if (parsed.sources && parsed.sources.length > 0) {
          parts.push("\n## Sources\n");
          parsed.sources.forEach((s: string, i: number) => {
            parts.push(`${i + 1}. ${s}\n`);
          });
        }

        if (parsed.bibliography && parsed.bibliography.length > 0) {
          parts.push("\n## Bibliography\n");
          parsed.bibliography.forEach((b: string) => {
            parts.push(`- ${b}\n`);
          });
        }

        markdown = parts.join("\n");
        jsonParsed = true;
        console.log("    JSON parsed successfully");
        console.log("    Markdown length:", markdown.length, "chars");
      }
    } catch (e) {
      console.log("    JSON parse FAILED:", (e as Error).message);
      jsonParsed = false;
    }

    // PRIORITY FALLBACK: Use pre-extracted structured data when JSON fails
    if (!jsonParsed && (researchOutput?.summary || researchOutput?.findings?.length)) {
      console.log("    Using pre-extracted structured data (JSON failed)...");
      const { formatResearchAsMarkdown } = await import("../src/notion-markdown");
      markdown = formatResearchAsMarkdown({
        summary: researchOutput.summary || "",
        findings: researchOutput.findings || [],
        sources: researchOutput.sources || [],
        query: researchOutput.query || "",
      });
      console.log("    Structured fallback markdown length:", markdown.length, "chars");
    }
  }

  // Show what would go to Notion
  console.log("\n" + "=".repeat(80));
  console.log("MARKDOWN THAT WOULD GO TO NOTION PAGE BODY");
  console.log("=".repeat(80));
  console.log("\nLength:", markdown.length, "characters\n");
  console.log(markdown);
  console.log("\n" + "=".repeat(80));

  // Also write to a file for easy viewing
  const outputPath = path.resolve(__dirname, "spike-output.md");
  await fs.writeFile(outputPath, markdown, "utf-8");
  console.log("\nAlso written to:", outputPath);

  // Now actually send to Notion
  console.log("\n" + "=".repeat(80));
  console.log("CREATING ACTUAL NOTION PAGE");
  console.log("=".repeat(80));

  const { createResearchWorkItem, syncAgentComplete } = await import("../src/workqueue");

  try {
    const { pageId, url } = await createResearchWorkItem({
      query: config.query,
      depth: config.depth,
      focus: undefined,
    });

    console.log("\nWork Queue item created:", url);

    // Now sync the completion
    await syncAgentComplete(pageId, agent, result);

    console.log("Research results synced to Notion!");
    console.log("\nVIEW RESULTS AT:", url);
  } catch (e) {
    console.error("Notion sync failed:", (e as Error).message);
  }

  console.log("\n" + "=".repeat(80));
  console.log("SPIKE COMPLETE");
  console.log("=".repeat(80));
}

main().catch(console.error);
