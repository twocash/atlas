/**
 * Notion-safe Markdown Converter
 *
 * Re-exports from @atlas/shared/notion for backwards compatibility.
 * The canonical implementation is now in the shared package.
 */

export {
  convertMarkdownToNotionBlocks,
  batchBlocksForApi,
  chunkText,
  formatResearchAsMarkdown,
  getNotionSafeMarkdownPrompt,
  type ConversionResult,
  type DirectiveBlock,
} from '@atlas/shared/notion';
