/**
 * Atlas Telegram Bot - Formatting System
 *
 * Modular formatting for Telegram messages and Notion pages.
 * Handles both markdown input and HTML passthrough.
 *
 * @module formatting
 */

export { TelegramFormatter, formatMessage, escapeHtml } from './telegram';
export { createCard, createList, createStatus, createLink } from './components';
export type { CardOptions, ListOptions, StatusType } from './types';

// Notion formatting utilities
export {
  stripMarkdown,
  prepareForNotion,
  createDivider,
  createHeading,
  createParagraph,
  createCallout,
  createBullet,
  createToggle,
  appendBlocksToPage,
  createAnalysisSection,
  type NotionBlock,
} from './notion';
