/**
 * Notion-safe Markdown Converter
 *
 * Professional-grade pipeline for converting Markdown to Notion blocks.
 * Uses @tryfabric/martian for core conversion with custom extensions for:
 * - Callout directives (:::callout)
 * - Toggle directives (:::toggle)
 * - Limits shim (chunking, text limits)
 * - Table fallback ladder
 *
 * Architecture based on proven approaches:
 * - Gemini outputs Notion-safe Markdown with directives
 * - This module converts to Notion blocks
 * - Handles all API limits deterministically
 */

import { markdownToBlocks, markdownToRichText } from "@tryfabric/martian";
import type { BlockObjectRequest } from "@notionhq/client/build/src/api-endpoints";

// ============================================
// Types
// ============================================

export interface DirectiveBlock {
  type: "callout" | "toggle";
  title?: string;
  calloutType?: "info" | "warning" | "tip" | "note";
  body: string;
}

export interface ConversionResult {
  blocks: BlockObjectRequest[];
  warnings: string[];
  stats: {
    totalBlocks: number;
    chunkedParagraphs: number;
    tablesFallback: number;
    directivesProcessed: number;
  };
}

// ============================================
// Constants - Notion API Limits
// ============================================

const NOTION_LIMITS = {
  /** Maximum characters in a single rich_text content */
  RICH_TEXT_CONTENT_MAX: 2000,
  /** Maximum rich_text array items per block */
  RICH_TEXT_ARRAY_MAX: 100,
  /** Maximum blocks per append request */
  BLOCKS_PER_REQUEST: 100,
  /** Maximum nesting depth */
  MAX_DEPTH: 2,
  /** Safe paragraph length (with buffer) */
  SAFE_PARAGRAPH_LENGTH: 1800,
  /** Maximum table rows before fallback */
  MAX_TABLE_ROWS: 10,
};

// Callout emoji mapping
const CALLOUT_ICONS: Record<string, string> = {
  info: "ℹ️",
  warning: "⚠️",
  tip: "💡",
  note: "📝",
  default: "📌",
};

// ============================================
// Directive Parsing
// ============================================

/**
 * Parse directives from Markdown and extract them for special handling.
 * Directives use the format:
 *   :::callout type=info title="Key takeaway"
 *   Body content
 *   :::
 */
function parseDirectives(markdown: string): {
  cleanMarkdown: string;
  directives: Array<{ placeholder: string; directive: DirectiveBlock }>;
} {
  const directives: Array<{ placeholder: string; directive: DirectiveBlock }> = [];
  let directiveIndex = 0;

  // Match :::type key=value ... \n body \n :::
  const directiveRegex = /:::(callout|toggle)(?:\s+([^\n]*))?\n([\s\S]*?):::/g;

  const cleanMarkdown = markdown.replace(directiveRegex, (match, type, attrs, body) => {
    // Use ATLASDIR format - "ATLAS" prefix won't be interpreted as markdown
    const placeholder = `ATLASDIR${directiveIndex}ATLASDIR`;
    directiveIndex++;

    // Parse attributes like type=info title="Key takeaway"
    const attrMap: Record<string, string> = {};
    if (attrs) {
      const attrRegex = /(\w+)=(?:"([^"]*)"|(\S+))/g;
      let attrMatch;
      while ((attrMatch = attrRegex.exec(attrs)) !== null) {
        attrMap[attrMatch[1]] = attrMatch[2] || attrMatch[3];
      }
    }

    directives.push({
      placeholder,
      directive: {
        type: type as "callout" | "toggle",
        title: attrMap.title,
        calloutType: (attrMap.type as DirectiveBlock["calloutType"]) || "info",
        body: body.trim(),
      },
    });

    // Replace with placeholder that martian will turn into a paragraph
    return `\n${placeholder}\n`;
  });

  return { cleanMarkdown, directives };
}

/**
 * Convert a directive to Notion block(s)
 */
