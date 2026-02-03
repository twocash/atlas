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

- [ ] Feature works in Telegram
- [ ] Help system updated (SOP-001)
- [ ] **Run MASTER BLASTER verification (`bun run verify`)** ← REQUIRED (SOP-009)
- [ ] Notion Work Queue item updated with Output link
- [ ] Tested on mobile (if applicable)
- [ ] No console errors in bot logs
- [ ] **Verify test coverage bug auto-created** (if Pit Crew feature)

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

MASTER BLASTER is Atlas's unified quality verification system. It chains all test suites into a single command that MUST pass before any feature goes to human testing.

**Vision:** Ship feature → Auto-bug for test coverage → Run MASTER BLASTER → Pass → Human testing

### Rule: No Ship Without Verification

**Every feature MUST pass `bun run verify` before marking as Done or Shipped.**

This is a hard gate. Do not proceed to human testing with failing tests.

### Commands

```bash
# Default: Unit + Smoke + Integration tests
bun run verify

# Quick: Unit tests only (fast feedback)
bun run verify:quick

# Full: All suites including E2E
bun run verify:full
```

### Pre-Human Testing Checklist

1. [ ] Feature code complete and committed
2. [ ] Run `bun run verify` - ALL tests must pass
3. [ ] If Pit Crew feature: Verify test coverage bug was auto-created
4. [ ] Review MASTER BLASTER output for warnings
5. [ ] Only then proceed to human testing

### Test Suites

| Suite | Command | What It Tests |
|-------|---------|---------------|
| **Canary Tests** | `scripts/canary-tests.ts` | Silent failures, degraded output |
| **Unit Tests** | `bun test` | Individual functions/classes |
| **Smoke Tests** | `scripts/smoke-test-all.ts` | All APIs, tools, integrations |
| **E2E Tests** | `src/health/test-runner.ts` | End-to-end workflows |
| **Integration** | Inline | Health checks, connectivity |

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

Or say: "run tests", "quality check", "master blaster"

---

*SOPs are living documents. Update as patterns emerge.*
