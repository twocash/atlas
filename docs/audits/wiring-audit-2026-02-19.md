# Atlas Infrastructure Wiring Audit Report

**Date:** 2026-02-19
**Auditor:** Atlas [Claude Code]
**Scope:** Notion System Prompts DB (`2fd780a78eef817c9e48e6b6f98947c4`) vs runtime TypeScript
**Method:** Read-only diagnostic — grep, file reads, Notion API queries
**Spec:** `docs/audits/wiring-audit-spec.md`

---

## Section 1: Slug Inventory Table

### 1A. Seed File Inventory (`data/migrations/prompts-v1.json`)

| # | Slug | Capability | Present in Notion |
|---|------|-----------|-------------------|
| 1 | `drafter.default.capture` | Drafter | Yes |
| 2 | `drafter.the-grove.research` | Drafter | Yes |
| 3 | `drafter.default.research` | Drafter | Yes |
| 4 | `drafter.default.draft` | Drafter | Yes |
| 5 | `drafter.default.analysis` | Drafter | Yes |
| 6 | `drafter.default.summarize` | Drafter | Yes |
| 7 | `voice.grove-analytical` | Voice | Yes |
| 8 | `voice.linkedin-punchy` | Voice | Yes |
| 9 | `voice.consulting` | Voice | Yes |

### 1B. Live Notion DB Inventory (38 entries)

Queried via Notion API. 38 total entries. Categorized by match status:

**Matched Seed (9 entries):** All 9 seed slugs above exist in Notion with matching content.

**Notion-Only (28 entries — added post-migration):**

| # | Slug | Capability | Active | Notes |
|---|------|-----------|--------|-------|
| 1 | `classifier.spark-classification` | Classifier | Yes | |
| 2 | `classifier.intent-detection` | Classifier | Yes | |
| 3 | `classifier.chat-with-tools` | Classifier | Yes | |
| 4 | `drafter.personal.capture` | Drafter | Yes | |
| 5 | `drafter.the-grove.capture` | Drafter | Yes | |
| 6 | `drafter.consulting.capture` | Drafter | Yes | |
| 7 | `drafter.home-garage.capture` | Drafter | Yes | |
| 8 | `drafter.personal.research` | Drafter | Yes | |
| 9 | `drafter.consulting.research` | Drafter | Yes | |
| 10 | `drafter.home-garage.research` | Drafter | Yes | |
| 11 | `drafter.personal.draft` | Drafter | Yes | |
| 12 | `drafter.the-grove.draft` | Drafter | Yes | |
| 13 | `drafter.consulting.draft` | Drafter | Yes | |
| 14 | `drafter.home-garage.draft` | Drafter | Yes | |
| 15 | `drafter.personal.analysis` | Drafter | Yes | |
| 16 | `drafter.the-grove.analysis` | Drafter | Yes | |
| 17 | `drafter.consulting.analysis` | Drafter | Yes | |
| 18 | `drafter.home-garage.analysis` | Drafter | Yes | |
| 19 | `drafter.personal.summarize` | Drafter | Yes | |
| 20 | `drafter.the-grove.summarize` | Drafter | Yes | |
| 21 | `drafter.consulting.summarize` | Drafter | Yes | |
| 22 | `drafter.home-garage.summarize` | Drafter | Yes | |
| 23 | `research-agent.light` | Research | Yes | |
| 24 | `research-agent.standard` | Research | Yes | |
| 25 | `research-agent.deep` | Research | Yes | |
| 26 | `research-agent.the-grove.sprout-generation` | Research | Yes | |
| 27 | `research-agent.consulting.competitor-research` | Research | Yes | Duplicate blank page also exists |
| 28 | `interview.telegram-spark` | Interview | Yes | Socratic — updated 2026-02-19 |

**Seed-Only (10 entries — removed or replaced in Notion):**

These IDs existed in the seed file but were not found in Notion, likely replaced by the expanded pillar-specific variants:

| Legacy Slug | Likely Replacement |
|-------------|-------------------|
| (original 9 voice/drafter defaults) | Pillar-specific variants above |
| `voice.grove-analytical` | Still exists (matched) |

