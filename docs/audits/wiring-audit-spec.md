# Atlas Infrastructure Wiring Audit — Execution Spec

**Purpose:** Systematically identify every declarative config entry (Notion System Prompts DB) and determine whether it's actually controlling runtime behavior, or whether hardcoded TypeScript is doing the job instead.

**Why this matters:** The entire declarative architecture exists so Jim can tune Atlas output by editing Notion pages — no code changes, no PRs, no deploys. Every bypassed entry is a stolen control surface. This audit maps what's connected and what's disconnected.

**Output:** A structured report (markdown table + detail sections) that becomes the remediation backlog.

---

## SETUP

```bash
# Work from the primary repo
cd C:\github\atlas

# Ensure clean state
git status
```

**System Prompts Database ID (SDK):** `2fd780a78eef817c9e48e6b6f98947c4`
*(Note: This is the Notion DB where all prompt slugs live. Query it to get the live slug inventory.)*

**Seed file (local fallback):** `apps/telegram/data/migrations/prompts-v1.json`

---

## PHASE 1: SLUG INVENTORY

### 1A. Collect all slugs from local seed file

```bash
# Extract all "id" values from prompts-v1.json
cat apps/telegram/data/migrations/prompts-v1.json | grep '"id"' | sed 's/.*"id": "//;s/".*//'
```

**Expected slugs (from seed file):**
- `drafter.default.capture`
- `drafter.the-grove.research`
- `drafter.default.research`
- `drafter.default.draft`
- `drafter.default.analysis`
- `drafter.default.summarize`
- `voice.grove-analytical`
- `voice.linkedin-punchy`
- `voice.consulting`

### 1B. Query live Notion System Prompts DB

Query the System Prompts database (`2fd780a78eef817c9e48e6b6f98947c4`) to get ALL entries, including any added after the seed migration. For each entry, record:
- ID (slug)
- Type/Capability
- Active status
- Pillar(s)
- Action/UseCase

**If you can access Notion via SDK:**
```typescript
const response = await notion.databases.query({
  database_id: '2fd780a78eef817c9e48e6b6f98947c4',
  page_size: 100,
});
// Extract: ID, Type, Active, Pillar, Action from each page
```

**If not, use the seed file as the authoritative list and note the limitation.**

### 1C. Also collect non-slug prompt patterns

Some prompts are fetched by property lookup rather than direct ID. Grep for these patterns:

```bash
# PromptManager property lookups (capability/pillar/useCase)
grep -rn "getPrompt(" packages/ apps/ --include="*.ts" | grep -v node_modules | grep -v ".test." | grep -v ".d.ts"

# Research-specific prompt IDs (depth-based)
grep -rn "research-agent\." packages/ apps/ --include="*.ts" | grep -v node_modules | grep -v ".test." | grep -v ".d.ts"
```

Record any additional prompt IDs referenced in code that aren't in the seed file (e.g., `research-agent.light`, `research-agent.standard`, `research-agent.deep`, or pillar-specific variants like `research-agent.the-grove.sprout-generation`).

---

## PHASE 2: CALL SITE MAPPING

For EVERY slug/ID found in Phase 1, determine whether it has a live call site in production code.

### 2A. Direct ID lookups

```bash
# getPromptById calls — the primary fetch pattern
grep -rn "getPromptById\|getPromptRecordById" packages/ apps/ --include="*.ts" | grep -v node_modules | grep -v ".test." | grep -v ".d.ts"

# composePrompts calls — the composition pattern
grep -rn "composePrompts\|composePrompt\|composeFromStructuredContext" packages/ apps/ --include="*.ts" | grep -v node_modules | grep -v ".test." | grep -v ".d.ts"

# resolveDrafterId / resolveVoiceId — ID construction
grep -rn "resolveDrafterId\|resolveVoiceId\|resolveDefaultDrafterId" packages/ apps/ --include="*.ts" | grep -v node_modules | grep -v ".test." | grep -v ".d.ts"
```

### 2B. Slug string literals

