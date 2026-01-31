# Feature Request: Grove Sprout Factory

**Pillar:** Atlas Dev
**Type:** Build
**Priority:** P1
**Requested By:** Jim
**Date:** 2026-01-31

---

## Summary

Build the **Grove Sprout Factory** - a Notion database and Atlas tooling that automatically generates research prompts ("sprouts") when Grove research is identified. These prompts are copy-paste ready for execution by Grove Software, Atlas Research Agent, or manual use.

---

## Problem Statement

When Jim shares Grove-relevant research (arxiv papers, GitHub repos, AI articles), Atlas currently:
1. Classifies it as Grove
2. Creates a Feed entry
3. Maybe creates a Work Queue item

**What's missing:** The research intent isn't captured as an actionable, structured prompt. Jim has to manually formulate what questions to ask, what angle to take, how deep to go.

**Solution:** Auto-generate a "sprout" - a pre-structured research prompt ready for execution.

---

## Requirements

### R1: Create Notion Database - Grove Sprout Factory

**Database Name:** Grove Sprout Factory
**Location:** Same workspace as Feed 2.0 and Work Queue 2.0

**Schema:**

| Property | Type | Values/Description |
|----------|------|-------------------|
| Title | Title | Research topic/question |
| Status | Select | Draft, Ready, Executing, Complete, Archived |
| Prompt | Text | The full prompt in a code block |
| Source Spark | Relation | → Feed 2.0 (link to original) |
| Executor | Select | Grove Software, Atlas Research Agent, Manual |
| Priority | Select | P0, P1, P2, P3 |
| Depth | Select | light, standard, deep |
| Pillar | Select | The Grove (default), Atlas Dev |
| Created | Date | Auto-set on creation |
| Executed | Date | When marked Executing or Complete |

### R2: Sprout Prompt Template

Every sprout should contain a structured prompt in this format:

```markdown
# Research Sprout: [Topic]

## Core Question
[Primary research question extracted from spark]

## Grove Relevance
- How does this relate to Grove's distributed intelligence thesis?
- What's the key insight or mechanism?
- How could Grove incorporate or respond to this?

## Research Parameters
- **Depth:** [light/standard/deep]
- **Sources to prioritize:** [academic, technical, industry, social]
- **Sources to avoid:** [if any]
- **Time horizon:** [historical context, current state, future implications]

## Expected Output
- [ ] Key findings summary (3-5 bullet points)
- [ ] Relevant sources cataloged with links
- [ ] Content potential assessed (blog? whitepaper? tweet thread?)
- [ ] Next actions identified
- [ ] Grove corpus additions tagged

## Original Context
[Caption or text from the original spark]
[URL if applicable]

## Execution Notes
[Space for the executor to add notes during research]
```

### R3: Add `create_sprout` Tool

**Tool Name:** `create_sprout`
**Location:** `apps/telegram/src/conversation/tools/sprouts.ts` (new file)

**Input Schema:**
```typescript
{
  topic: string;           // Research topic/question
  source_url?: string;     // URL from original spark
  source_text?: string;    // Text from original spark
  depth: 'light' | 'standard' | 'deep';
  priority: 'P0' | 'P1' | 'P2' | 'P3';
  grove_subcategory?: string;  // Thesis Support, Research Corpus, etc.
  feed_id?: string;        // Link back to Feed entry
}
```

**Behavior:**
1. Generate prompt from template
2. Create page in Grove Sprout Factory database
3. Set Status = Ready
4. Set Executor = (infer or default to Manual)
5. Link to Feed entry if provided
6. Return Notion URL

### R4: Wire into Classification Flow

**When to create sprout:**
- Pillar = The Grove
- Intent = Research (from intent taxonomy)
- Confidence >= 70%
- `auto_create_sprouts` setting = on (check MEMORY.md)

**Integration point:** `handler.ts` after classification, before response

**Flow:**
```
Message received
    ↓
Classification (pillar=Grove, intent=Research, confidence=85%)
    ↓
Check auto_create_sprouts setting
    ↓
If on → call create_sprout tool
    ↓
Include sprout URL in response to Jim
```

### R5: Response Format

When a sprout is auto-created, Atlas should respond:

```html
<b>Grove Research Identified</b>
📚 Topic: [extracted topic]
🎯 Depth: standard
✅ Sprout created → <a href="[notion_url]">View in Sprout Factory</a>

Ready for execution by Grove Software or manual research.
```

### R6: Manual Sprout Creation

Atlas should also support explicit sprout creation:

**Triggers:**
- "create a sprout for this"
- "add to sprout factory"
- "make this a research prompt"

**Behavior:** Same as auto-creation, but always fires regardless of setting.

### R7: Sprout Execution Tracking

When Jim (or an agent) marks a sprout as Executing or Complete:
- Set Executed date
- Optionally link to output (research doc, blog post, etc.)

Future enhancement: Atlas monitors Sprout Factory and can dispatch research agent on Ready items.

---

## Implementation Steps

1. **Jim creates database** in Notion with schema above
2. **Add database ID** to `.env` as `NOTION_SPROUT_FACTORY_DB`
3. **Create `sprouts.ts`** with `create_sprout` tool
4. **Add to tool registry** in `tools/index.ts`
5. **Wire into handler.ts** classification flow
6. **Test** with Grove research inputs
7. **Document** in prompt.ts Available Tools section

---

## Environment Variable

Add to `.env.example` and `.env`:
```
# Grove Sprout Factory database ID
NOTION_SPROUT_FACTORY_DB=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

---

## Success Criteria

1. ✅ Grove research auto-generates sprout in Notion
2. ✅ Sprout contains copy-paste ready prompt
3. ✅ Sprout links back to original Feed entry
4. ✅ Jim can toggle auto-creation on/off
5. ✅ Manual "create sprout" command works
6. ✅ Response includes Notion link to sprout

---

## Dependencies

- Grove Sprout Factory Notion database (Jim creates)
- SPARKS framework in identity files (✅ Phase 1 complete)
- Notion API access (✅ already configured)

---

## Estimated Effort

- Database creation: 10 minutes (Jim)
- Tool implementation: 2-3 hours (Atlas Dev)
- Testing: 30 minutes

---

## Notes

This is Phase 2 of the SPARKS integration. The identity layer updates (Phase 1) are complete - Atlas now knows about Grove subcategories, intent taxonomy, and the sprout concept. This feature request implements the tooling.

The Sprout Factory becomes a **prompt library** - a queue of research-ready prompts that can be executed by:
- Grove Software (automated research pipeline)
- Atlas Research Agent (dispatch_research)
- Jim manually (copy-paste into Claude/ChatGPT)

---

*Feature request ready for Atlas Work Queue.*