function directiveToBlocks(directive: DirectiveBlock): BlockObjectRequest[] {
  if (directive.type === "callout") {
    const icon = CALLOUT_ICONS[directive.calloutType || "default"] || CALLOUT_ICONS.default;

    // Check if body is too long for a single callout
    // Notion limit is 2000 chars per rich_text content
    if (directive.body.length > NOTION_LIMITS.SAFE_PARAGRAPH_LENGTH) {
      // Split long body into multiple blocks:
      // 1. Callout with title + first chunk of body
      // 2. Additional paragraphs for remaining content
      const bodyChunks = chunkText(directive.body, NOTION_LIMITS.SAFE_PARAGRAPH_LENGTH);
      const blocks: BlockObjectRequest[] = [];

      // First callout with title and first chunk
      const firstChunkItems: any[] = [];
      if (directive.title) {
        firstChunkItems.push({
          type: "text",
          text: { content: directive.title },
          annotations: { bold: true },
        });
        firstChunkItems.push({
          type: "text",
          text: { content: "\n\n" },
        });
      }
      firstChunkItems.push({
        type: "text",
        text: { content: bodyChunks[0] },
      });

      blocks.push({
        type: "callout",
        callout: {
          icon: { type: "emoji", emoji: icon as any },
          rich_text: firstChunkItems,
          color: "gray_background",
        },
      } as BlockObjectRequest);

      // Remaining chunks as paragraphs (indented visually by being after callout)
      for (let i = 1; i < bodyChunks.length; i++) {
        blocks.push({
          type: "paragraph",
          paragraph: {
            rich_text: [{ type: "text", text: { content: bodyChunks[i] } }],
          },
        } as BlockObjectRequest);
      }

      return blocks;
    }

    // Normal case: body fits in single callout
    const richTextItems: any[] = [];

    if (directive.title) {
      richTextItems.push({
        type: "text",
        text: { content: directive.title },
        annotations: { bold: true },
      });
      richTextItems.push({
        type: "text",
        text: { content: "\n\n" },
      });
    }

    // Add body text
    richTextItems.push({
      type: "text",
      text: { content: directive.body },
    });

    return [
      {
        type: "callout",
        callout: {
          icon: { type: "emoji", emoji: icon as any },
          rich_text: richTextItems,
          color: "gray_background",
        },
      } as BlockObjectRequest,
    ];
  }

  if (directive.type === "toggle") {
    // Convert body to blocks for toggle children
    const childBlocks = markdownToBlocks(directive.body);

    return [
      {
        type: "toggle",
        toggle: {
          rich_text: [
            {
              type: "text",
              text: { content: directive.title || "Details" },
            },
          ],
          children: childBlocks.slice(0, 100) as any[], // Notion limit
        },
      } as BlockObjectRequest,
    ];
  }

  return [];
}

// ============================================
// Text Chunking (Limits Shim)
// ============================================

/**
 * Split text into chunks that fit within Notion's rich_text limits
 */
function chunkText(text: string, maxLength: number = NOTION_LIMITS.SAFE_PARAGRAPH_LENGTH): string[] {
  if (text.length <= maxLength) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    // Find a good break point (sentence end, then word boundary)
    let breakPoint = maxLength;

    // Try to break at sentence end
    const sentenceEnd = remaining.lastIndexOf(". ", maxLength);
    if (sentenceEnd > maxLength * 0.5) {
      breakPoint = sentenceEnd + 1;
    } else {
      // Fall back to word boundary
      const wordBoundary = remaining.lastIndexOf(" ", maxLength);
      if (wordBoundary > maxLength * 0.3) {
        breakPoint = wordBoundary;
      }
    }

    chunks.push(remaining.substring(0, breakPoint).trim());
    remaining = remaining.substring(breakPoint).trim();
  }

  return chunks;
}

/**
 * Process blocks to ensure they fit within Notion limits.
 * Splits long paragraphs, handles deep nesting, etc.
 */
