/**
 * Atlas Telegram Bot - Message Formatting
 *
 * Converts Claude's markdown output to Telegram HTML format.
 * Telegram uses a subset of HTML for formatting messages.
 *
 * Telegram HTML supports:
 * - <b>bold</b>, <strong>bold</strong>
 * - <i>italic</i>, <em>italic</em>
 * - <u>underline</u>
 * - <s>strikethrough</s>
 * - <code>inline code</code>
 * - <pre>code block</pre>
 * - <a href="URL">link</a>
 */

/**
 * Escape HTML special characters to prevent injection
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Convert markdown to Telegram HTML format
 *
 * Handles:
 * - **bold** → <b>bold</b>
 * - *italic* → <i>italic</i>
 * - `inline code` → <code>inline code</code>
 * - ```code blocks``` → <pre>code</pre>
 * - ~~strikethrough~~ → <s>strikethrough</s>
 * - [text](url) → <a href="url">text</a>
 * - Headers (# ## ###) → <b>header</b>
 */
export function markdownToHtml(markdown: string): string {
  let html = markdown;

  // Step 1: Escape HTML entities first (except in code blocks which we'll handle)
  // We need to be careful not to double-escape

  // Step 2: Handle code blocks first (``` ... ```)
  // Preserve content inside code blocks by replacing with placeholders
  const codeBlocks: string[] = [];
  html = html.replace(/```(?:\w+)?\n?([\s\S]*?)```/g, (_match, code) => {
    const index = codeBlocks.length;
    // Escape HTML inside code blocks
    codeBlocks.push(`<pre>${escapeHtml(code.trim())}</pre>`);
    return `__CODE_BLOCK_${index}__`;
  });

  // Step 3: Handle inline code (` ... `)
  const inlineCode: string[] = [];
  html = html.replace(/`([^`\n]+)`/g, (_match, code) => {
    const index = inlineCode.length;
    inlineCode.push(`<code>${escapeHtml(code)}</code>`);
    return `__INLINE_CODE_${index}__`;
  });

  // Step 4: Escape remaining HTML entities
  html = escapeHtml(html);

  // Step 5: Restore code blocks (already escaped)
  html = html.replace(/__CODE_BLOCK_(\d+)__/g, (_match, index) => {
    return codeBlocks[parseInt(index, 10)];
  });

  // Step 6: Restore inline code (already escaped)
  html = html.replace(/__INLINE_CODE_(\d+)__/g, (_match, index) => {
    return inlineCode[parseInt(index, 10)];
  });

  // Step 7: Convert markdown syntax to HTML

  // Bold: **text** or __text__
  html = html.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  html = html.replace(/__([^_]+)__/g, '<b>$1</b>');

  // Italic: *text* or _text_ (but not inside words)
  // Be careful not to match * in lists or _ in variable names
  html = html.replace(/(?<![*\w])\*([^*\n]+)\*(?![*\w])/g, '<i>$1</i>');
  html = html.replace(/(?<![_\w])_([^_\n]+)_(?![_\w])/g, '<i>$1</i>');

  // Strikethrough: ~~text~~
  html = html.replace(/~~([^~]+)~~/g, '<s>$1</s>');

  // Links: [text](url) - restore the escaped < and >
  html = html.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2">$1</a>'
  );

  // Headers: # ## ### at start of line → bold
  html = html.replace(/^#{1,3}\s+(.+)$/gm, '<b>$1</b>');

  // Bullet lists: preserve as-is (Telegram renders them fine)
  // Just clean up the - or * markers
  // (leaving these as-is for now)

  return html.trim();
}

/**
 * Format a response for Telegram - convenience wrapper
 */
export function formatForTelegram(text: string): string {
  return markdownToHtml(text);
}

/**
 * Strip all formatting for plain text fallback
 */
export function stripFormatting(text: string): string {
  return text
    // Remove code blocks
    .replace(/```[\s\S]*?```/g, '')
    // Remove inline code
    .replace(/`[^`]+`/g, '')
    // Remove bold/italic markers
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    // Remove links, keep text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // Remove headers
    .replace(/^#{1,3}\s+/gm, '')
    .trim();
}
