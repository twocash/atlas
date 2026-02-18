/**
 * Test Failure Reporter
 *
 * Automatically creates Dev Pipeline entries when Master Blaster
 * tests fail. Includes deduplication (skips if open bug with same
 * test name exists) and rate limiting (max 10 bugs per run).
 *
 * Follows the same architectural patterns as error-escalation.ts:
 * lazy Notion client, safe-to-call-anywhere, never throws.
 *
 * @module @atlas/shared/test-failure-reporter
 */

import { Client } from "@notionhq/client";
import { NOTION_DB } from "./config";
import { execSync } from "child_process";

// ─── Configuration ───────────────────────────────────────

const MAX_BUGS_PER_RUN = 10;

// ─── State ───────────────────────────────────────────────

let bugsCreatedThisRun = 0;

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

export interface TestFailureContext {
  /** Expected vs actual values */
  expectedVsActual?: string;
  /** Command to reproduce the failure */
  reproCommand?: string;
  /** Git branch (auto-detected if omitted) */
  branch?: string;
  /** Formatted pipeline trace log from TraceContext */
  traceLog?: string;
  /** Additional context */
  [key: string]: unknown;
}

export interface ReportResult {
  created: boolean;
  reason?: "rate-limit" | "no-api-key" | "duplicate" | "error";
  url?: string;
}

// ─── Public API ──────────────────────────────────────────

/**
 * Report a test failure to the Dev Pipeline.
 *
 * Safe to call from any context — never throws.
 *
 * @param testName  - Name of the failing test or suite
 * @param subsystem - Surface area (Telegram, Chrome, Bridge, Agents)
 * @param error     - Error message or Error object
 * @param context   - Optional additional context
 */
export async function reportTestFailure(
  testName: string,
  subsystem: string,
  error: string | Error,
  context?: TestFailureContext
): Promise<ReportResult> {
  try {
    // Rate limit
    if (bugsCreatedThisRun >= MAX_BUGS_PER_RUN) {
      console.log(
        `[test-reporter] Rate limit reached (${MAX_BUGS_PER_RUN}) — skipping: ${testName}`
      );
      return { created: false, reason: "rate-limit" };
    }

    const notion = getNotionClient();
    if (!notion) {
      console.log(
        `[test-reporter] No NOTION_API_KEY — cannot report: ${testName}`
      );
      return { created: false, reason: "no-api-key" };
    }

    // Dedup check: query Dev Pipeline for open bug with same test name
    const isDuplicate = await hasOpenBugForTest(notion, testName, subsystem);
    if (isDuplicate) {
      console.log(
        `[test-reporter] Bug already filed for "${testName}" — skipping`
      );
      return { created: false, reason: "duplicate" };
    }

    // Build structured content
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    const stackTrace =
      error instanceof Error ? error.stack : undefined;
    const branch = context?.branch || detectGitBranch();
    const timestamp = new Date().toISOString();
    const title = `[TEST FAIL] ${subsystem}: ${testName}`;

    const bodyParts = [
      `**Test Name:** ${testName}`,
      `**Subsystem:** ${subsystem}`,
      `**Error Message:** ${errorMessage.substring(0, 500)}`,
      stackTrace
        ? `**Stack Trace:**\n${stackTrace.substring(0, 1200)}`
        : null,
      context?.expectedVsActual
        ? `**Expected vs Actual:** ${context.expectedVsActual}`
        : null,
      context?.reproCommand
        ? `**Reproduction Command:** ${context.reproCommand}`
        : null,
      context?.traceLog
        ? `**Pipeline Trace:**\n${context.traceLog.substring(0, 1500)}`
        : null,
      `**Git Branch:** ${branch}`,
      `**Timestamp:** ${timestamp}`,
    ]
      .filter(Boolean)
      .join("\n\n");

    const response = await notion.pages.create({
      parent: { database_id: NOTION_DB.DEV_PIPELINE },
      properties: {
        Discussion: {
          title: [{ text: { content: title.substring(0, 100) } }],
        },
        Type: {
          select: { name: "Bug" },
        },
        Priority: {
          select: { name: "P0" },
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
            icon: { type: "emoji" as const, emoji: "🐛" as const },
            color: "red_background" as const,
            rich_text: [
              {
                type: "text" as const,
                text: { content: bodyParts.substring(0, 2000) },
              },
            ],
          },
        },
      ],
    });

    bugsCreatedThisRun++;
    const url =
      (response as { url?: string }).url ||
      `https://notion.so/${response.id.replace(/-/g, "")}`;

    console.log(
      `[test-reporter] Bug created: "${title}" (${bugsCreatedThisRun}/${MAX_BUGS_PER_RUN}) → ${url}`
    );

    return { created: true, url };
  } catch (err) {
    console.error(
      `[test-reporter] Failed to report "${testName}":`,
      err instanceof Error ? err.message : err
    );
    return { created: false, reason: "error" };
  }
}

/**
 * Get the number of bugs created this run.
 */
export function getBugsCreatedCount(): number {
  return bugsCreatedThisRun;
}

/**
 * Reset reporter state (for testing).
 */
export function resetTestReporterState(): void {
  bugsCreatedThisRun = 0;
  _notionClient = null;
}

// ─── Internals ───────────────────────────────────────────

/**
 * Check if an open bug already exists for this test name.
 * "Open" means Status is NOT Shipped or Closed.
 */
async function hasOpenBugForTest(
  notion: Client,
  testName: string,
  subsystem: string
): Promise<boolean> {
  try {
    const searchTitle = `[TEST FAIL] ${subsystem}: ${testName}`;

    const response = await notion.databases.query({
      database_id: NOTION_DB.DEV_PIPELINE,
      filter: {
        and: [
          {
            property: "Discussion",
            title: { contains: testName },
          },
          {
            property: "Type",
            select: { equals: "Bug" },
          },
          // Exclude shipped/closed — only match open bugs
          {
            property: "Status",
            select: { does_not_equal: "Shipped" },
          },
          {
            property: "Status",
            select: { does_not_equal: "Closed" },
          },
        ],
      },
      page_size: 1,
    });

    return response.results.length > 0;
  } catch (err) {
    // If dedup check fails, allow creation (better to have a dupe than miss a bug)
    console.error(
      `[test-reporter] Dedup check failed for "${testName}":`,
      err instanceof Error ? err.message : err
    );
    return false;
  }
}

/**
 * Detect current git branch. Falls back to "unknown" if git isn't available.
 */
function detectGitBranch(): string {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", {
      encoding: "utf-8",
      timeout: 5000,
    }).trim();
  } catch {
    return "unknown";
  }
}
