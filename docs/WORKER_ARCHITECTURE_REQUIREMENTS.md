# Atlas Worker Architecture & Requirements

*For Gemini review and guidance*

---

## Part 1: Current Architecture Overview

### System Identity

**Atlas** is Jim's AI Chief of Staff — a cognitive co-pilot that triages, organizes, and executes work across four life domains (Pillars):

| Pillar | Scope |
|--------|-------|
| Personal | Health, relationships, growth, finances |
| The Grove | AI venture, architecture, research |
| Consulting | Client work, professional services |
| Home/Garage | Physical space, house, vehicles |

### Core Components

```
┌─────────────────────────────────────────────────────────────┐
│                     INPUT LAYER                              │
│  Telegram Bot (mobile-first) ──→ Cognitive Router            │
│  (Haiku classifier → Sonnet executor)                        │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   NOTION DATABASES                           │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │  Feed 2.0    │  │ Work Queue   │  │ Dev Pipeline │       │
│  │ (activity    │  │    2.0       │  │ (bugs/       │       │
│  │   log)       │  │ (task ledger)│  │  features)   │       │
│  └──────────────┘  └──────────────┘  └──────────────┘       │
│                                                              │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    MCP SERVERS                               │
│  pit_crew (agent-to-agent) │ notion (official)              │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   EXECUTION LAYER                            │
│  Research Agent │ Skills System │ File Operations            │
│  (Gemini grounding)                                          │
└─────────────────────────────────────────────────────────────┘
```

### Database Schemas

#### Feed 2.0 (Activity Log)
Every interaction is logged here. Single source of truth for "what happened."

| Field | Type | Purpose |
|-------|------|---------|
| Entry | Title | Summary of activity |
| Notes | Rich Text | Full context |
| Pillar | Select | Life domain |
| Action Type | Select | Research/Build/Draft/etc |
| Priority | Select | P0-P3 |
| Actionable | Checkbox | Requires follow-up |
| Confidence | Select | Classification confidence |
| Status | Status | Captured/Processing/Routed/Complete |

#### Work Queue 2.0 (Task Ledger)
The backlog of work to be done.

| Field | Type | Purpose |
|-------|------|---------|
| Task | Title | What needs to be done |
| Status | Status | Captured/Triaged/Active/Paused/Blocked/Done/Shipped |
| Priority | Select | P0-P3 |
| Type | Select | Research/Build/Draft/Schedule/Answer/Process |
| Pillar | Select | Life domain |
| Assignee | Select | Jim/Atlas [Telegram]/Agent |
| Notes | Rich Text | Context and details |
| Queued | Date | When added |
| Started | Date | When work began |
| Completed | Date | When finished |
| Output | URL | Link to deliverable |
| Resolution Notes | Rich Text | What was done |

#### Dev Pipeline (Development Tracking)
Bugs, features, and infrastructure work.

| Field | Type | Purpose |
|-------|------|---------|
| Discussion | Title | Issue description |
| Type | Select | Bug/Feature/Hotfix/Question |
| Status | Select | Dispatched/In Progress/Shipped/Closed |
| Priority | Select | P0-P2 |
| Handler | Select | Pit Crew/Jim/Atlas |
| Thread | Rich Text | Discussion content |
| Resolution | Rich Text | What was delivered |

### Current Task Lifecycle

```
User Input
    │
    ▼
┌─────────┐     ┌─────────┐     ┌─────────┐     ┌─────────┐
│Captured │ ──→ │ Triaged │ ──→ │ Active  │ ──→ │  Done   │
└─────────┘     └─────────┘     └─────────┘     └─────────┘
    │               │               │               │
    │               │               │               ▼
    │               │               │          ┌─────────┐
    │               │               └────────→ │ Shipped │
    │               │                          └─────────┘
    │               ▼
    │          ┌─────────┐
    └────────→ │ Blocked │
               └─────────┘
```

**Current Problem:** Tasks enter the queue but nothing autonomously moves them through. Atlas can update status when asked, but there's no worker loop that:
1. Polls for ready work
2. Claims and executes it
3. Updates progress
4. Marks completion

