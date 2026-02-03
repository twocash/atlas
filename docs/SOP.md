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
- [ ] Notion Work Queue item updated with Output link
- [ ] Tested on mobile (if applicable)
- [ ] No console errors in bot logs

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
- [ ] Pit Crew Work section placeholder exists
- [ ] Discussion ID returned for future messages
- [ ] Notion URL returned for tracking
```

### Anti-Patterns

❌ **Don't** stuff all content into Thread property
❌ **Don't** create multiple tickets for same issue (use post_message)
❌ **Don't** update status without context (add message explaining why)
❌ **Don't** skip the review step for complex features

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

*SOPs are living documents. Update as patterns emerge.*
