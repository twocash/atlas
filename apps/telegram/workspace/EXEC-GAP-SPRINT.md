# Atlas Telegram: Execution Gap — Remaining Item

**From:** Jim Calhoun (2026-02-19)
**To:** Claude Code (Implementation)
**Branch:** `fix/exec-gap-procedural-ui`
**Worktree:** `C:\github\atlas-exec-gap-procedural-ui\`

---

## Status at Contract Creation

Items 1–3 from the capture-without-execution gap analysis were resolved
in `f074d3b` (merged `a59c925`, 2026-02-18). This contract covers the
one remaining open item.

PM decisions locked (items 5–7 from the original gap report):
- Item 5 (`handleCreateTask`): Stay Captured — no auto-execute
- Item 6 (`handleTrackInWQ`): Default `requestType: 'Process'` — already fixed in `f074d3b`
- Item 7 (`routeToWorkQueue`): No auto-execute — already correct

---

## Item 4: `procedural-ui.ts` — Legacy Research Path

**Severity:** P1 (execution gap, low traffic)
**File:** `apps/telegram/src/features/procedural-ui.ts`
**Lines:** ~210–247
**Triggered by:** Procedural UI keyboard → user selects "Research Agent" capability

### Current Behavior

```typescript
// Line 215 — raw legacy import, no WQ, no notifications
const { runResearchAgent } = await import("../../../../packages/agents/src");
const { registry } = await import("../../../../packages/agents/src");

const result = await runResearchAgent(registry, { ... });

// Lines 231–246 — manual inline delivery, raw errors exposed
if (result.result.success) {
  await ctx.reply(truncatedSummary);  // manual, no Notion URL
} else {
  await ctx.reply(`Research failed: ${error.message}`);  // raw error
}
```

Problems:
1. Uses `runResearchAgent()` (raw, from packages/agents) — bypasses all
   Telegram-layer infrastructure (notifications, WQ wiring, provenance)
2. No `createResearchWorkItem()` — research runs with no Work Queue entry
3. No `sendCompletionNotification()` — result never stashed (breaks session
   continuity), no Notion URL in response, no bibliography/source count
4. Raw error messages leak to user on failure

### Expected Behavior

Match the pattern used by every other research callsite in the bot:

```
createResearchWorkItem()                 → WQ item created, Captured
runResearchAgentWithNotifications()      → agent spawned, progress events
sendCompletionNotification()             → results delivered, stash called
WQ item status → Shipped                → Notion tracking complete
```

### Fix

**Replace lines 210–247 with:**

```typescript
if (capability === "ResearchAgent" || capability === "Research") {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  let fullPillar: Pillar = "The Grove";
  if (pillar.includes("Consult")) fullPillar = "Consulting";
  else if (pillar.includes("Personal")) fullPillar = "Personal";
  else if (pillar.includes("Home") || pillar.includes("Garage")) fullPillar = "Home/Garage";

  const query = pendingQuery || "General research";
  const depth = useCase.includes("Deep") ? "deep" : "standard";

  // Create WQ item first
  const { createResearchWorkItem } = await import("../services/research-executor");
  const wqItem = await createResearchWorkItem({
    query,
    pillar: fullPillar,
    source: 'procedural-ui',
  });

  await ctx.reply(`🔬 Starting <b>${useCase}</b> research...`, { parse_mode: 'HTML' });

  const { runResearchAgentWithNotifications, sendCompletionNotification } =
    await import("../services/research-executor");

  runResearchAgentWithNotifications(
    { query, depth, pillar: fullPillar },
    chatId,
    ctx.api,
    wqItem.pageId,
    'procedural-ui',
  )
    .then(({ agent, result }) =>
      sendCompletionNotification(ctx.api, chatId, agent, result, wqItem.url, 'procedural-ui')
    )
    .catch(err => {
      logger.error("[ProceduralUI] Research dispatch failed", { error: err });
      ctx.api.sendMessage(chatId, "❌ Research couldn't start. Captured in Work Queue — retry from Notion.").catch(() => {});
    });
}
```

**Also add import at top of file:**
```typescript
import type { Pillar } from '../types';
```
(if not already present — check existing imports first)

### Notes

- `createResearchWorkItem` may need to be exported from `research-executor.ts`
  if not already. Check `agent-handler.ts` for the canonical implementation —
  it may live there and need moving/re-exporting.
- The `.catch()` on `runResearchAgentWithNotifications` is intentional —
  fire-and-forget so the callback returns immediately.
- Do NOT await `runResearchAgentWithNotifications` (it blocks for minutes).
- Source identifier: `'procedural-ui'` — for WQ Notes provenance.

---

## Shared Infrastructure (Reference)

All callsites use these — do not re-implement:

| Function | File | Purpose |
|----------|------|---------|
| `createResearchWorkItem()` | `agent-handler.ts` or `research-executor.ts` | Create WQ item before agent runs |
| `runResearchAgentWithNotifications()` | `services/research-executor.ts:45` | Spawn + notify + execute |
| `sendCompletionNotification()` | `services/research-executor.ts:225` | Final result delivery + stash |

---

## Testing

After fix, validate:

| Test | Expected |
|------|----------|
| Trigger procedural UI → Research Agent capability | WQ item created in Notion |
| Research completes | `sendCompletionNotification()` fires, Notion URL in message |
| Research summary present | `stashAgentResult()` called (session continuity) |
| Research fails | Clean error message, no raw exception exposed |

Add test to `test/exec-gap-procedural-ui.test.ts` covering the dispatch
call with mocked `createResearchWorkItem` + `runResearchAgentWithNotifications`.

Run Master Blaster `--quick` to confirm no regressions.

---

## Rollback

Single file change — independently revertable with `git revert`.
