/**
 * Error Escalation Layer
 *
 * Centralized failure reporting with per-subsystem rate tracking.
 * When a subsystem exceeds the failure threshold within a sliding
 * window, an Alert entry is created in Feed 2.0.
 *
 * Anti-recursion guard: if the Feed write itself fails, we log to
 * console only — never recurse into reportFailure().
 *
 * @module @atlas/shared/error-escalation
 */

import { Client } from "@notionhq/client";
import { NOTION_DB } from "./config";

// ─── Configuration ───────────────────────────────────────

/** Sliding window for failure counting (ms) */
const WINDOW_MS = 5 * 60 * 1000; // 5 minutes

/** Failures within window before escalation fires */
const THRESHOLD = 3;

/** Cooldown after escalation before allowing another alert for same subsystem (ms) */
const ESCALATION_COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes

// ─── State ───────────────────────────────────────────────

interface FailureRecord {
  timestamps: number[];
  lastEscalatedAt: number | null;
}

const subsystemFailures = new Map<string, FailureRecord>();

/** Guard against re-entrant calls (Feed write failure inside reportFailure) */
let isEscalating = false;

/** Lazy Notion client — initialized on first escalation */
let _notionClient: Client | null = null;

function getNotionClient(): Client | null {
  if (!_notionClient) {
    const key = process.env.NOTION_API_KEY;
    if (!key) return null;
    _notionClient = new Client({ auth: key });
  }
  return _notionClient;
}

// ─── Public API ──────────────────────────────────────────

export interface FailureContext {
  /** Additional structured data for the alert */
  [key: string]: unknown;
}

/**
 * Report a subsystem failure. Tracks failures in a sliding window
 * and escalates to Feed 2.0 when the threshold is exceeded.
 *
 * Safe to call from any catch block — will never throw.
 */
export function reportFailure(
  subsystem: string,
  error: unknown,
  context?: FailureContext
): void {
  try {
    const now = Date.now();
    const errorMessage =
      error instanceof Error ? error.message : String(error);

    // Always log the failure
    console.error(`[${subsystem}] Failure: ${errorMessage}`, context ?? "");

    // Get or create failure record
    let record = subsystemFailures.get(subsystem);
    if (!record) {
      record = { timestamps: [], lastEscalatedAt: null };
      subsystemFailures.set(subsystem, record);
    }

    // Prune timestamps outside the window
    record.timestamps = record.timestamps.filter(
      (t) => now - t < WINDOW_MS
    );

    // Record this failure
    record.timestamps.push(now);

    // Check threshold
    if (record.timestamps.length >= THRESHOLD) {
      // Check cooldown — don't spam alerts
      if (
        record.lastEscalatedAt &&
        now - record.lastEscalatedAt < ESCALATION_COOLDOWN_MS
      ) {
        return;
      }

      // Escalate (fire-and-forget, never await in sync path)
      record.lastEscalatedAt = now;
      escalateToFeed(subsystem, errorMessage, record.timestamps.length, context);
    }
  } catch {
    // reportFailure must NEVER throw
    console.error(
      `[error-escalation] Meta-failure in reportFailure for ${subsystem}`
    );
  }
}

/**
 * Get current failure counts (for diagnostics / health checks).
 */
export function getFailureCounts(): Record<string, number> {
  const now = Date.now();
  const counts: Record<string, number> = {};
  for (const [subsystem, record] of subsystemFailures) {
    const active = record.timestamps.filter((t) => now - t < WINDOW_MS);
    if (active.length > 0) {
      counts[subsystem] = active.length;
    }
  }
  return counts;
}

/**
 * Reset failure state (for testing).
 */
export function resetFailureState(): void {
  subsystemFailures.clear();
  isEscalating = false;
}

// ─── Escalation ──────────────────────────────────────────

async function escalateToFeed(
  subsystem: string,
  lastError: string,
  failureCount: number,
  context?: FailureContext
): Promise<void> {
  // Anti-recursion guard
  if (isEscalating) {
    console.error(
      `[error-escalation] Skipping escalation for ${subsystem} — already escalating (anti-recursion)`
    );
    return;
  }

  isEscalating = true;
  try {
    const notion = getNotionClient();
    if (!notion) {
      console.error(
        `[error-escalation] Cannot escalate ${subsystem} — no NOTION_API_KEY`
      );
      return;
    }

    const title = `[Error Escalation] ${subsystem}: ${failureCount} failures in 5min`;
    const body = [
      `**Subsystem:** ${subsystem}`,
      `**Failures in window:** ${failureCount}`,
      `**Last error:** ${lastError}`,
      context
        ? `**Context:** ${JSON.stringify(context, null, 2)}`
        : null,
      `**Threshold:** ${THRESHOLD} failures / ${WINDOW_MS / 60000}min`,
      `**Timestamp:** ${new Date().toISOString()}`,
    ]
      .filter(Boolean)
      .join("\n");

    await notion.pages.create({
      parent: { database_id: NOTION_DB.FEED },
      properties: {
        Entry: {
          title: [{ text: { content: title.substring(0, 100) } }],
        },
        Source: {
          select: { name: "Atlas [telegram]" },
        },
        "Action Type": {
          select: { name: "Alert" },
        },
        Status: {
          select: { name: "Pending" },
        },
        Keywords: {
          multi_select: [
            { name: "error-escalation" },
            { name: subsystem },
          ],
        },
      },
      children: [
        {
          object: "block" as const,
          type: "callout" as const,
          callout: {
            icon: { type: "emoji" as const, emoji: "🚨" as const },
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

    console.error(
      `[error-escalation] ESCALATED ${subsystem} to Feed 2.0 (${failureCount} failures)`
    );
  } catch (feedError) {
    // Feed write failed — console only, NEVER recurse
    console.error(
      `[error-escalation] Failed to write Feed alert for ${subsystem}:`,
      feedError instanceof Error ? feedError.message : feedError
    );
  } finally {
    isEscalating = false;
  }
}
