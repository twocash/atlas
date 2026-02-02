/**
 * Full Pipeline Smoke Test
 *
 * Simulates REAL Gemini output (including malformed JSON patterns we discovered)
 * and verifies the complete pipeline from raw API response to Notion-ready blocks.
 *
 * Run with: npx tsx packages/agents/test/full-pipeline-smoke.ts
 */

import {
  convertMarkdownToNotionBlocks,
  formatResearchAsMarkdown,
} from "../src/notion-markdown";

console.log("======================================");
console.log("FULL PIPELINE SMOKE TEST");
console.log("======================================\n");

// This is ACTUAL Gemini output structure (malformed, incomplete JSON)
// Based on what we discovered in spike testing
const MALFORMED_GEMINI_RESPONSE = `Based on my research, here are the findings about TypeScript refactoring tools in 2024:

\`\`\`json
{
  "summary": "TypeScript refactoring has become significantly more sophisticated in 2024, with tools now offering AI-assisted code transformations, semantic understanding beyond syntax, and integration with modern IDEs. The ecosystem has matured around three main pillars: automated codemods for migrations, real-time IDE refactoring powered by language servers, and AI-powered assistants that understand developer intent.\\n\\nKey developments include ts-morph reaching stability for AST manipulation, the emergence of AI coding assistants like Cursor and Copilot that can perform context-aware refactoring, and improved TypeScript language server capabilities for rename operations and extract method refactors.\\n\\nThe trend is clearly moving toward intelligent refactoring that considers test coverage, dependency graphs, and runtime behavior rather than just textual patterns.",
  "findings": [
    {
      "claim": "ts-morph provides a stable, high-level API for TypeScript AST manipulation",
      "source": "ts-morph Documentation",
      "url": "https://ts-morph.com"
    },
    {
      "claim": "Cursor IDE uses Claude to understand semantic context for refactoring suggestions",
      "source": "Cursor",
      "url": "https://cursor.sh"
    },
    {
      "claim": "TypeScript 5.4+ includes improved quick fixes and auto-import suggestions",
      "source": "TypeScript Blog",
      "url": "https://devblogs.microsoft.com/typescript"
    },
    {
      "claim": "jscodeshift remains the standard for automated codemods in large codebases",
      "source": "jscodeshift",
      "url": "https://github.com/facebook/jscodeshift"
    }
  ],
  "sources": [
    "https://ts-morph.com",
    "https://cursor.sh",
    "https://devblogs.microsoft.com/typescript",
    "https://github.com/facebook/jscodeshift"
\`\`\`

As you can see, TypeScript refactoring tools have evolved considerably.`;

// Simulate our parseResearchResponse logic (regex extraction)
function parseResearchResponse(text: string): {
  summary: string;
  findings: Array<{ claim: string; source: string; url: string }>;
  sources: string[];
} {
  console.log("[Parse] Raw text length:", text.length);

  // Extract summary
  let summary = "";
  const summaryMatch = text.match(/"summary"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (summaryMatch) {
    summary = summaryMatch[1]
      .replace(/\\n/g, '\n')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\')
      .trim();
    console.log("[Parse] Extracted summary, length:", summary.length);
  }

  // Extract findings
  const findings: Array<{ claim: string; source: string; url: string }> = [];
  const findingsBlockMatch = text.match(/"findings"\s*:\s*\[([\s\S]*?)(?:\]\s*,|\]\s*\}|\]\s*```)/);
  if (findingsBlockMatch) {
    const findingPattern = /\{\s*"claim"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,\s*"source"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,\s*"url"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
    let match;
    while ((match = findingPattern.exec(findingsBlockMatch[1])) !== null) {
      findings.push({
        claim: match[1].replace(/\\"/g, '"').trim(),
        source: match[2].replace(/\\"/g, '"'),
        url: match[3],
      });
    }
    console.log("[Parse] Extracted findings:", findings.length);
  }

  // Extract sources
  const sources: string[] = [];
  const sourcesBlockMatch = text.match(/"sources"\s*:\s*\[([\s\S]*?)(?:\]|\n\s*```)/);
  if (sourcesBlockMatch) {
    const urlPattern = /"(https?:\/\/[^"]+)"/g;
    let match;
    while ((match = urlPattern.exec(sourcesBlockMatch[1])) !== null) {
      if (!sources.includes(match[1])) {
        sources.push(match[1]);
      }
    }
    console.log("[Parse] Extracted sources:", sources.length);
  }

  return { summary, findings, sources };
}