function applyLimitsShim(blocks: BlockObjectRequest[]): {
  blocks: BlockObjectRequest[];
  chunkedCount: number;
} {
  const result: BlockObjectRequest[] = [];
  let chunkedCount = 0;

  for (const block of blocks) {
    if (block.type === "paragraph") {
      const para = block as any;
      const richText = para.paragraph?.rich_text || [];

      // Calculate total text length
      let totalLength = 0;
      for (const rt of richText) {
        if (rt.type === "text" && rt.text?.content) {
          totalLength += rt.text.content.length;
        }
      }

      if (totalLength > NOTION_LIMITS.SAFE_PARAGRAPH_LENGTH) {
        // Need to chunk this paragraph
        const fullText = richText
          .map((rt: any) => (rt.type === "text" ? rt.text?.content || "" : ""))
          .join("");

        const chunks = chunkText(fullText);
        chunkedCount++;

        for (const chunk of chunks) {
          result.push({
            type: "paragraph",
            paragraph: {
              rich_text: [{ type: "text", text: { content: chunk } }],
            },
          } as BlockObjectRequest);
        }
      } else {
        result.push(block);
      }
    } else {
      result.push(block);
    }
  }

  return { blocks: result, chunkedCount };
}

// ============================================
// Table Fallback Ladder
// ============================================

/**
 * Check if markdown contains tables and handle with fallback ladder:
 * 1. Small tables (<=10 rows): let martian convert
 * 2. Larger tables: convert to code block (reliable fallback)
 */
function processTableFallbacks(markdown: string): {
  markdown: string;
  tablesFallback: number;
} {
  let tablesFallback = 0;

  // Find markdown tables
  const tableRegex = /(\|[^\n]+\|\n\|[-:| ]+\|\n(?:\|[^\n]+\|\n?)+)/g;

  const processed = markdown.replace(tableRegex, (table) => {
    const rows = table.trim().split("\n");
    const dataRows = rows.length - 2; // Exclude header and separator

    if (dataRows > NOTION_LIMITS.MAX_TABLE_ROWS) {
      // Convert large table to code block
      tablesFallback++;
      return `\n\`\`\`\n${table.trim()}\n\`\`\`\n`;
    }

    // Small table - let martian handle it
    return table;
  });

  return { markdown: processed, tablesFallback };
}

// ============================================
// Main Conversion Function
// ============================================

/**
 * Convert Notion-safe Markdown to Notion blocks.
 *
 * Features:
 * - Handles callout and toggle directives
 * - Applies limits shim for text chunking
 * - Table fallback ladder for reliability
 * - Returns warnings for any issues
 */
export function convertMarkdownToNotionBlocks(markdown: string): ConversionResult {
  const warnings: string[] = [];
  let directivesProcessed = 0;

  // Step 1: Process table fallbacks
  const { markdown: tableProcessed, tablesFallback } = processTableFallbacks(markdown);

  // Step 2: Extract directives
  const { cleanMarkdown, directives } = parseDirectives(tableProcessed);
  directivesProcessed = directives.length;

  // Step 3: Convert base markdown to blocks
  let blocks: BlockObjectRequest[];
  try {
    blocks = markdownToBlocks(cleanMarkdown);
  } catch (error: any) {
    warnings.push(`Markdown conversion error: ${error.message}`);
    // Fallback: wrap entire content in a paragraph
    blocks = [
      {
        type: "paragraph",
        paragraph: {
          rich_text: [{ type: "text", text: { content: markdown.substring(0, 2000) } }],
        },
      } as BlockObjectRequest,
    ];
  }

  // Step 4: Replace directive placeholders with actual blocks
  const finalBlocks: BlockObjectRequest[] = [];
  for (const block of blocks) {
    if (block.type === "paragraph") {
      const para = block as any;
      const richTextArray = para.paragraph?.rich_text || [];

      // Join ALL rich_text content to check for placeholder
      const fullText = richTextArray
        .map((rt: any) => (rt.type === "text" ? rt.text?.content || "" : ""))
        .join("");

      // Check if this is a directive placeholder (ATLASDIR format avoids markdown interpretation)
      const placeholderMatch = fullText.match(/ATLASDIR(\d+)ATLASDIR/);
      if (placeholderMatch) {
        const idx = parseInt(placeholderMatch[1], 10);
        const directive = directives.find((d) => d.placeholder === `ATLASDIR${idx}ATLASDIR`);
        if (directive) {
          finalBlocks.push(...directiveToBlocks(directive.directive));
          continue;
        }
      }
    }
    finalBlocks.push(block);
  }

  // Step 5: Apply limits shim
  const { blocks: limitedBlocks, chunkedCount } = applyLimitsShim(finalBlocks);

  if (chunkedCount > 0) {
    warnings.push(`Chunked ${chunkedCount} long paragraph(s) to fit Notion limits`);
  }

  if (tablesFallback > 0) {
    warnings.push(`Converted ${tablesFallback} large table(s) to code blocks`);
  }

  return {
    blocks: limitedBlocks,
    warnings,
    stats: {
      totalBlocks: limitedBlocks.length,
      chunkedParagraphs: chunkedCount,
      tablesFallback,
      directivesProcessed,
    },
  };
}