```bash
# Search for each slug as a string literal
for slug in "drafter.default.capture" "drafter.the-grove.research" "drafter.default.research" "drafter.default.draft" "drafter.default.analysis" "drafter.default.summarize" "voice.grove-analytical" "voice.linkedin-punchy" "voice.consulting"; do
  echo "=== $slug ==="
  grep -rn "$slug" packages/ apps/ --include="*.ts" | grep -v node_modules | grep -v ".test." | grep -v ".d.ts" | grep -v "prompts-v1.json"
done
```

### 2C. Composition service entry points

```bash
# Who calls the composition service?
grep -rn "composePrompt(" packages/ apps/ --include="*.ts" | grep -v node_modules | grep -v ".test." | grep -v ".d.ts" | grep -v "composer.ts"

# Who calls composeFromStructuredContext?
grep -rn "composeFromStructuredContext(" packages/ apps/ --include="*.ts" | grep -v node_modules | grep -v ".test." | grep -v ".d.ts" | grep -v "composer.ts"

# Who calls composePromptFromState?
grep -rn "composePromptFromState(" packages/ apps/ --include="*.ts" | grep -v node_modules | grep -v ".test." | grep -v ".d.ts" | grep -v "composer.ts"
```

### 2D. PromptManager instantiation points

```bash
# Where is getPromptManager() called?
grep -rn "getPromptManager()" packages/ apps/ --include="*.ts" | grep -v node_modules | grep -v ".test." | grep -v ".d.ts"
```

---

## PHASE 3: HARDCODED BYPASS DETECTION

This is the critical pass. Find every place where TypeScript code is doing work that a Notion entry was designed to control.

### 3A. Hardcoded prompt text / instructions

```bash
# Look for multi-line string constants containing prompt-like content
# These are the "stolen control surfaces"
grep -rn "const.*Instructions\|const.*Prompt\|const.*Guidelines\|const.*GUIDANCE\|const.*FALLBACK" packages/ apps/ --include="*.ts" | grep -v node_modules | grep -v ".test." | grep -v ".d.ts"

# Function definitions that return prompt content
grep -rn "function get.*Instructions\|function get.*Guidance\|function get.*Guidelines\|function build.*Prompt" packages/ apps/ --include="*.ts" | grep -v node_modules | grep -v ".test." | grep -v ".d.ts"

# Template literals containing instruction-like content (longer than 100 chars)
grep -rn '`.*You are\|`.*Your task\|`.*Instructions\|`.*##.*Research\|`.*##.*Writing' packages/ apps/ --include="*.ts" | grep -v node_modules | grep -v ".test." | grep -v ".d.ts"
```

### 3B. Known bypasses (from prior analysis — VERIFY these still exist)

Check these specific locations and document their current state:

| File | Function | Line (approx) | What it does | What should do the job instead |
|------|----------|---------------|--------------|-------------------------------|
| `packages/agents/src/agents/research.ts` | `getSummaryGuidance()` | ~816 | Hardcoded summary format per depth | Should come from drafter prompt |
| `packages/agents/src/agents/research.ts` | `getQualityGuidelines()` | ~827 | Hardcoded quality rules per depth | Should come from drafter prompt |
| `packages/agents/src/agents/research.ts` | `getDepthInstructions()` | ~800 | Hardcoded research instructions per depth | Notion: `research-agent.{depth}` |
| `packages/agents/src/agents/research.ts` | `buildResearchPrompt()` | ~730 | JSON output schema hardcoded | Should be drafter template structure |
| `packages/agents/src/agents/research.ts` | `FALLBACK_VOICE_DEFAULTS` | ~565 | Full voice instructions in TypeScript | Notion: `voice.*` entries |
| `packages/agents/src/agents/research.ts` | `getVoiceInstructions()` (sync) | deprecated | Sync-only fallback, never hits Notion | Should be removed, async-only |

```bash
# Verify each still exists
grep -n "getSummaryGuidance\|getQualityGuidelines\|getDepthInstructions\|FALLBACK_VOICE_DEFAULTS\|getVoiceInstructions" packages/agents/src/agents/research.ts
```

### 3C. Output format bypasses

The research agent defines its output as JSON schema in `buildResearchPrompt()`. This means Gemini returns `{summary, findings[], sources[]}` — a data dump format. The drafter template (`drafter.the-grove.research`) defines a prose narrative format (Key Signal → Evidence → Implications). Because the drafter is never invoked, the JSON schema wins and output is a data dump.

```bash
# Find all output format definitions (JSON schemas, format instructions)
grep -rn "Output Format\|json\nformat\|Response Format\|JSON format" packages/ apps/ --include="*.ts" | grep -v node_modules | grep -v ".test." | grep -v ".d.ts"

