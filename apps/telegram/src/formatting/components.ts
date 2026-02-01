/**
 * Reusable Formatting Components
 *
 * Pre-built components for common UI patterns in Atlas.
 */

import { TelegramFormatter, escapeHtml } from './telegram';
import type { CardOptions, ListOptions, StatusType } from './types';

const STATUS_ICONS: Record<StatusType, string> = {
  success: '✅',
  error: '❌',
  warning: '⚠️',
  info: 'ℹ️',
  pending: '⏳',
};

const PRIORITY_ICONS: Record<string, string> = {
  P0: '🔴',
  P1: '🟡',
  P2: '🟢',
  P3: '⚪',
};

/**
 * Create a card-style display
 */
export function createCard(options: CardOptions): string {
  const f = new TelegramFormatter();

  // Title with optional status
  if (options.status) {
    f.raw(`${STATUS_ICONS[options.status]} <b>${escapeHtml(options.title)}</b>`);
  } else {
    f.header(options.title);
  }

  // Subtitle
  if (options.subtitle) {
    f.text(options.subtitle);
  }

  // Items
  if (options.items && options.items.length > 0) {
    f.blank();
    for (const item of options.items) {
      if (item.url) {
        f.raw(`<b>${escapeHtml(item.label)}:</b> <a href="${escapeHtml(item.url)}">${escapeHtml(item.value)}</a>`);
      } else {
        f.field(item.label, item.value);
      }
    }
  }

  // Footer
  if (options.footer) {
    f.blank();
    f.text(options.footer);
  }

  return f.build();
}

/**
 * Create a list display with optional grouping by priority
 */
export function createList(options: ListOptions): string {
  const f = new TelegramFormatter();

  if (options.title) {
    f.header(options.title);
    f.blank();
  }

  if (!options.items || options.items.length === 0) {
    f.text(options.emptyMessage || 'No items');
    return f.build();
  }

  if (options.grouped) {
    // Group by priority
    const groups: Record<string, typeof options.items> = {
      P0: [],
      P1: [],
      P2: [],
      P3: [],
      other: [],
    };

    for (const item of options.items) {
      const priority = item.priority || 'other';
      if (groups[priority]) {
        groups[priority].push(item);
      } else {
        groups.other.push(item);
      }
    }

    // Render each group
    for (const [priority, items] of Object.entries(groups)) {
      if (items.length === 0) continue;

      const icon = PRIORITY_ICONS[priority] || '';
      const label = priority === 'other' ? 'Other' : `${priority} Priority`;
      f.raw(`${icon} <b>${label}</b>`);

      for (const item of items) {
        renderListItem(f, item);
      }
      f.blank();
    }
  } else {
    // Flat list
    for (const item of options.items) {
      renderListItem(f, item);
    }
  }

  return f.build();
}

/**
 * Render a single list item
 */
function renderListItem(
  f: TelegramFormatter,
  item: { text: string; url?: string; meta?: string; status?: string }
): void {
  let line = '• ';

  if (item.url) {
    line += `<a href="${escapeHtml(item.url)}">${escapeHtml(item.text)}</a>`;
  } else {
    line += escapeHtml(item.text);
  }

  f.raw(line);

  // Meta line (status, etc.)
  if (item.meta || item.status) {
    const metaParts: string[] = [];
    if (item.status) metaParts.push(`Status: ${item.status}`);
    if (item.meta) metaParts.push(item.meta);
    f.raw(`  <i>${escapeHtml(metaParts.join(' | '))}</i>`);
  }
}

/**
 * Create a status indicator
 */
export function createStatus(type: StatusType, message: string): string {
  return `${STATUS_ICONS[type]} ${escapeHtml(message)}`;
}

/**
 * Create a clickable link with optional emoji
 */
export function createLink(text: string, url: string, emoji?: string): string {
  const prefix = emoji ? `${emoji} ` : '';
  return `${prefix}<a href="${escapeHtml(url)}">${escapeHtml(text)}</a>`;
}

/**
 * Create a tool result card
 */
export function createToolResult(options: {
  tool: string;
  success: boolean;
  title: string;
  url?: string;
  details?: Record<string, string>;
  error?: string;
}): string {
  const f = new TelegramFormatter();

  // Header with status
  const icon = options.success ? '✓' : '✗';
  f.raw(`<b>${icon} ${escapeHtml(options.tool)}</b>`);
  f.blank();

  if (options.success) {
    // Success output
    if (options.url) {
      f.raw(`<a href="${escapeHtml(options.url)}">${escapeHtml(options.title)}</a>`);
    } else {
      f.text(options.title);
    }

    if (options.details) {
      for (const [key, value] of Object.entries(options.details)) {
        f.field(key, value);
      }
    }
  } else {
    // Error output
    f.status('error', options.error || 'Operation failed');
  }

  return f.build();
}

/**
 * Create a dashboard-style summary
 */
export function createDashboard(options: {
  title: string;
  stats: Array<{ label: string; value: string | number }>;
  sections?: Array<{ title: string; items: string[] }>;
}): string {
  const f = new TelegramFormatter();

  f.header(options.title);
  f.blank();

  // Stats row
  const statLine = options.stats
    .map(s => `${escapeHtml(s.label)}: <b>${escapeHtml(String(s.value))}</b>`)
    .join(' | ');
  f.raw(statLine);

  // Sections
  if (options.sections) {
    for (const section of options.sections) {
      f.blank();
      f.subheader(section.title);
      for (const item of section.items) {
        f.bullet(item);
      }
    }
  }

  return f.build();
}

/**
 * Create a pipeline item display
 */
export function createPipelineItem(options: {
  title: string;
  url: string;
  priority: 'P0' | 'P1' | 'P2' | 'P3';
  type: string;
  status: string;
  handler?: string;
}): string {
  const icon = PRIORITY_ICONS[options.priority] || '';
  const f = new TelegramFormatter();

  f.raw(`${icon} <a href="${escapeHtml(options.url)}">${escapeHtml(options.title)}</a>`);
  f.raw(`  <i>${escapeHtml(options.type)} | ${escapeHtml(options.status)}${options.handler ? ` | ${options.handler}` : ''}</i>`);

  return f.build();
}
