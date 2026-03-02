/**
 * Emergence Feed Writer — Feed 2.0 Telemetry for Emergence Events
 *
 * Subscribes to emergence events and writes structured entries
 * to Feed 2.0 for auditability and Jim's review.
 *
 * Sprint: CONV-ARCH-004 v4.0 (Emergence Verification & Delivery Wiring)
 */

import { Client } from '@notionhq/client';
import { logger } from '../logger';
import { NOTION_DB, ATLAS_NODE } from '@atlas/shared/config';
import type { EmergenceEvent, EmergenceProposal, DismissedPattern } from './types';
import { onEmergenceEvent } from './monitor';

// =============================================================================
// LAZY NOTION CLIENT
// =============================================================================

let _notionClient: Client | null = null;

function getNotionClient(): Client | null {
  if (!_notionClient) {
    const key = process.env.NOTION_API_KEY;
    if (!key) return null;
    _notionClient = new Client({ auth: key });
  }
  return _notionClient;
}

// =============================================================================
// FEED 2.0 WRITER
// =============================================================================

/**
 * Write an emergence event to Feed 2.0.
 * Fire-and-forget — never throws.
 */
async function writeEmergenceFeedEntry(event: EmergenceEvent): Promise<void> {
  const client = getNotionClient();
  if (!client) {
    logger.debug('Emergence feed writer: no Notion client (NOTION_API_KEY missing)');
    return;
  }

  try {
    const title = buildTitle(event);
    const keywords = buildKeywords(event);

    await client.pages.create({
      parent: { database_id: NOTION_DB.FEED },
      properties: {
        Entry: { title: [{ text: { content: title } }] },
        Source: { select: { name: `Atlas [${ATLAS_NODE}]` } },
        Status: { select: { name: 'Logged' } },
        Keywords: {
          multi_select: keywords.map(k => ({ name: k })),
        },
      },
      children: buildBody(event),
    });

    logger.debug('Emergence event written to Feed 2.0', {
      type: event.type,
      proposalId: event.proposalId,
    });
  } catch (error) {
    // Fire-and-forget — log but never throw
    logger.warn('Emergence feed write failed (non-fatal)', {
      type: event.type,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// =============================================================================
// DISMISS PERSISTENCE
// =============================================================================

/**
 * Write a dismissed pattern to Feed 2.0 for persistence across restarts.
 * Called from the orchestrator's Gate 7 after processEmergenceResponse returns 'dismissed'.
 */
export async function persistDismissedPattern(
  proposal: EmergenceProposal,
  reason?: string,
): Promise<void> {
  const client = getNotionClient();
  if (!client) return;

  try {
    await client.pages.create({
      parent: { database_id: NOTION_DB.FEED },
      properties: {
        Entry: {
          title: [{ text: { content: `Emergence Dismissed: ${proposal.suggestedSkillName}` } }],
        },
        Source: { select: { name: `Atlas [${ATLAS_NODE}]` } },
        Status: { select: { name: 'Logged' } },
        Keywords: {
          multi_select: [
            { name: 'emergence' },
            { name: 'dismissed' },
          ],
        },
      },
      children: [
        {
          object: 'block' as const,
          type: 'callout' as const,
          callout: {
            icon: { type: 'emoji' as const, emoji: '🚫' as const },
            color: 'gray_background' as const,
            rich_text: [{
              type: 'text' as const,
              text: {
                content: [
                  `Pattern "${proposal.suggestedSkillName}" dismissed.`,
                  reason ? `Reason: ${reason}` : '',
                  `Signal: ${proposal.signal.source} (${proposal.signal.frequency}x)`,
                  `Cooldown: 7 days`,
                ].filter(Boolean).join('\n'),
              },
            }],
          },
        },
      ],
    });

    logger.debug('Dismissed pattern persisted to Feed 2.0', {
      skillName: proposal.suggestedSkillName,
    });
  } catch (error) {
    logger.warn('Dismissed pattern feed write failed (non-fatal)', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// =============================================================================
// EVENT SUBSCRIBER
// =============================================================================

/** Whether the subscriber is wired */
let isSubscribed = false;

/**
 * Wire the emergence event subscriber to Feed 2.0.
 * Safe to call multiple times (idempotent).
 */
export function wireEmergenceFeedSubscriber(): void {
  if (isSubscribed) return;

  onEmergenceEvent((event: EmergenceEvent) => {
    // Only write significant events to Feed (not every check)
    if (event.type === 'proposal_generated' ||
        event.type === 'proposal_approved' ||
        event.type === 'proposal_dismissed') {
      writeEmergenceFeedEntry(event).catch(() => {
        // Already handled inside writeEmergenceFeedEntry
      });
    }
  });

  isSubscribed = true;
  logger.info('Emergence Feed 2.0 subscriber wired');
}

/**
 * Reset subscriber state (for testing).
 */
export function _resetFeedWriter(): void {
  isSubscribed = false;
  _notionClient = null;
}

// =============================================================================
// HELPERS
// =============================================================================

function buildTitle(event: EmergenceEvent): string {
  switch (event.type) {
    case 'proposal_generated':
      return `Emergence: Skill proposed — ${event.skillName || 'unknown'}`;
    case 'proposal_approved':
      return `Emergence: Skill approved — ${event.skillName || 'unknown'}`;
    case 'proposal_dismissed':
      return `Emergence: Skill dismissed — ${event.skillName || 'unknown'}`;
    default:
      return `Emergence: ${event.type}`;
  }
}

function buildKeywords(event: EmergenceEvent): string[] {
  const keywords = ['emergence'];
  switch (event.type) {
    case 'proposal_generated': keywords.push('proposal'); break;
    case 'proposal_approved': keywords.push('approved'); break;
    case 'proposal_dismissed': keywords.push('dismissed'); break;
  }
  return keywords;
}

function buildBody(event: EmergenceEvent): any[] {
  const blocks: any[] = [];

  const emoji = event.type === 'proposal_approved' ? '✅'
    : event.type === 'proposal_dismissed' ? '🚫'
    : '🔍';

  blocks.push({
    object: 'block',
    type: 'callout',
    callout: {
      icon: { type: 'emoji', emoji },
      color: event.type === 'proposal_approved' ? 'green_background'
        : event.type === 'proposal_dismissed' ? 'gray_background'
        : 'blue_background',
      rich_text: [{
        type: 'text',
        text: {
          content: [
            `Event: ${event.type}`,
            event.skillName ? `Skill: ${event.skillName}` : '',
            event.signalId ? `Signal: ${event.signalId}` : '',
            event.proposalId ? `Proposal: ${event.proposalId}` : '',
          ].filter(Boolean).join('\n'),
        },
      }],
    },
  });

  if (event.metadata && Object.keys(event.metadata).length > 0) {
    blocks.push({
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: [{
          type: 'text',
          text: {
            content: `Metadata: ${JSON.stringify(event.metadata, null, 2).substring(0, 500)}`,
          },
        }],
      },
    });
  }

  return blocks;
}
