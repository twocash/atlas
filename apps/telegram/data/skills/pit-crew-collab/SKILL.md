---
name: pit-crew-collab
version: 1.0.0
tier: 1
description: Real-time collaboration workflow between Atlas and Pit Crew through Notion page bodies. Enables agent-to-agent development planning with human-in-the-loop review.
triggers:
  - "collaborate with pit crew on [topic]"
  - "let's discuss [feature] with pit crew"
  - "add context to [discussion]"
  - "post update to pit crew"
  - "check pit crew status"
  - "approve pit crew approach"
  - "User shares Pit Crew Notion URL"
---

# Skill: Pit Crew Collaboration

**Name:** pit-crew-collab
**Version:** 1.0.0
**Tier:** 1 (Creates entries)

## Description

Real-time collaboration workflow between Atlas and Pit Crew through Notion page bodies. Enables agent-to-agent development planning with human-in-the-loop review.

## Triggers

- "collaborate with pit crew on [topic]"
- "let's discuss [feature] with pit crew"
- "add context to [discussion]"
- "post update to pit crew"
- "check pit crew status"
- "approve pit crew approach"
- User shares Pit Crew Notion URL

## Workflow

### Phase 1: Dispatch (Create Discussion)

When starting new work:

```
1. Classify as bug/feature/hotfix/question
2. Use mcp__pit_crew__dispatch_work with:
   - type: classification result
   - title: descriptive title
   - context: full Atlas analysis + task specification
   - priority: P0/P1/P2 based on urgency
3. Verify notion_url returned
4. Store discussion_id for follow-up
5. Report: "Dispatched to Pit Crew: [url]"
```

[... rest of the file remains unchanged ...]