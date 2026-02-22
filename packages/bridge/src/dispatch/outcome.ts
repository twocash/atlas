/**
 * Outcome Handler — routes DispatchResult to Feed 2.0 + Work Queue 2.0.
 *
 * Constraint 5: Feed entry FIRST, then WQ update, then link.
 * Constraint 4: Fail loud — errors create Feed alerts, never silenced.
 *
 * Pattern from: feed-logger.ts (lazy Notion client, page creation).
 */

import { Client } from "@notionhq/client"
import { NOTION_DB } from "@atlas/shared"
import type { DispatchResult, DispatchWebhookPayload } from "../types/dispatch"

// ─── Lazy Notion Client ──────────────────────────────────────

let _notion: Client | null = null

function getNotion(): Client {
  if (!_notion) {
    _notion = new Client({ auth: process.env.NOTION_API_KEY })
  }
  return _notion
}

// For testing: inject a mock client
export function _injectNotion(client: Client | null): void {
  _notion = client
}

// ─── Feed Entry Creation ─────────────────────────────────────

async function createFeedEntry(
  title: string,
  source: string,
  keywords: string[],
  body: string,
  isAlert: boolean,
): Promise<string | null> {
  try {
    const notion = getNotion()

    const response = await notion.pages.create({
      parent: { database_id: NOTION_DB.FEED },
      properties: {
        Entry: {
          title: [{ text: { content: title } }],
        },
        Source: {
          select: { name: source },
        },
        Status: {
          select: { name: "Logged" },
        },
        ...(isAlert ? {
          "Action Type": {
            select: { name: "Alert" },
          },
        } : {}),
        Keywords: {
          multi_select: keywords.map((k) => ({ name: k })),
        },
      },
      children: [
        {
          type: "callout",
          callout: {
            icon: { emoji: isAlert ? "🚨" : "🤖" },
            color: isAlert ? "red_background" : "blue_background",
            rich_text: [{ type: "text", text: { content: body.slice(0, 2000) } }],
          },
        },
      ],
    })

    console.log(`[dispatch-outcome] Feed entry created: ${response.id}`)
    return response.id
  } catch (err: any) {
    console.error(`[dispatch-outcome] Failed to create Feed entry:`, err)
    return null
  }
}

// ─── Work Queue Update ──────────────────────────────────────

async function updateWorkQueueStatus(
  pageId: string,
  status: string,
  notes: string,
  feedPageId?: string,
): Promise<void> {
  try {
    const notion = getNotion()

    const properties: Record<string, any> = {
      Status: { select: { name: status } },
    }

    // Add dispatch notes to the Output field
    if (notes) {
      properties["Output"] = {
        rich_text: [{ type: "text", text: { content: notes.slice(0, 2000) } }],
      }
    }

    await notion.pages.update({
      page_id: pageId,
      properties,
    })

    // Link Feed entry to WQ item (Constraint 5: bidirectional link)
    if (feedPageId) {
      await notion.pages.update({
        page_id: pageId,
        properties: {
          "Feed Link": {
            rich_text: [{
              type: "text",
              text: {
                content: feedPageId,
                link: { url: `https://notion.so/${feedPageId.replace(/-/g, "")}` },
              },
            }],
          },
        },
      })
    }

    console.log(`[dispatch-outcome] WQ ${pageId} updated: status=${status}`)
  } catch (err: any) {
    console.error(`[dispatch-outcome] Failed to update WQ ${pageId}:`, err)
  }
}

// ─── Outcome Router ──────────────────────────────────────────

/**
 * Route a dispatch result to Feed 2.0 + Work Queue 2.0.
 *
 * Three paths:
 *   success + tests pass → Feed(dispatch-success) + WQ(Done)
 *   tests fail           → Feed(Alert, dispatch-escalation) + WQ(Blocked)
 *   timeout/error        → Feed(Alert, dispatch-escalation) + WQ(Blocked)
 */
export async function handleOutcome(
  payload: DispatchWebhookPayload,
  result: DispatchResult,
): Promise<void> {
  const date = new Date().toISOString().split("T")[0]

  switch (result.outcome) {
    case "success": {
      const body =
        `Dispatch completed successfully.\n\n` +
        `Files changed: ${result.filesChanged.length}\n` +
        (result.filesChanged.length > 0
          ? result.filesChanged.map((f) => `  - ${f}`).join("\n") + "\n"
          : "") +
        (result.commitHash ? `Commit: ${result.commitHash}\n` : "") +
        `Duration: ${Math.round(result.durationMs / 1000)}s\n` +
        `Branch: ${result.branchName}`

      const feedId = await createFeedEntry(
        `Dispatch Success — ${date} — ${payload.title}`,
        "Bridge",
        ["dispatch-success", "autonomous"],
        body,
        false,
      )

      await updateWorkQueueStatus(
        payload.pageId,
        "Done",
        `[Dispatch] Completed in ${Math.round(result.durationMs / 1000)}s. ` +
        `${result.filesChanged.length} files changed. Branch: ${result.branchName}`,
        feedId || undefined,
      )
      break
    }

    case "tests_failed": {
      const body =
        `Dispatch completed but tests failed.\n\n` +
        `Files changed: ${result.filesChanged.length}\n` +
        `Exit code: ${result.exitCode}\n` +
        `Duration: ${Math.round(result.durationMs / 1000)}s\n` +
        `Branch: ${result.branchName}\n\n` +
        `--- Last output ---\n` +
        result.stdout.slice(-1000)

      const feedId = await createFeedEntry(
        `Dispatch Escalation — ${date} — ${payload.title}`,
        "Bridge",
        ["dispatch-escalation", "tests-failed"],
        body,
        true,
      )

      await updateWorkQueueStatus(
        payload.pageId,
        "Blocked",
        `[Dispatch] Tests failed. Branch: ${result.branchName}. Review needed.`,
        feedId || undefined,
      )
      break
    }

    case "timeout": {
      const body =
        `Dispatch timed out.\n\n` +
        `Duration: ${Math.round(result.durationMs / 1000)}s\n` +
        `Branch: ${result.branchName}\n` +
        `Worktree: ${result.worktreePath}\n\n` +
        `--- Last output ---\n` +
        result.stdout.slice(-1000)

      const feedId = await createFeedEntry(
        `Dispatch Timeout — ${date} — ${payload.title}`,
        "Bridge",
        ["dispatch-escalation", "timeout"],
        body,
        true,
      )

      await updateWorkQueueStatus(
        payload.pageId,
        "Blocked",
        `[Dispatch] Timed out after ${Math.round(result.durationMs / 1000)}s. Branch: ${result.branchName}`,
        feedId || undefined,
      )
      break
    }

    case "error": {
      const body =
        `Dispatch error.\n\n` +
        `Error: ${result.stderr}\n` +
        (result.branchName ? `Branch: ${result.branchName}\n` : "") +
        (result.worktreePath ? `Worktree: ${result.worktreePath}\n` : "")

      const feedId = await createFeedEntry(
        `Dispatch Error — ${date} — ${payload.title}`,
        "Bridge",
        ["dispatch-escalation", "error"],
        body,
        true,
      )

      await updateWorkQueueStatus(
        payload.pageId,
        "Blocked",
        `[Dispatch] Error: ${result.stderr.slice(0, 200)}`,
        feedId || undefined,
      )
      break
    }
  }
}
