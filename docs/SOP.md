# Atlas Development SOPs

Standard operating procedures for Atlas development.

---

## SOP-001: Help System Updates

**Effective:** 2026-01-30  
**Scope:** All new commands, agents, and user-facing features

### Rule

**Every new user-facing capability MUST update the help system before merging.**

This is a required acceptance criterion for all PRs that add:
- New `/commands`
- New agent types
- New Telegram interactions
- Modified command syntax

### Process

1. **Add feature** — Implement the new capability
2. **Update help.ts** — Add entry to `apps/telegram/src/commands/help.ts`
3. **Verify** — Run `/help` and confirm new command appears
4. **Include in PR** — Help update must be in same commit/PR as feature

### Help Entry Format

```
/command <args>             — One-line description
  --flag                    — Optional flag explanation
```

**Guidelines:**
- Command left-aligned, description right-aligned with `—` separator
- Keep descriptions under 40 characters
- Group related commands under category headers
- New unreleased features go under "COMING SOON"

### Categories

| Category | What Goes Here |
|----------|----------------|
| RESEARCH & AGENTS | Agent commands, research, long-running tasks |
| MODEL SELECTION | Model switching, preferences |
| STATUS | System status, briefings, queue info |
| CONTENT | Draft, writing, content generation |
| CAPTURE | Expense, inbox, quick capture |
| SKILLS | Skill builder, custom agents |
| COMING SOON | Planned but not yet implemented |

### Acceptance Criteria Template

When writing specs for new features, include:

```markdown
### Acceptance Criteria

- [ ] Feature works as specified
- [ ] Tests pass
- [ ] **Help system updated** ← REQUIRED
- [ ] Documentation updated (if applicable)
```

### Enforcement

- PR reviewers should check for help.ts changes
- Missing help updates = PR blocked
- "Coming Soon" entries should be promoted when feature ships

---

## SOP-002: Command Naming Conventions

### Rules

1. **Lowercase only** — `/agent` not `/Agent`
2. **No underscores** — `/skill-new` not `/skill_new` (actually, prefer `/skill new`)
3. **Subcommands with space** — `/agent status` not `/agentstatus`
4. **Flags with double-dash** — `--thorough` not `-t`

### Examples

✅ Good:
```
/agent research "query"
/agent status
/model list
/skill new
/briefing now
```

❌ Bad:
```
/AgentResearch
/agent_status
/modelList
/skillNew
```

---

## SOP-003: Feature Shipping Checklist

Before marking any Work Queue item as "Done":

- [ ] Feature works in its target surface (Telegram / Chrome Extension / Bridge)
- [ ] Help system updated (SOP-001) (if Telegram command)
- [ ] **Run MASTER BLASTER verification (`bun run verify`)** ← REQUIRED (SOP-009)
- [ ] MASTER BLASTER covers ALL Atlas surfaces (Telegram + Chrome Ext + Bridge)
- [ ] Notion Work Queue item updated with Output link
- [ ] Tested on mobile/browser (if applicable)
- [ ] No console errors in bot/extension logs
- [ ] **Verify test coverage bug auto-created** (if Pit Crew feature)
- [ ] **New test files added to Master Blaster runner** (if new tests were created)

---

## SOP-004: Spike Tests with Production Environment

**Effective:** 2026-02-02
**Scope:** All integration tests, spike tests, and workflow verification

### Rule

**Spike tests MUST run with production environment variables to catch integration bugs.**

Running tests without proper environment variables has repeatedly caused bugs to slip through:
- Notion API calls fail silently or with misleading errors
- Optional fields appear to work but fail in production
- Token/credential issues masked as "null returns"

### Process

1. **Create spike test** — `test/[feature]-spike.ts`
2. **Load environment** — Use `.env` or explicit env loading
3. **Run with env** — Execute using production credentials
4. **Verify real integrations** — Notion, APIs should actually work

### Running Spike Tests

**Windows (PowerShell):**
```powershell
cd apps/telegram
$env:NOTION_API_KEY = (Get-Content .env | Select-String "NOTION_API_KEY" | ForEach-Object { $_.Line -replace 'NOTION_API_KEY=','' })
bun test/my-spike.ts
```

**Windows (One-liner with .env):**
```powershell
cd apps/telegram; foreach ($line in Get-Content .env) { if ($line -match "^([^=]+)=(.*)$") { [Environment]::SetEnvironmentVariable($matches[1], $matches[2]) } }; bun test/my-spike.ts
```

**Or use the npm script (recommended):**
```bash
cd apps/telegram
bun run spike test/my-spike.ts
```

### Spike Test Template

```typescript
/**
 * Spike Test: [Feature] Verification
 *
 * Run: bun run spike test/[feature]-spike.ts
 */

// Verify environment is loaded
if (!process.env.NOTION_API_KEY) {
  console.error('❌ NOTION_API_KEY not set. Load .env first.');
  process.exit(1);
}

// ... test code
```

### What to Verify

| Integration | What to Check |
|-------------|---------------|
| **Notion** | Create/read entries actually work, not just "no errors" |
| **Telegram** | Keyboard callbacks route correctly |
| **Claude/Gemini** | API calls return expected format |
| **External APIs** | Real responses, not mocked |

### Acceptance Criteria

For features with external integrations:

```markdown
### Acceptance Criteria

- [ ] Spike test created
- [ ] **Spike test passes with production env** ← REQUIRED
- [ ] All API calls verified (not just code paths)
- [ ] Error handling tested with real responses
```

### Failure Indicators

If you see these in spike tests, **STOP** — the feature is broken:
- `API token is invalid` — Wrong/missing NOTION_API_KEY
- `returned NULL` — Integration failure, not just missing optional field
- `object_not_found` — Wrong database ID (check CLAUDE.md canonical IDs)

---

## SOP-005: Pit Crew Collaboration Protocol

**Effective:** 2026-02-03
**Scope:** All Atlas ↔ Pit Crew work dispatches and collaboration

### Overview

Atlas and Pit Crew collaborate through Notion pages with rich, editable content. This enables:
- Real-time back-and-forth on requirements
- Human review before execution
- Full audit trail of decisions
- Agent-to-agent development at enterprise scale

### Rule 1: Page Body Content (Not Thread Property)

**All dispatch content MUST be written to the Notion page BODY, not the Thread property.**

❌ Wrong: Stuffing context into Thread property as escaped text
✅ Right: Structured blocks in page body (headings, callouts, paragraphs)

### Required Page Structure

When dispatching to Pit Crew, pages must include:

```
## 🤖 Atlas Analysis
> [Callout with reasoning/analysis]

## 📋 Task Specification
[Paragraphs with full requirements]

---

## 🔧 Pit Crew Work
(Placeholder for implementation notes)
```

### Rule 2: Message Threading

**Use `mcp__pit_crew__post_message` for collaboration, NOT creating new pages.**

Messages appear in the Notion page body as callout blocks:
- 🤖 Atlas messages (blue background)
- 🔧 Pit Crew messages (green background)
- 👤 Jim messages (default)

All messages include timestamps for audit trail.

### Rule 3: Status Updates Sync to Notion

**Use `mcp__pit_crew__update_status` to progress workflow.**

This tool:
1. Updates the Notion Status property
2. Appends a status change message to the page body

Status progression:
```
dispatched → in-progress → needs-approval → approved → deployed → closed
```

### Collaboration Workflow

