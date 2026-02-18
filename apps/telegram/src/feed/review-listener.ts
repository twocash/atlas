/**
 * Review Listener (P3)
 *
 * Polls Feed 2.0 for Review entries that have been Actioned (accepted),
 * Dismissed (rejected), or Revised (needs rework). Logs disposition
 * for audit trail.
 *
 * Unlike the Approval Listener (P2), this does NOT trigger deferred
 * execution — research has already been delivered (FAIL-OPEN).
 * This listener exists to close the feedback loop by recording
 * the human's Accept/Revise/Reject decision.
 *
 * @see EPIC: Action Feed Producer Wiring (P3 contract)
 */

import { Client } from '@notionhq/client';
import { NOTION_DB } from '@atlas/shared/config';
import { logger } from '../logger';
import { isFeatureEnabled } from '../config/features';

// ==========================================
// Constants
// ==========================================

const FEED_DATABASE_ID = NOTION_DB.FEED;

/** Default poll interval: 90 seconds (less urgent than Approval) */
const DEFAULT_INTERVAL_MS = 90_000;

// ==========================================
// State
// ==========================================

let pollTimer: ReturnType<typeof setInterval> | null = null;
let _notion: Client | null = null;

function getNotionClient(): Client {
  if (!_notion) {
    _notion = new Client({ auth: process.env.NOTION_API_KEY });
  }
  return _notion;
}

/**
 * Track Review card IDs we've already processed to prevent double-logging.
 * Cleared when listener stops.
 */
const processedReviews = new Set<string>();

// ==========================================
// Core Functions
// ==========================================

/**
 * Poll Feed 2.0 for Review entries with Actioned or Dismissed status.
 */
async function pollReviews(): Promise<void> {
  try {
    const notion = getNotionClient();

    // Query for Review entries that have been actioned or dismissed
    const response = await notion.databases.query({
      database_id: FEED_DATABASE_ID,
      filter: {
        and: [
          { property: 'Action Type', select: { equals: 'Review' } },
          {
            or: [
              { property: 'Action Status', select: { equals: 'Actioned' } },
              { property: 'Action Status', select: { equals: 'Dismissed' } },
            ],
          },
        ],
      },
      page_size: 20,
    });

    for (const page of response.results) {
      const pageId = page.id;

      // Skip already-processed entries
      if (processedReviews.has(pageId)) continue;

      const props = (page as any).properties;
      const actionStatus = props?.['Action Status']?.select?.name;
      const actionDataRaw = props?.['Action Data']?.rich_text?.[0]?.plain_text;

      let actionData: Record<string, unknown> = {};
      try {
        if (actionDataRaw) actionData = JSON.parse(actionDataRaw);
      } catch {
        // Malformed JSON — log and continue
      }

      const wqTitle = (actionData as any)?.wq_title || 'Unknown';

      if (actionStatus === 'Actioned') {
        logger.info('Research review accepted', {
          feedPageId: pageId,
          wqTitle,
          disposition: 'accepted',
        });
      } else if (actionStatus === 'Dismissed') {
        logger.info('Research review rejected', {
          feedPageId: pageId,
          wqTitle,
          disposition: 'rejected',
        });
      }

      // Mark as processed
      processedReviews.add(pageId);
    }
  } catch (error) {
    logger.error('Review listener poll failed', { error });
  }
}

// ==========================================
// Lifecycle
// ==========================================

/**
 * Start the review listener.
 * Polls Feed 2.0 for actioned/dismissed Review entries.
 */
export function startReviewListener(
  intervalMs: number = DEFAULT_INTERVAL_MS
): void {
  if (!isFeatureEnabled('reviewProducer')) {
    logger.info('Review listener disabled by feature flag');
    return;
  }

  if (pollTimer) {
    logger.warn('Review listener already running');
    return;
  }

  pollTimer = setInterval(() => {
    pollReviews();
  }, intervalMs);

  logger.info('Review listener started', {
    intervalMs,
    intervalSec: Math.round(intervalMs / 1000),
  });
}

/**
 * Stop the review listener.
 */
export function stopReviewListener(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
    processedReviews.clear();
    logger.info('Review listener stopped');
  }
}
