import { describe, test, expect } from 'bun:test';
import { convertMarkdownToNotionBlocks, batchBlocksForApi, chunkText } from '../src/notion/markdown-to-blocks';

describe('convertMarkdownToNotionBlocks', () => {
  test('converts headers to heading blocks', () => {
    const result = convertMarkdownToNotionBlocks('## My Header');
    expect(result.blocks.some(b => b.type === 'heading_2')).toBe(true);
    expect(result.stats.totalBlocks).toBeGreaterThan(0);
  });

  test('converts H1 headers', () => {
    const result = convertMarkdownToNotionBlocks('# Top Level Header');
    expect(result.blocks.some(b => b.type === 'heading_1')).toBe(true);
  });

  test('converts H3 headers', () => {
    const result = convertMarkdownToNotionBlocks('### Sub Header');
    expect(result.blocks.some(b => b.type === 'heading_3')).toBe(true);
  });

  test('converts bold text in paragraphs', () => {
    const result = convertMarkdownToNotionBlocks('This is **bold text** in a paragraph.');
    expect(result.blocks.length).toBeGreaterThan(0);
    // Martian handles bold → rich_text annotations
  });

  test('converts bullet lists', () => {
    const result = convertMarkdownToNotionBlocks('- item 1\n- item 2\n- item 3');
    const bullets = result.blocks.filter(b => b.type === 'bulleted_list_item');
    expect(bullets.length).toBe(3);
  });

  test('converts numbered lists', () => {
    const result = convertMarkdownToNotionBlocks('1. first\n2. second\n3. third');
    const numbered = result.blocks.filter(b => b.type === 'numbered_list_item');
    expect(numbered.length).toBe(3);
  });

  test('converts code blocks with language', () => {
    const result = convertMarkdownToNotionBlocks('```javascript\nconst x = 1;\nconsole.log(x);\n```');
    expect(result.blocks.some(b => b.type === 'code')).toBe(true);
  });

  test('converts code blocks without language', () => {
    const result = convertMarkdownToNotionBlocks('```\nplain code\n```');
    expect(result.blocks.some(b => b.type === 'code')).toBe(true);
  });

  test('converts inline code', () => {
    const result = convertMarkdownToNotionBlocks('Use `const` for constants.');
    expect(result.blocks.length).toBeGreaterThan(0);
  });

  test('converts callout directives', () => {
    const result = convertMarkdownToNotionBlocks(':::callout type=info\nThis is important info.\n:::');
    expect(result.blocks.some(b => b.type === 'callout')).toBe(true);
    expect(result.stats.directivesProcessed).toBe(1);
  });

  test('converts callout with title', () => {
    const result = convertMarkdownToNotionBlocks(':::callout type=tip title="Pro Tip"\nHelpful advice here.\n:::');
    expect(result.blocks.some(b => b.type === 'callout')).toBe(true);
    expect(result.stats.directivesProcessed).toBe(1);
  });

  test('converts callout with warning type', () => {
    const result = convertMarkdownToNotionBlocks(':::callout type=warning\nBe careful!\n:::');
    const callout = result.blocks.find(b => b.type === 'callout');
    expect(callout).toBeDefined();
  });

  test('converts toggle directives', () => {
    const result = convertMarkdownToNotionBlocks(':::toggle title="Click to expand"\nHidden content here.\n:::');
    expect(result.blocks.some(b => b.type === 'toggle')).toBe(true);
    expect(result.stats.directivesProcessed).toBe(1);
  });

  test('chunks long paragraphs', () => {
    const longText = 'X'.repeat(3000);
    const result = convertMarkdownToNotionBlocks(longText);
    expect(result.blocks.length).toBeGreaterThan(1);
    expect(result.stats.chunkedParagraphs).toBeGreaterThan(0);
  });

  test('falls back large tables to code blocks', () => {
    const largeTable = '| A | B |\n|---|---|\n' +
      Array(15).fill('| 1 | 2 |').join('\n');
    const result = convertMarkdownToNotionBlocks(largeTable);
    expect(result.stats.tablesFallback).toBe(1);
    expect(result.blocks.some(b => b.type === 'code')).toBe(true);
  });

  test('converts small tables normally', () => {
    const smallTable = '| A | B |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |';
    const result = convertMarkdownToNotionBlocks(smallTable);
    // Small tables should not fall back
    expect(result.stats.tablesFallback).toBe(0);
  });

  test('handles malformed markdown gracefully', () => {
    const result = convertMarkdownToNotionBlocks('**unclosed bold');
    expect(result.blocks.length).toBeGreaterThan(0);
    // Should not throw, should produce some output
  });

  test('handles unclosed code blocks gracefully', () => {
    const result = convertMarkdownToNotionBlocks('```javascript\nconst x = 1;');
    expect(result.blocks.length).toBeGreaterThan(0);
  });

  test('preserves empty result for empty input', () => {
    const result = convertMarkdownToNotionBlocks('');
    expect(result.blocks).toEqual([]);
    expect(result.stats.totalBlocks).toBe(0);
  });

  test('handles whitespace-only input', () => {
    const result = convertMarkdownToNotionBlocks('   \n\n   ');
    expect(result.blocks).toEqual([]);
  });

  test('converts links', () => {
    const result = convertMarkdownToNotionBlocks('Check out [this link](https://example.com).');
    expect(result.blocks.length).toBeGreaterThan(0);
  });

  test('converts blockquotes', () => {
    const result = convertMarkdownToNotionBlocks('> This is a quote');
    expect(result.blocks.some(b => b.type === 'quote')).toBe(true);
  });

  test('handles multiple directives', () => {
    const markdown = `
:::callout type=info
First callout
:::

Some text between.

:::callout type=warning
Second callout
:::
`.trim();
    const result = convertMarkdownToNotionBlocks(markdown);
    const callouts = result.blocks.filter(b => b.type === 'callout');
    expect(callouts.length).toBe(2);
    expect(result.stats.directivesProcessed).toBe(2);
  });

  test('handles mixed content', () => {
    const markdown = `
## Overview

This is a **bold** statement.

:::callout type=tip title="Key Point"
Important information here.
:::

### Details

- First item
- Second item

\`\`\`typescript
const code = 'example';
\`\`\`
`.trim();
    const result = convertMarkdownToNotionBlocks(markdown);
    expect(result.blocks.length).toBeGreaterThan(5);
    expect(result.stats.directivesProcessed).toBe(1);
  });
});

