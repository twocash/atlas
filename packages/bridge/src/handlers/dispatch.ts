/**
 * HTTP Handler for POST /dispatch — validates payload, evaluates rules, dispatches.
 *
 * Thin handler: validate → router → spawn (async) or escalate (sync).
 * Constraint 4: errors create Feed alerts, never silenced.
 */

import { randomUUID } from "crypto"
import type { DispatchWebhookPayload } from "../types/dispatch"
import { evaluate } from "../dispatch/router"
import { canDispatch, runDispatch } from "../dispatch/spawner"
import { handleOutcome } from "../dispatch/outcome"

const CORS_HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
}

/** Validate required fields on the webhook payload. */
function validatePayload(body: unknown): { ok: true; payload: DispatchWebhookPayload } | { ok: false; error: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Request body must be a JSON object" }
  }

  const b = body as Record<string, unknown>
  const required = ["pageId", "title", "status", "pillar", "priority", "type"]
  const missing = required.filter((k) => !b[k] || typeof b[k] !== "string")

  if (missing.length > 0) {
    return { ok: false, error: `Missing required fields: ${missing.join(", ")}` }
  }

  return {
    ok: true,
    payload: {
      pageId: b.pageId as string,
      title: b.title as string,
      status: b.status as string,
      pillar: b.pillar as string,
      priority: b.priority as string,
      type: b.type as string,
      notes: typeof b.notes === "string" ? b.notes : undefined,
      url: typeof b.url === "string" ? b.url : undefined,
      assignee: typeof b.assignee === "string" ? b.assignee : undefined,
    },
  }
}

/**
 * Handle POST /dispatch.
 *
 * Returns immediately for dispatch decisions (spawn is async).
 * Returns synchronously for escalate/queue decisions.
 */
export async function handleDispatch(req: Request): Promise<Response> {
  // Master kill switch
  if (process.env.BRIDGE_DISPATCH !== "true") {
    return new Response(
      JSON.stringify({ ok: false, error: "Dispatch is disabled (BRIDGE_DISPATCH != true)" }),
      { status: 403, headers: CORS_HEADERS },
    )
  }

  // Parse body
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return new Response(
      JSON.stringify({ ok: false, error: "Invalid JSON body" }),
      { status: 400, headers: CORS_HEADERS },
    )
  }

  // Validate
  const validation = validatePayload(body)
  if (!validation.ok) {
    return new Response(
      JSON.stringify({ ok: false, error: validation.error }),
      { status: 400, headers: CORS_HEADERS },
    )
  }

  const payload = validation.payload
  console.log(`[dispatch] Received: "${payload.title}" (${payload.type}, ${payload.status}, ${payload.pillar})`)

  // Evaluate against rules
  const match = evaluate(payload)
  console.log(`[dispatch] Rule match: ${match.ruleName} → ${match.decision} (${match.reason})`)

  if (match.decision === "escalate" || match.decision === "queue") {
    return new Response(
      JSON.stringify({
        ok: true,
        decision: match.decision,
        rule: match.ruleName,
        reason: match.reason,
      }),
      { headers: CORS_HEADERS },
    )
  }

  // Decision: dispatch — check capacity
  if (!canDispatch()) {
    return new Response(
      JSON.stringify({
        ok: false,
        decision: "dispatch",
        error: "At capacity — dispatch queued for retry",
        rule: match.ruleName,
      }),
      { status: 429, headers: CORS_HEADERS },
    )
  }

  // Fire-and-forget: spawn async, return immediately
  const sessionId = randomUUID()

  runDispatch(
    sessionId,
    payload.pageId,
    payload.title,
    match.prompt,
    match.model,
    match.maxTurns,
    match.timeoutSeconds,
    (result) => handleOutcome(payload, result),
  ).catch((err) => {
    // Constraint 4: fail loud
    console.error(`[dispatch] Unhandled error in runDispatch:`, err)
  })

  return new Response(
    JSON.stringify({
      ok: true,
      decision: "dispatch",
      sessionId,
      rule: match.ruleName,
      reason: match.reason,
    }),
    { headers: CORS_HEADERS },
  )
}
