# Atlas Telegram: Bug Fix Sprint

**From:** Jim Calhoun & Claude (QA Session, 2026-02-06)
**To:** Claude Code (Implementation)
**Branch:** `triage-intelligence`
**Worktree:** `C:\github\atlas-triage-intelligence\`

---

## Context

Six bugs were confirmed during live Telegram testing of the cognitive routing system. These surfaced during a structured test matrix covering URL handling, intent classification, pillar routing, ambiguous intent, multi-intent parsing, and cross-pillar content.

**Priority order:** Fix bugs 2, 3, 6 (High) first, then 1, 4, 5 (Medium).

**Test transcript:** Telegram conversation logs from 2026-02-06 testing session.

---

## Database IDs (Reference)

| Database | Database Page ID (Notion SDK) | Data Source ID (MCP) |
|----------|-------------------------------|----------------------|
| Feed 2.0 | `90b2b33f-4b44-4b42-870f-8d62fb8cbf18` | `a7493abb-804a-4759-b6ac-aeca62ae23b8` |
| Work Queue 2.0 | `3d679030-b76b-43bd-92d8-1ac51abb4a28` | `6a8d9c43-b084-47b5-bc83-bc363640f2cd` |

---

## BUG #1: Duplicate Confirmation Messages

**Severity:** Medium
**File(s):** `src/conversation/handler.ts`, `src/conversation/content-flow.ts`, `src/conversation/content-confirm.ts`

### Reproduction
1. Send any URL to the bot
2. Observe TWO confirmation messages instead of one

### Evidence
GitHub Codex Orchestrator URL and Mercedes BaT listing both produced duplicate confirmations during testing.

### Root Cause
Race condition or dual handlers — one confirmation fires from Feed creation path, another from Work Queue creation or content-flow keyboard. The `maybeHandleAsContentShare()` path in `handler.ts` and the tool-based capture path may both be sending confirmations.

### Expected Behavior
Single consolidated message: `✓ Captured to Feed (Pillar / Intent) → routing to Work Queue`

### Fix Strategy
1. Trace both confirmation paths in `content-flow.ts` → `triggerInstantClassification()` and `triggerMediaConfirmation()`
2. Add a sent-confirmation flag (per message ID) to prevent double-send
3. If both Feed + Work Queue writes complete, consolidate into one message
4. Check for early return after `maybeHandleAsContentShare()` in `handler.ts` — if content-flow handled it, handler should not also confirm

---

## BUG #2: "I don't see content" False Negative

**Severity:** HIGH
**File(s):** `src/conversation/handler.ts`, `src/conversation/content-flow.ts`, `src/intent.ts`

### Reproduction
1. Send a URL in one message
2. Immediately send context text in a follow-up message (e.g., "check this out")
3. Bot responds "I don't see any content to capture" on the second message
4. Bot then self-corrects (processes the URL from message 1)

### Root Cause
Message-pairing/context window gap. Bot processes each message independently. When URL arrives in msg 1 and context in msg 2, the handler for msg 2 doesn't see the URL and treats it as contentless. No look-back to recent messages exists.

### Expected Behavior
One of:
- **Option A (Preferred):** Treat URL-only messages as valid captures — don't wait for context
- **Option B:** Brief 2-3 second buffer before responding, allowing follow-up messages to arrive
- **Option C:** Look-back at previous 1-2 messages to correlate URL + context

### Fix Strategy
1. In `detectContentShare()` in `content-flow.ts`, a URL-only message should be a valid content share — proceed to classification immediately
2. Context text in follow-up should be treated as supplementary, not required
3. If implementing message correlation: check conversation history in `src/conversation/context.ts` for recent URL within last 30 seconds
4. The "I don't see any content" response likely comes from Claude's system prompt — audit `src/conversation/prompt.ts` for this phrasing and add instruction: "URL-only messages are valid captures"

---

## BUG #3: No Fallback Hierarchy for Ambiguous Intent

**Severity:** HIGH
**File(s):** `src/intent.ts`, `src/cognitive/triage-skill.ts`, `src/classifier.ts`

### Reproduction
1. Send ambiguous message: "That PR needs work"
2. Bot asks for clarification instead of making a decision

### Root Cause
Intent detection defaults to "ask user" for ambiguous input. The confidence threshold system defined in `classifier.ts` (`CONFIDENCE_THRESHOLDS`) exists but the fallback hierarchy isn't fully implemented in practice. When `triageMessage()` in `triage-skill.ts` returns `intent: 'clarify'`, the system always asks rather than defaulting to capture.

### Expected Behavior — Confidence-Based Routing
| Confidence | Action |
|-----------|--------|
| 90%+ | Auto-classify, single confirm |
| 70-90% | Classify with caveat: "Filed as X — tap to change" |
| 50-70% | Quick A/B/C choices (inline keyboard) |
| <50% | **Default to capture** (safe fallback), allow reclassification |

### Fix Strategy
1. In `triage-skill.ts`, when confidence < 50%, set `intent: 'capture'` instead of `intent: 'clarify'`
2. Capture to Feed with best-guess pillar, add `Was Reclassified: false` flag
3. Send message: "Captured as [best guess]. Tap to reclassify: [A] [B] [C]"
4. Wire up reclassification keyboard handler (may already exist in `dispatch-choice.ts`)
5. The principle: **capture is always safe, asking always adds friction**

### Design Decision
Jim's ADHD-optimized philosophy: default to capture, not clarification. The system should be wrong-and-correctable rather than right-but-slow. "Decide once, execute forever" means the fallback should preserve the spark, not block on it.

---

## BUG #4: Pillar Misclassification — Vehicles → Home/Garage

**Severity:** Medium
**File(s):** `src/cognitive/triage-skill.ts` (triage prompt), `src/conversation/prompt.ts` (system prompt)

### Reproduction
1. Send a Bring a Trailer (bringatrailer.com) vehicle listing URL
2. Bot classifies as "Personal" pillar
3. Should be "Home/Garage" based on vehicle collection context

### Evidence
Mercedes 300E BaT listing → classified as Personal. Work Queue item `2ff780a78eef81c8a2f7f22a6bbe90bc` shows `Pillar: Personal`.

### Root Cause
Vehicle/automotive domain not mapped to Home/Garage pillar in the classification prompt. The triage prompt in `triage-skill.ts` doesn't include domain-specific signals for Jim's vehicle collection.

### Expected Behavior
- `bringatrailer.com` → Home/Garage
- Vehicle-related content (cars, trucks, parts, automotive) → Home/Garage
- Jim's fleet context: 2019 AMG E63s, 1979 450SL, 2021 GX460, 2006 Lexus

### Fix Strategy
1. In `triage-skill.ts`, add domain mapping to the triage prompt:
   ```
   Domain signals for Home/Garage:
   - bringatrailer.com, carsandbids.com, autotrader.com
   - Vehicle/automotive/car/truck content
   - Garage, workshop, tools, permits, renovation
   ```
2. Also check `src/conversation/prompt.ts` system prompt for pillar routing rules
3. Reference `CLAUDE.md` routing rules section which already specifies some pillar signals
4. Consider adding a domain → pillar lookup table in config (extensible pattern)

---

## BUG #5: Research Grounding Failure with Raw Error Exposed

**Severity:** Medium
**File(s):** `src/cognitive/supervise.ts` (or equivalent research handler), `src/conversation/handler.ts` (error handling)

### Reproduction
1. Send cross-pillar/ambiguous research request: "AI tool for home renovation"
2. Research grounding triggers (Gemini)
3. Gemini API fails (content policy or API error)
4. Raw error message exposed to user in Telegram
5. Bot falls back to Work Queue creation

### Root Cause
Missing try/catch with user-friendly fallback around Gemini grounding calls. Error propagates raw to the Telegram response.

### Expected Behavior
1. User sees "Researching..." or "Looking into that..." status
2. On Gemini failure: silent retry (1-2 attempts)
3. If retry fails: clean fallback message: "Couldn't complete research right now, but I've captured this for follow-up."
4. **Never** expose raw API errors, stack traces, or technical messages to user

### Fix Strategy
1. Find Gemini/research grounding call (likely in `src/cognitive/` or `src/test-research.ts` pattern)
2. Wrap in try/catch with:
   - Retry logic (1-2 attempts with 1s delay)
   - User-friendly error message on final failure
   - Log raw error to `logger.error()` for debugging
3. Check `src/pending-research.ts` — may have existing retry patterns to reuse
4. Ensure no `throw` propagates to message handler without being caught

---

## BUG #6: Multi-Intent Parsing Non-Existent

**Severity:** HIGH
**File(s):** `src/intent.ts`, `src/cognitive/triage-skill.ts`

### Reproduction
1. Send compound message: "Save this article and remind me to read it tomorrow"
2. Bot treats as single unresolvable request
3. Only asks for the article link — completely ignores the reminder component

### Root Cause
Intent detection in `intent.ts` assumes single intent per message. `detectIntent()` returns one `IntentDetectionResult`. The triage skill in `triage-skill.ts` also returns a single `TriageResult` with one intent.

### Expected Behavior
1. Detect multiple intents: `[capture article]` + `[schedule reminder]`
2. Decompose into separate actions
3. Execute sequentially or in parallel
4. Confirm all: "Got it — I'll save the article and set a reminder for tomorrow"

### Fix Strategy
**Phase 1 (MVP — this sprint):**
1. In `triage-skill.ts`, update the triage prompt to detect compound intents
2. Return an array of `TriageResult` objects (or a `sub_intents` field)
3. In the handler, if multiple intents detected, process each sequentially
4. Consolidate confirmations into a single message listing all actions

**Phase 2 (future):**
- Parallel execution of independent intents
- Dependency resolution (e.g., "save article" must complete before "set reminder for that article")
- Intent chaining with shared context

### Type Changes Needed
```typescript
// Current (single intent):
interface TriageResult {
  intent: 'command' | 'capture' | 'query' | 'clarify';
  confidence: number;
  // ...
}

