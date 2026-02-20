/**
 * Feed Health Alerter — Creates Feed 2.0 entries for database access failures.
 *
 * When the database validator detects unreachable databases, this module
 * creates Feed 2.0 "Health Alert" entries so Jim sees them in his activity log.
 *
 * Deduplication: checks for existing open alerts (Status != 'Done', Status != 'Dismissed')
 * with matching title before creating new ones. One alert per database, not per check.
 *
 * ADR-008: Fail fast, fail loud — but Feed alerts are the "loud" part for
 * enrichment databases that don't block startup.
 */

import { Client } from '@notionhq/client';
import { NOTION_DB } from '@atlas/shared/config';
import type { DbValidationResult } from './db-validator';

// ─── Configuration ───────────────────────────────────────

const FEED_DB_ID = NOTION_DB.FEED;

/** Alert title prefix for dedup matching */
const ALERT_PREFIX = '[Health Alert]';

// ─── Types ───────────────────────────────────────────────

export interface AlertResult {
  dbKey: string;
  created: boolean;
  skippedReason?: string;
  feedPageId?: string;
}

// ─── Alerter ─────────────────────────────────────────────

/**
 * Create Feed 2.0 alerts for failed database validations.
 *
 * Only creates alerts for databases that actually failed.
 * Deduplicates by checking for existing open alerts with matching title.
 *
 * @param failures - Validation results where accessible === false
 * @param notionToken - Explicit token override (for testing)
 */
export async function createHealthAlerts(
  failures: DbValidationResult[],
  notionToken?: string,
): Promise<AlertResult[]> {
  if (failures.length === 0) return [];

  const token = notionToken || process.env.NOTION_API_KEY || process.env.NOTION_TOKEN;
  if (!token) {
    console.warn('[feed-alerter] Cannot create alerts — no Notion token');
    return failures.map((f) => ({
      dbKey: f.key,
      created: false,
      skippedReason: 'No Notion token available',
    }));
  }

  // Feed DB itself might be unreachable — if so, we can't alert
  const feedFailed = failures.some((f) => f.key === 'FEED');
  if (feedFailed) {
    console.error('[feed-alerter] Feed 2.0 itself is unreachable — cannot create health alerts');
    return failures.map((f) => ({
      dbKey: f.key,
      created: false,
      skippedReason: 'Feed 2.0 unreachable',
    }));
  }

  const notion = new Client({ auth: token });
  const results: AlertResult[] = [];

  for (const failure of failures) {
    try {
      const result = await createAlertIfNeeded(notion, failure);
      results.push(result);
    } catch (err) {
      console.warn(`[feed-alerter] Failed to create alert for ${failure.key}:`, err);
      results.push({
        dbKey: failure.key,
        created: false,
        skippedReason: `Alert creation failed: ${(err as Error).message}`,
      });
    }
  }

  return results;
}

/**
 * Create a Feed alert for a single database failure, with dedup check.
 */
async function createAlertIfNeeded(
  notion: Client,
  failure: DbValidationResult,
): Promise<AlertResult> {
  const alertTitle = `${ALERT_PREFIX} ${failure.label} database unreachable`;

  // Dedup: check for existing open alerts with this title
  const existing = await findOpenAlert(notion, alertTitle);
  if (existing) {
    console.info(`[feed-alerter] Existing open alert for ${failure.key} — skipping`);
    return {
      dbKey: failure.key,
      created: false,
      skippedReason: 'Duplicate alert exists',
      feedPageId: existing,
    };
  }

  // Create the alert
  const page = await notion.pages.create({
    parent: { database_id: FEED_DB_ID },
    properties: {
      Title: {
        title: [{ text: { content: alertTitle } }],
      },
      Type: {
        select: { name: 'Process' },
      },
      Source: {
        select: { name: 'Claude Code' },
      },
      Status: {
        select: { name: 'Received' },
      },
      Pillar: {
        select: { name: 'The Grove' },
      },
      Notes: {
        rich_text: [{
          text: {
            content: [
              `Database: ${failure.label} (${failure.key})`,
              `ID: ${failure.dbId}`,
              `Criticality: ${failure.criticality}`,
              `Surfaces: ${failure.surfaces.join(', ')}`,
              `Error: ${failure.error || 'Unknown'}`,
              '',
              `Action: Share this database with the Atlas Notion integration,`,
              `or verify the database ID is correct in packages/shared/src/config.ts.`,
            ].join('\n'),
          },
        }],
      },
      Keywords: {
        multi_select: [
          { name: 'health-alert' },
          { name: 'database-access' },
        ],
      },
    },
  });

  console.info(`[feed-alerter] Created alert for ${failure.key}: ${page.id}`);
  return {
    dbKey: failure.key,
    created: true,
    feedPageId: page.id,
  };
}

/**
 * Check for an existing open Feed alert with the given title.
 * Returns the page ID if found, null otherwise.
 */
async function findOpenAlert(
  notion: Client,
  title: string,
): Promise<string | null> {
  try {
    const response = await notion.databases.query({
      database_id: FEED_DB_ID,
      filter: {
        and: [
          {
            property: 'Title',
            title: { equals: title },
          },
          {
            property: 'Status',
            select: { does_not_equal: 'Done' },
          },
          {
            property: 'Status',
            select: { does_not_equal: 'Dismissed' },
          },
        ],
      },
      page_size: 1,
    });

    return response.results.length > 0 ? response.results[0].id : null;
  } catch {
    // If dedup check fails, err on the side of creating the alert
    return null;
  }
}
