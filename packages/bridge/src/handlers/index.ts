/**
 * Handler Chain — composes middleware handlers into a pipeline.
 *
 * Phase 3: single handler (relay passthrough).
 * Phase 5: [triageHandler, relayHandler, responseRouterHandler]
 *          triage intercepts before relay, response router observes after.
 *
 * The chain runs handlers in order. Each handler calls next() to pass
 * control to the next handler. If a handler doesn't call next(), the
 * chain stops (useful for triage intercepting a message).
 */

import type { BridgeEnvelope, HandlerFn, HandlerContext } from "../types/bridge"
import { relayHandler } from "./relay"
import { triageHandler } from "./triage"
import { responseRouterHandler } from "./response-router"

// ─── Handler Chain ───────────────────────────────────────────
// Order: triage → relay → response-router
// Triage intercepts client→claude (may skip relay).
// Relay forwards messages.
// Response router observes claude→client for landing surface routing.

const handlers: HandlerFn[] = [triageHandler, relayHandler, responseRouterHandler]

/**
 * Process a message envelope through the handler chain.
 */
export async function processEnvelope(
  envelope: BridgeEnvelope,
  context: HandlerContext,
): Promise<void> {
  let index = 0

  const next = () => {
    index++
    if (index < handlers.length) {
      const result = handlers[index](envelope, context, next)
      if (result instanceof Promise) {
        result.catch((err) => {
          console.error(`[bridge] Handler error at index ${index}:`, err)
        })
      }
    }
  }

  try {
    const result = handlers[0](envelope, context, next)
    if (result instanceof Promise) await result
  } catch (err) {
    console.error("[bridge] Handler chain error:", err)
  }
}

/**
 * Prepend a handler to the chain (e.g., triage handler in Phase 5).
 */
export function prependHandler(handler: HandlerFn): void {
  handlers.unshift(handler)
}

/**
 * Append a handler to the chain (e.g., logging handler).
 */
export function appendHandler(handler: HandlerFn): void {
  handlers.push(handler)
}
