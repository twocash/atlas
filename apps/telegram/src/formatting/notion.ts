/**
 * Atlas Telegram Bot - Notion Formatting Utilities
 *
 * Shared utilities for creating and formatting Notion blocks.
 * Used by audit.ts, tools/core.ts, and skill execution.
 *
 * @module formatting/notion
 */

import { Client } from '@notionhq/client';
import { logger } from '../logger';

// Re-export for convenience
export type NotionBlock = {
  object: 'block';
  type: string;
  [key: string]: unknown;
};

/**
 * Strip Markdown formatting for Notion rich_text
 * Notion rich_text doesn't render Markdown - it shows raw asterisks
 */
export function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, '$1')     // Bold **text**
    .replace(/\*([^*]+)\*/g, '$1')          // Italic *text*
    .replace(/__([^_]+)__/g, '$1')          // Bold __text__
    .replace(/_([^_]+)_/g, '$1')            // Italic _text_
    .replace(/`([^`]+)`/g, '$1')            // Inline code `text`
    .replace(/```[\s\S]*?```/g, '')         // Code blocks
    .replace(/#+\s+/g, '')                  // Headers
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // Links [text](url)
    .replace(/<binary data[^>]*>/gi, '')    // Binary artifacts
    .trim();
}

/**
 * Clean and truncate text for Notion blocks
 * Notion has a 2000 char limit per rich_text block
 */
export function prepareForNotion(text: string, maxLength: number = 2000): string {
  const cleaned = stripMarkdown(text);
  if (cleaned.length <= maxLength) return cleaned;
  return cleaned.substring(0, maxLength - 3) + '...';
}

/**
 * Create a divider block
 */
export function createDivider(): NotionBlock {
  return {
    object: 'block',
    type: 'divider',
    divider: {},
  };
}

/**
 * Create a heading block
 */
export function createHeading(
  text: string,
  level: 1 | 2 | 3 = 2
): NotionBlock {
  const key = `heading_${level}` as const;
  return {
    object: 'block',
    type: key,
    [key]: {
      rich_text: [{ type: 'text', text: { content: prepareForNotion(text) } }],
    },
  };
}

/**
 * Create a paragraph block
 */
export function createParagraph(text: string): NotionBlock {
  return {
    object: 'block',
    type: 'paragraph',
    paragraph: {
      rich_text: [{ type: 'text', text: { content: prepareForNotion(text) } }],
    },
  };
}

/**
 * Create a callout block
 */
export function createCallout(
  text: string,
  emoji: string = '💡'
): NotionBlock {
  return {
    object: 'block',
    type: 'callout',
    callout: {
      rich_text: [{ type: 'text', text: { content: prepareForNotion(text) } }],
      icon: { type: 'emoji', emoji },
    },
  };
}

/**
 * Create a bulleted list item block
 */
export function createBullet(text: string): NotionBlock {
  return {
    object: 'block',
    type: 'bulleted_list_item',
    bulleted_list_item: {
      rich_text: [{ type: 'text', text: { content: prepareForNotion(text, 500) } }],
    },
  };
}

/**
 * Create a toggle block with children
 */
export function createToggle(
  title: string,
  children: NotionBlock[]
): NotionBlock {
  return {
    object: 'block',
    type: 'toggle',
    toggle: {
      rich_text: [{ type: 'text', text: { content: prepareForNotion(title) } }],
      children,
    },
  };
}

/**
 * Append blocks to a Notion page
 * This is the standard way to add content to a page body
 */
export async function appendBlocksToPage(
  notion: Client,
  pageId: string,
  blocks: NotionBlock[]
): Promise<{ success: boolean; blocksAdded: number; error?: string }> {
  if (blocks.length === 0) {
    return { success: true, blocksAdded: 0 };
  }

  try {
    await notion.blocks.children.append({
      block_id: pageId,
      children: blocks as Parameters<typeof notion.blocks.children.append>[0]['children'],
    });

    logger.info('Blocks appended to Notion page', {
      pageId,
      blockCount: blocks.length,
    });

    return { success: true, blocksAdded: blocks.length };
  } catch (error: any) {
    logger.error('Failed to append blocks to Notion page', {
      pageId,
      error: error?.message,
    });
    return {
      success: false,
      blocksAdded: 0,
      error: `Notion error: ${error?.code || 'unknown'} - ${error?.message || String(error)}`,
    };
  }
}

/**
 * Parse markdown content into Notion blocks
 * Handles: headings, bullets, numbered lists, bold, and paragraphs
 */
export function parseMarkdownToBlocks(content: string): NotionBlock[] {
  const blocks: NotionBlock[] = [];
  const lines = content.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();

    // Skip empty lines
    if (!line) {
      i++;
      continue;
    }

    // Headings: # ## ### or **Header** on its own line
    const h1Match = line.match(/^#\s+(.+)$/);
    const h2Match = line.match(/^##\s+(.+)$/);
    const h3Match = line.match(/^###\s+(.+)$/);
    const boldHeaderMatch = line.match(/^\*\*([^*]+)\*\*$/);

    if (h1Match) {
      blocks.push(createHeading(h1Match[1].replace(/\*\*/g, ''), 1));
      i++;
      continue;
    }
    if (h2Match) {
      blocks.push(createHeading(h2Match[1].replace(/\*\*/g, ''), 2));
      i++;
      continue;
    }
    if (h3Match) {
      blocks.push(createHeading(h3Match[1].replace(/\*\*/g, ''), 3));
      i++;
      continue;
    }
    if (boldHeaderMatch && line === `**${boldHeaderMatch[1]}**`) {
      // Standalone bold line = treat as heading
      blocks.push(createHeading(boldHeaderMatch[1], 3));
      i++;
      continue;
    }

    // Bullet points: - or *
    const bulletMatch = line.match(/^[-*]\s+(.+)$/);
    if (bulletMatch) {
      blocks.push(createBullet(stripMarkdown(bulletMatch[1])));
      i++;
      continue;
    }

    // Numbered lists: 1. 2. etc
    const numberedMatch = line.match(/^\d+\.\s+(.+)$/);
    if (numberedMatch) {
      blocks.push({
        object: 'block',
        type: 'numbered_list_item',
        numbered_list_item: {
          rich_text: [{ type: 'text', text: { content: prepareForNotion(stripMarkdown(numberedMatch[1]), 500) } }],
        },
      });
      i++;
      continue;
    }

    // Regular paragraph - collect consecutive non-special lines
    let paragraphText = line;
    i++;
    while (i < lines.length) {
      const nextLine = lines[i].trim();
      // Stop if empty line, heading, or list item
      if (!nextLine || nextLine.match(/^#{1,3}\s/) || nextLine.match(/^[-*]\s/) || nextLine.match(/^\d+\.\s/) || nextLine.match(/^\*\*[^*]+\*\*$/)) {
        break;
      }
      paragraphText += ' ' + nextLine;
      i++;
    }

    // Create paragraph with stripped markdown
    blocks.push(createParagraph(stripMarkdown(paragraphText)));
  }

  return blocks;
}

/**
 * Create a standard analysis section for a page
 * Follows SOP-007: Notion Page Body Communication Standard
 *
 * Structure:
 * ---
 * ## 📋 Section Header
 * > Callout with context/status
 * Content paragraphs...
 * - Bullet points
 */
export function createAnalysisSection(opts: {
  heading?: string;
  callout?: string;
  calloutEmoji?: string;
  content: string;
  bullets?: string[];
}): NotionBlock[] {
  const blocks: NotionBlock[] = [];

  // Divider to separate from existing content (SOP-007 standard)
  blocks.push(createDivider());

  // Section heading - should include emoji per SOP-007
  if (opts.heading) {
    blocks.push(createHeading(opts.heading, 2));
  }

  // Callout for context/status (SOP-007: "Callout for important context")
  if (opts.callout) {
    blocks.push(createCallout(opts.callout, opts.calloutEmoji || '📋'));
  }

  // Parse markdown content into proper Notion blocks
  // This handles headings, bullets, numbered lists, and paragraphs
  const contentBlocks = parseMarkdownToBlocks(opts.content);
  blocks.push(...contentBlocks.slice(0, 30)); // Allow up to 30 blocks for thorough analysis

  // Additional bullet points for key findings (SOP-007: "Key Points" pattern)
  if (opts.bullets && opts.bullets.length > 0) {
    for (const bullet of opts.bullets.slice(0, 10)) {
      blocks.push(createBullet(bullet));
    }
  }

  return blocks;
}
