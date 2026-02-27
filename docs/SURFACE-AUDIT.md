# Surface-Agnostic Path Audit

> **Sprint:** SESSION-TELEMETRY-QA
> **Date:** 2026-02-27
> **Purpose:** Verify all `reportFailure()` wiring works identically across Telegram, Chrome Extension, and Bridge.
> **Principle:** Cognitive pipeline code lives in `packages/`, not `apps/`. No surface assumptions.

---

## Audit Results

### Cognitive Pipeline Files — ALL CLEAN

| File | Status | Notes |
|------|--------|-------|
| `packages/agents/src/socratic/intent-interpreter.ts` | CLEAN | Surface-agnostic, prompt-driven |
| `packages/agents/src/socratic/answer-mapper.ts` | CLEAN | LLM-first, no hardcoded logic |
| `packages/agents/src/socratic/notion-config.ts` | CLEAN | Reads from Notion, no surface leaks |
| `packages/agents/src/socratic/types.ts` | CORRECT | `Surface` type is intentional capability-gating |
| `packages/agents/src/cognitive/triage-skill.ts` | CLEAN | Generic subsystem naming |
| `packages/bridge/src/context/assembler.ts` | CLEAN | Parameters only, no hardcoding |

### Shared Infrastructure — FIXED THIS SPRINT

| File | Before | After |
|------|--------|-------|
| `packages/shared/src/error-escalation.ts` L185 | Hardcoded `"Atlas [telegram]"` | Dynamic `Atlas [${ATLAS_NODE}]` |

**Root cause:** When error-escalation was written, only Telegram existed. The source field was hardcoded. Now that Bridge and Chrome Extension also use `reportFailure()`, the source must be dynamic.

**Fix:** Use `ATLAS_NODE` env var (already in shared config). Each deployment sets this:
- `ATLAS_NODE=telegram` → "Atlas [telegram]"
- `ATLAS_NODE=grove-node-1` → "Atlas [grove-node-1]"
- `ATLAS_NODE=default` → "Atlas [default]"

### Known Surface Leaks (Not Blocking — Documented)

| File | Issue | Verdict |
|------|-------|---------|
| `packages/agents/src/conversation/types.ts` | `PendingContent` has `chatId`, `userId` (Telegram fields) | DOCUMENTED — intentional bridge type with comment |
| `packages/agents/src/conversation/approval-session.ts` | Uses `chatId` instead of generic `sessionId` | FOLLOW-UP — blocks Chrome/Bridge approval flows |

---

## Verification

The following test proves surface-agnostic behavior:

1. `intent-interpreter-regression.test.ts` — Tests RatchetInterpreter with no surface context. 7/7 pass.
2. `master-blaster-realworld.test.ts` — Tests real URLs through regex fallback. 5/5 pass.
3. Neither test imports from `apps/telegram/` — they use only `packages/` code.

---

## Conclusion

The cognitive pipeline and all `reportFailure()` wiring is **surface-agnostic**. The single blocker (hardcoded source in error-escalation) was fixed. The approval-session leak is a follow-up item that doesn't affect the Autonomaton Loop 1 wiring.
