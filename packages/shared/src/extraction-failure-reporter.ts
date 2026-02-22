/**
 * Extraction Failure Reporter
 *
 * Auto-dispatches P1 bugs to Dev Pipeline when SPA extraction chains
 * fail silently. Captures the full diagnostic chain trace so root cause
 * analysis is immediate — no log spelunking required.
 *
 * Follows the same architectural patterns as test-failure-reporter.ts:
 * lazy Notion client, safe-to-call-anywhere, never throws.
 *
 * @module @atlas/shared/extraction-failure-reporter
 */

import { Client } from "@notionhq/client";
import { NOTION_DB } from "./config";

// ─── Configuration ───────────────────────────────────────

const MAX_REPORTS_PER_HOUR = 5;
const DEDUP_TTL_MS = 60 * 60 * 1000; // 1 hour cooldown per URL

// ─── State ───────────────────────────────────────────────

let reportsThisHour = 0;
let lastResetTime = Date.now();

/** Dedup by URL — prevents spam when Jim shares multiple links in a session */
const reportedUrls = new Map<string, number>(); // urlHash -> timestamp

/** Lazy Notion client — initialized on first call */
let _notionClient: Client | null = null;

function getNotionClient(): Client | null {
  if (!_notionClient) {
    const key = process.env.NOTION_API_KEY;
    if (!key) return null;
    _notionClient = new Client({ auth: key });
  }
  return _notionClient;
}

// ─── Types ───────────────────────────────────────────────

export interface ExtractionChainTrace {
  url: string;
  source: string;
  jinaStatus: number | undefined;
  jinaError: string | undefined;
  cookieRetryAttempted: boolean;
  cookieRetryResult: string | undefined;
  httpFallbackRan: boolean;
  httpFallbackResult: string | undefined;
  toUrlContentSuccess: boolean;
  triageTitle: string | undefined;
  cex001Blocked: boolean;
  timestamp: string;
}

// ─── Public API ──────────────────────────────────────────

/**
 * Report an SPA extraction chain failure to Dev Pipeline.
 *
 * Safe to call from any context — never throws.
 * Rate-limited: max 5 reports per hour, 1 per URL per hour.
 */
export async function reportExtractionFailure(
  chain: ExtractionChainTrace,
): Promise<void> {
  try {
    // Hourly rate limit reset
    if (Date.now() - lastResetTime > DEDUP_TTL_MS) {
      reportsThisHour = 0;
      lastResetTime = Date.now();
      // Clean up expired dedup entries
      const now = Date.now();
      for (const [hash, ts] of reportedUrls) {
        if (now - ts > DEDUP_TTL_MS) reportedUrls.delete(hash);
      }
    }

    if (reportsThisHour >= MAX_REPORTS_PER_HOUR) {
      console.log(`[extraction-reporter] Rate limit reached (${MAX_REPORTS_PER_HOUR}/hr) — skipping: ${chain.url}`);
      return;
    }

    // URL dedup
    const urlHash = simpleHash(chain.url);
    if (reportedUrls.has(urlHash)) {
      console.log(`[extraction-reporter] Already reported this URL within cooldown — skipping: ${chain.url}`);
      return;
    }

    const notion = getNotionClient();
    if (!notion) {
      console.log(`[extraction-reporter] No NOTION_API_KEY — cannot report: ${chain.url}`);
      return;
    }

    // Build the chain trace body
    const domain = new URL(chain.url).hostname.replace('www.', '');
    const title = `[CEX-001] SPA extraction chain failure: ${chain.source} — ${domain}`;
    const body = formatChainTrace(chain);

    await notion.pages.create({
      parent: { database_id: NOTION_DB.DEV_PIPELINE },
      properties: {
        Discussion: {
          title: [{ text: { content: title.substring(0, 100) } }],
        },
        Type: {
          select: { name: "Bug" },
        },
        Priority: {
          select: { name: "P1" },
        },
        Status: {
          select: { name: "Captured" },
        },
        Requestor: {
          select: { name: "Atlas [Telegram]" },
        },
        Dispatched: {
          date: { start: new Date().toISOString().split("T")[0] },
        },
      },
      children: [
        {
          object: "block" as const,
          type: "callout" as const,
          callout: {
            icon: { type: "emoji" as const, emoji: "🔗" as const },
            color: "red_background" as const,
            rich_text: [
              {
                type: "text" as const,
                text: { content: body.substring(0, 2000) },
              },
            ],
          },
        },
      ],
    });

    reportsThisHour++;
    reportedUrls.set(urlHash, Date.now());
    console.log(`[extraction-reporter] Bug dispatched: "${title}" (${reportsThisHour}/${MAX_REPORTS_PER_HOUR})`);
  } catch (err) {
    console.error(
      `[extraction-reporter] Failed to report extraction failure:`,
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * Reset reporter state (for testing).
 */
export function resetExtractionReporterState(): void {
  reportsThisHour = 0;
  lastResetTime = Date.now();
  reportedUrls.clear();
  _notionClient = null;
}

// ─── Internals ───────────────────────────────────────────

function formatChainTrace(chain: ExtractionChainTrace): string {
  const parts = [
    `Extraction Chain Trace`,
    ``,
    `URL: ${chain.url}`,
    `Source: ${chain.source} (SPA)`,
    ``,
    `Step 1: Jina Reader`,
    `- Status: ${chain.jinaStatus ?? 'unknown'} (${chain.jinaError ? 'FAILED' : 'OK'})`,
    chain.jinaError ? `- Error: "${chain.jinaError}"` : null,
    ``,
    `Step 2: Login Wall Detection`,
    `- Cookie retry: ${chain.cookieRetryAttempted ? (chain.cookieRetryResult || 'attempted') : 'NOT ATTEMPTED'}`,
    ``,
    `Step 3: HTTP Fallback`,
    `- Ran: ${chain.httpFallbackRan ? 'YES' : 'NO (SPA guard blocked)'}`,
    chain.httpFallbackRan ? `- Result: ${chain.httpFallbackResult || 'unknown'}` : null,
    ``,
    `Step 4: toUrlContent()`,
    `- success: ${chain.toUrlContentSuccess}`,
    ``,
    `Step 5: Triage`,
    `- Title: "${chain.triageTitle || 'none'}"`,
    ``,
    `Step 6: ATLAS-CEX-001 Guard`,
    `- Blocked: ${chain.cex001Blocked ? 'YES' : 'NO'}`,
    ``,
    `Timestamp: ${chain.timestamp}`,
  ];

  return parts.filter(p => p !== null).join('\n');
}

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0; // Convert to 32bit integer
  }
  return hash.toString(36);
}