# Find where research output is consumed/formatted (the re-parsing chain)
grep -rn "parseResearchResponse\|formatResearchAsMarkdown\|convertMarkdownToNotionBlocks" packages/ apps/ --include="*.ts" | grep -v node_modules | grep -v ".test." | grep -v ".d.ts"
```

### 3D. Composition service — is it called from any live execution path?

The composition service (`packages/agents/src/services/prompt-composition/composer.ts`) may exist purely as dead infrastructure. Determine:

1. Is `composePrompt()` called from any file OTHER than tests and the composer itself?
2. Is `composeFromStructuredContext()` called from any live flow?
3. If yes — does the caller actually USE the returned prompt in a model call?

```bash
# Imports of composition functions
grep -rn "from.*composer\|from.*prompt-composition" packages/ apps/ --include="*.ts" | grep -v node_modules | grep -v ".test." | grep -v ".d.ts" | grep -v "index.ts"
```

---

## PHASE 4: EXECUTION PATH TRACING

For each execution path that DOES reference a slug or the composition service, trace whether the output actually reflects the Notion config.

### 4A. Research agent path

Trace the full chain:
1. Research is triggered (from where? grep for `runResearchAgent` or `executeResearch`)
2. `buildResearchPrompt()` constructs the prompt
3. Does it call `composePrompt()` or `composeFromStructuredContext()`? **Or does it build inline?**
4. Gemini generates response
5. `parseResearchResponse()` extracts structured data
6. `syncAgentComplete()` → `appendResearchResultsToPage()` writes to Notion
7. At what point does the drafter template shape the output? **Answer: it doesn't.**

```bash
# Where is research triggered?
grep -rn "runResearchAgent\|executeResearch" packages/ apps/ --include="*.ts" | grep -v node_modules | grep -v ".test." | grep -v ".d.ts" | grep -v "research.ts"

# Does buildResearchPrompt call any composition function?
grep -n "composePrompt\|composeFrom\|composeProm" packages/agents/src/agents/research.ts
```

### 4B. Content capture/draft path

```bash
# Where does capture/draft happen?
grep -rn "drafter.default.capture\|action.*capture\|action.*draft" packages/ apps/ --include="*.ts" | grep -v node_modules | grep -v ".test." | grep -v ".d.ts"
```

### 4C. Voice injection path

The research agent calls `getVoiceInstructionsAsync()` which DOES hit PromptManager. But:
- Does the voice text actually shape the output? Or does the hardcoded JSON schema override it?
- Is voice applied pre-generation (prompt injection) or post-generation (output formatting)?

```bash
# Voice loading in research
grep -n "voiceInstructions\|getVoiceInstructions" packages/agents/src/agents/research.ts
```

### 4D. Socratic/Intent path (for comparison — likely the best-wired path)

```bash
# How does the Socratic interview config get loaded?
grep -rn "gap.promptEntry\|socratic.*config\|interview.*config" packages/ apps/ --include="*.ts" | grep -v node_modules | grep -v ".test." | grep -v ".d.ts"
```

---

## PHASE 5: CHAIN TEST COVERAGE

For each Notion slug, check whether an existing test verifies the full chain (slug loaded → used in prompt → model output reflects template).

```bash
# Tests that reference prompt slugs
for slug in "drafter.default.capture" "drafter.the-grove.research" "drafter.default.research" "voice.grove-analytical" "voice.linkedin-punchy" "voice.consulting" "research-agent.standard" "research-agent.light" "research-agent.deep"; do
  echo "=== $slug ==="
  grep -rn "$slug" apps/telegram/test/ packages/ --include="*.test.ts" --include="*.test.js"
done