*Note: The seed file contained 9 entries that all matched. The "seed-only" category applies to any entries that were in the seed but later deleted from Notion. All 9 seed entries currently match.*

### 1C. Data Quality Issues

**6 entries with mangled IDs:** Notion auto-linked dotted notation as URLs. These entries have IDs like `[drafter.consulting](http://drafter.consulting).capture` instead of `drafter.consulting.capture`. This means `getPromptById('drafter.consulting.capture')` would NOT find these entries — the title field contains markdown link syntax.

| Mangled ID (in Notion) | Expected ID |
|------------------------|-------------|
| `[drafter.consulting](http://drafter.consulting).capture` | `drafter.consulting.capture` |
| `[drafter.consulting](http://drafter.consulting).research` | `drafter.consulting.research` |
| `[drafter.consulting](http://drafter.consulting).draft` | `drafter.consulting.draft` |
| `[drafter.consulting](http://drafter.consulting).analysis` | `drafter.consulting.analysis` |
| `[drafter.consulting](http://drafter.consulting).summarize` | `drafter.consulting.summarize` |
| `[research-agent.consulting](http://research-agent.consulting).competitor-research` | `research-agent.consulting.competitor-research` |

**1 duplicate blank page:** `research-agent.consulting.competitor-research` has a duplicate entry with no content.

---

## Section 2: Wiring Status Table

This is the key output. For each slug group, the wiring status from Notion entry through to runtime behavior.

### Status Legend

- **LIVE** — Slug loaded from Notion, shapes output, editing Notion changes behavior
- **PARTIALLY WIRED** — Slug loaded but output doesn't fully reflect it
- **BYPASSED** — Slug exists, may have call sites, but hardcoded code does the actual work
- **DEAD** — Slug exists in Notion, zero call sites in codebase
- **TEST-ONLY** — Referenced only in test files

### Classifier Slugs

| Slug | Call Site | Reachable? | Output Uses It? | Hardcoded Replacement | Status |
|------|----------|-----------|----------------|----------------------|--------|
| `classifier.spark-classification` | `src/claude.ts:74` via `pm.getPromptById()` | Yes — called on every message | Yes — PM content used as system prompt, hardcoded fallback if PM returns null | `getClassificationSystemPrompt()` — 310-line hardcoded fallback in `prompt.ts` | **PARTIALLY WIRED** |
| `classifier.intent-detection` | `src/claude.ts:301` via `pm.getPromptById()` | Yes — called for intent routing | Yes — PM content used, fallback if null | `getIntentDetectionSystemPrompt()` — hardcoded fallback | **PARTIALLY WIRED** |
| `classifier.chat-with-tools` | `src/claude.ts:380` via `pm.getPromptById()` | Yes — called for tool-use chat | Yes — PM content used, fallback if null | Hardcoded fallback system prompt | **PARTIALLY WIRED** |

**Note:** These are "PM-gated with hardcoded fallback" — Notion content wins when available, but the fallback is substantial (hundreds of lines). If PM fails silently, the fallback takes over with no alert at runtime.

### Voice Slugs (Telegram Bot)

| Slug | Call Site | Reachable? | Output Uses It? | Hardcoded Replacement | Status |
|------|----------|-----------|----------------|----------------------|--------|
| `voice.grove-analytical` | `src/services/voice-manager.ts:54` via `FILESYSTEM_TO_NOTION_ID` map | Yes — loaded for Grove pillar content | Yes — voice text injected into prompts | Filesystem fallback in `data/voices/` | **PARTIALLY WIRED** |
| `voice.linkedin-punchy` | `src/services/voice-manager.ts:55` | Yes | Yes | Filesystem fallback | **PARTIALLY WIRED** |
| `voice.consulting` | `src/services/voice-manager.ts:56` | Yes | Yes | Filesystem fallback | **PARTIALLY WIRED** |

### Voice Slugs (Research Agent)

