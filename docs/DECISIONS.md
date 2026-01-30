# Atlas Product Decisions

**Purpose:** Log key architectural and product decisions with rationale.  
**Updated:** 2026-01-29

---

## Decision Format

Each decision follows this structure:
- **Context:** What situation prompted this decision
- **Options considered:** Alternatives evaluated
- **Decision:** What we chose
- **Rationale:** Why this option
- **Consequences:** What this enables/limits
- **Status:** Proposed | Accepted | Superseded

---

## DEC-001: Browser Extension as Primary Interface

**Date:** 2026-01-29  
**Status:** Accepted

**Context:**  
Atlas interaction is currently fragmented: Notion for capture/triage, CLI for scripts, Notion comments for dispositions. This creates async round-trips that break flow.

**Options considered:**
1. **Improve Notion UX** - Custom views, better templates
2. **Build standalone app** - Electron/web app dedicated to Atlas
3. **Telegram bot** - Mobile-first conversational interface
4. **Browser extension** - Side panel in existing work context

**Decision:** Browser extension as primary real-time interface

**Rationale:**
- Extension already exists and works (LinkedIn automation proves the model)
- Zero context-switch—Atlas is present while working in browser
- Can evolve incrementally from current state
- Notion remains source of truth (no migration risk)
- Side panel UX is proven (many tools use this pattern)

**Consequences:**
- Investment in extension UI/UX pays compound returns
- Mobile use case requires separate solution (Telegram later)
- Extension must be reliable—daily driver expectations
- Notion API rate limits may become a factor

---

## DEC-002: Notion Remains Source of Truth

**Date:** 2026-01-29  
**Status:** Accepted

**Context:**  
Could build lighter-weight state management (local files, SQLite, Supabase) instead of relying on Notion API.

**Options considered:**
1. **Notion only** - All state in Notion databases
2. **Local-first** - SQLite/JSON with Notion sync
3. **Supabase** - Postgres backend, faster queries
4. **Hybrid** - Hot state local, cold state Notion

**Decision:** Notion remains sole source of truth; extension reads/writes via API

**Rationale:**
- Notion provides free manual override UI (edit items directly)
- Already invested in Notion structure (Inbox, Feed, Memory, Pillars)
- Avoids sync complexity and conflict resolution
- Notion API is fast enough for dashboard use case
- Jim already lives in Notion for other work

**Consequences:**
- Dependent on Notion API availability/performance
- Complex queries may need server-side aggregation
- No offline support in extension (acceptable tradeoff)
- Rate limiting requires thoughtful API usage

---

## DEC-003: Four Pillars as Top-Level Taxonomy

**Date:** 2026-01-29 (documenting existing)  
**Status:** Accepted

**Context:**  
Need a stable taxonomy for routing all captured content.

**Options considered:**
1. **Project-based** - Route to specific projects
2. **GTD contexts** - @home, @work, @errands, etc.
3. **Life domains** - Personal, Work, Home, etc.
4. **Flat tags** - No hierarchy, tag-based

**Decision:** Four pillars: Personal, The Grove, Consulting, Home/Garage

**Rationale:**
- Maps to how Jim's life is actually structured
- Stable over time (unlike projects which come and go)
- Clear routing rules (permits → Home, clients → Consulting)
- Small enough set to not require sub-categorization

**Consequences:**
- Every item must fit one pillar (no cross-pillar items)
- Pillar rules need documentation (see Atlas Memory)
- New life domains would require adding a pillar

---

## DEC-004: Async Triage with Sync Visibility

**Date:** 2026-01-29  
**Status:** Accepted

**Context:**  
Triage processing can be async (Python scripts), but visibility into state should be real-time.

**Options considered:**
1. **Fully async** - Scripts run on schedule, check Notion for results
2. **Fully sync** - Every action processes immediately
3. **Async processing, sync visibility** - Background triage, real-time dashboard

**Decision:** Async processing with synchronous visibility layer (extension dashboard)

**Rationale:**
- Heavy processing (classification, API calls) shouldn't block UI
- Visibility doesn't require processing—just reading state
- Extension can poll/refresh without waiting for triage completion
- Matches mental model: "things are being handled" vs "I see the queue"

**Consequences:**
- Dashboard shows current state, not real-time processing
- Need visual indicator when processing is in-flight
- Edge case: item captured but not yet triaged (show as "Processing")

---

## DEC-005: Editorial Learning Stays File-Based

**Date:** 2026-01-29 (documenting existing)  
**Status:** Accepted

