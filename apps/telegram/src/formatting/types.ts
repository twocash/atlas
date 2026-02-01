/**
 * Formatting Types
 */

export type StatusType = 'success' | 'error' | 'warning' | 'info' | 'pending';

export interface CardOptions {
  title: string;
  subtitle?: string;
  items?: Array<{ label: string; value: string; url?: string }>;
  footer?: string;
  status?: StatusType;
}

export interface ListOptions {
  title?: string;
  items: Array<{
    text: string;
    url?: string;
    meta?: string;
    priority?: 'P0' | 'P1' | 'P2' | 'P3';
    status?: string;
  }>;
  emptyMessage?: string;
  grouped?: boolean;
}

export interface FormatOptions {
  /** Preserve HTML tags in input (don't escape them) */
  preserveHtml?: boolean;
  /** Convert markdown to HTML */
  parseMarkdown?: boolean;
  /** Strip all formatting for plain text */
  plainText?: boolean;
}
