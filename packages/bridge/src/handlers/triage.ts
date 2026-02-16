/**
 * Triage Handler — cognitive middleware that intercepts client→claude
 * messages for intelligent routing.
 *
 * For client→claude direction:
 *   1. Assemble context slots (triage + voice + browser + output)
 *   2. Route by complexity tier:
 *      - Tier 0-1 (local): respond directly to the client
 *      - Tier 2-3 (claude_code): construct prompt and forward to Claude Code
 *
 * For claude→client direction: passes through to next handler (relay).
 *
 * Inserted BEFORE relayHandler via prependHandler() in the handler chain.
 */

import type { HandlerFn, BridgeEnvelope, HandlerContext } from "../types/bridge"
import type { OrchestrationRequest, BrowserContext } from "../types/orchestration"
import { assembleContext } from "../context/assembler"
import { constructPrompt, buildClaudeMessage } from "../context/prompt-constructor"
import { profileTask, getQuickResponse, canSkipLLM } from "../../../../apps/telegram/src/cognitive/profiler"

// ─── Feature Gate ─────────────────────────────────────────

/** Kill switch: set BRIDGE_TRIAGE=false to disable triage and fall back to relay passthrough */
function isTriageEnabled(): boolean {
  return process.env.BRIDGE_TRIAGE !== "false"
}

// ─── Handler ──────────────────────────────────────────────

export const triageHandler: HandlerFn = async (envelope, context, next) => {
  // Only intercept client→claude messages
  if (envelope.direction !== "client_to_claude") {
    next()
    return
  }

  // Kill switch check
  if (!isTriageEnabled()) {
    next()
    return
  }

  // Extract user message text from the envelope
  const messageText = extractMessageText(envelope)
  if (!messageText) {
    // Not a user message (tool_response, etc.) — pass through
    next()
    return
  }

  try {
    // Quick-skip check: trivial messages (greetings, etc.) can be answered locally
    const profile = profileTask(messageText)
    if (canSkipLLM(profile)) {
      const quickResponse = getQuickResponse(messageText)
      if (quickResponse) {
        sendLocalResponse(context, envelope.sourceConnectionId, quickResponse, 0)
        return // Don't call next() — we handled it
      }
    }

    // Full triage + context assembly
    const request: OrchestrationRequest = {
      messageText,
      surface: envelope.surface || "chrome_extension",
      sessionId: envelope.sessionId,
      sourceConnectionId: envelope.sourceConnectionId,
      browserContext: extractBrowserContext(envelope),
      timestamp: envelope.timestamp,
    }

    const assembly = await assembleContext(request)

    console.log(
      `[triage] Tier ${assembly.tier} → ${assembly.route} | ` +
      `intent=${assembly.triage.intent} pillar=${assembly.triage.pillar} ` +
      `slots=[${assembly.slotsUsed.join(",")}] ` +
      `tokens=${assembly.totalContextTokens} latency=${assembly.triageLatencyMs}ms`,
    )

    // Construct enriched prompt
    const prompt = constructPrompt(assembly)
    const claudeMessage = buildClaudeMessage(prompt)

    // Check Claude connection before sending
    if (!context.isClaudeConnected()) {
      console.warn("[triage] Claude not connected — sending error to client")
      context.sendToClient(envelope.sourceConnectionId, {
        type: "error",
        data: {
          code: "CLAUDE_NOT_CONNECTED",
          message: "Claude Code is not connected. Try again in a moment.",
        },
      } as any)
      return
    }

    context.sendToClaude(claudeMessage as any)

    // Don't call next() — we've handled the message routing
  } catch (err) {
    console.error("[triage] Triage failed, falling back to relay:", (err as Error).message)
    // On failure, pass through to relay handler (graceful degradation)
    next()
  }
}

// ─── Helpers ──────────────────────────────────────────────

/**
 * Extract the user's message text from a BridgeEnvelope.
 * Returns null if this isn't a user message.
 */
function extractMessageText(envelope: BridgeEnvelope): string | null {
  const msg = envelope.message as any
  if (!msg) return null

  // Client sends: { type: "user_message", content: [{ type: "text", text: "..." }] }
  if (msg.type === "user_message" && Array.isArray(msg.content)) {
    const textBlocks = msg.content.filter((b: any) => b.type === "text")
    if (textBlocks.length > 0) {
      return textBlocks.map((b: any) => b.text).join("\n")
    }
  }

  return null
}

/**
 * Extract browser context from the envelope message (if the extension sent it).
 */
function extractBrowserContext(envelope: BridgeEnvelope): BrowserContext | undefined {
  const msg = envelope.message as any
  if (!msg?.browserContext) return undefined

  return {
    url: msg.browserContext.url,
    title: msg.browserContext.title,
    selectedText: msg.browserContext.selectedText,
    linkedInContext: msg.browserContext.linkedInContext,
  }
}

/**
 * Send a local response back to the client that sent the message.
 */
function sendLocalResponse(
  context: HandlerContext,
  connectionId: string,
  text: string,
  tier: number,
): void {
  context.sendToClient(connectionId, {
    type: "assistant",
    message: {
      role: "assistant",
      content: text,
    },
    metadata: {
      route: "local",
      tier,
    },
  } as any)
}
