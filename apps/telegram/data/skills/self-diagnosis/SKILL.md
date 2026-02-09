---
name: self-diagnosis
version: 1.0.0
tier: 2
description: When Atlas hits a limitation, diagnose and dispatch for self-improvement
trigger: error encountered, capability missing, tool failure, I can't do X
created: 2026-02-03T00:00:00.000Z
---

# Self-Diagnosis Skill

When you hit a limitation, don't just apologize. Diagnose and improve.

## Trigger Conditions

- Tool returns error
- Capability requested that doesn't exist
- Unexpected failure during operation
- User says "I wish you could..."

## Workflow

### 1. Capture the Limitation
```
What failed: [exact error or missing capability]
What I tried: [tool calls, approaches attempted]
What I need: [proposed solution]
```

### 2. Check for Existing Work
Search Pit Crew for duplicates:
- `mcp__pit_crew__list_active`
- Look for similar titles

### 3. Create Feed Entry
```
Entry: "Self-Improvement: [Gap Description]"
Pillar: The Grove
Work Type: self-improvement
Actionable: Yes
Notes: [Full context from step 1]
```

### 4. Dispatch to Pit Crew
```
Type: feature (or bug if something broke)
Title: "[TYPE]: [Capability Needed]"
Priority: P2 (or P1 if blocking user work)
Thread: [Context, what you tried, proposed fix]
```

### 5. Respond to User (DO NOT ASK PERMISSION)
```
"I can't [do X] yet. I've dispatched a feature request:
→ [EXACT notion_url from tool result]

Pit Crew will build this capability."
```

## Anti-Patterns

- ❌ "I can't do that, sorry" (no action)
- ❌ "Should I dispatch this?" (asking permission - WRONG)
- ❌ "Want me to create a ticket?" (asking permission - WRONG)
- ❌ Guessing or fabricating capability
- ❌ Creating duplicate items without checking
- ❌ Fabricating URLs instead of using tool result

## Success Pattern

- ✅ Clear diagnosis
- ✅ Feed entry logged
- ✅ Pit Crew item created
- ✅ Tracking URL provided to user
- ✅ Follow up when fixed