# Tests that verify composition pipeline
grep -rn "composePrompt\|composeFrom\|composePrompts" apps/telegram/test/ packages/ --include="*.test.ts"
```

---

## OUTPUT FORMAT

Generate a single markdown report with the following structure:

### Section 1: Slug Inventory Table

| Slug | Capability | Active | Source |
|------|-----------|--------|--------|
| `drafter.the-grove.research` | Drafter | Yes | Seed + Notion |
| ... | ... | ... | ... |

### Section 2: Wiring Status Table (THE KEY OUTPUT)

| Slug | Call Sites | Reachable? | Output Uses It? | Hardcoded Replacement | Status |
|------|-----------|-----------|----------------|----------------------|--------|
| `drafter.the-grove.research` | `composer.ts:42` via `resolveDrafterId()` | No — `composePrompt()` never called from research path | N/A | `buildResearchPrompt()` line 730 constructs prompt inline | 🔴 BYPASSED |
| `voice.grove-analytical` | `research.ts:590` via `getVoiceInstructionsAsync()` | Yes — loaded at runtime | Partial — injected into prompt but JSON schema overrides format | `FALLBACK_VOICE_DEFAULTS` at line 565 | 🟡 PARTIALLY WIRED |
| ... | ... | ... | ... | ... | ... |

**Status legend:**
- 🟢 **LIVE** — Slug loaded from Notion, shapes output, editing Notion changes behavior
- 🟡 **PARTIALLY WIRED** — Slug loaded but output doesn't fully reflect it (e.g., voice loaded but format overridden)
- 🔴 **BYPASSED** — Slug exists, may even have call sites, but hardcoded code does the actual work
- ⚫ **DEAD** — Slug exists in Notion, zero call sites anywhere in codebase
- 🔵 **TEST-ONLY** — Referenced only in test files, not production code

### Section 3: Hardcoded Bypass Inventory

For each 🔴 BYPASSED entry, document:

```
### [Slug]: drafter.the-grove.research

**Designed to control:** Research output structure, Grove thesis framing, quality standards
**Actually controls:** Nothing — never called during research execution

**Hardcoded replacement(s):**
1. `getSummaryGuidance()` at research.ts:816 — controls summary format per depth
2. `getQualityGuidelines()` at research.ts:827 — controls quality rules per depth  
3. `getDepthInstructions()` at research.ts:800 — controls research approach per depth
4. JSON schema in `buildResearchPrompt()` at research.ts:730 — forces {summary, findings[], sources[]} format

**Impact:** Jim cannot change research output quality, format, or Grove thesis alignment by editing Notion. Every change requires a code deploy.

**Remediation:** Wire buildResearchPrompt() through composePrompt() or directly fetch drafter via PromptManager, replacing inline instructions with Notion template.
```

### Section 4: Composition Service Status

Is the composition service (`composer.ts`) called from ANY live execution path?
- List every caller
- For each caller, is it reachable from a real user action (Telegram message, Chrome extension, etc.)?
- If no live callers exist, the entire composition service is dead infrastructure.

### Section 5: Chain Test Gaps

For each slug, document:
- Does a test exist that verifies the slug is loaded?
- Does a test exist that verifies the output reflects the slug's content?
- If not, this is a CONSTRAINT 6 violation.

---

## EXECUTION NOTES FOR CLAUDE CODE

1. **Run all greps from `C:\github\atlas\` root** (the primary worktree)
2. **Use PowerShell-compatible syntax** — adjust grep commands if needed (`Select-String` or use git bash)
3. **Do NOT modify any files** — this is a read-only diagnostic
4. **If a grep returns nothing, say so explicitly** — empty results are data
5. **Include line numbers in all results** — Jim needs to verify in context
6. **Don't summarize prematurely** — dump the raw grep output, THEN build the tables
7. **The report goes to `docs/audits/wiring-audit-YYYY-MM-DD.md`** in the repo

---

## WHAT THIS AUDIT DOES NOT COVER (future work)

- **Notion DB schema drift** — whether the System Prompts DB properties match what code expects
- **Runtime behavior validation** — actually running the bot and verifying output changes when Notion is edited
- **Performance impact** — whether PromptManager cache is working, Notion API latency
- **Chrome extension paths** — focus is on Telegram/agent paths for now

---

*Audit designed by Atlas PM. Execute on primary worktree, commit report to docs/audits/.*
