# Dev Pipeline Standard Operating Procedures

*How bugs, features, and hotfixes flow through Atlas development.*

---

## Overview

The Dev Pipeline is the canonical tracking system for all Atlas development work. Items flow from identification through completion with full audit trails.

---

## Workflow States

| Status | Meaning | Next Action |
|--------|---------|-------------|
| **Captured** | Identified, not yet analyzed | Triage and classify |
| **Triaged** | Analyzed, scope defined | Ready for development |
| **In Progress** | Actively being worked | Monitor, unblock |
| **Review** | Code complete, needs review | Verify and test |
| **Done** | Shipped and verified | Close and document |

---

## Item Types

### BUG
Something is broken that was previously working.

**Required fields:**
- Title: Clear description of the failure
- Context: Steps to reproduce, error messages
- Priority: Based on impact (P0 = production down)

### FEATURE
New capability that doesn't exist yet.

**Required fields:**
- Title: What capability is being added
- Context: Why it's needed, use cases
- Priority: Based on value vs effort

### HOTFIX
Critical production issue needing immediate attention.

**Required fields:**
- Title: What's broken
- Context: Impact scope, affected systems
- Priority: Always P0

---

## Priority Guidelines

| Priority | Definition | Response Time |
|----------|------------|---------------|
| **P0** | Production broken, blocking Jim | Immediate |
| **P1** | Significant impact, this week | Same day |
| **P2** | Important, not urgent | This sprint |
| **P3** | Nice to have, backlog | When available |

---

## Creating Pipeline Items

### Via Atlas (Telegram)
```
"Create a bug: [description]"
"Log feature request: [description]"
"This is broken: [error details]"
```
Atlas will create the Dev Pipeline item and return the tracking URL.

### Via Pit Crew
```
mcp__pit_crew__dispatch_work with:
- type: bug | feature | hotfix
- title: Clear description
- context: Full details
- priority: P0 | P1 | P2 | P3
```

---

## Self-Improvement Loop (Atlas → Pit Crew → Atlas)

Atlas can identify its own limitations and dispatch work to fix them.

### Atlas Self-Filing Protocol

When Atlas encounters something it can't do:

1. **Identify the gap:**
   - Tool missing? Feature needed? Bug blocking?

2. **Create Feed entry:**
   - Pillar: The Grove
   - Work Type: self-improvement
   - Actionable: Yes
   - Notes: What Atlas tried, what failed, what's needed

3. **Dispatch to Pit Crew:**
   - Type: feature (capability gap) or bug (broken capability)
   - Priority: Based on impact (P1 if blocking user work)
   - Context: Include error messages, attempted approaches

4. **Track and confirm:**
   - Monitor discussion thread
   - Test when fix ships
   - Update Feed entry to Done

### Example Self-Improvement Items

| Limitation | Type | Priority | Outcome |
|------------|------|----------|---------|
| Can't update WQ status | Feature | P1 | Added notion_update tool |
| URL hallucination | Bug | P0 | Anti-hallucination system |
| No health checks | Feature | P2 | Health check battery |

This creates a virtuous cycle where Atlas becomes more capable over time.

---

## Anti-Patterns to Avoid

### Don't Do This

1. **Naked one-liners**
   - Bad: "Fix the bug"
   - Good: "BUG: Research Agent fails to process tasks when queue > 10 items"

2. **Missing context**
   - Bad: "It's broken"
   - Good: "Error: 'Cannot read property X of undefined' in handler.ts:142"

3. **Wrong priority**
   - Don't mark everything P0
   - P0 = production is actually broken

4. **Duplicate items**
   - Search before creating
   - Link related items

5. **Stale items**
   - Close what's done
   - Archive what's abandoned

---

## Closing Items

When work is complete:

1. **Update status to Done**
2. **Add resolution notes:** What was fixed, how
3. **Link the output:** PR URL, commit hash, deployed version
4. **Update changelog:** Via `update_self` tool

---

## Integration Points

### With Work Queue
Dev Pipeline items can reference Work Queue tasks and vice versa.

### With Feed
All Dev Pipeline actions are logged to Feed for audit trail.

### With Pit Crew
Pit Crew manages the discussion threads attached to Dev Pipeline items.

---

*Last updated: 2026-02-01*
*Version: 1.0.0*