// === TEST 1: Parse malformed Gemini response ===
console.log("=== TEST 1: Parse Malformed Gemini Response ===");
const parsed = parseResearchResponse(MALFORMED_GEMINI_RESPONSE);

console.log("\nParsed Results:");
console.log("- Summary length:", parsed.summary.length);
console.log("- Summary preview:", parsed.summary.substring(0, 200) + "...");
console.log("- Findings count:", parsed.findings.length);
console.log("- Sources count:", parsed.sources.length);

const test1Pass =
  parsed.summary.length > 100 &&
  parsed.findings.length === 4 &&
  parsed.sources.length >= 4;

console.log("\nTest 1:", test1Pass ? "✅ PASSED" : "❌ FAILED");

// === TEST 2: Convert to Markdown ===
console.log("\n=== TEST 2: Convert to Notion-safe Markdown ===");
const markdown = formatResearchAsMarkdown({
  summary: parsed.summary,
  findings: parsed.findings,
  sources: parsed.sources,
  query: "TypeScript refactoring tools 2024",
});

console.log("Markdown length:", markdown.length);
console.log("Contains callout:", markdown.includes(":::callout"));
console.log("Contains toggle:", markdown.includes(":::toggle"));
console.log("Contains Key Findings:", markdown.includes("## Key Findings"));

const test2Pass =
  markdown.includes(":::callout") &&
  markdown.includes(":::toggle") &&
  markdown.includes("## Key Findings");

console.log("\nTest 2:", test2Pass ? "✅ PASSED" : "❌ FAILED");

// === TEST 3: Convert to Notion Blocks ===
console.log("\n=== TEST 3: Convert to Notion Blocks ===");
const conversion = convertMarkdownToNotionBlocks(markdown);

console.log("Total blocks:", conversion.blocks.length);
console.log("Stats:", conversion.stats);
console.log("Warnings:", conversion.warnings);

// Analyze block types
const blockTypes: Record<string, number> = {};
for (const block of conversion.blocks) {
  blockTypes[block.type] = (blockTypes[block.type] || 0) + 1;
}
console.log("Block types:", blockTypes);

const test3Pass =
  blockTypes["callout"] === 1 &&
  blockTypes["toggle"] === 1 &&
  blockTypes["numbered_list_item"] === 4 &&
  blockTypes["heading_2"] === 2;

console.log("\nTest 3:", test3Pass ? "✅ PASSED" : "❌ FAILED");

// === TEST 4: Verify Block Content ===
console.log("\n=== TEST 4: Verify Block Content ===");

// Check callout has the summary
const callout = conversion.blocks.find(b => b.type === "callout") as any;
const calloutText = callout?.callout?.rich_text?.map((rt: any) => rt.text?.content || "").join("") || "";
const calloutHasSummary = calloutText.includes("TypeScript refactoring");
console.log("Callout contains summary:", calloutHasSummary);

// Check numbered items have findings
const numberedItems = conversion.blocks.filter(b => b.type === "numbered_list_item") as any[];
const firstItem = numberedItems[0]?.numbered_list_item?.rich_text?.map((rt: any) => rt.text?.content || "").join("") || "";
const hasClaimText = firstItem.includes("ts-morph");
console.log("First finding contains claim:", hasClaimText);

// Check toggle exists
const toggle = conversion.blocks.find(b => b.type === "toggle") as any;
const hasToggle = toggle?.toggle?.rich_text?.[0]?.text?.content?.includes("sources");
console.log("Toggle has sources title:", hasToggle);

const test4Pass = calloutHasSummary && hasClaimText && hasToggle;
console.log("\nTest 4:", test4Pass ? "✅ PASSED" : "❌ FAILED");

// === FINAL RESULTS ===
console.log("\n======================================");
const allPassed = test1Pass && test2Pass && test3Pass && test4Pass;

if (allPassed) {
  console.log("✅ ALL TESTS PASSED");
  console.log("\nPipeline successfully handles:");
  console.log("1. Malformed/incomplete Gemini JSON");
  console.log("2. Regex-based field extraction");
  console.log("3. Markdown conversion with directives");
  console.log("4. Notion block generation with proper structure");
  console.log("\nReady for production!");
} else {
  console.log("❌ SOME TESTS FAILED");
  console.log("Review the output above to identify issues.");
  process.exit(1);
}
console.log("======================================");
