---
name: weekly-review
description: Structured weekly review of all pillars and work queue
version: 1.0.0
tier: 2
trigger: weekly review, week recap, what happened this week, end of week
created: 2026-01-29T00:00:00.000Z
---

# weekly-review

Structured weekly review of all pillars and work queue

## Trigger

"weekly review", "week recap", "what happened this week", "end of week"

## Instructions

1. **Get Status Summary**
   - Call `get_status_summary` to see current state
   - Note active items, blocked items, completed this week

2. **Review Each Pillar**
   For each of the four pillars (Personal, The Grove, Consulting, Home/Garage):
   - Call `work_queue_list` with pillar filter
   - Summarize: completed, in-progress, blocked
   - Note any items that need attention

3. **Identify Wins**
   - List 2-3 accomplishments from the week
   - Highlight shipped/done items

4. **Surface Blockers**
   - List any blocked items
   - Suggest next steps to unblock

5. **Next Week Preview**
   - Show P0 and P1 items for next week
   - Flag any deadlines

6. **Format Response**
   ```html
   <b>Weekly Review</b>

   <b>Wins</b>
   • [win 1]
   • [win 2]

   <b>By Pillar</b>
   • Personal: [summary]
   • The Grove: [summary]
   • Consulting: [summary]
   • Home/Garage: [summary]

   <b>Blocked</b>
   • [item] - [what's needed]

   <b>Next Week</b>
   • [P0/P1 items]
   ```