/**
 * Tests for Notion-safe Markdown converter
 * Run with: npx tsx test/notion-markdown.test.ts
 */

import {
  convertMarkdownToNotionBlocks,
  batchBlocksForApi,
  formatResearchAsMarkdown,
} from "../src/notion-markdown";

console.log("======================================");
console.log("NOTION MARKDOWN CONVERTER TESTS");
console.log("======================================\n");

let passed = 0;
let failed = 0;

function test(name: string, fn: () => boolean) {
  console.log(`\n🧪 TEST: ${name}`);
  console.log("─".repeat(40));
  try {
    const result = fn();
    if (result) {
      console.log("✅ PASSED");
      passed++;
    } else {
      console.log("❌ FAILED");
      failed++;
    }
  } catch (error: any) {
    console.log("❌ FAILED (exception):", error.message);
    failed++;
  }
}

// ============================================
// Basic Markdown Tests
// ============================================

test("Basic paragraph conversion", () => {
  const md = "This is a simple paragraph.";
  const result = convertMarkdownToNotionBlocks(md);

  console.log("  Blocks:", result.blocks.length);
  console.log("  Warnings:", result.warnings.length);

  return result.blocks.length === 1 && result.blocks[0].type === "paragraph";
});

test("Heading conversion", () => {
  const md = `# Main Heading

## Subheading

Some content here.`;

  const result = convertMarkdownToNotionBlocks(md);

  console.log("  Blocks:", result.blocks.length);
  const types = result.blocks.map((b) => b.type);
  console.log("  Types:", types.join(", "));

  return types.includes("heading_1") && types.includes("heading_2");
});

test("Bullet list conversion", () => {
  const md = `- Item 1
- Item 2
- Item 3`;

  const result = convertMarkdownToNotionBlocks(md);

  console.log("  Blocks:", result.blocks.length);

  return result.blocks.some((b) => b.type === "bulleted_list_item");
});

test("Numbered list conversion", () => {
  const md = `1. First
2. Second
3. Third`;

  const result = convertMarkdownToNotionBlocks(md);

  console.log("  Blocks:", result.blocks.length);

  return result.blocks.some((b) => b.type === "numbered_list_item");
});

// ============================================
// Directive Tests
// ============================================

test("Callout directive", () => {
  const md = `:::callout type=info title="Important Note"
This is the callout body with some important information.
:::`;

  const result = convertMarkdownToNotionBlocks(md);

  console.log("  Blocks:", result.blocks.length);
  console.log("  Directives processed:", result.stats.directivesProcessed);
  console.log("  Block types:", result.blocks.map((b) => b.type).join(", "));

  return result.stats.directivesProcessed === 1 && result.blocks.some((b) => b.type === "callout");
});

test("Toggle directive", () => {
  const md = `:::toggle title="Click to expand"
- Hidden item 1
- Hidden item 2
:::`;

  const result = convertMarkdownToNotionBlocks(md);

  console.log("  Blocks:", result.blocks.length);
  console.log("  Directives processed:", result.stats.directivesProcessed);
  console.log("  Block types:", result.blocks.map((b) => b.type).join(", "));

  return result.stats.directivesProcessed === 1 && result.blocks.some((b) => b.type === "toggle");
});

test("Multiple directives", () => {
  const md = `# Research Results

:::callout type=tip title="Summary"
Key takeaway here.
:::

## Findings

:::toggle title="Detailed findings"
1. Finding one
2. Finding two
:::`;

  const result = convertMarkdownToNotionBlocks(md);

  console.log("  Blocks:", result.blocks.length);
  console.log("  Directives processed:", result.stats.directivesProcessed);

  return result.stats.directivesProcessed === 2;
});

// ============================================
// Limits Shim Tests
// ============================================

test("Long paragraph chunking", () => {
  // Create a paragraph that's definitely over 1800 chars
  const longText = "This is a test sentence that will be repeated many times. ".repeat(50);
  const md = longText;

  const result = convertMarkdownToNotionBlocks(md);

  console.log("  Input length:", longText.length);
  console.log("  Blocks after chunking:", result.blocks.length);
  console.log("  Chunked paragraphs:", result.stats.chunkedParagraphs);

  // Should have been chunked into multiple paragraphs
  return result.stats.chunkedParagraphs > 0 && result.blocks.length > 1;
});