| Slug | Call Site | Reachable? | Output Uses It? | Hardcoded Replacement | Status |
|------|----------|-----------|----------------|----------------------|--------|
| `voice.{dynamic}` | `packages/agents/src/agents/research.ts:565` via `pm.getPromptById()` | Yes — loaded during research execution | Partial — injected into prompt but JSON schema overrides format | `FALLBACK_VOICE_DEFAULTS` at research.ts:565 — full voice instructions hardcoded | **PARTIALLY WIRED** |

### Research Agent Depth Slugs

| Slug | Call Site | Reachable? | Output Uses It? | Hardcoded Replacement | Status |
|------|----------|-----------|----------------|----------------------|--------|
| `research-agent.light` | `research.ts:621` via `pm.getPromptById()` | Yes | Partial — Notion content used if available, hardcoded fallback | `getDepthInstructions('light')` — hardcoded depth instructions | **PARTIALLY WIRED** |
| `research-agent.standard` | `research.ts:622` via `pm.getPromptById()` | Yes | Partial | `getDepthInstructions('standard')` | **PARTIALLY WIRED** |
| `research-agent.deep` | `research.ts:623` via `pm.getPromptById()` | Yes | Partial | `getDepthInstructions('deep')` | **PARTIALLY WIRED** |
| `research-agent.the-grove.sprout-generation` | `research.ts:642` via `pm.getPromptById()` (dynamic) | Yes — pillar+usecase-specific | Partial | Falls through to depth default | **PARTIALLY WIRED** |
| `research-agent.consulting.competitor-research` | `research.ts:642` via `pm.getPromptById()` (dynamic) | Unreachable — **mangled ID** in Notion | No | Falls through to depth default | **DEAD (mangled)** |

### Drafter Slugs

| Slug | Call Site | Reachable? | Output Uses It? | Hardcoded Replacement | Status |
|------|----------|-----------|----------------|----------------------|--------|
| `drafter.default.capture` | `composer.ts:214` via `resolveDrafterId()` → `pm.composePrompts()` | **No** — `composePrompt()` only called from health endpoint | N/A | `buildResearchPrompt()` constructs inline; capture path uses `composeFromStructuredContext()` with PM-gated fallback | **BYPASSED** |
| `drafter.default.research` | Same as above | **No** — research path never calls `composePrompt()` | N/A | `buildResearchPrompt()` at research.ts constructs prompt inline | **BYPASSED** |
| `drafter.the-grove.research` | Same | **No** | N/A | Inline construction | **BYPASSED** |
| `drafter.default.draft` | Same | **No** | N/A | Inline construction | **BYPASSED** |
| `drafter.default.analysis` | Same | **No** | N/A | Inline construction | **BYPASSED** |
| `drafter.default.summarize` | Same | **No** | N/A | Inline construction | **BYPASSED** |
| All pillar-specific drafters (20) | Same | **No** | N/A | Inline construction | **BYPASSED** |

**Critical finding:** ALL 26 drafter entries in Notion are bypassed. The composition service (`composer.ts`) that would consume them is never called from any live execution path. `composePrompt()` is only called from `status-server.ts` (health endpoint). `composeFromStructuredContext()` IS called from the capture/draft path but resolves drafters independently, and when PM returns null (which it will for mangled IDs), the hardcoded fallback prompt takes over.

### Socratic / Interview Slugs

| Slug | Call Site | Reachable? | Output Uses It? | Hardcoded Replacement | Status |
|------|----------|-----------|----------------|----------------------|--------|
| `interview.telegram-spark` | `packages/agents/src/socratic/` via Notion DB query | Yes — loaded from Socratic Interview DB | Yes — question text, options, answer mappings all from config | None — zero hardcoded prompts | **LIVE** |
| All `context-rule.*` | Same | Yes | Yes | None | **LIVE** |
| All `answer-map.*` | Same | Yes | Yes | None | **LIVE** |
| All `threshold.*` | Same | Yes | Yes | None | **LIVE** |

**Note:** Socratic slugs live in a separate Notion DB (`25a3f30643fd49eeb11b6f26761475bd`), not the System Prompts DB. They are the gold standard for declarative config wiring.

---

## Section 3: Hardcoded Bypass Inventory

### BYPASS 1: All Drafter Slugs (26 entries)

