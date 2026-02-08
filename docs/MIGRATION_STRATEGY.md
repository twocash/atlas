# Atlas 2.0 Migration Strategy

**Created:** 2026-01-30  
**Owner:** Jim Calhoun  
**Status:** In Progress

---

## Executive Summary

Atlas 2.0 is operational with core Telegram bot functionality, Notion integration, and Cognitive Router v1.0. However, the legacy `claude-assist` directory contains significant institutional knowledge, skills, and capabilities that must be migrated to avoid capability loss during consolidation.

**Key Finding:** The most valuable assets are NOT code—they're the documented wisdom in SPARKS.md, editorial memory, system prompts, and the skills framework.

---

## Migration Inventory

### Category 1: BRAIN DOCS (Highest Priority)

These documents shape how Atlas thinks and operates:

| Source | Target | Status | Notes |
|--------|--------|--------|-------|
| `CLAUDE.md` (v3.1) | Merge into `apps/telegram/CLAUDE.md` | 🔄 Pending | Contains Four Pillars, Session Startup, Feedback Loop |
| `SPARKS.md` | `apps/telegram/workspace/SPARKS.md` | ✅ Done | Already copied |
| `PRODUCT.md` | `apps/telegram/docs/PRODUCT.md` | 🔄 Pending | Product vision, architecture |
| `DECISIONS.md` | `apps/telegram/docs/DECISIONS.md` | 🔄 Pending | Architectural decisions |
| `BACKLOG.md` | Reference only | ⏸ Skip | Superseded by Work Queue 2.0 |

### Category 2: SKILLS SYSTEM (Agent SDK Prep)

Skills for agent coordination:

| Skill | Purpose | Migrate? | Priority |
|-------|---------|----------|----------|
| `agent-dispatch` | Spawn specialized agents | ✅ Yes | P1 |
| `health-check` | Validate system state | ✅ Yes | P1 |
| `heartbeat-monitor` | Track running tasks | ✅ Yes | P1 |
| `status-inspector` | Analyze task details | ✅ Yes | P2 |
| `skill-builder` | Create new skills | ✅ Yes | P2 |
| `load-persona` | Switch agent modes | ⚠️ Maybe | P3 |
| `directory-map` | Filesystem viz | ❌ Skip | - |
| `git-snapshot` | Git operations | ❌ Skip | - |

### Category 3: CONTENT PIPELINES (Future Sprint)

Document generation capabilities:

| Component | Source | Purpose | Status |
|-----------|--------|---------|--------|
| Grove Docs Refinery | `grove_docs_refinery/` | Document processing + Notion sync | 🔄 Evaluate |
| Research Generator | `grove_research_generator/` | Blog/whitepaper generation | 🔄 Evaluate |
| System Prompts | `*/prompts/` | Writer, reviewer, research prompts | ✅ Migrate |
| Editorial Memory | `editorial_memory.md` | Learned preferences | ✅ Migrate |

### Category 4: NOTION TOOLING (Evaluate)

Direct API utilities:

| Script | Purpose | Action |
|--------|---------|--------|
| `notion_pipeline/` | Direct API client (bypasses MCP cache) | Evaluate for integration |
| `atlas_startup.py` | @Atlas mention scanning | Port logic to bot startup |
| `atlas_inbox_scan.py` | Inbox visibility | Port logic to /status command |

### Category 5: CHROME EXTENSION (Separate Project)

| Component | Status | Notes |
|-----------|--------|-------|
| `atlas-chrome-ext/` | Keep separate | LinkedIn automation, different scope |
| SOPs (SALES_NAV_SOP.md etc.) | Reference | Document patterns for future |

---

## Migration Phases

### Phase 1: Documentation Merge (NOW)

**Goal:** Atlas 2.0 has full context without losing institutional knowledge

**Actions:**
1. ✅ Create `apps/telegram/docs/` directory
2. 🔄 Copy PRODUCT.md → `apps/telegram/docs/PRODUCT.md`
3. 🔄 Copy DECISIONS.md → `apps/telegram/docs/DECISIONS.md`
4. 🔄 Merge CLAUDE.md wisdom into apps/telegram/CLAUDE.md
5. ✅ Verify SPARKS.md is current

