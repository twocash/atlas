# Atlas Dev Pipeline - Standard Operating Procedures

**Last Updated:** 2026-02-01
**Owner:** Jim Calhoun + Pit Crew
**Database:** [Atlas Dev Pipeline](https://www.notion.so/ce6fbf1bee30433da9e6b338552de7c9)

---

## Purpose

The Dev Pipeline tracks Atlas development work: bugs, features, hotfixes, and questions. It serves as the interface between Jim (product owner) and the Pit Crew (dev agents).

## Database Schema

| Field | Type | Purpose |
|-------|------|---------|
| **Discussion** | Title | Clear, actionable title (e.g., "BUG: Atlas hallucinates Notion URLs") |
| **Type** | Select | Bug, Feature, Hotfix, Question |
| **Priority** | Select | P0 (today), P1 (this week), P2 (backlog) |
| **Status** | Select | Dispatched → In Progress → Needs Review → Approved → Shipped/Closed |
| **Requestor** | Select | Jim, Atlas [Telegram] |
| **Handler** | Select | Pit Crew (default) |
| **Thread** | Text | Context, reproduction steps, requirements |
| **Resolution** | Text | What was done, what it unlocked, commits |
| **Dispatched** | Date | When item was created |
| **Resolved** | Date | When item was shipped/closed |
| **Output** | URL | Link to PR, commit, or artifact |

---

## Workflow

### 1. Dispatch (Entry)

Items enter the pipeline via:
- **Jim via Telegram:** "Create a P1 bug in dev pipeline: [description]"
- **Atlas self-filing:** When detecting issues during operation
- **Pit Crew:** When discovering issues during development

**Required on dispatch:**
- Clear title with type prefix (BUG:, FEATURE:, HOTFIX:)
- Priority (P0/P1/P2)
- Thread with context (what's happening, why it matters)

### 2. In Progress

Pit Crew picks up items in priority order:
1. P0 first (same-day resolution expected)
2. P1 next (this week)
3. P2 when capacity allows

**Update Thread** with investigation findings as work progresses.

### 3. Needs Review

When fix is ready:
- Update **Output** with commit/PR link
- Set status to "Needs Review"
- Notify Jim if P0/P1

### 4. Shipped

When approved and deployed:
- Set status to "Shipped"
- Fill **Resolution** with:
  - What was fixed/built
  - What it unlocked (capabilities enabled)
  - Commit references
- Set **Resolved** date

### 5. Closed

For items that won't be done:
- Duplicates → Close with "Duplicate of [link]"
- Won't fix → Close with rationale
- Test items → Archive immediately after verification

---

## Title Conventions

```
BUG: [Symptom] - [Impact if not obvious]
FEATURE: [Capability] - [Context if needed]
HOTFIX: [Critical issue requiring immediate fix]
SPRINT: [Sprint Name] (SPRINT-ID)
```

**Examples:**
- `BUG: Atlas hallucinates Notion URLs - breaks all Notion links`
- `FEATURE: Atlas hourly reflection log`
- `HOTFIX: Production token expired`
- `SPRINT: Atlas MCP Client Enablement (ATLAS-MCP-001)`

---

## Resolution Documentation Standard

When shipping, Resolution field MUST include:

```
FIXED ✅ (or COMPLETE ✅ for features)

**Root cause:** [What was actually wrong]

**Fix applied:**
- [Bullet points of changes]

**What it unlocked:**
- [Capabilities enabled by this fix]

**Commit:** [hash or PR link]
```

---

## Anti-Patterns to Avoid

1. **Vague titles:** "Fix bug" → Use "BUG: Atlas returns 404 on Dev Pipeline queries"
2. **Missing context:** Always include Thread with reproduction steps
3. **Duplicate creation:** Search before creating; if dupe found, close new one
4. **Orphaned items:** Don't leave items in Dispatched > 1 week without update
5. **Empty resolutions:** Every Shipped item needs documented resolution

---

## Sprint Tracking

For larger efforts spanning multiple items:

1. Create a `SPRINT:` item as the parent
2. Reference sprint ID in related items' Thread
3. When sprint completes, update parent with summary of all deliverables
4. Archive individual items if they're just sub-tasks

---

## Cleanup Cadence

**Weekly:**
- Review Dispatched items > 7 days old
- Archive test/validation items
- Merge duplicates

**Monthly:**
- Archive Shipped items > 30 days old (they're in git history)
- Review P2 backlog for relevance

---

## Integration with Atlas

Atlas can:
- **Create items:** `dev_pipeline_create` tool
- **List items:** `dev_pipeline_list` tool
- **Query details:** Via Notion MCP plugin

Atlas CANNOT (yet):
- Update item status (roadmap)
- Archive items (roadmap)

---

## Shipped Items Log (2026-02)

### Anti-Hallucination System (c153151)
**What it unlocked:**
- Reliable Notion operations (no more ghost pages)
- Verifiable tool execution (toolIterations > 0)
- URL integrity (real UUIDs from tool results)

### MCP Client Infrastructure (ATLAS-MCP-001)
**What it unlocked:**
- 27 MCP tools available
- External server connectivity (Notion, Pit Crew)
- Foundation for future tool integrations

### Token/Auth Fixes (f78b468, 68be0ac)
**What it unlocked:**
- Proper database connectivity
- Eliminated 404 errors
- Valid Notion URLs

---

*This document is version-controlled in `docs/DEV_PIPELINE_SOP.md`*