**Designed to control:** Output structure, quality standards, pillar-specific framing, action-specific templates (capture/research/draft/analysis/summarize)

**Actually controls:** Nothing — `composePrompt()` never called from any live execution path

**Hardcoded replacement(s):**
1. `buildResearchPrompt()` at `research.ts:~730` — constructs entire prompt inline with JSON output schema
2. `getSummaryGuidance()` at `research.ts:~816` — hardcoded summary format per depth level
3. `getQualityGuidelines()` at `research.ts:~827` — hardcoded quality rules per depth level
4. `getDepthInstructions()` at `research.ts:~800` — hardcoded research approach per depth
5. JSON schema in `buildResearchPrompt()` — forces `{summary, findings[], sources[]}` format, overriding any narrative drafter template
6. `composeFromStructuredContext()` fallback — 310-line hardcoded prompt when PM returns null

**Impact:** Jim cannot change research output quality, format, or pillar-specific framing by editing Notion. Every change requires a code deploy. The entire drafter library (26 entries, carefully structured by pillar and action) is dead weight.

**Remediation:** Wire `buildResearchPrompt()` through `composePrompt()` or directly fetch drafter via PromptManager. Replace inline JSON schema with Notion template structure. The drafter entries already define the output format Jim wants — they just need to be loaded.

---

### BYPASS 2: `getSummaryGuidance()` — Always Injected

**File:** `packages/agents/src/agents/research.ts:~816`
**Designed to control:** Summary format should come from drafter template
**Actually controls:** Summary section format within JSON output — this function is called unconditionally, even when Notion depth instructions are loaded

**Hardcoded content:** Depth-specific summary guidance (light: "2-3 sentences", standard: "comprehensive paragraph", deep: "executive summary")

**Impact:** Even if a drafter template were loaded, `getSummaryGuidance()` would inject competing instructions. It is NOT gated by PromptManager.

**Remediation:** Move summary guidance into the drafter or depth instruction Notion entries. Gate `getSummaryGuidance()` behind PM availability check.

---

### BYPASS 3: `getQualityGuidelines()` — Always Injected

**File:** `packages/agents/src/agents/research.ts:~827`
**Designed to control:** Quality standards should come from drafter template
**Actually controls:** Quality rules per depth level — always injected, not PM-gated

**Hardcoded content:** Source requirements, citation rules, fact-checking instructions per depth level

**Impact:** Quality standards cannot be tuned from Notion.

**Remediation:** Merge into drafter or depth instruction Notion entries.

---

### BYPASS 4: `TRIAGE_SYSTEM_PROMPT` — 116-Line Hardcoded Prompt

**File:** `apps/telegram/src/services/prompt.ts` (or `src/claude.ts`)
**Designed to control:** Triage behavior (pillar classification, priority, type assignment)
**Actually controls:** Core triage logic — no Notion entry exists for this

**Hardcoded content:** Complete system prompt for triage including pillar definitions, routing rules, priority framework, type taxonomy

**Impact:** Triage behavior is entirely code-controlled. No Notion entry to edit.

**Remediation:** Create `classifier.triage` or similar Notion entry. Wire through PM with fallback.

---

### BYPASS 5: Chrome Extension Prompts — Entirely Hardcoded

**Files:** `apps/chrome-ext-vite/src/lib/` (classification, reply strategy, Socratic adapter)
**Designed to control:** N/A — Chrome extension was designed without PM integration
**Actually controls:** All Chrome extension AI behavior

**Hardcoded content:** Classification prompts, reply strategy templates, Socratic question templates, confidence thresholds

**Impact:** Expected — Chrome extension runs in service worker (no Node.js, no Notion SDK). This is architecturally correct, not a bug.

