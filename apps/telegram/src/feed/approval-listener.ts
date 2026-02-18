/**
 * Approval Listener (P2)
 *
 * Polls Feed 2.0 for Approval entries that have been Actioned (approved)
 * or Dismissed (rejected). On approval → executes deferred Tier 2 skill.
 * On rejection → cleans up pending state.
 *
 * FAIL-CLOSED: If anything goes wrong during deferred execution,
 * the skill does NOT retry automatically.
 *
 * @see EPIC: Action Feed Producer Wiring (P2 contract)
 */

import { Client } from '@notionhq/client';
import { NOTION_DB } from '@atlas/shared/config';
import { logger } from '../logger';
import { isFeatureEnabled } from '../config/features';
import { executeSkillWithApproval } from '../skills/executor';
import { getPendingApprovals, removePendingApproval } from '../skills/executor';
import { updateFeedEntryAction } from '../notion';

// ==========================================
// Constants
// ==========================================

const FEED_DATABASE_ID = NOTION_DB.FEED;

/** Default poll interval: 60 seconds */
const DEFAULT_INTERVAL_MS = 60_000;

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

// ==========================================
// Core Functions
// ==========================================

/**
 * Poll Feed 2.0 for Approval entries with Actioned or Dismissed status.
 * Matches against pending approvals stored in executor.ts.
 */
async function pollApprovals(): Promise<void> {
  const pending = getPendingApprovals();

  if (pending.size === 0) {
    logger.debug('Approval listener: no pending approvals to check');
    return;
  }

  try {
    const notion = getNotionClient();

    // Query for Approval entries that have been actioned or dismissed
    const response = await notion.databases.query({
      database_id: FEED_DATABASE_ID,
      filter: {
        and: [
          { property: 'Action Type', select: { equals: 'Approval' } },
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
      const approval = pending.get(pageId);

      if (!approval) continue; // Not one of ours

      // Read the action status
      const props = (page as any).properties;
      const actionStatus = props?.['Action Status']?.select?.name;

      if (actionStatus === 'Actioned') {
        await handleApproved(approval, pageId);
      } else if (actionStatus === 'Dismissed') {
        await handleRejected(approval, pageId);
      }
    }
  } catch (error) {
    logger.error('Approval listener poll failed', { error });
  }
}

/**
 * Handle an approved skill — execute it with the stored context.
 */
async function handleApproved(
  approval: ReturnType<typeof getPendingApprovals> extends Map<string, infer V> ? V : never,
  feedPageId: string
): Promise<void> {
  logger.info('Skill approved via Action Feed, executing', {
    skill: approval.skillName,
    feedPageId,
  });

  // Remove from pending before executing (prevent double-fire)
  removePendingApproval(feedPageId);

  try {
    const result = await executeSkillWithApproval(
      approval.skillName,
      approval.context
    );

    if (result.success) {
      logger.info('Deferred skill executed successfully', {
        skill: approval.skillName,
        executionTimeMs: result.executionTimeMs,
      });
    } else {
      logger.warn('Deferred skill execution failed', {
        skill: approval.skillName,
        error: result.error,
      });

      // Update the Feed entry to reflect execution failure
      try {
        await updateFeedEntryAction(feedPageId, {
          actionStatus: 'Expired',
        });
      } catch {
        // Best-effort status update
      }
    }
  } catch (error) {
    logger.error('Deferred skill execution threw', {
      skill: approval.skillName,
      error,
    });
  }
}

/**
 * Handle a rejected skill — clean up pending state.
 */
async function handleRejected(
  approval: ReturnType<typeof getPendingApprovals> extends Map<string, infer V> ? V : never,
  feedPageId: string
): Promise<void> {
  logger.info('Skill rejected via Action Feed', {
    skill: approval.skillName,
    feedPageId,
  });

  removePendingApproval(feedPageId);
}

// ==========================================
// Lifecycle
// ==========================================

/**
 * Start the approval listener.
 * Polls Feed 2.0 for actioned/dismissed Approval entries.
 */
export function startApprovalListener(
  intervalMs: number = DEFAULT_INTERVAL_MS
): void {
  if (!isFeatureEnabled('approvalProducer')) {
    logger.info('Approval listener disabled by feature flag');
    return;
  }

  if (pollTimer) {
    logger.warn('Approval listener already running');
    return;
  }

  // Start polling on interval
  pollTimer = setInterval(() => {
    pollApprovals();
  }, intervalMs);

  logger.info('Approval listener started', {
    intervalMs,
    intervalSec: Math.round(intervalMs / 1000),
  });
}

/**
 * Stop the approval listener.
 */
export function stopApprovalListener(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
    logger.info('Approval listener stopped');
  }
}
