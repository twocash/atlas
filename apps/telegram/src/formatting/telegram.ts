/**
 * Telegram Formatter
 *
 * Smart formatting for Telegram messages.
 * Handles both HTML passthrough and markdown conversion.
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

import type { FormatOptions } from './types';

// Allowed HTML tags in Telegram
const ALLOWED_TAGS = ['b', 'strong', 'i', 'em', 'u', 's', 'code', 'pre', 'a'];

/**
 * Escape HTML special characters
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Check if text contains HTML tags
 */
function containsHtmlTags(text: string): boolean {
  return /<\/?[a-z][\s\S]*>/i.test(text);
}

/**
 * Validate and sanitize HTML - only allow Telegram-safe tags
 */
function sanitizeHtml(html: string): string {
  // First, protect allowed tags by temporarily replacing them
  const tagPlaceholders: Array<{ placeholder: string; tag: string }> = [];
  let sanitized = html;

  // Match opening and closing tags for allowed elements
  const tagPattern = new RegExp(
    `<(\\/?)\\s*(${ALLOWED_TAGS.join('|')})([^>]*)>`,
    'gi'
  );

  sanitized = sanitized.replace(tagPattern, (match, closing, tagName, attrs) => {
    const placeholder = `__TAG_${tagPlaceholders.length}__`;
    // For anchor tags, preserve href attribute
    let cleanTag = '';
    if (tagName.toLowerCase() === 'a' && !closing) {
      const hrefMatch = attrs.match(/href\s*=\s*["']([^"']+)["']/i);
      const href = hrefMatch ? hrefMatch[1] : '';
      cleanTag = `<a href="${escapeHtml(href)}">`;
    } else {
      cleanTag = `<${closing}${tagName.toLowerCase()}>`;
    }
    tagPlaceholders.push({ placeholder, tag: cleanTag });
    return placeholder;
  });

  // Escape any remaining HTML (disallowed tags)
  sanitized = escapeHtml(sanitized);

  // Restore allowed tags
  for (const { placeholder, tag } of tagPlaceholders) {
    sanitized = sanitized.replace(placeholder, tag);
  }

  return sanitized;
}

/**
 * Convert markdown to Telegram HTML
 */