---

## Part 2: What's Missing — The Worker Gap

### Current State
- ✅ Capture works (Telegram → Feed → Work Queue)
- ✅ Classification works (Cognitive Router)
- ✅ Dispatch works (submit_ticket → Dev Pipeline or Work Queue)
- ✅ Manual status updates work (work_queue_update)
- ❌ **No autonomous execution loop**
- ❌ **No progress tracking during execution**
- ❌ **No completion verification**

### The Gap Illustrated

**What happens now:**
```
Jim: "Research MCP servers for Google Calendar"
Atlas: Creates Work Queue item with Status=Triaged
       ...item sits there forever...
Jim: "Hey what happened to that research?"
Atlas: "Oh let me check... it's still Triaged"
```

**What should happen:**
```
Jim: "Research MCP servers for Google Calendar"
Atlas: Creates Work Queue item with Status=Triaged
       ↓
Worker Loop: Sees Triaged item, claims it (Status=Active)
       ↓
Worker Loop: Executes research (Gemini grounding, web search)
       ↓
Worker Loop: Updates item with findings, Status=Done
       ↓
Atlas: "Research complete. Here's what I found: [summary]"
```

---

## Part 3: Requirements for Worker System

### Core Requirements

1. **Polling/Trigger Mechanism**
   - Worker should check for Triaged items on a schedule OR
   - Be triggered when new items enter Triaged status
   - Respect priority ordering (P0 before P1, etc.)

2. **Claim & Lock**
   - Worker claims an item by setting Status=Active + Assignee=Agent
   - Prevents duplicate processing
   - Timeout/heartbeat for stale claims

3. **Execution by Type**
   - Different execution paths based on Type field:
     - **Research** → Gemini grounding, web search, synthesize findings
     - **Build** → Code generation, file operations, testing
     - **Draft** → Content generation with voice/style
     - **Process** → Administrative workflows
     - **Schedule** → Calendar operations (future)
     - **Answer** → Quick response, comment reply

4. **Progress Updates**
   - Update Notes field with progress during execution
   - Optionally log to Feed for visibility
   - Handle long-running tasks gracefully

5. **Completion & Verification**
   - Set Status=Done when complete
   - Populate Resolution Notes with what was accomplished
   - Populate Output with deliverable URL if applicable
   - Optionally verify output exists/is valid

6. **Error Handling**
   - Set Status=Blocked on failure
   - Populate Blocked Reason with error details
   - Dispatch to Pit Crew if code-level fix needed

### Non-Requirements (Avoiding Drift)

- ❌ Don't create new databases for worker state
- ❌ Don't create parallel task tracking systems
- ❌ Don't add complex queue infrastructure (Redis, etc.)
- ❌ Don't create worker-specific status values
- ✅ Use existing Work Queue fields
- ✅ Use existing status lifecycle
- ✅ Log to Feed for audit trail

---

## Part 4: Proposed Architecture

### Option A: Integrated Worker (Preferred)

Worker runs inside Atlas Telegram bot process. Simpler, single deployment.

```
┌─────────────────────────────────────────────────────────────┐
│                  ATLAS TELEGRAM BOT                          │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │  Conversation │  │   Worker     │  │   Scheduler  │       │
│  │    Handler   │  │    Loop      │  │   (cron)     │       │
│  └──────────────┘  └──────────────┘  └──────────────┘       │
│         │                 │                 │                │
│         └────────────────┼─────────────────┘                │
│                          ▼                                   │
│                   ┌──────────────┐                          │
│                   │  Execution   │                          │
│                   │   Engine     │                          │
│                   └──────────────┘                          │
│                          │                                   │
│         ┌────────────────┼────────────────┐                 │
│         ▼                ▼                ▼                 │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐        │
│  │  Research    │ │    Draft     │ │   Process    │        │
│  │  Executor    │ │  Executor    │ │  Executor    │        │
│  └──────────────┘ └──────────────┘ └──────────────┘        │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

**Trigger options:**
- Timer-based: Check every N minutes
- Event-based: Webhook/poll on Notion update
- Manual: `/work` command triggers one cycle

### Option B: Separate Worker Process

Worker runs as independent process. More complex but scales independently.

```
┌─────────────────┐         ┌─────────────────┐
│  Atlas Telegram │         │  Atlas Worker   │
│      Bot        │         │    Process      │
│                 │         │                 │
│  (Capture/Chat) │         │  (Execution)    │
└────────┬────────┘         └────────┬────────┘
         │                           │
         └───────────┬───────────────┘
                     ▼
              ┌──────────────┐
              │    Notion    │
              │  Work Queue  │
              └──────────────┘
