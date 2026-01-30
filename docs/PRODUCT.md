# Atlas Product Overview

**Owner:** Jim Calhoun  
**Version:** 0.1  
**Updated:** 2026-01-29

---

## Vision

Atlas is a cognitive co-pilot that works *with* how Jim's brain operates—not against it. Instead of fighting ADD tendencies (scattered capture, context-switching, interest-driven attention), Atlas channels them into a reliable system that triages, organizes, and executes while maintaining state across sessions.

**This is a life operating system, not a work tool.** Atlas handles everything from garage renovation budgets to AI venture sprints to personal health goals—with equal capability across all domains.

**The unlock:** A browser extension that brings Atlas into the flow of life, eliminating the async round-trips to Notion that create stop-start friction.

---

## User Profile

**Primary user:** Jim Calhoun, Managing Director at Take Flight Advisors

**Behavioral patterns:**
- Captures ideas across many surfaces (Notion, browser, conversations)
- Context-switches frequently between four life domains
- Prefers delegation over task management
- Wants to "clear the inbox" but loses momentum chasing results
- Values seeing progress without hunting for it

**Success looks like:**
- Drop something in, trust it's being handled
- See status without context-switching to Notion
- Get prompted for decisions at the right moment
- Never lose a thread between sessions

---

## Current Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           ATLAS SYSTEM                                  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   CAPTURE                    PROCESS                      OUTPUT        │
│   ───────                    ───────                      ──────        │
│                                                                         │
│   ┌─────────┐               ┌─────────────┐              ┌──────────┐  │
│   │ Notion  │──────────────►│ Triage      │─────────────►│ Notion   │  │
│   │ Inbox   │               │ Engine      │              │ Pillars  │  │
│   └─────────┘               │ (Python)    │              └──────────┘  │
│       ▲                     └─────────────┘                    │        │
│       │                           │                            │        │
│   @atlas                          │                            ▼        │
│   mentions                        ▼                      ┌──────────┐  │
│                             ┌─────────────┐              │ Atlas    │  │
│                             │ Work Queue  │              │ Feed     │  │
│                             └─────────────┘              │ (Log)    │  │
│                                   │                      └──────────┘  │
│                                   ▼                                     │
│   ┌─────────┐               ┌─────────────┐              ┌──────────┐  │
│   │ Chrome  │◄─────────────►│ Grove Docs  │─────────────►│ Notion   │  │
│   │ Ext     │               │ Refinery    │              │ Docs     │  │
│   └─────────┘               └─────────────┘              └──────────┘  │
│       │                                                                 │
│       ▼                                                                 │
│   ┌─────────┐               ┌─────────────┐              ┌──────────┐  │
│   │LinkedIn │──────────────►│ Phantom-    │─────────────►│ Contacts │  │
│   │ Posts   │               │ Buster ETL  │              │ DB       │  │
│   └─────────┘               └─────────────┘              └──────────┘  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**What works well:**
- Triage classification (pillars, disposition, priority) is reliable
- Grove docs refinery produces polished content
- LinkedIn engagement tracking captures high-value contacts
- Editorial learning loop improves output over time
- Context clue analysis can auto-classify most sparks (see `SPARKS.md`)

