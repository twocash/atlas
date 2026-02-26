/**
 * Notion URL → UrlContent Adapter (Surface-Agnostic)
 *
 * Converts a Notion URL into a standard UrlContent object using the
 * Notion API via notion-lookup.ts. Lives in packages/agents/ so any
 * surface (Telegram, Bridge, Chrome Extension) can reuse it.
 *
 * Created by hotfix/notion-handler-pipeline-migration to replace the
 * pre-CPE bypass in apps/telegram/src/conversation/content-flow.ts.
 */

import { lookupNotionPage, getPageContentForContext, isNotionUrl } from './notion-lookup';
import { logger } from '../logger';
import type { UrlContent } from './types';

export { isNotionUrl };

/**
 * Extract content from a Notion URL into the standard UrlContent format.
 * Uses the Notion API (not HTTP fetch) since Notion pages are login-walled.
 */
export async function extractNotionContent(url: string): Promise<UrlContent> {
  try {
    const pageInfo = await lookupNotionPage(url);

    if (!pageInfo) {
      logger.warn('Notion page not found or inaccessible', { url });
      return {
        url,
        title: '',
        description: '',
        bodySnippet: '',
        fetchedAt: new Date(),
        success: false,
        error: 'Notion page not found or inaccessible',
      };
    }

    const typeLabel = pageInfo.type === 'work_queue'
      ? 'Work Queue item'
      : pageInfo.type === 'feed'
        ? 'Feed entry'
        : 'Notion page';

    return {
      url,
      title: pageInfo.title,
      description: typeLabel,
      bodySnippet: getPageContentForContext(pageInfo),
      fetchedAt: new Date(),
      success: true,
    };
  } catch (error) {
    logger.error('Notion content extraction failed', {
      url,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      url,
      title: '',
      description: '',
      bodySnippet: '',
      fetchedAt: new Date(),
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