**Merge Strategy for CLAUDE.md:**
- Add: Four Pillars taxonomy (Personal, Grove, Consulting, Home/Garage)
- Add: Session startup routine
- Add: Feedback loop protocol (corrections → Memory)
- Add: Research document generation capability
- Keep: Existing Sprint 1-4 context (don't lose it)

### Phase 2: Skills Migration (Sprint 4)

**Goal:** Atlas 2.0 can use skill system for Agent SDK

**Actions:**
1. Create `apps/telegram/skills/` directory structure
2. Copy skill template + coordination skills
3. Update skill references for new Notion databases
4. Add skill loading to bot startup
5. Test skill invocation via Telegram

### Phase 3: Content Pipelines (Sprint 5+)

**Goal:** Atlas 2.0 can generate content

**Decision Required:** Keep Python pipelines as subprocesses OR rewrite in TypeScript?

**Recommendation:** Keep Python, call from TypeScript
- grove_docs_refinery is 2000+ lines of working code
- Opus API calls are expensive to debug
- Python → subprocess call from Bun is trivial

**Actions:**
1. Create `apps/telegram/pipelines/` symlink or copy
2. Add `/generate` command to Telegram bot
3. Copy editorial_memory.md
4. Copy system prompts

### Phase 4: Notion Utilities (Sprint 5+)

**Goal:** Leverage direct Notion API where MCP has limitations

**Actions:**
1. Port `notion_pipeline/client.py` query capabilities to TypeScript
2. Port `atlas_startup.py` @Atlas mention scanning
3. Port `atlas_inbox_scan.py` for enhanced /status

---

## Database ID Mapping

### Legacy (Inbox 1.0)
```
Atlas Inbox:  c298b60934d248beb2c50942436b8bfe
Atlas Feed:   3e8867d58aa5495780c2860dada8c993
Atlas Memory: 2eb780a78eef81fc8694e59d126fe159
```

### Current (Inbox 2.0 + Work Queue 2.0)
```
Inbox 2.0:      f6f638c9-6aee-42a7-8137-df5b6a560f50
Work Queue 2.0: 3d679030-b76b-43bd-92d8-1ac51abb4a28
```

**Note:** Legacy databases still exist. Items were migrated (17 items on 2026-01-30).

---

## What NOT to Migrate

### Obsolete/Superseded
- `BACKLOG.md` - Work Queue 2.0 replaces this
- `agents/*.py` - Templates only, Agent SDK will supersede
- `.claude/custom-instructions.md` - Per-project, not portable

### Separate Projects
- `atlas-chrome-ext/` - LinkedIn automation (keep separate)
- `sales_nav_exports/` - Data exports (not code)

### Utilities (Low Value)
- `launchers/` - Machine-specific batch files
- `sandbox/` - Test files
- `configs/` - Environment examples

---

## Success Criteria

### Phase 1 Complete When:
- [x] PRODUCT.md in apps/telegram/docs/
- [x] DECISIONS.md in apps/telegram/docs/
- [x] CLAUDE.md has Four Pillars, Session Startup, Feedback Loop
- [x] Atlas knows about both Inbox 1.0 AND 2.0 contexts

### Phase 2 Complete When:
- [ ] Skills directory exists in apps/telegram/
- [ ] At least 3 coordination skills are functional
- [ ] Can invoke skill via Telegram message
- [ ] Skills reference correct Notion databases

### Phase 3 Complete When:
- [ ] /generate command produces content
- [ ] Editorial memory influences output
- [ ] Generated content posts to Notion

---

## Risk Assessment

### High Risk
- **Losing editorial memory** - This represents 50+ hours of learned preferences
- **Breaking Notion connections** - Database IDs are hardcoded everywhere

### Medium Risk
- **Skills framework incompatibility** - May need rewrite for TypeScript
- **Python ↔ TypeScript bridge** - Subprocess management complexity

### Low Risk
- **Documentation gaps** - Easy to fix incrementally
- **Missing utilities** - Can re-implement as needed

---

## Changelog

| Date | Change |
|------|--------|
| 2026-01-30 | Initial strategy created |
| 2026-01-30 | Phase 1 COMPLETE: docs directory, PRODUCT.md, DECISIONS.md, CLAUDE.md merged |