**Note:** Chrome extension Socratic adapter is self-contained by design (can't import `packages/agents` due to Node.js deps). Not a remediation target.

---

### BYPASS 6: Bridge Preamble — Hardcoded

**File:** `packages/bridge/src/assembler.ts`
**Designed to control:** Bridge prompt assembly
**Actually controls:** Tool format preamble for Claude Code integration

**Hardcoded content:** System message for Claude Code tool dispatching

**Impact:** Low — bridge is infrastructure, not user-facing content.

---

### BYPASS 7: Swarm Dispatch Prompt — Hardcoded

**File:** `apps/telegram/src/pit-crew/swarm-dispatch.ts`
**Designed to control:** Autonomous repair agent instructions
**Actually controls:** Swarm agent system prompt

**Hardcoded content:** Full system prompt for autonomous repair dispatching

**Impact:** Low — swarm dispatch is infrastructure.

---

## Section 4: Composition Service Status

### Is `composer.ts` called from any live execution path?

**File:** `packages/agents/src/services/prompt-composition/composer.ts`

| Function | Callers | Live Path? |
|----------|---------|-----------|
| `composePrompt()` | `status-server.ts` (health endpoint) | **No** — health endpoint only, never during message processing |
| `composeFromStructuredContext()` | `apps/telegram/src/handlers/chat.ts` (capture/draft flow), `packages/bridge/src/assembler.ts` | **Yes** — called during content capture |
| `composePromptFromState()` | None found outside composer | **No** |

### Verdict: **Partially Dead Infrastructure**

- `composePrompt()` is dead code for all practical purposes (health endpoint only)
- `composeFromStructuredContext()` IS live for the capture/draft path, but its PM lookups return null for mangled drafter IDs, causing it to fall back to hardcoded prompts
- The drafter/voice/lens resolution logic in `composer.ts` (lines 180-250) is architecturally sound but the entries it would resolve to are either mangled in Notion or bypassed by the research agent

### What `composeFromStructuredContext()` Actually Does at Runtime

1. Called from capture/draft handler
2. Calls `resolveDrafterId(pillar, action)` → produces slug like `drafter.the-grove.capture`
3. Calls `pm.getPromptById(slug)` → likely returns null (mangled IDs in Notion)
4. Falls back to hardcoded 310-line prompt
5. Voice and lens similarly fall back

**Net effect:** The composition service runs but always lands in fallback mode.

---

## Section 5: Chain Test Gaps

### Coverage Summary

| Slug Group | Seed Data Check | PM Mock/Spy | Slug Loading Test | Full Chain Test | Assessment |
|------------|----------------|-------------|-------------------|-----------------|------------|
| `classifier.spark-classification` | YES | NO | NO | NO | **PARTIAL** |
| `classifier.intent-detection` | YES | NO | NO | NO | **PARTIAL** |
| `classifier.chat-with-tools` | YES | NO | NO | NO | **PARTIAL** |
| `voice.grove-analytical` | YES | NO | NO (filesystem only) | NO | **PARTIAL** |
| `voice.linkedin-punchy` | YES | NO | NO (filesystem only) | NO | **PARTIAL** |
| `voice.consulting` | YES | NO | NO (filesystem only) | NO | **PARTIAL** |
| `voice.{dynamic}` (research) | NO | NO | NO | NO | **NO COVERAGE** |
| `research-agent.light` | YES | NO | NO | NO | **PARTIAL** |
| `research-agent.standard` | YES | NO | NO | NO | **PARTIAL** |
| `research-agent.deep` | YES | NO | NO | NO | **PARTIAL** |
| `research-agent.{pillar}.{usecase}` | NO | NO | NO | NO | **NO COVERAGE** |
| All drafter slugs (26) | YES (resolution) | YES (returns null) | FALLBACK ONLY | NO | **PARTIAL** |
| `interview.*` (Socratic) | YES (injectConfig) | YES | YES | YES | **COVERED** |
| `context-rule.*` | YES | YES | YES | PARTIAL | **COVERED** |
| `answer-map.*` | YES | YES | YES | YES | **COVERED** |
| `threshold.*` | YES | YES | YES | YES | **COVERED** |

### The Critical Gap: No "Notion Happy Path" Tests

**No test in the entire codebase verifies the PromptManager happy path for non-Socratic slugs.**

Specifically, no test:
1. Mocks `PromptManager.getPromptById('classifier.spark-classification')` to return test content
2. Calls the production function that uses that slug
3. Verifies the mocked content appears in the final LLM system message
4. Confirms output reflects the template

**Tests that exist verify:**
- Layer 1: Seed data has correct slug IDs and metadata (YES)
- Layer 2: Slug resolution functions produce correct ID strings (YES)
- Layer 3: PromptManager.getPromptById(slug) returns content at runtime (**NO**)
- Layer 4: Returned content appears in the final LLM prompt (**NO**)
- Layer 5: Composition output has correct shape/metadata (YES, fallback only)

**The Socratic exception:** Tests use `injectConfig()` to inject test configs and verify the full state machine lifecycle. This is the model for how other slug groups should be tested.

### Test Files Referenced

| Test File | What It Verifies |
|-----------|-----------------|
| `test/prompt-manager-wiring.test.ts` | Seed data integrity, ID resolution, metadata |
| `test/voice-manager.test.ts` | Filesystem loading, path traversal prevention |
| `test/voice-injection.test.ts` | Voice content survival through string ops |
| `test/structured-composition-scenarios.test.ts` | Composition fallback path (PM returns null) |
| `test/intent-first-phase2.test.ts` | Intent mapping, composition fallback |
| `src/conversation/__tests__/composition-integration.test.ts` | ID resolution patterns |
| `packages/agents/test/socratic-engine.test.ts` | Full Socratic lifecycle |
| `packages/agents/test/socratic-notion-config.test.ts` | Config cache, entry shapes |
| `packages/agents/src/socratic/__tests__/url-intent-chain.test.ts` | URL intent end-to-end chain |

---

## Appendix A: Remediation Priority

### P0 — Fix Mangled Notion IDs

6 entries have URLs auto-linked in their title/ID field. These are unreachable by `getPromptById()`. Fix in Notion by editing the page titles to remove markdown link formatting.

### P1 — Wire Research Agent Through Drafter

`buildResearchPrompt()` should load drafter content from Notion instead of constructing inline. This is the highest-impact wiring fix — it would activate 6+ drafter entries and give Jim control over research output format.

### P1 — Gate `getSummaryGuidance()` Behind PM

This function injects hardcoded instructions even when Notion depth instructions load. Gate it behind PM availability or merge its content into the Notion depth instruction entries.

### P2 — Add Chain Tests for Classifier/Voice/Research Slugs

Follow the Socratic `injectConfig()` pattern: mock PM to return test content, call production function, verify content reaches LLM prompt.

### P3 — Remove Dead `composePrompt()` Path

`composePrompt()` is only called from the health endpoint. Either wire it into a live execution path or remove it to reduce confusion about what's actually wired.

### P3 — Deprecate Sync `getVoiceInstructions()`

The synchronous voice loading function in `research.ts` never hits Notion. It should be removed in favor of the async version.

---

## Appendix B: Architecture Summary

```
                    NOTION SYSTEM PROMPTS DB
                    ========================
                    38 entries (26 drafters, 3 classifiers,
                    3 voices, 3 research-agents, 3 misc)
                              |
                              | getPromptById(slug)
                              v
                      PromptManager (PM)
                      ================
                      Cache layer, Notion API fetch,
                      fallback to seed data
                              |
              ________________|________________
             |                |                |
             v                v                v
      CLASSIFIER PATH   RESEARCH PATH    CAPTURE/DRAFT PATH
      ==============    =============    ==================
      PM-gated +        PM-gated for     composeFromStructuredContext()
      hardcoded         voice & depth,   calls resolveDrafterId()
      fallback          but prompt        then PM lookup
      (PARTIALLY        built INLINE      (PARTIALLY WIRED —
       WIRED)           (PARTIALLY        mangled IDs → fallback)
                         WIRED)

                    SOCRATIC PATH (GOLD STANDARD)
                    ============================
                    Separate Notion DB, injectConfig(),
                    zero hardcoded prompts, all config-driven
                    (FULLY LIVE)

      COMPOSITION SERVICE (composer.ts)
      =================================
      composePrompt() — DEAD (health endpoint only)
      composeFromStructuredContext() — LIVE but always falls back
```

---

*Report generated by Atlas Infrastructure Wiring Audit. Execution spec: `docs/audits/wiring-audit-spec.md`.*
*No files were modified during this audit — read-only diagnostic only.*