test("Batch blocks for API", () => {
  // Create more than 100 blocks
  const manyItems = Array.from({ length: 150 }, (_, i) => `- Item ${i + 1}`).join("\n");
  const result = convertMarkdownToNotionBlocks(manyItems);

  const batches = batchBlocksForApi(result.blocks);

  console.log("  Total blocks:", result.blocks.length);
  console.log("  Batches:", batches.length);
  console.log("  First batch size:", batches[0]?.length);

  // Should be batched into multiple requests
  return batches.length >= 2 && batches[0].length <= 100;
});

// ============================================
// Table Fallback Tests
// ============================================

test("Small table (kept as table)", () => {
  const md = `| Header 1 | Header 2 |
|----------|----------|
| Cell 1 | Cell 2 |
| Cell 3 | Cell 4 |`;

  const result = convertMarkdownToNotionBlocks(md);

  console.log("  Blocks:", result.blocks.length);
  console.log("  Tables fallback:", result.stats.tablesFallback);

  // Small table should not be converted to code block
  return result.stats.tablesFallback === 0;
});

test("Large table (fallback to code block)", () => {
  // Create a table with more than 10 rows
  const rows = Array.from({ length: 15 }, (_, i) => `| Row ${i + 1} | Data |`).join("\n");
  const md = `| Header | Data |
|--------|------|
${rows}`;

  const result = convertMarkdownToNotionBlocks(md);

  console.log("  Blocks:", result.blocks.length);
  console.log("  Tables fallback:", result.stats.tablesFallback);

  // Large table should be converted to code block
  return result.stats.tablesFallback === 1;
});

// ============================================
// Research Formatting Tests
// ============================================

test("Format research as markdown", () => {
  const data = {
    summary: "TypeScript refactoring tools have evolved significantly in 2024.",
    findings: [
      { claim: "ESLint is essential", source: "ESLint Docs", url: "https://eslint.org" },
      { claim: "Prettier handles formatting", source: "Prettier", url: "https://prettier.io" },
    ],
    sources: ["https://eslint.org", "https://prettier.io"],
    query: "TypeScript refactoring tools",
  };

  const markdown = formatResearchAsMarkdown(data);

  console.log("  Generated markdown length:", markdown.length);
  console.log("  Contains callout:", markdown.includes(":::callout"));
  console.log("  Contains toggle:", markdown.includes(":::toggle"));
  console.log("  Preview:", markdown.substring(0, 200) + "...");

  return (
    markdown.includes(":::callout") &&
    markdown.includes(":::toggle") &&
    markdown.includes("Key Findings")
  );
});

test("Research markdown to blocks end-to-end", () => {
  const data = {
    summary: "AI-assisted coding tools are transforming software development workflows.",
    findings: [
      { claim: "GitHub Copilot uses GPT-4", source: "GitHub Blog", url: "https://github.blog" },
      { claim: "Cursor integrates Claude", source: "Cursor", url: "https://cursor.sh" },
    ],
    sources: ["https://github.blog", "https://cursor.sh"],
    query: "AI coding assistants",
  };

  const markdown = formatResearchAsMarkdown(data);
  const result = convertMarkdownToNotionBlocks(markdown);

  console.log("  Markdown length:", markdown.length);
  console.log("  Blocks:", result.blocks.length);
  console.log("  Block types:", result.blocks.map((b) => b.type).join(", "));
  console.log("  Directives:", result.stats.directivesProcessed);
  console.log("  Warnings:", result.warnings);

  return result.blocks.length > 0 && result.stats.directivesProcessed >= 1;
});

// ============================================
// Results
// ============================================

console.log("\n\n======================================");
console.log(`RESULTS: ${passed} passed, ${failed} failed`);
console.log("======================================");

if (failed > 0) {
  process.exit(1);
}