```

### Recommended: Option A with Manual Trigger First

Start simple:
1. Add `/work` command that runs one worker cycle
2. Worker picks highest-priority Triaged item
3. Executes based on Type
4. Updates status and notes
5. Reports result to Jim

Then evolve:
1. Add timer-based polling (every 5 min)
2. Add Notion webhook for real-time triggering
3. Add parallel execution for independent tasks

---

## Part 5: Schema Considerations

### Potential New Fields on Work Queue

| Field | Type | Purpose |
|-------|------|---------|
| Claimed At | Date | When worker started |
| Worker ID | Select | Which worker instance claimed |
| Execution Log | Rich Text | Step-by-step progress |
| Retry Count | Number | How many attempts |
| Last Error | Rich Text | Most recent error |

**Question for Gemini:** Are these fields necessary, or can we use existing fields creatively?

- Notes → Could hold execution log
- Started → Could serve as Claimed At
- Blocked Reason → Could hold Last Error

### Potential New Database: Execution History

**Only if needed.** Would track:
- Which items were processed
- Execution duration
- Success/failure rates
- Performance metrics

**Current preference:** Avoid this. Use Feed 2.0 for audit trail instead.

---

## Part 6: Jim's Core Requirements

1. **Work should flow through without manual pushing**
   - Items that are Triaged should get picked up and executed
   - Status should update automatically as work progresses
   - Completion should be logged with what was accomplished

2. **Visibility into what's happening**
   - Know when work starts (Active)
   - Know when work completes (Done) or fails (Blocked)
   - See what was produced (Output, Resolution Notes)

3. **Avoid architectural drift**
   - Don't create parallel systems
   - Don't add infrastructure complexity
   - Use Notion as the source of truth
   - Keep the four pillars as the organizing principle

4. **Types should map to execution patterns**
   - Research → Deep dive with sources
   - Draft → Content generation
   - Build → Code/implementation
   - Process → Administrative workflow

5. **Self-healing on failure**
   - If execution fails, diagnose and dispatch fix
   - Don't silently drop work
   - Surface blockers clearly

---

## Part 7: Open Questions for Gemini

1. **Trigger Strategy**
   - Should the worker poll on a timer, or be event-driven?
   - What's the right polling interval for a personal assistant?

2. **Concurrency**
   - Should multiple items execute in parallel?
   - How to handle dependencies between items?

3. **Execution Context**
   - Does the worker need its own conversation context?
   - How does it report back to Jim without interrupting?

4. **Long-Running Tasks**
   - How to handle research that takes 10+ minutes?
   - Should there be a timeout? Checkpointing?

5. **Verification**
   - How does the worker know if a task is "really done"?
   - Should Jim approve before marking Shipped?

6. **Schema Evolution**
   - Are the proposed new fields worthwhile?
   - Or can we achieve this with existing schema?

---

## Summary

**Current State:** Atlas captures and triages well, but nothing executes autonomously.

**Desired State:** Work flows from Triaged → Active → Done without manual intervention.

**Constraints:**
- Use existing Notion databases
- Minimal new infrastructure
- Avoid drift from core patterns

**Preferred Approach:**
1. Start with `/work` manual trigger
2. Add timer-based polling
3. Evolve to event-driven as needed

---

*Document prepared for Gemini review. Open to architectural guidance.*
