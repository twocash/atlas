---
name: feed-first-classification
description: Complete workflow for processing every request through Feed 2.0 with full metadata analysis
version: 1.0.0
tier: core
---

# feed-first-classification

Complete workflow for processing every request through Feed 2.0 with full metadata analysis

## Trigger

Any task request, bug report, research query, or unclear interaction

## Instructions

# Feed First Classification Workflow

## MANDATORY: Every request MUST go through Feed 2.0 first

### Step 1: CREATE FEED ENTRY
Use `notion_create` to log to Feed 2.0 with ALL metadata fields:

**Core Fields:**
- **Entry:** Clear, logical summary (NOT raw user input)
- **Notes:** Original user request + timestamp
- **Pillar:** Personal/Grove/Consulting/Home/Atlas Dev
- **Action Type:** Research/Build/Draft/Route/Answer/Process
- **Priority:** P0/P1/P2/P3
- **Actionable:** Yes/No
- **Confidence:** High/Medium/Low (your classification confidence)
- **Complexity:** Simple/Standard/Complex
- **Follow-up Required:** Yes/No
- **Status:** Captured/Processing/Routed/Complete

### Step 2: ANALYZE & CLASSIFY
In the Feed entry, think through:
- What is Jim actually asking for?
- Which pillar does this belong to?
- What action should I take?
- Am I confident in this classification?

### Step 3: ASK FOR CLARIFICATION IF NEEDED
If confidence is Medium/Low, ask Jim:
- "Filing as [Pillar] [Action Type] - correct?"
- "This could be Grove research OR Atlas Dev - which?"
- Document the clarification in Notes

### Step 4: ROUTE TO APPROPRIATE SYSTEM
Once classified:
- Atlas Dev → Pit Crew dispatch
- Research → Research Agent
- Work tasks → Work Queue
- Content → Draft Agent

### Step 5: UPDATE FEED STATUS
Mark as "Routed" and include tracking URL

## METADATA GUIDELINES

**Entry Rewriting Examples:**
- Raw: "fix the thing"
- Rewritten: "Bug Report: Research Agent not processing tasks"

- Raw: "look into this link about AI"
- Rewritten: "Research Request: Analyze distributed AI architecture paper"

**Actionable Classification:**
- Yes: Requires work/follow-up
- No: FYI, reference, casual conversation

**Work Type Options:**
- research — Investigation, analysis, fact-finding
- build — Development, implementation, coding
- draft — Content creation, writing, editing
- schedule — Meetings, events, time-based tasks
- process — Administrative, workflow, maintenance
- self-improvement — Atlas capability gaps
- bug-fix — Something is broken
- infrastructure — System-level work

**Complexity Assessment:**
- Simple: Clear scope, routine action
- Standard: Normal complexity, well-defined
- Complex: Multiple approaches, unclear scope, high stakes

This workflow ensures maximum coherence at the single point where all work flows begin.