```
1. DISPATCH: Atlas creates ticket with rich page body
   └─ Tool: mcp__pit_crew__dispatch_work
   └─ Result: Notion page with editable content

2. REVIEW: Jim reviews/edits specs in Notion
   └─ Human-in-the-loop refinement
   └─ Can modify requirements directly

3. CLARIFY: Pit Crew posts questions
   └─ Tool: mcp__pit_crew__post_message
   └─ Messages appear in page body

4. RESPOND: Atlas answers questions
   └─ Tool: mcp__pit_crew__post_message
   └─ Full conversation visible in Notion

5. APPROVE: Jim or Atlas approves approach
   └─ Tool: mcp__pit_crew__update_status → 'approved'
   └─ Status change logged in page

6. EXECUTE: Pit Crew implements
   └─ Documents work in "Pit Crew Work" section
   └─ Posts progress updates

7. DEPLOY: Mark as shipped
   └─ Tool: mcp__pit_crew__update_status → 'deployed'
   └─ Include output URL (commit, PR, etc.)
```

### MCP Tools Reference

| Tool | Purpose | Syncs to Notion |
|------|---------|-----------------|
| `dispatch_work` | Create new ticket | ✅ Creates page with body |
| `post_message` | Add to conversation | ✅ Appends callout block |
| `update_status` | Progress workflow | ✅ Updates property + message |
| `get_discussion` | Read full thread | ❌ Read-only |
| `list_active` | View open items | ❌ Read-only |

### Acceptance Criteria for Dispatches

```markdown
### Dispatch Checklist

- [ ] Page body has structured content (not Thread property)
- [ ] Atlas Analysis section included
- [ ] Task Specification is detailed enough for execution
- [ ] **Breadcrumb sections included (SOP-008)** ← REQUIRED
- [ ] Pit Crew Work section placeholder exists
- [ ] Discussion ID returned for future messages
- [ ] Notion URL returned for tracking
```

**NOTE:** All dispatches MUST follow SOP-008 breadcrumbs protocol.

### Auto-Bug Creation on Ship

When a feature or build is marked as `shipped` or `deployed`, the system automatically creates a "Test Coverage" bug in the Dev Pipeline. This ensures no feature ships without corresponding test coverage.

**Behavior:**
- Triggered automatically when `update_status` → `shipped` or `deployed`
- Only for `type: feature` or `type: build` discussions
- Creates linked bug: "Add test coverage for: [Feature Name]"
- Links to parent feature for context
- Can be disabled via `AUTO_CREATE_TEST_BUGS=false` env var

**See:** SOP-009 for the full Quality Gate Protocol

### Anti-Patterns

❌ **Don't** stuff all content into Thread property
❌ **Don't** create multiple tickets for same issue (use post_message)
❌ **Don't** update status without context (add message explaining why)
❌ **Don't** skip the review step for complex features
❌ **Don't** skip breadcrumb sections (User Value, Alternatives, Architecture Fit)

---

## SOP-006: Routing Confidence Protocol

**Effective:** 2026-02-03
**Scope:** All work dispatches through submit_ticket

### Rule

**When routing confidence is below 85%, present a choice to the user.**

Atlas must provide `routing_confidence` (0-100) with every dispatch. If uncertain:
- Don't auto-route to the wrong pipeline
- Present inline keyboard with both options
- Let the user decide: Pit Crew vs Work Queue

### When to Use Low Confidence

- Task could be bug fix OR feature request
- Task could be research OR build work
- Category is ambiguous from the request
- Multiple valid interpretations exist

### Implementation

The `submit_ticket` tool requires:
- `routing_confidence`: 0-100 (required)
- `alternative_category`: backup option if confidence < 85%

Example:
```json
{
  "category": "feature",
  "routing_confidence": 70,
  "alternative_category": "research",
  "title": "Investigate caching options"
}
```

If confidence < 85%, user sees:
```
⚠️ Routing Confidence: 70%

Task: Investigate caching options

[✨ Pit Crew (Feature)] [🔍 Work Queue (Research)]
                       [❌ Cancel]
```

---

## SOP-007: Notion Page Body Communication Standard

**Effective:** 2026-02-03
**Scope:** All Notion pages used for collaboration (Pit Crew, Work Queue, Feed)

### Rule

**Substantive content MUST go in the page BODY. Metadata fields are for metadata only.**

This enables:
- Easy reading and scanning by Jim, Atlas, and Pit Crew
- Structured discussions with proper formatting
- Rich context for problem-solving
- Searchable, navigable content

### What Goes Where

| Location | Content Type | Examples |
|----------|--------------|----------|
| **Page Body** | Substantive content | Requirements, analysis, discussions, verification notes, code snippets, decisions |
| **Status Property** | Workflow state | Dispatched, In Progress, Closed |
| **Priority Property** | Urgency level | P0, P1, P2 |
| **Type Property** | Classification | Bug, Feature, Research |
| **Assignee Property** | Who owns it | Atlas, Pit Crew, Jim |

### Body Structure Standards

Every substantive update to a Notion page should include:

```markdown
## 📋 Section Header

Clear description of what this section covers.

### Subsection (if needed)

| Column 1 | Column 2 | Column 3 |
|----------|----------|----------|
| Data     | Data     | Data     |

**Key Points:**
- Bullet point 1
- Bullet point 2

> Callout for important context or quotes

```code blocks for technical content```
```

### Required Sections for Dev Pipeline Tickets

Per SOP-008, all Dev Pipeline tickets MUST include:

| Section | Required | Purpose |
|---------|----------|---------|
| **🤖 Atlas Analysis** | ✅ | Initial reasoning |
| **📋 Task Specification** | ✅ | Requirements |
| **🎯 User Value** | ✅ | Why this matters to Jim |
| **🔀 Alternatives Considered** | ✅ | Options evaluated |
| **🏛️ Architecture Fit** | ✅ | Integration points |
| **🔧 Tech Debt** | If applicable | Known limitations |
| **🔧 Pit Crew Work** | ✅ | Implementation notes |

### Verification/Closure Format

When closing or verifying an item:

```markdown
---

## 🔧 Pit Crew Verification — [DATE]

> ✅ **VERIFIED FIXED** or ❌ **INVALID** or 📋 **TRIAGED**

**Evidence:**
- What was checked
- What was found
- Links to commits/PRs if applicable

**Resolution:** Brief summary of outcome

**Status → [New Status]**
```

### Anti-Patterns

❌ **Don't** put requirements in a "Notes" property field
❌ **Don't** stuff discussions into a "Thread" text property
❌ **Don't** use properties for long-form content
❌ **Don't** leave page body empty with all content in properties
❌ **Don't** write unstructured walls of text

### Good Examples

**Requirements in body:**
```markdown
## 📋 Requirements

| # | Requirement | Status |
|---|-------------|--------|
| 1 | Feature does X | ✅ Done |
| 2 | Feature handles Y | ⬜ Pending |

### Acceptance Criteria
- [ ] Criterion 1
- [ ] Criterion 2
```

**Triage notes in body:**
```markdown
## 📋 Triage Assessment

| Attribute | Value |
|-----------|-------|
| **Complexity** | Medium |
| **Dependencies** | Component X |
| **Value** | High |

**Decision:** Moving to backlog for Q2.
```

### Rationale

- **Jim** can quickly scan structured content in Notion
- **Atlas** can read and understand context for follow-up work
- **Pit Crew** has full requirements without hunting through properties
- **Search** works better on body content than property values
- **History** is preserved as the page evolves

---

## SOP-008: Agentic Breadcrumbs Protocol

**Effective:** 2026-02-03
**Scope:** All bug fixes, feature implementations, and Pit Crew dispatches

### Overview