describe('batchBlocksForApi', () => {
  test('batches blocks into groups of 100', () => {
    const blocks = Array(250).fill({
      type: 'paragraph',
      paragraph: { rich_text: [{ type: 'text', text: { content: 'test' } }] }
    });
    const batches = batchBlocksForApi(blocks as any);
    expect(batches.length).toBe(3);
    expect(batches[0].length).toBe(100);
    expect(batches[1].length).toBe(100);
    expect(batches[2].length).toBe(50);
  });

  test('returns single batch for small arrays', () => {
    const blocks = Array(50).fill({
      type: 'paragraph',
      paragraph: { rich_text: [{ type: 'text', text: { content: 'test' } }] }
    });
    const batches = batchBlocksForApi(blocks as any);
    expect(batches.length).toBe(1);
    expect(batches[0].length).toBe(50);
  });

  test('handles empty array', () => {
    const batches = batchBlocksForApi([]);
    expect(batches.length).toBe(0);
  });

  test('handles exactly 100 blocks', () => {
    const blocks = Array(100).fill({
      type: 'paragraph',
      paragraph: { rich_text: [{ type: 'text', text: { content: 'test' } }] }
    });
    const batches = batchBlocksForApi(blocks as any);
    expect(batches.length).toBe(1);
    expect(batches[0].length).toBe(100);
  });
});

describe('chunkText', () => {
  test('returns single chunk for short text', () => {
    const chunks = chunkText('Short text');
    expect(chunks.length).toBe(1);
    expect(chunks[0]).toBe('Short text');
  });

  test('splits long text into multiple chunks', () => {
    const longText = 'A'.repeat(5000);
    const chunks = chunkText(longText);
    expect(chunks.length).toBeGreaterThan(1);
    // Each chunk should be under the limit
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(1800);
    }
  });

  test('respects custom max length', () => {
    const text = 'A'.repeat(100);
    const chunks = chunkText(text, 30);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(30);
    }
  });

  test('breaks at sentence boundaries when possible', () => {
    const text = 'First sentence. Second sentence. Third sentence. Fourth sentence.'.repeat(50);
    const chunks = chunkText(text, 100);
    // Should break at periods when possible
    expect(chunks.length).toBeGreaterThan(1);
  });

  test('breaks at word boundaries when no sentences', () => {
    const text = 'word '.repeat(500);
    const chunks = chunkText(text, 100);
    // Should not break mid-word
    for (const chunk of chunks) {
      expect(chunk.endsWith(' ') || chunk === chunks[chunks.length - 1]).toBe(true);
    }
  });

  test('handles empty string', () => {
    const chunks = chunkText('');
    expect(chunks.length).toBe(1);
    expect(chunks[0]).toBe('');
  });
});