// Proposed (multi-intent):
interface TriageResult {
  intents: TriageIntent[];  // Array of detected intents
  primaryIntent: TriageIntent;  // Highest-confidence intent
  isCompound: boolean;  // Quick flag for multi-intent
}

interface TriageIntent {
  intent: 'command' | 'capture' | 'query' | 'clarify';
  confidence: number;
  description: string;  // What this specific intent is about
  // ... other fields from current TriageResult
}
```

---

## Additional Observation: Feed Entry Content Bloat

**Severity:** Low (not blocking, optimize later)

Feed 2.0 entries contain full analysis content duplicated from Work Queue items. Feed should be lightweight telemetry (metadata only), with full content living only in Work Queue.

**Example:** GitHub Codex Orchestrator entry has identical multi-paragraph analysis in both Feed and Work Queue.

**Expected:** Feed has title + metadata fields only. Work Queue has full analysis content.

---

## Testing

After fixes, validate against the original test matrix:

| Test | Bug(s) Validated |
|------|-----------------|
| Send URL only → single confirmation | #1, #2 |
| Send URL + follow-up context → no false negative | #2 |
| Send ambiguous message → capture with reclassify option | #3 |
| Send BaT vehicle URL → Home/Garage pillar | #4 |
| Send cross-pillar research query → graceful Gemini failure | #5 |
| Send compound intent message → all intents handled | #6 |

Also run existing test suite: `bun run scripts/master-blaster.ts`

---

## Rollback Plan

Each fix should be independently revertable. If a fix causes regression:
1. Feature-flag the change (default: off)
2. Revert to previous behavior
3. Re-test with flag off to confirm clean state
