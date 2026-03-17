/**
 * Tool Circuit Telemetry — logs tool events to Feed 2.0.
 *
 * Lightweight logger for the Autonomaton tool circuit.
 * Writes directly to Feed 2.0 via Notion SDK.
 * Does NOT use the conversation pipeline's logAction (wrong interface).
 *
 * ADR-011: Every tool call logged. ADR-008: failures are loud.
 */

import { Client } from "@notionhq/client"
import { NOTION_DB } from "@atlas/shared/config"

let _notion: Client | null = null

function getNotion(): Client | null {
  if (_notion) return _notion
  const key = process.env.NOTION_API_KEY
  if (!key) return null
  _notion = new Client({ auth: key })
  return _notion
}

export interface ToolEvent {
  toolName: string
  zone: string
  action: string // "auto-approved" | "held" | "blocked" | "approved" | "denied" | "always"
  toolPattern?: string
  surface?: string
  timestamp?: string
}

/**
 * Log a tool event to Feed 2.0.
 * Fire-and-forget — telemetry failures are non-fatal.
 */
export async function logToolEvent(event: ToolEvent): Promise<void> {
  const notion = getNotion()
  if (!notion) return

  const ts = event.timestamp || new Date().toISOString()
  const summary = `Tool: ${event.toolName} → ${event.zone}/${event.action}`

  try {
    await notion.pages.create({
      parent: { database_id: NOTION_DB.FEED },
      properties: {
        Entry: { title: [{ text: { content: summary.slice(0, 100) } }] },
        Pillar: { select: { name: "The Grove" } },
        "Request Type": { select: { name: "Quick" } },
        Source: { select: { name: event.surface || "Bridge" } },
        Author: { select: { name: "Atlas [grove-node-1]" } },
        Status: { select: { name: "Routed" } },
        Date: { date: { start: ts } },
        Keywords: {
          multi_select: [
            { name: "tool-circuit" },
            { name: event.zone },
            { name: event.action },
          ],
        },
        Notes: {
          rich_text: [
            {
              text: {
                content: JSON.stringify({
                  toolName: event.toolName,
                  zone: event.zone,
                  action: event.action,
                  toolPattern: event.toolPattern || "default",
                  timestamp: ts,
                }, null, 2).slice(0, 2000),
              },
            },
          ],
        },
      },
    })
  } catch (err) {
    console.warn("[tool-telemetry] Feed write failed:", (err as Error).message)
  }
}