/**
 * Batch blocks for Notion API requests.
 * Returns arrays of blocks, each fitting within the per-request limit.
 */
export function batchBlocksForApi(blocks: BlockObjectRequest[]): BlockObjectRequest[][] {
  const batches: BlockObjectRequest[][] = [];

  for (let i = 0; i < blocks.length; i += NOTION_LIMITS.BLOCKS_PER_REQUEST) {
    batches.push(blocks.slice(i, i + NOTION_LIMITS.BLOCKS_PER_REQUEST));
  }

  return batches;
}

// ============================================
// Research-Specific Formatting
// ============================================

/**
 * Validate URL for Notion compatibility
 * Returns true if URL is valid HTTP/HTTPS
 */
function isValidNotionUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Format research results as Notion-safe Markdown.
 * This is the format Gemini should output.
 */
export function formatResearchAsMarkdown(data: {
  summary: string;
  findings: Array<{ claim: string; source: string; url: string }>;
  sources: string[];
  query: string;
}): string {
  const lines: string[] = [];

  // Executive Summary as callout
  lines.push(`:::callout type=info title="Executive Summary"`);
  lines.push(data.summary);
  lines.push(`:::`);
  lines.push("");

  // Key Findings
  if (data.findings.length > 0) {
    lines.push("## Key Findings");
    lines.push("");

    for (let i = 0; i < data.findings.length; i++) {
      const f = data.findings[i];
      lines.push(`${i + 1}. **${f.claim}**`);
      // Only include URL if it's valid
      if (f.source && f.url && isValidNotionUrl(f.url)) {
        lines.push(`   — [${f.source}](${f.url})`);
      } else if (f.source) {
        lines.push(`   — *${f.source}*`);
      }
      lines.push("");
    }
  }

  // Sources - filter to valid URLs only
  const validSources = data.sources.filter(isValidNotionUrl);
  if (validSources.length > 0) {
    lines.push("## Sources");
    lines.push("");
    lines.push(":::toggle title=\"View all sources\"");
    for (let i = 0; i < validSources.length; i++) {
      lines.push(`${i + 1}. ${validSources[i]}`);
    }
    lines.push(":::");
  }

  return lines.join("\n");
}

/**
 * Generate the Gemini prompt that outputs Notion-safe Markdown.
 */
export function getNotionSafeMarkdownPrompt(query: string, depth: string): string {
  return `You are Atlas Research Agent, an autonomous research assistant with access to Google Search.

## Research Task
Query: "${query}"
Depth: ${depth}

## Instructions

Use Google Search to find current, authoritative information about this topic.

## Output Format

Return a single Markdown document following these rules:
- Use ATX headings (#, ##, ###)
- Use standard bullet/number lists
- For the executive summary, use:
  :::callout type=info title="Executive Summary"
  Your summary here (2-3 sentences)
  :::
- For expandable details, use:
  :::toggle title="Section Title"
  Content here
  :::
- Keep paragraphs under 800 characters
- Do not use HTML
- Do not include JSON

## Document Structure

1. Start with the executive summary callout
2. Add "## Key Findings" section with numbered findings
3. For each finding: state the fact, then cite source with markdown link
4. End with "## Sources" section listing all URLs

Begin your research now.`;
}
