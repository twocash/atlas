# BUG: Drafter Resolution Always Falls Back to Hardcoded Prompt

**Severity:** P0 — Live code path, 100% fallback rate
**Filed:** 2026-02-19
**Reporter:** Atlas Wiring Audit
**Component:** `packages/agents/src/services/prompt-composition/composer.ts` + `prompt-manager.ts`

---

## Summary

The `composeFromStructuredContext()` → `composePrompt()` → `pm.composePrompts()` pipeline
**always falls back to hardcoded `buildFallbackPrompt()`**, even though:

- 20+ pillar-specific drafter entries exist in Notion with correct IDs
- Voice entries exist in Notion with correct IDs
- `NOTION_PROMPTS_DB_ID` is correctly configured in `.env`
- The PM's `fetchFromNotion()` query is correctly formed

The entries are there. The config is there. The code is wrong.

---

## Root Cause: All-or-Nothing Composition (Bug #1 — PRIMARY)

**File:** `packages/agents/src/services/prompt-manager.ts`, lines 800-852

`composePrompts()` iterates over `[drafter, voice, lens]` and calls `getPromptRecordById()` for each.
**If ANY component returns null, the ENTIRE composition aborts and returns null:**

```typescript
// prompt-manager.ts:822-831
for (const promptId of promptIds) {
  const record = await this.getPromptRecordById(promptId);
  if (!record) {
    // Returns null for the ENTIRE composition
    return null;  // ← DRAFTER IS THROWN AWAY even if it was found
  }
}
```

Then in `composer.ts:214-228`, the caller sees `null` and **blames the drafter**:

```typescript
if (!composedPrompt && promptIds.drafter) {
  console.error(`[Composer] DRAFTER NOT FOUND: "${promptIds.drafter}"...`);
  // Retries with drafter.default.{action}... but SAME VOICE that failed
  const fallbackIds = { ...promptIds, drafter: defaultDrafter };
  composedPrompt = await pm.composePrompts(fallbackIds, variables);
  // ↑ Same voice → same failure → still null
}
```

**The drafter was never the problem.** A voice lookup failure kills the whole chain,
and the fallback retries with the same failing voice, guaranteeing another failure.

### Concrete trace

For `composeFromStructuredContext({ pillar: 'Consulting', intent: 'save', audience: 'client' })`:

