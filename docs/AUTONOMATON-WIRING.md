# Autonomaton Wiring Map

> **Sprint:** SESSION-TELEMETRY-QA
> **Date:** 2026-02-27
> **Purpose:** Map every cognitive pipeline error path and its `reportFailure()` connection.
> **Principle:** ADR-008 (Fail Fast, Fail Loud). No silent fallbacks in the cognitive pipeline.

---

## Error Path Classification

| Classification | Action | Criteria |
|---|---|---|
| **SILENT CRITICAL** | Wire `reportFailure()` immediately | Cognitive pipeline failure that degrades user-visible output |
| **SILENT DEGRADED** | Wire `reportFailure()` with severity context | Non-fatal degradation that should be tracked |
| **ALREADY WIRED** | Verify still connected | Existing `reportFailure()` call |
| **ACCEPTABLE SILENT** | Document and leave | Non-cognitive utility, no user impact |

---

## Already Wired (6 paths - pre-sprint)

| # | File | Subsystem | Line | Trigger |
|---|------|-----------|------|---------|
| 1 | `packages/agents/src/cognitive/triage-skill.ts` | `triage-fallback` | 349 | Haiku triage fails → fallback result |
| 2 | `packages/agents/src/conversation/audit.ts` | `feed-write` | 356 | Feed 2.0 entry creation fails |
| 3 | `packages/agents/src/conversation/audit.ts` | `work-queue-write` | 678 | Work Queue entry creation fails |
| 4 | `packages/agents/src/conversation/context-enrichment.ts` | `slot-{name}` | 112 | Individual slot assembly fails |
| 5 | `packages/agents/src/conversation/context-enrichment.ts` | `context-enrichment` | 166 | Overall context assembly fails |
| 6 | `packages/agents/src/pipeline/orchestrator.ts` | `conversation-handler` | 1359 | Top-level conversation error |

---

## Wired This Sprint - Critical (3 paths) + Triage Adapters (2 paths)

| # | File | Catch Location | Before | After | Subsystem ID |
|---|------|----------------|--------|-------|--------------|
| 1 | `intent-interpreter.ts` (RatchetInterpreter.interpret) | L231-243 | `console.error` + silent regex fallback | `reportFailure('intent-interpreter', ...)` with model ID, HTTP status, consecutive failure count. Returns `intent_interpreter_status: 'degraded'`. | `intent-interpreter` |
| 2 | `answer-mapper.ts` (mapAnswer intent block) | L272-283 | `console.error` + continues without intent | `reportFailure('intent-interpretation', ...)` with error detail. Marks Feed entry `interpretationMethod: 'error'`. | `intent-interpretation` |
| 3 | `assembler.ts` (assembleVoiceSlot) | L147-149 | `console.warn` + returns empty slot | `reportFailure('voice-slot', ...)` with composition error. Non-blocking. | `voice-slot` |
| 4 | `triage-skill.ts` (classifyWithFallback) | L703-713 | `logger.warn` + safe defaults | `reportFailure('triage-classify', ...)` with message preview. | `triage-classify` |
| 5 | `triage-skill.ts` (triageForAudit) | L737-750 | `logger.warn` + safe defaults | `reportFailure('triage-audit', ...)` with message preview. | `triage-audit` |

---

## Wired This Sprint - Degraded (3 paths)

| # | File | Catch Location | Before | After | Subsystem ID |
|---|------|----------------|--------|-------|--------------|
| 4 | `notion-config.ts` (fetchPageContent) | L130-132 | `console.error` + returns empty string | `reportFailure('socratic-config', ...)` with page ID. Returns empty (unchanged behavior). | `socratic-config` |
| 5 | `notion-config.ts` (individual body fetch) | L195-197 | `console.warn` + uses empty body | `reportFailure('socratic-config', ...)` with page ID. Non-blocking. | `socratic-config` |
| 6 | `notion-config.ts` (full config fetch) | L279-282 | `console.error` + falls to stale cache | `reportFailure('socratic-config', ...)`. Stale cache still used (acceptable degradation). | `socratic-config` |

---

## Acceptable Silent (5 paths) — No Action

| # | File | Catch Location | Reason |
|---|------|----------------|--------|
| 1 | `content-router.ts` (detectContentSourceFallback) | L109-112 | URL parse → returns 'generic'. Not a pipeline failure, just an unusual URL format. Logged as warning. |
| 2 | `content-router.ts` (extractDomain) | L143-145 | Returns 'unknown' domain. Display-only, no cognitive impact. |
| 3 | `content-router.ts` (isValidUrl) | L222-224 | Returns false. Validation helper, not a failure. |
| 4 | `training-collector.ts` (logEntry) | L114-116 | Training data write failure. Non-critical by design — training is opportunistic. |
| 5 | `training-collector.ts` (getEntryCount/readEntries) | L129-131, L146-148 | Training data reads. Non-critical. |

---

## reportFailure() Context Contract

Every `reportFailure()` call in the cognitive pipeline MUST include:

```typescript
reportFailure(subsystem, error, {
  timestamp: new Date().toISOString(),
  // Reproduction context (truncated for safety):
  messagePreview: messageText?.substring(0, 200),
  // Session linkage (when available):
  sessionId: session?.id,
  // Diagnostic pointer:
  suggestedFix: 'Human-actionable next step',
  // Subsystem-specific fields:
  ...subsystemContext,
});
```

**The bug report must tell the human WHERE TO LOOK.** Not just "intent interpreter failed" but include the model ID, the HTTP status, and what env var to check.

---

## Autonomaton Loop 1 (Defensive) — Proven by Test 5

The intentional failure cascade test (master-blaster-realworld.test.ts Test 5) proves:

1. Set `ATLAS_INTENT_MODEL=claude-nonexistent-model`
2. Intent interpreter call → HTTP 404
3. `reportFailure('intent-interpreter', ...)` fires with model ID + status
4. Sliding window threshold (3 in 5 min) → Feed 2.0 Alert
5. Regex fallback activates, marked `intent_interpreter_status: 'degraded'`
6. User flow completes (degraded but functional)

This is Digital Jidoka: the system pulls the andon cord with enough diagnostic context for a human to resolve it without investigation.