Every bug fix and feature implementation MUST leave documentation breadcrumbs for future developers and agents. This enables:
- Future agents to understand WHY changes were made, not just WHAT
- Jim to review decisions without hunting through conversations
- Patterns to emerge from documented alternatives
- Tech debt to be tracked, not forgotten
- Code changes to be traceable to user value

### Rule 1: Code Comment Standard

For bug fixes and significant changes, include a comment block:

```typescript
// Fix: Brief description of what was fixed
// Ticket: https://notion.so/... OR discussion-id
// Commit: abc1234
```

For features:
```typescript
// Feature: Brief description
// Ticket: https://notion.so/...
// Commit: abc1234
```

### Rule 2: Required Notion Ticket Sections

Every Pit Crew dispatch MUST include these sections:

| Section | Purpose |
|---------|---------|
| **🎯 User Value** | What this unlocks for Jim |
| **🔀 Alternatives Considered** | Options evaluated with reasons for dismissal |
| **🏛️ Architecture Fit** | How it integrates with existing systems |
| **🔧 Tech Debt** | Known limitations, future work (if applicable) |

### Rule 3: Closure Documentation

**Bug Fix Closure:**
```markdown
## ✅ Resolution — [DATE]

**Root Cause:** [What caused the bug]
**Fix:** [What changed to fix it]
**Files Changed:**
- `path/to/file.ts` — [What was changed and why]
- `path/to/other.ts` — [What was changed and why]
**Commit:** [hash or PR link]
```

**Feature Closure:**
```markdown
## 🚀 Shipped — [DATE]

**Implementation:** [Key implementation details]
**Files Changed:**
- `path/to/file.ts` — [What was added and why]
- `path/to/other.ts` — [What was modified]
**Commit/PR:** [hash or PR link]
```

### Dispatch Template

Full template for Pit Crew dispatches (replaces basic template in SOP-005):

```markdown
## 🤖 Atlas Analysis
> [Reasoning and analysis of the problem/feature]

## 📋 Task Specification
[Detailed requirements and acceptance criteria]

## 🎯 User Value
What this unlocks for Jim:
- [Benefit 1]
- [Benefit 2]

## 🔀 Alternatives Considered
| Option | Pros | Cons | Decision |
|--------|------|------|----------|
| [Alt 1] | ... | ... | Selected/Dismissed |
| [Alt 2] | ... | ... | Selected/Dismissed |

## 🏛️ Architecture Fit
- [How it integrates with existing system]
- [Patterns it follows]
- [Dependencies it touches]

## 🔧 Tech Debt (if applicable)
- [ ] [Known limitation or future work item]
- [ ] [Another item to address later]

---

## 🔧 Pit Crew Work
(Implementation notes go here)
```

### Anti-Patterns

❌ **Don't** skip the User Value section — every change should trace to user benefit
❌ **Don't** omit Alternatives — document what you considered even if obvious
❌ **Don't** leave Tech Debt undocumented — track it or fix it
❌ **Don't** close tickets without Resolution/Shipped sections

### Cross-References

- **SOP-005:** All Pit Crew dispatches follow this breadcrumbs protocol
- **SOP-007:** Page body structure must include breadcrumb sections

---

## SOP-009: Quality Gate Protocol (MASTER BLASTER)

**Effective:** 2026-02-03
**Scope:** All feature development, before human testing

### Overview

MASTER BLASTER is Atlas's unified quality verification system. It chains ALL test suites across the FULL Atlas surface — Telegram bot, Chrome Extension, Bridge, and cross-cutting integrations — into a single command that MUST pass before any feature goes to human testing.

**Vision:** Ship feature → Auto-bug for test coverage → Run MASTER BLASTER → Pass → Human testing

**Philosophy:** Loud, informative fails — not silent fallbacks. Every surface of Atlas is verified end-to-end.

### Rule: No Ship Without Verification

**Every feature MUST pass `bun run verify` before marking as Done or Shipped.**

This is a hard gate. Do not proceed to human testing with failing tests.

### Commands

```bash
# Default: All surfaces, strict mode (fallbacks disabled)
bun run verify

# Quick: Unit + regression + chrome ext unit (fast feedback)
bun run verify:quick

# Full: All suites including E2E + Playwright bridge
bun run verify:full
```

### Pre-Human Testing Checklist

1. [ ] Feature code complete and committed
2. [ ] Run `bun run verify` - ALL tests must pass
3. [ ] If Pit Crew feature: Verify test coverage bug was auto-created
4. [ ] Review MASTER BLASTER output for warnings
5. [ ] Only then proceed to human testing

### Test Suites

#### Telegram Bot Surface (`apps/telegram/`)

| Suite | Runner | What It Tests |
|-------|--------|---------------|
| **Canary Tests** | `scripts/canary-tests.ts` | Silent failures, degraded output |
| **Unit Tests** | `bun test` | Individual functions/classes |
| **Regression Tests** | `test/*.test.ts` (9 files) | Bug regressions, intent-first, composition |
| **Action Feed Producers** | `test/action-feed-producers.test.ts` | P2/P3 approval + review producers |
| **Intent-First Integration** | `test/intent-first-integration.test.ts` | Full intent routing flow |
| **Autonomous Repair (Pit Stop)** | Inline | Zone classifier, swarm dispatch, permissions |
| **Smoke Tests** | `scripts/smoke-test-all.ts` | All APIs, tools, integrations |
| **E2E Tests** | `src/health/test-runner.ts` | End-to-end workflows |
| **Integration** | Inline | Health checks, Notion, Claude API |

#### Chrome Extension Surface (`apps/chrome-ext-vite/`)

| Suite | Runner | What It Tests |
|-------|--------|---------------|
| **Unit Tests** | `test/dom-to-notion.test.ts` + `test/ai-classification.test.ts` | DOM extraction, Notion sync, 4-tier AI classification |
| **Build Verification** | `node build.mjs` | esbuild content scripts + Vite sidepanel build clean |

#### Bridge Surface (`packages/bridge/`)

| Suite | Runner | What It Tests |
|-------|--------|---------------|
| **Tool Dispatch Pipeline** | `test/tool-dispatch-pipeline.test.ts` | Schema validation, MCP routing, protocol contracts |
| **Bridge Stability (Playwright)** | `test-bridge-stability.mjs` | WebSocket relay, Chrome extension integration |

### Canary Tests (Silent Failure Detection)

**Purpose:** Detect "works but wrong" scenarios where the system appears functional but produces degraded or hallucinated output.

**What Canaries Catch:**
- System prompts that load but are missing critical content
- Tools that return `success: true` but with empty/default data
- Fallbacks that silently replace real data with placeholders
- Missing identity phrases (SOUL content not properly injected)
- Configuration drift (wrong database IDs, missing env vars)

**Run Canaries Directly:**
```bash
bun run verify:canary
```

**Canaries are included in default and full verify modes.**

### Pipeline E2E Tests (Full Pipeline Verification)

**Purpose:** Verify pipelines produce **real, fulsome output** end-to-end, not just "success: true" with empty data.

**What Pipeline Tests Verify:**
- Research agent returns real results (not placeholder URLs)
- Summary meets minimum quality thresholds
- Findings have actual source citations
- Grounding was used (not training data)
- Output structure is complete
- **Notion body verification** (with `--with-notion`):
  - Creates test Work Queue item
  - Writes research results to page body
  - Verifies content landed correctly (summary, findings, sources)
  - Automatically archives test page when done

