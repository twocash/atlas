---
name: triage-inbox
description: Process captured items in the Inbox, classify and route
trigger: triage inbox, process inbox, what's in the inbox, check inbox
created: 2026-01-30T00:00:00.000Z
---

# triage-inbox

Process captured items in the Inbox, classify and route

## Trigger

"triage inbox", "process inbox", "what's in the inbox", "check inbox", "triage"

## Instructions

1. **Fetch Captured Items**
   - Call `inbox_list` (defaults to Status = Captured)
   - List all pending items awaiting triage

2. **For Each Item, Determine:**
   - **Pillar**: Personal, The Grove, Consulting, Home/Garage
   - **Type**: Draft, Build, Research, Process, Schedule, Answer
   - **Priority**: P0 (today), P1 (this week), P2 (this month), P3 (someday)
   - **Implicit Tasks**: Does this need synthesis or has hidden complexity?

3. **Present Triage Decisions**
   ```html
   <b>Inbox Triage</b>
   Found [N] items

   1. <b>[Item Title]</b>
      → <code>[Pillar]</code> | <code>[Type]</code> | <code>[Priority]</code>
      [Brief reasoning]

   2. ...
   ```

4. **Wait for Confirmation**
   - Ask: "Proceed with triage?"
   - On confirm: update each item in Notion
   - On correction: adjust and re-confirm

5. **After Triage**
   - Report summary of actions taken
   - Note any items moved to Work Queue
   - Flag any that need Jim's input

6. **Routing Rules**
   - Permits → always Home/Garage
   - Client mentions → always Consulting
   - AI/LLM research → always The Grove
   - Health/gym/family → Personal
