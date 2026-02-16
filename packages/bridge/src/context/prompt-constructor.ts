/**
 * Prompt Constructor — converts assembled context slots into the
 * final instruction string sent to Claude Code.
 *
 * The constructed prompt follows a structured template:
 *   [System context]
 *   [Slot 1: Intent]
 *   [Slot 4: Voice]
 *   [Slot 5: Browser]
 *   [Slot 2: Domain RAG]   (if populated)
 *   [Slot 3: POV]          (if populated)
 *   [Slot 6: Output]
 */

import type { ContextSlot } from "../types/orchestration"
import type { AssemblyResult } from "./assembler"

// ─── Prompt Template ──────────────────────────────────────

const SYSTEM_PREAMBLE = `You are Atlas, Jim's AI Chief of Staff. Process the following request using the context provided.`

/**
 * Build the instruction string from assembled context slots.
 *
 * Only includes populated slots. Slots are ordered by their
 * semantic role, not priority (priority is for trimming only).
 */
export function constructPrompt(assembly: AssemblyResult): string {
  const sections: string[] = [SYSTEM_PREAMBLE]

  // Ordered by semantic importance in the prompt
  const slotOrder: string[] = ["intent", "voice", "browser", "domain_rag", "pov", "output"]

  for (const slotId of slotOrder) {
    const slot = assembly.slots.find((s) => s.id === slotId)
    if (!slot || !slot.populated) continue

    sections.push(formatSlotSection(slot))
  }

  return sections.join("\n\n---\n\n")
}

/**
 * Format a single slot into a prompt section.
 */
function formatSlotSection(slot: ContextSlot): string {
  const header = SLOT_HEADERS[slot.id] ?? `[${slot.id}]`
  return `${header}\n${slot.content}`
}

/** Human-readable headers for each slot in the prompt */
const SLOT_HEADERS: Record<string, string> = {
  intent: "## Request",
  voice: "## Voice & Style",
  browser: "## Browser Context",
  domain_rag: "## Domain Knowledge",
  pov: "## Epistemic Position",
  output: "## Output Instructions",
}

/**
 * Build the Claude Code stream-json message from the constructed prompt.
 *
 * Returns the object that gets written to Claude Code's stdin as NDJSON.
 */
export function buildClaudeMessage(prompt: string): {
  type: "user"
  message: { role: "user"; content: string }
} {
  return {
    type: "user",
    message: {
      role: "user",
      content: prompt,
    },
  }
}

/**
 * Convenience: assemble + construct in one call.
 * Returns both the prompt string and the Claude message object.
 */
export function constructFromAssembly(assembly: AssemblyResult): {
  prompt: string
  claudeMessage: ReturnType<typeof buildClaudeMessage>
} {
  const prompt = constructPrompt(assembly)
  return {
    prompt,
    claudeMessage: buildClaudeMessage(prompt),
  }
}