**Run Pipeline Tests:**
```bash
# Dry run - validate setup only (no API costs)
bun run verify:pipeline:dry

# Light research test (~$0.001, 3-10 seconds)
bun run verify:pipeline

# Include Notion body verification (creates/verifies/archives test page)
bun run verify:pipeline:notion

# Include standard depth test (~$0.01, 30-60 seconds)
bun run verify:pipeline --standard

# Full verification with both Notion and standard depth
bun run verify:pipeline --with-notion --standard
```

**Quality Thresholds:**
| Depth | Min Summary | Min Findings | Min Sources |
|-------|-------------|--------------|-------------|
| light | 100 chars | 2 | 2 |
| standard | 500 chars | 5 | 4 |
| deep | 1500 chars | 8 | 8 |

**When to Run:**
- Before major releases
- After changes to research agent
- When debugging "research works but output is empty"

**NOT included in default verify** (costs API tokens).

### Test Authoring Rules

**Environment:** All tests run via `bun run verify` which loads `.env` from `apps/telegram/.env` and sets `ENABLE_FALLBACKS=false`. Production env vars (API keys, database IDs) are required for integration and smoke suites.

**CWD Contract:** `bun test` runs from `apps/telegram/`. Tests that reference filesystem paths MUST use `process.cwd()` or CWD-relative paths, NOT `__dirname`. Reason: bun bundles test files and `__dirname` resolves to the bundle location, not the source file.

**Vitest Contamination:** Some legacy tests import `vitest` (which is not installed). When `bun test` runs all files together, `vi.mock()` calls contaminate the Node `fs` module for other test files in the same process. New tests MUST use `Bun.file()` API instead of `fs.readFileSync()` to avoid this. See `architecture.test.ts` for the pattern.

**Fallbacks:** Master Blaster runs with `ENABLE_FALLBACKS=false` by default. This is the correct mode. Do NOT test with fallbacks enabled unless explicitly debugging a fallback path.

### On Test Failure

1. **Fix the failing test** OR
2. **If test is flaky/invalid:** Create bug to fix test
3. **Re-run MASTER BLASTER**
4. **Do NOT proceed** to human testing with failures

### Auto-Bug Creation

When a feature is shipped via Pit Crew (`update_status → shipped/deployed`):
- System auto-creates: "Add test coverage for: [Feature Name]"
- Links to parent feature
- Type = "Test Coverage", Priority = P2
- Controlled by `AUTO_CREATE_TEST_BUGS` env var (default: true)

### Exit Codes

- `0` = All tests passed (proceed to human testing)
- `1` = Failures detected (fix before proceeding)

### MASTER BLASTER Output Format

```
====================================
   MASTER BLASTER VERIFICATION
====================================

[1/4] Running Unit Tests...
  [PASS] 23 passed, 0 failed

[2/4] Running Smoke Tests...
  [PASS] 56 passed, 0 failed

[3/4] Running E2E Tests...
  [PASS] 12 passed, 0 failed

[4/4] Running Integration Tests...
  [PASS] 4 passed, 0 failed

====================================
   RESULT: ALL SYSTEMS GO
====================================
```

### Integration with SOPs

- **SOP-003:** Feature Shipping Checklist now requires MASTER BLASTER
- **SOP-005:** Pit Crew ships auto-create test coverage bugs
- **SOP-008:** Breadcrumbs include test coverage requirements

### Telegram Skill

```
/verify        — Run MASTER BLASTER verification
```

---

## SOP-013: Atlas Stack Startup

**Effective:** 2026-02-18
**Updated:** 2026-02-27 (auto-start via Task Scheduler, two .env files, Docker service auto-start)
**Scope:** Starting the Atlas production stack for a dev or monitoring session

### Overview

The Atlas production stack has 4 components. On reboot, the full chain starts automatically
via Windows Task Scheduler + Docker service. No manual intervention required.

### Components

| # | Component | Purpose | Start Method |
|---|-----------|---------|-------------|
| 1 | Docker + AnythingLLM | RAG document search | Docker service (auto) + container `--restart always` |
| 2 | Ollama | Embedding engine | Windows service (auto) |
| 3 | Telegram Bot | Handles messages from Jim's phone | Task Scheduler: `Atlas Telegram Bot` (+90s delay) |
| 4 | Bridge Server | Claude Code ↔ Chrome Extension WebSocket | Task Scheduler: `Atlas Bridge` (+120s delay) |

### Reboot Chain (Zero-Touch)

On reboot, everything starts automatically in order:

1. **Windows services start**: Docker service (`com.docker.service`, set to `auto`) + Ollama service
2. **Docker Desktop starts**: `AutoStart: true` in `%APPDATA%\Docker\settings-store.json`
3. **AnythingLLM container starts**: `--restart always` policy (port 3001)
4. **+90s: Atlas Telegram Bot starts**: visible terminal window via Task Scheduler
5. **+120s: Atlas Bridge starts**: visible terminal window via Task Scheduler

The delays give Docker + Ollama time to initialize before the bot/bridge try to connect.

### Environment Variables

**Two .env files, two purposes:**

| File | Contents | Who reads it |
|------|----------|-------------|
| `C:\github\atlas\.env` (root) | `ANYTHINGLLM_URL`, `ANYTHINGLLM_API_KEY` | Bot, Bridge, rag-sync.ts |
| `apps/telegram/.env` | `TELEGRAM_BOT_TOKEN`, `NOTION_API_KEY`, `ANTHROPIC_API_KEY`, etc. | Bot, Bridge |

**Loading order (both startup scripts AND dotenv in code):**
1. Root `.env` loaded FIRST (infra vars)
2. `apps/telegram/.env` loaded SECOND (API keys)
3. dotenv won't overwrite - first file wins for shared keys
4. System-level env vars take precedence over both

**WARNING - ENV VAR TRAP (burned 4 times):** If a stale shell has cached env vars, they override .env files. Fix: start a fresh shell or `unset` the offending var. Do NOT rearchitect the loading chain.

### Manual Start (Without Reboot)

```powershell
# Start via Task Scheduler (same as reboot would)
Start-ScheduledTask -TaskName 'Atlas Telegram Bot'
Start-ScheduledTask -TaskName 'Atlas Bridge'

# Or start directly in current terminal
.\start-telegram.ps1    # Bot
.\start-bridge.ps1      # Bridge
```

### Task Scheduler Management

```powershell
# View all Atlas tasks
Get-ScheduledTask -TaskName 'Atlas*' | Format-Table TaskName, State

# Stop/Start individual tasks
Stop-ScheduledTask -TaskName 'Atlas Telegram Bot'
Start-ScheduledTask -TaskName 'Atlas Telegram Bot'

# Re-install tasks (requires admin)
powershell -ExecutionPolicy Bypass -File scripts\install-atlas-startup-tasks.ps1
```

### Log Files

Both start scripts write logs to:

```
C:\github\atlas\apps\telegram\data\logs\
  atlas-bot.log       <- Telegram bot stdout
  atlas-bridge.log    <- Bridge server stdout
```

**Note:** Log files are UTF-16 encoded. Use PowerShell for searching:
```powershell
Get-Content -Encoding Unicode 'C:\github\atlas\apps\telegram\data\logs\atlas-bot.log' -Tail 50
```

Standard `grep` will NOT work on these files.

### Stopping the Stack

- **Bot:** `Stop-ScheduledTask -TaskName 'Atlas Telegram Bot'` or Ctrl+C in terminal
- **Bridge:** `Stop-ScheduledTask -TaskName 'Atlas Bridge'` or Ctrl+C in terminal
- **AnythingLLM:** `docker stop anythingllm` (auto-restarts on next Docker start)