function markdownToHtml(markdown: string): string {
  let html = markdown;

  // Handle code blocks first (``` ... ```)
  // Use \x00 delimiter to avoid conflicts with markdown patterns
  const codeBlocks: string[] = [];
  html = html.replace(/```(?:\w+)?\n?([\s\S]*?)```/g, (_match, code) => {
    const index = codeBlocks.length;
    codeBlocks.push(`<pre>${escapeHtml(code.trim())}</pre>`);
    return `\x00CODE${index}\x00`;
  });

  // Handle inline code (` ... `)
  const inlineCode: string[] = [];
  html = html.replace(/`([^`\n]+)`/g, (_match, code) => {
    const index = inlineCode.length;
    inlineCode.push(`<code>${escapeHtml(code)}</code>`);
    return `\x00INLINE${index}\x00`;
  });

  // Escape remaining HTML entities
  html = escapeHtml(html);

  // Restore code blocks
  html = html.replace(/\x00CODE(\d+)\x00/g, (_match, index) => {
    return codeBlocks[parseInt(index, 10)];
  });

  // Restore inline code
  html = html.replace(/\x00INLINE(\d+)\x00/g, (_match, index) => {
    return inlineCode[parseInt(index, 10)];
  });

  // Convert markdown syntax to HTML

  // Bold: **text** or __text__
  html = html.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  html = html.replace(/__([^_]+)__/g, '<b>$1</b>');

  // Italic: *text* or _text_
  html = html.replace(/(?<![*\w])\*([^*\n]+)\*(?![*\w])/g, '<i>$1</i>');
  html = html.replace(/(?<![_\w])_([^_\n]+)_(?![_\w])/g, '<i>$1</i>');

  // Strikethrough: ~~text~~
  html = html.replace(/~~([^~]+)~~/g, '<s>$1</s>');

  // Links: [text](url)
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  // Headers: # ## ### at start of line → bold
  html = html.replace(/^#{1,3}\s+(.+)$/gm, '<b>$1</b>');

  return html.trim();
}

/**
 * Main formatting function - handles mixed HTML and markdown content
 *
 * Strategy:
 * 1. Protect existing valid HTML tags
 * 2. Convert markdown to HTML
 * 3. Restore protected tags
 */
export function formatMessage(text: string, options: FormatOptions = {}): string {
  const {
    preserveHtml = true,
    parseMarkdown = true,
    plainText = false,
  } = options;

  if (plainText) {
    return stripFormatting(text);
  }

  let result = text;

  // Step 1: Protect existing HTML tags if preserveHtml is true
  // Use \x00 (null char) as delimiter - won't conflict with markdown
  const protectedTags: Array<{ placeholder: string; tag: string }> = [];

  if (preserveHtml && containsHtmlTags(result)) {
    // Match allowed HTML tags and protect them
    const tagPattern = new RegExp(
      `<(\\/?)\\s*(${ALLOWED_TAGS.join('|')})([^>]*)>`,
      'gi'
    );

    result = result.replace(tagPattern, (match, closing, tagName, attrs) => {
      const placeholder = `\x00TAG${protectedTags.length}\x00`;
      let cleanTag = '';

      if (tagName.toLowerCase() === 'a' && !closing) {
        const hrefMatch = attrs.match(/href\s*=\s*["']([^"']+)["']/i);
        const href = hrefMatch ? hrefMatch[1] : '';
        cleanTag = `<a href="${href}">`;
      } else {
        cleanTag = `<${closing}${tagName.toLowerCase()}>`;
      }

      protectedTags.push({ placeholder, tag: cleanTag });
      return placeholder;
    });
  }

  // Step 2: Handle code blocks (protect from escaping)
  const codeBlocks: string[] = [];
  result = result.replace(/```(?:\w+)?\n?([\s\S]*?)```/g, (_match, code) => {
    const index = codeBlocks.length;
    codeBlocks.push(`<pre>${escapeHtml(code.trim())}</pre>`);
    return `\x00CODE${index}\x00`;
  });

  // Step 3: Handle inline code
  const inlineCode: string[] = [];
  result = result.replace(/`([^`\n]+)`/g, (_match, code) => {
    const index = inlineCode.length;
    inlineCode.push(`<code>${escapeHtml(code)}</code>`);
    return `\x00INLINE${index}\x00`;
  });

  // Step 4: Escape remaining HTML (unprotected content)
  result = escapeHtml(result);

  // Step 5: Restore code blocks
  result = result.replace(/\x00CODE(\d+)\x00/g, (_match, index) => {
    return codeBlocks[parseInt(index, 10)];
  });

  // Step 6: Restore inline code
  result = result.replace(/\x00INLINE(\d+)\x00/g, (_match, index) => {
    return inlineCode[parseInt(index, 10)];
  });

  // Step 7: Convert markdown to HTML if enabled
  if (parseMarkdown) {
    // Bold: **text** or __text__
    result = result.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
    result = result.replace(/__([^_]+)__/g, '<b>$1</b>');

    // Italic: *text* or _text_
    result = result.replace(/(?<![*\w])\*([^*\n]+)\*(?![*\w])/g, '<i>$1</i>');
    result = result.replace(/(?<![_\w])_([^_\n]+)_(?![_\w])/g, '<i>$1</i>');

    // Strikethrough: ~~text~~
    result = result.replace(/~~([^~]+)~~/g, '<s>$1</s>');

    // Links: [text](url)
    result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

    // Headers: # ## ### at start of line → bold
    result = result.replace(/^#{1,3}\s+(.+)$/gm, '<b>$1</b>');
  }

  // Step 8: Restore protected HTML tags
  for (const { placeholder, tag } of protectedTags) {
    result = result.replace(placeholder, tag);
  }

  return result.trim();
}

/**
 * Strip all formatting for plain text fallback
 */
export function stripFormatting(text: string): string {
  return text
    // Remove HTML tags
    .replace(/<[^>]+>/g, '')
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
    // Decode HTML entities
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim();
}

/**
 * TelegramFormatter class for more complex formatting needs
 */
export class TelegramFormatter {
  private lines: string[] = [];

  /** Add a bold header */
  header(text: string): this {
    this.lines.push(`<b>${escapeHtml(text)}</b>`);
    return this;
  }

  /** Add a subheader */
  subheader(text: string): this {
    this.lines.push(`<b>${escapeHtml(text)}</b>`);
    return this;
  }

  /** Add plain text */
  text(text: string): this {
    this.lines.push(escapeHtml(text));
    return this;
  }

  /** Add a blank line */
  blank(): this {
    this.lines.push('');
    return this;
  }

  /** Add a bullet point */
  bullet(text: string, url?: string): this {
    if (url) {
      this.lines.push(`• <a href="${escapeHtml(url)}">${escapeHtml(text)}</a>`);
    } else {
      this.lines.push(`• ${escapeHtml(text)}`);
    }
    return this;
  }

  /** Add a labeled value */
  field(label: string, value: string): this {
    this.lines.push(`<b>${escapeHtml(label)}:</b> ${escapeHtml(value)}`);
    return this;
  }

  /** Add a status indicator */
  status(type: 'success' | 'error' | 'warning' | 'info' | 'pending', text: string): this {
    const icons = {
      success: '✅',
      error: '❌',
      warning: '⚠️',
      info: 'ℹ️',
      pending: '⏳',
    };
    this.lines.push(`${icons[type]} ${escapeHtml(text)}`);
    return this;
  }

  /** Add a link */
  link(text: string, url: string): this {
    this.lines.push(`<a href="${escapeHtml(url)}">${escapeHtml(text)}</a>`);
    return this;
  }

  /** Add code */
  code(text: string): this {
    this.lines.push(`<code>${escapeHtml(text)}</code>`);
    return this;
  }

  /** Add a code block */
  codeBlock(text: string): this {
    this.lines.push(`<pre>${escapeHtml(text)}</pre>`);
    return this;
  }

  /** Add a divider */
  divider(): this {
    this.lines.push('─'.repeat(20));
    return this;
  }

  /** Add raw HTML (use with caution) */
  raw(html: string): this {
    this.lines.push(sanitizeHtml(html));
    return this;
  }

  /** Build the final message */
  build(): string {
    return this.lines.join('\n');
  }

  /** Reset the formatter */
  reset(): this {
    this.lines = [];
    return this;
  }
}
