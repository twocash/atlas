/**
 * End-to-end test: Research results → Notion blocks
 *
 * Simulates what happens when Gemini research gets converted to Notion page content.
 * Tests the full pipeline WITHOUT hitting actual APIs.
 *
 * Run with: npx tsx packages/agents/test/research-to-notion-e2e.ts
 */

import {
  convertMarkdownToNotionBlocks,
  batchBlocksForApi,
  formatResearchAsMarkdown,
} from "../src/notion-markdown";

console.log("======================================");
console.log("RESEARCH → NOTION E2E TEST");
console.log("======================================\n");

// Simulate real research output from Gemini (after JSON parsing)
const researchOutput = {
  summary: `TypeScript refactoring tools have evolved significantly in 2024, with a focus on automated migration patterns and AI-assisted code transformations. The ecosystem now offers robust options for both gradual adoption in legacy codebases and type-safe refactoring in mature TypeScript projects.

Key developments include the maturation of codemods for framework migrations, improved IDE integration for real-time type inference, and the emergence of AI-powered refactoring assistants that can understand semantic intent beyond simple text transformations.

The trend is moving toward "intelligent" refactoring that considers not just syntax but also runtime behavior, test coverage, and dependency graphs. Tools like ts-morph provide programmatic access to the TypeScript AST, enabling custom refactoring scripts that can be version-controlled and reused across projects.

For teams adopting TypeScript incrementally, the recommended approach is to start with strict null checks disabled, gradually enabling stricter options as the codebase matures. This "dial-up" strategy reduces the initial friction while still capturing the benefits of static typing.`,
  findings: [
    {
      claim: "ts-morph provides a simplified API for TypeScript AST manipulation, making custom refactoring scripts more accessible",
      source: "ts-morph Documentation",
      url: "https://ts-morph.com",
    },
    {
      claim: "The @typescript-eslint/eslint-plugin includes over 100 rules specifically for TypeScript code quality",
      source: "typescript-eslint",
      url: "https://typescript-eslint.io",
    },
    {
      claim: "Cursor IDE integrates Claude for context-aware refactoring suggestions that understand project semantics",
      source: "Cursor",
      url: "https://cursor.sh",
    },
    {
      claim: "GitHub Copilot can generate refactoring suggestions based on code comments and variable names",
      source: "GitHub Blog",
      url: "https://github.blog/ai-and-ml",
    },
    {
      claim: "jscodeshift remains the industry standard for large-scale JavaScript/TypeScript codemods",
      source: "jscodeshift Documentation",
      url: "https://github.com/facebook/jscodeshift",
    },
    {
      claim: "The TypeScript team recommends enabling strict mode incrementally using tsconfig extends",
      source: "TypeScript Handbook",
      url: "https://www.typescriptlang.org/docs/handbook",
    },
  ],
  sources: [
    "https://ts-morph.com",
    "https://typescript-eslint.io",
    "https://cursor.sh",
    "https://github.blog/ai-and-ml",
    "https://github.com/facebook/jscodeshift",
    "https://www.typescriptlang.org/docs/handbook",
  ],
  query: "TypeScript refactoring tools 2024",
  depth: "standard",
};

console.log("=== INPUT: Research Output ===");
console.log("Summary length:", researchOutput.summary.length);
console.log("Findings count:", researchOutput.findings.length);
console.log("Sources count:", researchOutput.sources.length);
console.log("");

// Step 1: Convert to Notion-safe Markdown
console.log("=== STEP 1: Convert to Markdown ===");
const markdown = formatResearchAsMarkdown(researchOutput);
console.log("Markdown length:", markdown.length);
console.log("\n--- MARKDOWN PREVIEW ---");
console.log(markdown.substring(0, 800) + "...");
console.log("------------------------\n");

// Step 2: Convert Markdown to Notion blocks
console.log("=== STEP 2: Convert to Notion Blocks ===");
const conversion = convertMarkdownToNotionBlocks(markdown);

console.log("Total blocks:", conversion.blocks.length);
console.log("Stats:", conversion.stats);
console.log("Warnings:", conversion.warnings);
console.log("");

// Step 3: Batch for API
console.log("=== STEP 3: Batch for API ===");
const batches = batchBlocksForApi(conversion.blocks);
console.log("Batches:", batches.length);
console.log("Blocks per batch:", batches.map(b => b.length));
console.log("");

// Step 4: Analyze block types
console.log("=== STEP 4: Block Analysis ===");
const blockTypes: Record<string, number> = {};
for (const block of conversion.blocks) {
  blockTypes[block.type] = (blockTypes[block.type] || 0) + 1;
}
console.log("Block types:", blockTypes);
console.log("");

// Step 5: Verify content integrity
console.log("=== STEP 5: Content Integrity Check ===");

// Check callout exists (executive summary)
const hasCallout = conversion.blocks.some(b => b.type === "callout");
console.log("✓ Has executive summary callout:", hasCallout);

// Check findings exist (numbered list items)
const numberedItems = conversion.blocks.filter(b => b.type === "numbered_list_item").length;
console.log("✓ Numbered list items (findings):", numberedItems);

// Check toggle exists (sources)
const hasToggle = conversion.blocks.some(b => b.type === "toggle");
console.log("✓ Has sources toggle:", hasToggle);

// Check headings
const headings = conversion.blocks.filter(b => b.type === "heading_2").length;
console.log("✓ H2 headings:", headings);

console.log("");

// Step 6: Sample block content
console.log("=== STEP 6: Sample Block Content ===");

// Show the callout content
const calloutBlock = conversion.blocks.find(b => b.type === "callout") as any;
if (calloutBlock) {
  const calloutText = calloutBlock.callout?.rich_text?.map((rt: any) => rt.text?.content || "").join("") || "";
  console.log("\n--- CALLOUT (Summary) ---");
  console.log(calloutText.substring(0, 400) + "...");
}

// Show first numbered item
const firstNumbered = conversion.blocks.find(b => b.type === "numbered_list_item") as any;
if (firstNumbered) {
  const itemText = firstNumbered.numbered_list_item?.rich_text?.map((rt: any) => rt.text?.content || "").join("") || "";
  console.log("\n--- FIRST FINDING ---");
  console.log(itemText);
}

console.log("\n");

// Final verdict
console.log("======================================");
const allPassed =
  hasCallout &&
  numberedItems >= researchOutput.findings.length &&
  hasToggle &&
  headings >= 2 &&
  conversion.warnings.length === 0;

if (allPassed) {
  console.log("✅ E2E TEST PASSED");
  console.log("Research output successfully converted to Notion blocks");
} else {
  console.log("❌ E2E TEST FAILED");
  console.log("Missing expected content");
  process.exit(1);
}
console.log("======================================");
