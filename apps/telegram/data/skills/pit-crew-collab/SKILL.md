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

### Phase 2: Collaborate (Message Threading)

When continuing existing discussion:

```
1. Get discussion_id from context or URL
2. Use mcp__pit_crew__post_message with:
   - discussion_id: from dispatch or URL
   - from: 'atlas'
   - message: clarification/response
3. Message appears in Notion page body as callout
4. Report: "Posted to discussion: [url]"
```

### Phase 3: Progress (Status Updates)

When workflow advances:

```
1. Use mcp__pit_crew__update_status with:
   - discussion_id: from context
   - status: 'in-progress' | 'needs-approval' | 'approved' | 'deployed' | 'closed'
   - output: (optional) commit URL, PR link
2. Status syncs to Notion property AND page body
3. Report: "Status updated to [status]"
```

## MCP Tools Used

| Tool | When | What It Does |
|------|------|--------------|
| `mcp__pit_crew__dispatch_work` | New ticket | Creates Notion page with body |
| `mcp__pit_crew__post_message` | Collaboration | Appends to page body |
| `mcp__pit_crew__update_status` | Workflow | Updates property + message |
| `mcp__pit_crew__get_discussion` | Check context | Reads full thread |
| `mcp__pit_crew__list_active` | Overview | Lists open discussions |

## Page Body Structure

All dispatches create this structure in Notion:

```markdown
## 🤖 Atlas Analysis
> [Callout: Why this is needed, reasoning]

## 📋 Task Specification
[Paragraphs: Full requirements, details]

---

## 🔧 Pit Crew Work
(Placeholder for implementation notes)
```

## Message Formatting

Messages appear as callout blocks:

| From | Icon | Background |
|------|------|------------|
| Atlas | 🤖 | Blue |
| Pit Crew | 🔧 | Green |
| Jim | 👤 | Default |

All messages include: `[timestamp] content`

## Example Flows

### New Feature Request

```
User: "Atlas should auto-create tickets when skills fail 3x"

Atlas:
1. classify → FEATURE
2. dispatch_work:
   - type: 'feature'
   - title: 'Auto-Healing Skill System'
   - context: [Atlas Analysis + Specification]
   - priority: 'P1'
3. Return: "Dispatched: [notion_url]"
```

### Collaboration Response

```
Pit Crew: "Should failure count persist across restarts?"

Atlas:
1. get_discussion to read context
2. post_message:
   - discussion_id: '2026-02-03-auto-healing...'
   - from: 'atlas'
   - message: "Yes, persist to data/memory/skill-failures.json..."
3. Return: "Posted clarification to [notion_url]"
```

### Approve and Ship

```
User: "Looks good, approve it"

Atlas:
1. update_status:
   - discussion_id: from context
   - status: 'approved'
2. Return: "Approved for development"

[Later, after implementation]

Pit Crew:
1. update_status:
   - status: 'deployed'
   - output: 'https://github.com/twocash/atlas/commit/abc123'
2. Return: "Shipped! [commit_url]"
```

## Error Handling

| Error | Response |
|-------|----------|
| Discussion not found | "Can't find that discussion. Check the ID or URL." |
| MCP not connected | "Pit Crew MCP not available. Check server status." |
| Notion sync failed | "Created locally but Notion sync failed. Check NOTION_API_KEY." |

## Anti-Patterns

- ❌ Creating new discussions for follow-up questions (use post_message)
- ❌ Stuffing content into Thread property (use page body)
- ❌ Updating status without context (always explain why)
- ❌ Skipping dispatch for Atlas infrastructure issues (self-improve!)

## Dependencies

- `mcp__pit_crew__*` tools available
- Notion API key configured
- Dev Pipeline database accessible

## Outputs

- Feed entry: Logged interaction
- Notion page: Created or updated
- discussion_id: For future reference
- notion_url: For tracking

## Related Skills

- `self-diagnosis` - Dispatch for self-improvement
- `feed-first-classification` - Classify before dispatch