**What creates friction:**
- Async processing requires hunting in Notion for results
- No visibility into queue state without running scripts
- Blocked items (awaiting Jim's feedback) get lost
- Session handoffs lose context despite Feed logging
- Multiple entry points (Notion, CLI, comments) fragment attention
- **Clarification happens too late**—by the time Atlas processes, Jim's context is gone

**The Core Insight:**

Sparks need interpretation *while the thought is fresh*. Pure async can't solve this. The architecture needs a fast clarification loop (Telegram or Extension chat) before routing to the async processing layer.

```
Spark → [Quick Clarify: 10 sec] → Interpreted Task → [Async Processing] → Done
              ↑                          ↓
         Telegram/Ext              Notion + Persistent Agent
```

---

## Strategic Direction

### The Clarification Layer (Critical Path)

Before the browser extension can be the command center, Atlas needs a fast clarification channel. When Jim shares a spark, he needs to refine intent *in the moment*—not hours later when checking Notion.

**Telegram as clarification channel:**
- Share link → Atlas analyzes → "Grove research or Atlas experiment?" → Jim taps reply
- Mobile-first means clarification happens anywhere
- Conversation history provides context for future sparks
- Bridge to Notion: once clarified, task lands in the right place

**Why Telegram before Extension chat:**
- Works on mobile (extension is desktop-only)
- Lower implementation complexity
- Proves the clarification model before building into extension

### The Browser Extension Unlock

The existing Chrome extension already proves the model: real-time side panel that surfaces work without leaving the current context. Today it handles LinkedIn. Tomorrow it becomes the unified Atlas interface.

**Phase 1: Visibility Layer**
- Surface inbox items, pending decisions, blocked work
- Show queue state and recent activity
- No more hunting in Notion for status

**Phase 2: Triage Interface**
- Quick-action buttons for common dispositions
- Inline pillar/priority assignment
- Capture from any page with context

**Phase 3: Conversation Layer**
- Chat interface to Atlas in the side panel
- Desktop equivalent of Telegram clarification
- Full context: current page, recent sparks, queue state

### Persistent Agent (grove-node-1)

A Claude Code instance running persistently to act as Atlas's "hands":
- Executes longer tasks without session timeouts
- Runs monitoring loops (inbox scan, engagement tracking)
- Picks up clarified tasks from Notion queue
- Operates autonomously while Jim is away
- Reports back via Telegram or Feed

---

## Product Workstreams

### 1. Atlas Core (Triage & Execution)

**Goal:** Inbox to close with minimal friction

**Key metrics:**
- Time from capture to triage decision
- Items stuck in "pending feedback" > 48 hours
- Inbox zero achievement rate

**Current components:**
- `atlas_inbox_scan.py` - Inbox visibility
- `atlas_startup.py` - Session initialization
- `notion_pipeline/` - Triage workflows
- Notion databases (Inbox, Feed, Memory)

**Priority problems:**
- P1: No real-time visibility into queue state
- P1: Blocked items invisible until manual check
- P2: Triage decisions require Notion context-switch
- P2: Session handoffs lose momentum

---

### 2. Life Projects (Home, Personal, Consulting)

**Goal:** Track projects across all pillars with equal capability

**Key metrics:**
- Budget accuracy (actual vs tracked)
- Expense capture time (< 30 seconds target)
- Project milestone visibility

**Current components:**
- Notion project pages (manual)
- Four pillars taxonomy
- No dedicated tooling yet

**Priority problems:**
- P1: No budget tracking for garage build (or any project)
- P1: Expense capture requires too many steps
- P2: Progress milestones not visible at a glance
- P2: Contractor/vendor follow-ups get lost

**Active projects:**
- Garage build (Home/Garage) - budget ~$X, in progress
- DrumWave engagement (Consulting)
- Grove community launch (The Grove)

---

### 3. Grove Marketing Suite

**Goal:** Build Grove community with minimal manual effort

**Key metrics:**
- LinkedIn engagement → Contact conversion rate
- Content throughput (ideas → published)
- Sales Nav list growth by segment

**Current components:**
- `atlas-chrome-ext/` - LinkedIn automation
- `grove_docs_refinery/` - Content pipeline
- `grove_research_generator/` - Document generation
- `phantombuster_etl.py` - Engagement capture

**Priority problems:**
- P2: Extension UI needs polish for daily use
- P2: Content pipeline still requires CLI
- P3: No visibility into engagement trends

---

### 4. Infrastructure & Skills

**Goal:** Reliable foundation for agent coordination

**Key metrics:**
- Skill creation time
- Cross-session state reliability
- Multi-machine sync accuracy

**Current components:**
- `skills/` - Skill system
- `.claude/` - Custom instructions
- `launchers/` - Multi-model support
- `.agent/` - Coordination infrastructure

**Priority problems:**
- P3: Skills system underutilized
- P3: Multi-machine state not synced
- P3: Agent dispatch patterns underdeveloped

---

## The Four Pillars

All Atlas work routes to one of four life domains. **These are equal citizens**—the architecture serves a garage build just as well as an AI venture sprint.

| Pillar | Scope | Example Projects |
|--------|-------|------------------|
| **Personal** | Health, relationships, growth, finances | Fitness tracking, learning goals, family trip planning, investment research |
| **The Grove** | AI venture, architecture, research | Sprints, blog posts, technical specs, community building |
| **Consulting** | Client work, professional services | DrumWave deliverables, Take Flight projects, client communications |
| **Home/Garage** | Physical space, house, vehicles | Garage renovation (active), permits, repairs, tool inventory |

### Current Active Projects by Pillar

**Home/Garage: Garage Build**
- Budget tracking (materials, labor, permits)
- Progress milestones and photos
- Contractor coordination
- Permit status and inspections
- Tool/equipment purchases

**The Grove: Community Launch**
- LinkedIn engagement automation
- Content pipeline
- Sales Navigator outreach

**Consulting: Active Clients**
- DrumWave advisory
- Take Flight operations

**Personal:** (examples)
- Health metrics and goals
- Reading/learning queue
- Family coordination

### Why Equal Pillars Matter

The same Atlas capabilities should work across all domains:
- **Capture:** Drop a garage receipt into inbox just like a research link
- **Triage:** Classify to pillar, assign priority, route to project
- **Track:** See progress on garage budget same as sprint burndown
- **Surface:** "You're over budget on lumber" as visible as "blocked on client feedback"

---

## Success Criteria (North Star)

**For Jim:**
- "I dropped it in, Atlas handled it, I saw the result without hunting"
- "I know what's blocked on me at a glance"
- "Sessions pick up where they left off"

**For the system:**
- Inbox → Triaged < 5 minutes (automated)
- Blocked items surfaced within same session
- Zero items lost between sessions

---

## Open Questions

1. **Extension vs. Telegram:** Which real-time interface to prioritize? Extension has richer context, Telegram has mobile reach.

2. **Notion as backend:** Keep Notion as source of truth, or migrate to lighter-weight state? Notion provides UI for manual overrides but adds latency.

3. **Claude integration:** How deeply should the extension integrate with Claude? Could the side panel become a Claude chat with Atlas context injected?

4. **Multi-machine:** How to handle Atlas running on laptop vs grove-node-1? Currently uses machine tags in Feed but no real sync.

---

## Next Steps

1. Create BACKLOG.md with prioritized features
2. Identify highest-leverage P1 item to prototype
3. Set up this Claude project as PM command center
4. Sync product artifacts to Notion when stable

---

*Atlas: Triage, organize, execute—without fighting the brain you have.*
