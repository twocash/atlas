/**
 * Domain RAG Slot Assembly — Slot 2 Wiring
 *
 * Replaces the `assembleDomainRagSlot()` stub.
 * Flow: resolve workspace → query AnythingLLM → format chunks → createSlot()
 *
 * Graceful degradation: returns empty slot on any failure.
 */

import type { ContextSlot } from "../types/orchestration"
import { createSlot, createEmptySlot } from "./slots"
import { resolveWorkspace } from "./workspace-router"
import { queryWorkspace } from "./anythingllm-client"

// ─── Types ───────────────────────────────────────────────

interface TriageLike {
  pillar: string
  keywords: string[]
}

// ─── Slot Assembly ───────────────────────────────────────

/**
 * Assemble the Domain RAG slot from AnythingLLM workspace query.
 *
 * @param triage - Triage result (needs pillar + keywords)
 * @param messageText - The original user message (used as query)
 */
export async function assembleDomainRagSlot(
  triage: TriageLike,
  messageText: string,
): Promise<ContextSlot> {
  try {
    // Step 1: Resolve pillar to workspace
    const workspace = resolveWorkspace(triage.pillar)
    if (!workspace) {
      return createEmptySlot("domain_rag", "no-workspace-mapping")
    }

    // Step 2: Query AnythingLLM
    const response = await queryWorkspace(workspace, messageText)
    if (!response.ok || response.chunks.length === 0) {
      return createEmptySlot("domain_rag", response.error ? `rag-error: ${response.error}` : "rag-empty")
    }

    // Step 3: Format chunks into slot content
    const content = formatChunks(workspace, response.chunks)

    return createSlot({
      id: "domain_rag",
      source: `anythingllm:${workspace}`,
      content,
    })
  } catch (err) {
    console.warn("[Domain RAG] Slot assembly failed:", (err as Error).message)
    return createEmptySlot("domain_rag", "rag-error")
  }
}

// ─── Content Formatting ──────────────────────────────────

function formatChunks(
  workspace: string,
  chunks: Array<{ text: string; title?: string }>,
): string {
  const lines: string[] = [
    `Domain context from ${workspace} workspace:`,
  ]

  for (const chunk of chunks) {
    lines.push("---")
    if (chunk.title) {
      lines.push(`[${chunk.title}]`)
    }
    lines.push(chunk.text)
  }

  return lines.join("\n")
}
