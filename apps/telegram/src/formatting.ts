/**
 * Atlas Telegram Bot - Message Formatting
 *
 * Re-exports from the modular formatting system.
 * @deprecated Import from './formatting' directory instead
 */

// Re-export everything from the new modular system
export {
  formatMessage,
  formatMessage as markdownToHtml, // Backward compatibility alias
  escapeHtml,
  TelegramFormatter,
  createCard,
  createList,
  createStatus,
  createLink,
} from './formatting/index';

export { stripFormatting } from './formatting/telegram';
export { createToolResult, createDashboard, createPipelineItem } from './formatting/components';

/**
 * Format a response for Telegram - convenience wrapper
 * @deprecated Use formatMessage instead
 */
export { formatMessage as formatForTelegram } from './formatting/index';