1. `resolveDrafterId('Consulting', 'capture')` → `'drafter.consulting.capture'` ✓ EXISTS IN NOTION
2. `resolveAudienceVoice('client', 'Consulting', null)` → `'consulting-brief'`
3. `resolveVoiceId('consulting-brief')` → `'voice.consulting-brief'`
4. `pm.composePrompts({ drafter: 'drafter.consulting.capture', voice: 'voice.consulting-brief' })`
5. Iterates: first fetches drafter ✓ found
6. Then fetches voice... (see Bug #2)
7. If voice fails → **entire composition returns null**
8. Error log: `[Composer] DRAFTER NOT FOUND: "drafter.consulting.capture"` — **WRONG**, drafter was found
9. Retries: `{ drafter: 'drafter.default.capture', voice: 'voice.consulting-brief' }`
10. Voice still fails → null again
11. Falls to `buildFallbackPrompt()` — all 20 drafter entries wasted

---

## Bug #2: Auto-Link Corruption of Voice IDs

**File:** Notion System Prompts DB, entry `Voice: Consulting Brief`

The stored ID for `voice.consulting-brief` is corrupted by Notion auto-linking:

```
Stored:   [voice.consulting](http://voice.consulting)-brief
Expected: voice.consulting-brief
```

Notion auto-links `.consulting` because it's a valid TLD. The `sanitizeNotionId()` regex
handles this on the READ path (stripping `[text](url)` → `text`), but the WRITE path
(when the entry was created in Notion UI) baked the corruption into the stored value.

### Affected entries (TLD collision risk)

Any ID containing a segment that matches a valid TLD:
- `.consulting` → `voice.consulting-brief`, `drafter.consulting.*`
- `.design` → potential future entries
- `.app` → potential future entries
- `.studio`, `.agency`, `.systems` → potential future entries

### Why drafters seem clean

`drafter.consulting.capture` — `.consulting` is followed by `.capture` (another dot segment),
so Notion's auto-linker doesn't treat it as a standalone domain. But `voice.consulting` followed
by `-brief` (hyphen, not dot) makes `.consulting` look like a valid domain to the auto-linker.

### Does this actually break the query?

The Notion API's `rich_text: { equals: ... }` filter compares against concatenated `plain_text`.
Auto-linked text should have the same plain_text (`voice.consulting-brief`), so the filter
**should** still match. However, this is fragile and untested — if Notion's filter behavior
changes, or if the auto-linking produces unexpected plain_text, it silently breaks.

---

## Bug #3: Misleading Error Messages

**File:** `packages/agents/src/services/prompt-composition/composer.ts`, lines 214-228

The error `[Composer] DRAFTER NOT FOUND` fires whenever `composePrompts()` returns null —
regardless of which component (drafter, voice, or lens) actually failed. The log message:

```
[Composer] DRAFTER NOT FOUND: Pillar-specific drafter "drafter.consulting.capture" not in
Notion or local fallback — trying default
```

...led the wiring audit to initially misdiagnose this as a missing-data problem ("the entries
were never created"). The entries were there all along. The error message was wrong.

---

## Bug #4: Circuit Breaker Cascade

**File:** `packages/agents/src/services/prompt-manager.ts`, lines 442-500

One Notion API failure sets `this.notionAvailable = false`, and ALL subsequent queries
return null immediately until `notionRetryInterval` elapses:

```typescript
// fetchFromNotion catch block:
this.notionAvailable = false;
this.lastNotionCheck = Date.now();
return null;
```

If the first PM query at bot startup fails (network blip, Notion rate limit), every composition
for the retry window (~30s) silently falls back. No degraded warning is logged from the
circuit breaker path — it just returns null.

---

## Evidence: What's Actually in Notion

### Drafter entries (confirmed by fetch, all Active, correct IDs):
| Entry | Stored ID | Auto-linked? |
|-------|-----------|:---:|
| Drafter: Consulting Capture | `drafter.consulting.capture` | No |
| Drafter: Consulting Draft | `drafter.consulting.draft` | No |
| Drafter: The Grove Draft | `drafter.the-grove.draft` | No |
| Drafter: Personal Draft | `drafter.personal.draft` | No |
| (+ ~16 more across all pillars and actions) | | |

### Voice entries (confirmed by fetch, all Active):
| Entry | Stored ID | Auto-linked? |
|-------|-----------|:---:|
| voice.strategic | `voice.strategic` | No |
| Voice: Practical | `voice.practical` | No |
| Voice: Reflective | `voice.reflective` | No |
| Voice: Consulting Brief | `[voice.consulting](http://voice.consulting)-brief` | **YES** |

### Code-generated IDs (from `resolveAudienceVoice` + `resolveDrafterId`):
| Audience | Pillar | Voice ID | Drafter ID (capture) |
|----------|--------|----------|---------------------|
| self | Consulting | `voice.strategic` | `drafter.consulting.capture` |
| client | Consulting | `voice.consulting-brief` | `drafter.consulting.capture` |
| public | Consulting | `voice.client-facing` | `drafter.consulting.capture` |
| self | The Grove | `voice.raw-notes` | `drafter.the-grove.capture` |
| client | The Grove | `voice.grove-analytical` | `drafter.the-grove.capture` |
| self | Personal | `voice.reflective` | `drafter.personal.capture` |
| self | Home/Garage | `voice.practical` | `drafter.home-garage.capture` |

---

## Fix Plan

### Fix 1: Make composition gracefully degrade (PRIMARY)

In `composePrompts()`, don't abort the entire composition when a voice/lens fails.
Only the drafter is required. Voice and lens are optional overlays.

```typescript
// BEFORE (all-or-nothing):
if (!record) return null;

// AFTER (graceful degradation):
if (!record) {
  console.warn(`[PromptManager] Optional component "${promptId}" not found — skipping`);
  continue; // Skip this component, don't abort
}
```

With a flag to distinguish required (drafter) from optional (voice, lens) components.

### Fix 2: Fix error messages in composer.ts

Replace `[Composer] DRAFTER NOT FOUND` with diagnostic that identifies WHICH component failed.
`composePrompts()` should return structured error info, not just null.

### Fix 3: Protect against auto-link corruption

For entries with TLD-colliding IDs, either:
- Create entries via Notion API (bypasses auto-linker)
- Use IDs that avoid TLD collisions (e.g., `voice_consulting_brief` instead of `voice.consulting-brief`)
- Add `sanitizeNotionId()` to the query path as well as the read path

### Fix 4: Add degraded logging to circuit breaker

When `shouldRetryNotion()` returns false, log a `[DEGRADED]` warning so silent failures
are visible.

---

## Verification

After fixing, run:
```bash
# Set PROMPT_STRICT_MODE=true to surface all resolution failures
PROMPT_STRICT_MODE=true bun test packages/agents/test/

# Or test composition directly:
bun run apps/telegram/scripts/debug-prompt-fetch.ts
```

The `[Composer] DRAFTER NOT FOUND` logs should disappear, replaced by successful
composition or specific component-level degraded warnings.