**Context:**  
Grove docs refinery learns from Jim's edits. Where should learnings be stored?

**Options considered:**
1. **Notion database** - Learnings as database entries
2. **Local markdown** - `editorial_memory.md` in repo
3. **Embedded in prompts** - Hardcode learnings into system prompts

**Decision:** Local markdown file (`editorial_memory.md`)

**Rationale:**
- Easy to read and edit manually
- Version controlled with git
- Injected into prompts at generation time
- No API overhead for every generation

**Consequences:**
- Multi-machine use requires syncing file (git pull)
- Not queryable like a database
- Works well for current scale (< 100 learnings)

---

## DEC-006: Telegram as Primary Clarification Channel

**Date:** 2026-01-29  
**Status:** Accepted

**Context:**  
Sparks (raw input) need interpretation. Pure async processing means clarification happens after Jim's context has faded. Need a fast channel to capture intent while thought is fresh.

**Options considered:**
1. **Notion comments** - Async, Jim checks later (current state)
2. **Extension chat** - Real-time but desktop-only
3. **Telegram bot** - Mobile-first, instant, conversational
4. **SMS/iMessage** - Universal but limited interaction model
5. **Email** - Too slow, wrong mental model

**Decision:** Telegram as primary clarification channel, with Extension chat as desktop equivalent later

**Rationale:**
- Mobile-first: Jim can clarify anywhere, not just at desktop
- Instant: Notification appears while spark context is fresh
- Conversational: Natural back-and-forth for nuanced clarification
- Lower implementation complexity than Extension chat
- Telegram bot API is well-documented and reliable
- Proves the model before investing in Extension integration

**Consequences:**
- Requires Jim to have Telegram installed and notifications enabled
- Two interfaces to maintain eventually (Telegram + Extension)
- Telegram history becomes part of the record (alongside Notion)
- Need to bridge Telegram conversations to Notion for canonical storage

---

## DEC-007: SPARKS.md as Interpretation Guide

**Date:** 2026-01-29  
**Status:** Accepted

**Context:**  
Atlas needs a documented framework for interpreting Jim's input. This enables consistent behavior across sessions and clarifies the "why" behind classification decisions.

**Options considered:**
1. **Hardcoded rules** - Logic embedded in code
2. **Notion database** - Queryable but heavyweight
3. **Markdown document** - Human-readable, version-controlled, injected into prompts

**Decision:** `SPARKS.md` as the canonical interpretation guide

**Rationale:**
- Human-readable: Jim can review and refine the logic
- Version-controlled: Changes tracked in git
- Prompt-injectable: Can be included in Claude context
- Living document: Updates as patterns emerge from feedback loop
- Complements Atlas Memory (which stores specific corrections)

**Consequences:**
- Must keep SPARKS.md updated as new patterns emerge
- Classification logic lives in docs, not code (may need sync)
- Should be uploaded to Claude project knowledge for persistence

---

## Pending Decisions

### PENDING: Persistent Agent Architecture

**Context:** Want a Claude Code instance on grove-node-1 running persistently to execute queued tasks.

**Options to evaluate:**
1. **Screen/tmux session** - Simple, Claude Code in background
2. **Systemd service** - More robust, auto-restart
3. **Docker container** - Isolated, reproducible
4. **Scheduled task loop** - Windows Task Scheduler triggers periodic runs

**Considerations:**
- How to handle session timeouts/reconnects
- How to monitor health and restart on failure
- How to queue and prioritize tasks
- Cost implications of persistent API usage

**Status:** Needs investigation before P2-CORE-007

---

### PENDING: Telegram ↔ Notion Bridging

**Context:** Telegram conversations need to sync to Notion for canonical record.

**Options to evaluate:**
1. **Real-time sync** - Every message creates Notion entry
2. **Batch sync** - Periodic dump of conversation to Feed
3. **Task-only sync** - Only clarified tasks land in Notion, conversation stays in Telegram
4. **Hybrid** - Tasks to Inbox, conversation summary to Feed

**Status:** Decide during P1-CORE-001 implementation

---

## Changelog

| Date | Decision | Status |
|------|----------|--------|
| 2026-01-29 | DEC-001 through DEC-005 documented | Accepted |
| 2026-01-29 | DEC-006: Telegram as clarification channel | Accepted |
| 2026-01-29 | DEC-007: SPARKS.md as interpretation guide | Accepted |

---

*Decisions are permanent unless explicitly superseded.*