### Health Check

Bot startup runs a comprehensive health check (32 checks) including:
- ENV: all required vars present
- Notion: Feed 2.0 + Work Queue 2.0 accessible
- Claude: Sonnet + Haiku connected
- **RAG: AnythingLLM online + per-workspace doc counts** (delegated to Bridge's shared `healthCheck()`)
- Data: SOUL.md, USER.md, MEMORY.md, voice configs

If RAG is offline, the bot continues but injects `[RAG offline - answering without client docs]` into responses (Constraint 4).

### When to Skip the Bridge

The bridge is only needed when using the Atlas Chrome Extension's Claude panel.
If you're only using Telegram, you can skip starting the bridge.

### Switching Between Production and Dev

Production bot runs from `C:\github\atlas\` (master branch).
Dev work happens in a worktree. See Constraint 7.

### Acceptance Criteria

- [ ] Bot responds to Telegram messages
- [ ] Bridge responds on `ws://localhost:3848` (if started)
- [ ] Bridge identity fully hydrated (constitution, soul, user, memory, goals)
- [ ] AnythingLLM online with doc counts > 0 in health check
- [ ] Log files are being written under `data/logs/`
- [ ] Health check shows 32/32 pass

---

## SOP-010: Notion Database ID Immutability

**Effective:** 2026-02-04
**Scope:** All Notion API integration code

### Overview

Database IDs in the codebase are IMMUTABLE and must NEVER be changed without explicit approval and validation.

### Background

Atlas uses TWO different types of IDs for the SAME Notion database:
- **Database PAGE IDs** (for `@notionhq/client` SDK)
- **DATA SOURCE IDs** (for Notion MCP plugin with `collection://` URLs)

Confusion between these two types has caused "object_not_found" errors 25+ times.

### Canonical Database IDs

**For Notion SDK (`@notionhq/client`) - NEVER CHANGE THESE:**
```typescript
// Use these in all code that calls the Notion API
const FEED_DATABASE_ID = '90b2b33f-4b44-4b42-870f-8d62fb8cbf18';
const WORK_QUEUE_DATABASE_ID = '3d679030-b76b-43bd-92d8-1ac51abb4a28';
const DEV_PIPELINE_DATABASE_ID = 'ce6fbf1b-ee30-433d-a9e6-b338552de7c9';
```

**For Notion MCP plugin ONLY - DIFFERENT IDs:**
```typescript
// Use these only with Notion MCP plugin tools
// Feed 2.0: a7493abb-804a-4759-b6ac-aeca62ae23b8
// Work Queue 2.0: 6a8d9c43-b084-47b5-bc83-bc363640f2cd
```

### Contract

1. ❌ NEVER change database IDs in code without documenting why
2. ❌ NEVER "fix" IDs by swapping PAGE IDs for DATA SOURCE IDs
3. ✅ ALWAYS use PAGE IDs for Notion SDK code
4. ✅ ALWAYS use DATA SOURCE IDs for MCP plugin references
5. ✅ ALWAYS verify which context you're in before changing IDs
6. ✅ ALWAYS update CLAUDE.md if a database is renamed/recreated

### When "object_not_found" Occurs

**The problem is almost NEVER:**
- ❌ "Integration needs to be shared with the database"
- ❌ "Check Notion settings > Connections"

**The problem is almost ALWAYS:**
- ✅ Code is using the WRONG database ID (drift toward legacy IDs)
- ✅ A file still references Inbox 2.0 or other deprecated databases
- ✅ Code is using DATA SOURCE IDs where it should use PAGE IDs

### Before Changing Any Database ID

1. Run validation test against the new ID
2. Document which context requires which ID type
3. Update canonical ID list in CLAUDE.md
4. Grep codebase for all references to old ID
5. Get explicit approval

### Historical Context

- **Jan 30, 2026**: Commit f014058 incorrectly changed PAGE IDs to DATA SOURCE IDs
- **Jan 30, 2026**: Commit a0b6ff7 correctly reverted back to PAGE IDs
- **Lesson**: Database access works with PAGE IDs for SDK, not DATA SOURCE IDs

### Validation Script

Before deploying any database ID changes:

```bash
cd packages/agents
bun validate-workqueue-bug.ts  # or equivalent test
```

If the validation fails, DO NOT DEPLOY.

### Cross-References

- **CLAUDE.md**: Canonical database IDs section
- **apps/telegram/CLAUDE.md**: Same canonical IDs
- **SOP-004**: Spike tests with production environment

---

---

## SOP-011: Self-Improvement Pipeline Protocol

**Added:** 2026-02-05
**Context:** Autonomous skill repair via Feed 2.0 → Self-Improvement Listener → Swarm Dispatch

### Purpose

Atlas has a self-healing pipeline that autonomously detects and fixes certain classes of bugs. This SOP documents when and how to tag bugs for autonomous repair, how the pipeline works, and how to moderate the queue strategically.

### Pipeline Overview

```
Feed 2.0 (Keywords: "self-improvement")
    ↓ polled every 15 seconds
Self-Improvement Listener (src/listeners/self-improvement.ts)
    ↓ parses entry, extracts target files
Zone Classifier (src/skills/zone-classifier.ts)
    ↓ Zone 1: auto-execute | Zone 2: auto-notify | Zone 3: approve
Swarm Dispatch (src/pit-crew/swarm-dispatch.ts)
    ↓ spawns Claude Code CLI session (300s timeout)
    ↓ success → mark Feed entry "Dispatched"
    ↓ failure → create Work Queue item for manual handling
```

### What Qualifies for Self-Improvement Tagging

**Tag with `self-improvement` keyword when ALL of these are true:**

1. **Bounded scope** — The fix touches specific, identifiable files (not "refactor the whole system")
2. **Clear specification** — The fix can be described precisely enough for an automated agent to execute
3. **Low blast radius** — Failure won't corrupt data, break production, or cascade
4. **Verifiable** — Success can be detected (file exists, frontmatter parses, test passes)

**Qualifying bug categories:**

| Category | Example | Zone |
|----------|---------|------|
| Missing file content | SKILL.md missing YAML frontmatter | Zone 1 (auto-execute) |
| Config drift | skill.yaml has wrong tier value | Zone 1 (auto-execute) |
| Schema mismatches | Property name typo in Notion writes | Zone 2 (auto-notify) |
| Test fixtures | Test data out of sync with schema | Zone 2 (auto-notify) |
| Documentation gaps | Missing JSDoc on public APIs | Zone 1 (auto-execute) |

**DO NOT tag with `self-improvement`:**

| Category | Reason |
|----------|--------|
| Architecture changes | Too broad, needs human design review |
| New features | Requires product decision |
| Security fixes | Needs careful human review |
| Database migrations | Risk of data loss |
| Multi-service changes | Cross-system coordination needed |

### Feed Entry Format for Self-Improvement

When creating a Feed 2.0 entry for autonomous repair:

```
Title: [verb] [what] in [where]
  e.g. "fix SKILL.md missing frontmatter in 5 skills"

Keywords: self-improvement (REQUIRED)
Pillar: The Grove (or appropriate pillar)
Request Type: Bug
Status: New

Body content MUST include:
1. Specific file paths (matching pattern: src/ or data/)
2. What the fix should do
3. What "done" looks like
4. Tier classification (0, 1, or 2)
```

### Queue Moderation Strategy

**Capacity limits:**
- Maximum 3 concurrent swarm sessions (prevents resource exhaustion)
- Maximum 10 entries in the dispatched set (prevents runaway queuing)
- 300-second timeout per swarm session (prevents hanging)

**Priority ordering:**
- Process entries in the order Feed 2.0 returns them (newest first by default)
- P0 bugs with `self-improvement` tag get natural priority from Feed ordering

**Backpressure:**
- If swarm sessions consistently timeout, STOP creating new self-improvement entries
- Investigate why sessions fail before adding more work
- Timeout → auto-creates Work Queue item → human reviews the failure

**Throttling rules:**
- Don't flood the Feed with self-improvement entries — batch related fixes into one entry
- One entry per logical bug (e.g., "5 skills missing frontmatter" = 1 entry, not 5)
- Wait for current swarm to finish before queuing the next self-improvement entry

### Monitoring

**Signs the pipeline is healthy:**
- Feed entries move from "New" → "Dispatched" within 5 minutes
- Swarm sessions complete (not timeout) > 80% of the time
- Work Queue fallback items are rare (< 20% of dispatches)

**Signs the pipeline needs attention:**
- Multiple consecutive timeouts → swarm prompts may be too broad
- "Found self-improvement entries" count stuck at same number → entries not being processed
- Work Queue filling up with "[Auto]" prefixed items → swarm reliability issue

### Cross-References

- **Listener code:** `src/listeners/self-improvement.ts`
- **Zone classifier:** `src/skills/zone-classifier.ts`
- **Swarm dispatch:** `src/pit-crew/swarm-dispatch.ts`
- **Feature flags:** `ATLAS_SELF_IMPROVEMENT_LISTENER`, `ATLAS_SWARM_DISPATCH`
- **SOP-005:** Pit Crew Collaboration Protocol (manual fallback path)
- **docs/AUTONOMY.md:** Complete permission model

---

## SOP-012: Bug Logging Protocol (Dev Pipeline)

**Effective:** 2026-02-08
**Scope:** All bugs, defects, and code quality issues discovered during development, monitoring, or code review

### Overview

Every bug discovered in the Atlas codebase MUST be logged to the **Dev Pipeline 2.0** Notion database via Pit Crew dispatch. No bug should exist only in a conversation, memory, or TODO comment — the Dev Pipeline is the single source of truth for all known defects.

### Rule: All Bugs Go to Dev Pipeline

**Every bug MUST be dispatched to the Dev Pipeline via `mcp__pit_crew__dispatch_work`, regardless of severity.**

This includes:
- Production errors caught in bot monitoring
- Code quality issues found during review
- Silent failures or misleading behavior
- Memory leaks, race conditions, error handling gaps
- Stale code, dead code paths, configuration drift
- Log quality issues that impede debugging

### Bug Discovery Sources

| Source | When It Happens | Who Dispatches |
|--------|-----------------|----------------|
| **Production monitoring** | Watching live bot logs | Atlas (monitoring session) |
| **Code review** | Strategic codebase scans | Atlas (review session) |
| **Test failures** | MASTER BLASTER failures | Atlas (auto or manual) |
| **User reports** | Jim reports via Telegram | Atlas (triage session) |
| **Self-improvement listener** | Autonomous detection | Atlas (auto-dispatch) |

### Grouping Rules

**Consolidate bugs by functional area when they share:**
- Same file or module
- Same root cause
- Same fix approach
- Logical dependency (fixing one requires fixing the other)

**Keep bugs separate when:**
- Different root causes even if same file
- Different fix complexity (don't bury a trivial fix in a medium ticket)
- Different priority levels

### Required Fields for Bug Dispatches

| Field | Value | Notes |
|-------|-------|-------|
| **title** | `[Area] Brief description` | e.g. "Memory leaks in context manager and content flow" |
| **priority** | P0-P3 | P0=today, P1=this week, P2=this month, P3=backlog |
| **body** | Full SOP-008 breadcrumbs | See template below |

### Bug Dispatch Body Template

```markdown
## Bug Report

### Problem
[Clear description of the bug(s)]

### Impact
- **Severity:** [Critical/High/Medium/Low]
- **Blast radius:** [What's affected]
- **User impact:** [How Jim is affected]

### Root Cause
[Technical analysis of why this happens]

### Bugs in This Ticket
| # | Bug | File:Line | Effort | Impact |
|---|-----|-----------|--------|--------|
| 1 | Description | path:line | Trivial/Small/Med | High/Med/Low |

### Suggested Fix
[Specific code changes or approach]

### Evidence
[Log output, stack traces, or code snippets that prove the bug]

### Test Plan
- [ ] How to verify the fix works
- [ ] Regression prevention

## 🎯 User Value
[Why fixing this matters to Jim]

## 🏛️ Architecture Fit
[How the fix integrates with existing patterns]
```

### Priority Guidelines

| Priority | Criteria | SLA |
|----------|----------|-----|
| **P0** | Data loss, security, production down | Fix today |
| **P1** | User-facing bugs, safety limits | Fix this week |
| **P2** | Code quality, memory leaks, log noise | Fix this month |
| **P3** | Tech debt, dead code, cosmetic | Backlog |

### Anti-Patterns

❌ **Don't** leave bugs only in conversation context — they'll be lost
❌ **Don't** put bugs in TODO comments without a Dev Pipeline ticket
❌ **Don't** log the same bug twice — search Dev Pipeline first
❌ **Don't** skip the body template for "trivial" bugs — document everything
❌ **Don't** mix P0 and P3 bugs in the same ticket

### Cross-References

- **SOP-005:** Pit Crew dispatch protocol (how to use dispatch_work)
- **SOP-007:** Page body communication standard (body formatting)
- **SOP-008:** Breadcrumbs protocol (required sections)
- **SOP-009:** Quality Gate (MASTER BLASTER catches bugs automatically)
- **Dev Pipeline DB:** `ce6fbf1b-ee30-433d-a9e6-b338552de7c9`

---

## SOP-014: AnythingLLM RAG Infrastructure

**Effective:** 2026-02-18
**Updated:** 2026-02-27 (env var fix, Docker service auto-start, health check, API jank docs)
**Scope:** AnythingLLM Docker container on grove-node-1

### Overview

AnythingLLM is a RAG (Retrieval-Augmented Generation) server running as a **Docker container** on grove-node-1. It provides document ingestion and semantic search for Atlas agents.

**History:** The native Windows desktop app was the original deployment (pre-2026-02-24). It was abandoned because the native app does not support multi-user mode. Docker is now canonical. The native app (`C:\Users\jimca\AppData\Local\Programs\AnythingLLM\AnythingLLM.exe`) is still installed but MUST NOT be launched -- it will conflict with the Docker container on port 3001.

### Instance Details

| Property | Value |
|----------|-------|
| **Container name** | `anythingllm` |
| **Image** | `mintplexlabs/anythingllm:latest` |
| **Restart policy** | `always` (auto-starts when Docker daemon runs) |
| **Port mapping** | `0.0.0.0:3001 -> 3001/tcp` |
| **Local URL** | `http://localhost:3001` |
| **Health endpoint** | `GET /api/ping` -> `{"online":true}` |
| **Host storage** | `C:\anythingllm-storage` -> `/app/server/storage` (container) |
| **Tailscale IP** | `100.80.12.118` (remote access: `http://100.80.12.118:3001`) |
| **Multi-user mode** | Enabled |
| **Embedding engine** | Ollama + snowflake-arctic-embed2 (1024 dims, 8K context) |
| **Ollama host** | `http://host.docker.internal:11434` (Ollama runs on host, Docker reaches via bridge) |
| **Vector DB** | lancedb |
| **LLM provider** | Anthropic (Claude Sonnet 4), set via Docker `-e` env vars |
| **LLM model** | `claude-sonnet-4-20250514` |
| **Workspaces** | grove-technical, grove-vision, monarch, take-flight, gtm-consulting, drumwave, grove-corpus |

**Storage is PRODUCTION DATA -- NEVER WIPE `C:\anythingllm-storage`.**

### Reboot Chain (Zero-Touch Recovery)

On a normal reboot, AnythingLLM comes back automatically with no human intervention:

1. Docker service (`com.docker.service`) starts automatically (set to `auto` on 2026-02-27)
2. Docker Desktop starts (AutoStart: true in `%APPDATA%\Docker\settings-store.json`)
3. Docker daemon initializes
4. AnythingLLM container auto-starts (`--restart always` policy)
5. Ollama starts as Windows service (auto)

The native Windows desktop app has been **removed** from `HKCU\...\Run` to prevent it from squatting port 3001 before Docker comes up. If AnythingLLM fails to start after reboot, check Case 5 below.

**Ollama cold-start warning:** First embedding query after Docker restart takes 15-20s while Ollama loads the model. The AnythingLLM client uses a 20s timeout to survive this.

### Environment Variables

**Two .env files (updated 2026-02-27):**

| File | Contains | Purpose |
|------|----------|---------|
| `C:\github\atlas\.env` (root) | `ANYTHINGLLM_URL`, `ANYTHINGLLM_API_KEY` | Shared infra vars |
| `apps/telegram/.env` | `NOTION_API_KEY`, `ANTHROPIC_API_KEY`, etc. | Surface API keys |

**AnythingLLM vars were REMOVED from `apps/telegram/.env` on 2026-02-26 and moved to root `.env`.** Both bot and bridge now load root `.env` first, then `apps/telegram/.env` second:
- **Bot**: `start-telegram.ps1` loads both .env files via PowerShell before bun launch. `dotenv` in `src/index.ts` also loads `apps/telegram/.env`.
- **Bridge**: `start-bridge.ps1` loads both .env files via PowerShell. `dotenv` in `server.ts` loads both as defense-in-depth.

**WARNING - ENV VAR TRAP (burned 4 times):** Stale shell env vars override .env files. If RAG shows "Not configured" despite correct .env, start a fresh shell. Do NOT rearchitect the loading chain.

### Health Check

Bot startup includes an AnythingLLM health check that delegates to Bridge's shared `healthCheck()` in `packages/bridge/src/context/anythingllm-client.ts`. Returns structured `AnythingLLMHealthReport`:
- Auth verification (Bearer token against `/api/v1/auth`)
- Per-workspace doc counts (queries each configured workspace)
- Workspace routing via `getConfiguredWorkspaces()` in `workspace-router.ts`

### API Jank (DOCUMENTED)

AnythingLLM's API has quirks that have burned debugging time:

| Issue | Details | Workaround |
|-------|---------|------------|
| **Workspace returns array** | `GET /api/v1/workspace/:slug` returns `{ workspace: [{...}] }` not `{ workspace: {...} }` | Access `data.workspace[0]` |
| **embed_text is broken** | REST endpoint doesn't work | Use multipart upload + `update-embeddings` (SOP-015) |
| **Chat history poisoning** | Stale wrong answers in `openAiHistory` teach model to repeat them | Delete `workspace_chats` records |
| **Ollama cold-start timeout** | First query after restart takes 15-20s | `TIMEOUT_MS = 20_000` in client |

Manual check (unauthenticated):
```bash
curl -s http://localhost:3001/api/ping
# Expected: {"online":true}
```

Authenticated check (verifies API key):
```bash
curl -s -H "Authorization: Bearer $ANYTHINGLLM_API_KEY" http://localhost:3001/api/v1/workspaces
# Expected: JSON with workspaces array
```

Remote check (from der-tier via Tailscale):
```bash
curl -s http://100.80.12.118:3001/api/ping
```

### Recovery SOPs

**Case 0: Normal reboot**

Docker Desktop auto-starts -> Docker daemon starts -> container auto-starts (`--restart always`). No action needed. Verify with `curl -s http://localhost:3001/api/ping`.

**Case 1: Docker Desktop not running**

Docker Desktop is registered in Windows startup but may fail to launch. Start it manually:
```powershell
Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe"
```
Wait for Docker daemon to initialize (~30s). The AnythingLLM container will auto-start once the daemon is ready.

**Case 2: Container stopped but Docker running**

```bash
docker start anythingllm
```
Wait ~10s, verify with `/api/ping`.

**Case 3: Container deleted (nuclear recovery)**

Recreate the container from scratch. Storage is preserved on the host at `C:\anythingllm-storage`:

**CRITICAL: Must use `MSYS_NO_PATHCONV=1` prefix in Git Bash** or paths get mangled to `C:/Program Files/Git/...` which breaks STORAGE_DIR inside the container. LLM config MUST be passed as `-e` env vars (the .env file in storage is unreliable for these).

```bash
MSYS_NO_PATHCONV=1 docker run -d \
  -p 3001:3001 \
  --cap-add SYS_ADMIN \
  --restart always \
  -v "C:\anythingllm-storage:/app/server/storage" \
  -e STORAGE_DIR="/app/server/storage" \
  -e LLM_PROVIDER="anthropic" \
  -e ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" \
  -e ANTHROPIC_MODEL_PREF="claude-sonnet-4-20250514" \
  --name anythingllm \
  mintplexlabs/anythingllm:latest
```

All data (workspaces, documents, vectors, API keys, users) is in the bind mount and will be restored automatically.

**Why `-e` env vars instead of .env file?** AnythingLLM Docker does not reliably read API keys from the storage `.env` file. Docker `-e` flags inject them into the process environment directly, which the app always picks up. The `.env` file in storage is used for other settings (embedding engine, vector DB, etc.) but LLM provider config must come from Docker env vars.

**Case 4: API key 403 errors**

The API key lives in the SQLite database inside the container. To query it:
```bash
docker exec -w /app/server anythingllm node -e "const { PrismaClient } = require('@prisma/client'); const p = new PrismaClient(); p.api_keys.findMany().then(k => { console.log(JSON.stringify(k)); p.\$disconnect(); });"
```

Alternatively, generate a new key in the web UI at `http://localhost:3001` under Settings > Tools > API Keys. Then update `ANYTHINGLLM_API_KEY` in `apps/telegram/.env` and restart the bot/bridge.

**CRITICAL: Ghost env var from native install.** The native Windows app set `ANYTHINGLLM_API_KEY` as a **User-level environment variable**. The `start-bridge.ps1` `.env` loader skips keys that are already set in the environment (line 29: "Only set if not already defined"). This means the old native-app key silently overrides the correct Docker key from `.env`.

Diagnostic:
```powershell
# Check for ghost User-level env vars from the native install
[System.Environment]::GetEnvironmentVariable("ANYTHINGLLM_API_KEY", "User")
[System.Environment]::GetEnvironmentVariable("ANYTHINGLLM_URL", "User")
```

Fix:
```powershell
# Remove the stale User-level variable — .env will take over
[System.Environment]::SetEnvironmentVariable("ANYTHINGLLM_API_KEY", $null, "User")
```

This was the root cause of the persistent 403 loop (Feb 2026). The key in `.env` was correct, the key in the Docker container was correct, but the Bridge process inherited the wrong key from the User environment.

**Case 5: Native app squatting port 3001**

If the native desktop app was accidentally launched or re-added to startup, it will grab port 3001 before Docker can bind it. Symptoms: Docker container starts but AnythingLLM is unreachable, or the container logs show port-in-use errors.

Fix:
```powershell
# Kill the native app
taskkill /f /im AnythingLLM.exe

# Remove from startup if re-added
Remove-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'AnythingLLM' -ErrorAction SilentlyContinue

# Restart the Docker container
docker restart anythingllm
```

The native app MUST NOT be in Windows startup. Only Docker Desktop should be in `HKCU\...\Run`.

### Storage Architecture

| Path | What it is | Critical? |
|------|-----------|-----------|
| `C:\anythingllm-storage` (host) | Docker bind mount -- production data | YES -- NEVER WIPE |
| `C:\anythingllm-storage\.env` (host) | Docker container's AnythingLLM config | YES |
| `/app/server/storage` (container) | Same data, mounted inside container | Same data |
| `C:\Users\jimca\AppData\Roaming\anythingllm-desktop\storage\.env` | Native app config (LEGACY) | NO -- do not use |

**NEVER:**
- Wipe or format `C:\anythingllm-storage`
- Run `docker rm anythingllm` without confirming the bind mount is intact
- Launch the native desktop app while the Docker container is running
- Confuse the native app config path with the Docker config path

**ALWAYS:**
- Back up `C:\anythingllm-storage` before major updates or image pulls
- Use the Docker container for all AnythingLLM operations
- Verify the bind mount after any `docker run` command: `docker inspect anythingllm --format '{{range .Mounts}}{{.Source}} -> {{.Destination}}{{end}}'`

### AnythingLLM Configuration

The container reads its config from `/app/server/storage/.env` (host: `C:\anythingllm-storage\.env`). Key settings:

| Setting | Value | Effect |
|---------|-------|--------|
| `EMBEDDING_ENGINE` | `native` | Uses built-in MiniLM-L6-v2 for embeddings |
| `VECTOR_DB` | `lancedb` | Local vector store, no external service needed |
| `SERVER_PORT` | `3001` | HTTP API port |
| `MULTI_USER_MODE` | `true` | Multi-user authentication enabled |
| `STORAGE_DIR` | `/app/server/storage` | Set via `-e` flag on `docker run` |

### Docker Maintenance

**Pull latest image:**
```bash
docker pull mintplexlabs/anythingllm:latest
docker stop anythingllm
docker rm anythingllm
# Then recreate with the docker run command from Case 3
```

**View container logs:**
```bash
docker logs anythingllm --tail 100
docker logs anythingllm -f  # follow/stream
```

**Check container status:**
```bash
docker ps -f name=anythingllm
```

### Supervisor Integration

The `/atlas-supervisor` v3.0 checks AnythingLLM status via HTTP ping on each `status` or `logs` command.

- If offline: logs a warning (RAG is non-critical, bot continues without it)
- Recovery is handled by Docker's `--restart always` policy, not by the supervisor
- If Docker itself is down, supervisor cannot recover it -- see Case 1 above

---

## SOP-015: Client RAG Pipeline

**Effective:** 2026-02-26
**Scope:** Client document ingestion into AnythingLLM workspaces for RAG retrieval

### Overview

Client documents from der-tier (Jim's laptop) and grove-node-1 are automatically synced into AnythingLLM workspaces. The sync script runs on grove-node-1 where AnythingLLM Docker lives. It reads der-tier files via the mapped `T:` drive (SMB).

### Architecture

```
der-tier (laptop)                grove-node-1 (server)
  C:\github\clients\   ──SMB──>  T:\github\clients\     (read via T: drive)
                                  C:\github\clients\     (local files)
                                        │
                                  rag-sync.ts (every 15 min)
                                        │
                                  AnythingLLM Docker (port 3001)
                                    ├── monarch workspace
                                    ├── take-flight workspace
                                    ├── drumwave workspace
                                    └── grove-corpus workspace
```

### Client Folder Structure

```
C:\github\clients\           (separate git repo)
├── monarch/                 → workspace: monarch
├── take-flight/             → workspace: take-flight
├── drumwave/                → workspace: drumwave
└── grove-corpus/            → workspace: grove-corpus
    Each with: correspondence/, deliverables/, research/
```

Supported file types: `.txt`, `.md`, `.pdf`, `.docx`, `.csv`, `.json`

### Workspace Routing

| Client Folder | AnythingLLM Workspace |
|---------------|----------------------|
| `monarch/` | `monarch` |
| `take-flight/` | `take-flight` |
| `drumwave/` | `drumwave` |
| `grove-corpus/` | `grove-corpus` |

### Sync Script

**File:** `scripts/rag-sync.ts`

```bash
# Manual run
bun run scripts/rag-sync.ts

# Dry run (preview only)
bun run scripts/rag-sync.ts --dry-run

# Verbose output
bun run scripts/rag-sync.ts --verbose
```

**What it does:**
1. Preflight: verify local dir, remote dir (T: mount), AnythingLLM health
2. Scan both source paths for supported files
3. Hash each file (SHA-256), compare against manifest
4. Upload new/changed files via `POST /api/v1/document/upload` (multipart)
5. Embed into workspace via `POST /api/v1/workspace/:slug/update-embeddings`
6. Update manifest at `data/rag-manifest.json`

**Dedup rules:** Files at both `C:\` and `T:\` with identical hashes upload once (local wins). Files only on `T:\` are uploaded from there.

### Manifest

**File:** `data/rag-manifest.json` (auto-generated, do not edit)

Tracks `{ path, hash, uploadedAt, workspace, docLocation, source }` per file. The `docLocation` is returned by AnythingLLM's upload API and is what `update-embeddings` needs. NOT the original file path.

### Scheduled Sync

**Windows Task Scheduler job:** `Atlas RAG Sync`

```powershell
# Install/update
powershell -ExecutionPolicy Bypass -File scripts\install-rag-sync-task.ps1

# Remove
powershell -ExecutionPolicy Bypass -File scripts\install-rag-sync-task.ps1 -Remove
```

Runs every 15 minutes. Logs to `data/rag-sync.log` (append mode).

### AnythingLLM Upload API

The `embed_text` endpoint is broken. Use the working multipart upload:

```
POST /api/v1/document/upload
Content-Type: multipart/form-data
Authorization: Bearer <API_KEY>
Body: file=<binary>
Response: { success: true, documents: [{ location: "custom-documents/..." }] }

POST /api/v1/workspace/:slug/update-embeddings
Content-Type: application/json
Authorization: Bearer <API_KEY>
Body: { adds: ["custom-documents/..."], deletes: [] }
```

### Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `T:` drive not reachable | der-tier offline or SMB disconnected | `net use T: \\der-tier\Der-TierC` |
| AnythingLLM not responding | Docker down | `docker start anythingllm` |
| Upload returns 403 | Bad API key | Check `ANYTHINGLLM_API_KEY` in `.env`, see SOP-014 Case 4 |
| File not embedding | `docLocation` mismatch | Check manifest, re-run sync |
| Workspace not found | New client folder | Add to `WORKSPACE_MAP` in `rag-sync.ts` |

### Cross-References

- **SOP-014:** AnythingLLM infrastructure (Docker, recovery, env vars)
- **Manifest:** `data/rag-manifest.json`
- **Client docs repo:** `C:\github\clients\` (separate git repo)
- **Sync script:** `scripts/rag-sync.ts`
- **Task installer:** `scripts/install-rag-sync-task.ps1`

---

*SOPs are living documents. Update as patterns emerge.*
