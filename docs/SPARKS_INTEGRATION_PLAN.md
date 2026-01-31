# SPARKS Framework Integration Plan v2

**Document:** Identity-Layer Integration
**Author:** Atlas [Telegram]
**Date:** 2026-01-31
**Status:** DRAFT - Awaiting Jim's Approval

---

## Philosophy

SPARKS isn't a classification system bolted onto Atlas. It's **how Atlas understands Jim's world**. The framework belongs in the identity layer:

| File | Contains | SPARKS Content |
|------|----------|----------------|
| **SOUL.md** | How Atlas thinks | Interpretation logic, confidence protocol, clarification rules |
| **USER.md** | Jim's world | Pillars, signals, clients, patterns |
| **MEMORY.md** | Learned patterns | Corrections, temporal rules, accumulated wisdom |

When Atlas wakes up and reads these files, it doesn't run a "classifier" - it simply *knows* how to interpret sparks because that knowledge is part of its identity.

---

## Key Decisions

### 1. Five Pillars (Atlas Dev promoted)

| Pillar | Scope | Primary Signals |
|--------|-------|-----------------|
| **Personal** | Health, relationships, growth, finances | gym, family, vacation, investment |
| **The Grove** | AI venture, research, thesis, content | distributed, multi-agent, LEANN, thesis |
| **Consulting** | Take Flight client work | Client names, deliverable, SOW |
| **Home/Garage** | Physical space, permits, vehicles | permits, contractor, renovation, lumber |
| **Atlas Dev** | Atlas infrastructure, tools, capabilities | "Atlas should", MCP, orchestration, triage |

**Action:** Update Work Queue items currently tagged "The Grove" that are actually Atlas Dev work.

### 2. Take Flight Client List

**Take Flight Learning** = Jim's consulting entity (the one that bills)

**Clients:**
- DrumWave
- Monarch
- Wells Fargo
- Chase
- Bank of America
- PNC Bank
- *(others as identified)*

Any mention of these → Consulting pillar, high confidence.

### 3. Grove Sprout Factory

**New Notion Database:** `Grove Sprout Factory`

**Purpose:** Processed research prompts ready for execution. When Atlas identifies Grove research, it auto-generates a sprout and files it here.

**Schema:**
| Property | Type | Purpose |
|----------|------|---------|
| Title | Title | Topic/question |
| Status | Select | Draft, Ready, Executing, Complete |
| Prompt | Text (code block) | Copy-paste ready prompt |
| Source Spark | Relation | Link to original Feed entry |
| Executor | Select | Grove Software, Atlas Research Agent, Manual |
| Priority | Select | P0-P3 |
| Created | Date | Auto |

**Sprout Prompt Template:**
```markdown
# Research Sprout: [Topic]

## Core Question
[Primary research question]

## Grove Relevance
- How does this relate to Grove's thesis?
- What's the key insight or mechanism?
- How could Grove incorporate or respond?

## Research Parameters
- Depth: [light/standard/deep]
- Sources to prioritize: [academic, technical, industry]
- Sources to avoid: [if any]

## Expected Output
- [ ] Key findings summary
- [ ] Relevant sources cataloged
- [ ] Content potential assessed
- [ ] Next actions identified

## Context
[Any additional context from the original spark]
```

### 4. Auto-Sprout Configuration

**Setting:** `auto_create_sprouts` (stored in MEMORY.md or as Atlas preference)

| Value | Behavior |
|-------|----------|
| `on` | Every Grove research spark → auto-create sprout in Factory |
| `off` | Offer option: "Want me to create a sprout for this?" |
| `ask` | Always ask before creating |

**Default:** `on` - Jim can tell Atlas to turn it off.

### 5. Weekend Heuristic

**Rule:** Saturday/Sunday inputs get +15% confidence boost for Personal and Home/Garage pillars.

**Rationale:** Jim's weekend context is different from weekday. A Home Depot link on Saturday is almost certainly Home/Garage, not Consulting research.

---

## File Changes

### SOUL.md Additions

Add new section: **"## How I Interpret Sparks"**

```markdown
## How I Interpret Sparks

A spark is any raw input Jim shares: a link, a thought, a file, a screenshot. My job is to interpret intent and route correctly.

### Confidence Protocol

| Confidence | Action |
|------------|--------|
| **90%+** | Route automatically. Brief note: "Filed as Grove research." |
| **70-90%** | Route with caveat: "Filing as Grove—correct?" |
| **50-70%** | Quick clarification with A/B/C choices |
| **< 50%** | Must ask: "Help me understand the intent here." |

### The 10-Second Rule

Clarification must be answerable in under 10 seconds:
- Yes/No or A/B/C choices only
- No open-ended questions
- No multi-part questions
- Inline keyboard buttons when possible

**Good:** "Grove research or Atlas Dev experiment? A) Research B) Experiment C) Both"
**Bad:** "What would you like me to do with this?"

### Explicit Overrides

These signals override all other classification:
- `#grove` → The Grove (100%)
- `#atlas` → Atlas Dev (100%)
- `#home` or `#garage` → Home/Garage (100%)
- `#personal` → Personal (100%)
- `#consulting` or client name → Consulting (100%)

### Intent Taxonomy

Beyond pillar, I classify *what Jim wants*:

| Intent | Signals | Action |
|--------|---------|--------|
| **Research** | "look into", "what do we know" | Create research task, possibly sprout |
| **Catalog** | "add to corpus", "file this" | Quick capture, tag for retrieval |
| **Experiment** | "try this", "implement" | Create Atlas Dev task |
| **Task** | "do this", "set up", "fix" | Work Queue item |
| **Reference** | "fyi", "interesting" | Low-priority capture |
| **Question** | "what do you think" | Direct response |

### Grove Research → Sprout Factory

When I identify Grove research (confidence 70%+):
1. Create Feed entry
2. Auto-generate sprout prompt
3. File in Grove Sprout Factory (Notion)
4. Status: Ready for execution

This is configurable - Jim can tell me to stop auto-creating sprouts.
```

---

### USER.md Additions

Expand **"## The Four Pillars"** to **"## The Five Pillars"** with signals:

```markdown
## The Five Pillars

Jim's life is organized into five domains. These are equal citizens:

### Personal
**Scope:** Health, relationships, growth, finances

**Signals:**
- Keywords: health, fitness, diet, sleep, exercise, gym, family, travel, vacation, learning, courses, books, reading, finance, investment, budget
- Sites: Health/fitness sites, travel booking, educational platforms
- Context: Weekend morning links often Personal

### The Grove
**Scope:** AI venture, architecture, research, thesis, content

**Signals:**
- Keywords: distributed, decentralized, edge computing, p2p, local-first, collective intelligence, knowledge graph, multi-agent, LEANN, Grove, thesis, research corpus, AI infrastructure, open source AI, federated
- Sites: arxiv.org, papers.*, academic sources, AI research blogs
- URLs: linkedin.com (community/marketing context)
- Hashtag: #grove

**Subcategories:**
| Type | Signals |
|------|---------|
| Thesis Support | distributed intelligence, collective cognition, knowledge commons |
| Research Corpus | arxiv, academic, "add to corpus" |
| Technical Exploration | GitHub + Grove keywords, "how do they do X" |
| Content Seed | Social posts, quotable insights, hot takes |
| Competitive Intel | Similar products, market moves |
| Community Lead | LinkedIn profiles, interesting commenters |

### Consulting (Take Flight)
**Scope:** Client work billed through Take Flight Learning

**Clients:**
- DrumWave
- Monarch
- Wells Fargo
- Chase
- Bank of America
- PNC Bank

**Signals:**
- Keywords: client, deliverable, presentation, invoice, billing, SOW, engagement
- Any client name mention → Consulting (95% confidence)
- Hashtag: #consulting

### Home/Garage
**Scope:** Physical space, house, vehicles, permits

**Signals:**
- Keywords: construction, renovation, permits, inspection, contractor, materials, lumber, concrete, tools, workshop, garage, repair, maintenance, HVAC, electrical, plumbing
- Sites: homedepot.com, lowes.com, contractor sites, permit portals
- Context: Weekend links often Home/Garage
- Hashtag: #home, #garage

### Atlas Dev
**Scope:** Atlas infrastructure, capabilities, tools, self-improvement

**Signals:**
- Keywords: "Atlas should", "we should implement", agent memory, context management, orchestration, productivity system, task management, triage, MCP, Claude, Anthropic, tool use
- GitHub repos about: agents, memory, orchestration, productivity
- Phrases: "for Atlas", "Atlas could use this", "let's try this for us"
- Hashtag: #atlas

**Note:** Atlas Dev was previously a Grove subcategory. It's now its own pillar because Atlas infrastructure work is distinct from Grove research/thesis work.
```

---

### USER.md: URL Pattern Section

Add new section:

```markdown
## URL Patterns

Quick-reference for URL-based classification:

| URL Pattern | Pillar | Confidence |
|-------------|--------|------------|
| `arxiv.org`, `papers.*` | The Grove | High |
| `github.com` + AI/agent keywords | Grove or Atlas Dev | Medium (check content) |
| `github.com` + home automation | Home/Garage | High |
| `linkedin.com` | The Grove | Medium (community context) |
| `homedepot.com`, `lowes.com` | Home/Garage | High |
| Health, fitness, medical sites | Personal | High |
| Productivity tools, PKM, Notion | Personal or Atlas Dev | Medium (needs clarification) |
| News, general tech blogs | Varies | Low (use keyword analysis) |
```

---

### MEMORY.md Additions

Expand **"## Classification Rules"**:

```markdown
## Classification Rules

### Explicit Rules (Learned)
- Permits → always Home/Garage (not Consulting)
- Client mentions (DrumWave, Monarch, Wells Fargo, Chase, BoA, PNC) → always Consulting
- AI/LLM research → The Grove (unless "Atlas should" → Atlas Dev)
- "gym", "health", "family" → Personal
- "Atlas should", "for Atlas", "we should implement" → Atlas Dev

### Temporal Patterns
- Weekend (Sat/Sun) inputs: +15% confidence for Personal and Home/Garage
- If recent conversation about topic X, next spark about X is probably continuation
- Evening inputs skew Personal

### Session Context
- Maintain 24-48 hour context window for topic continuity
- Active project awareness affects classification
- Seasonal context matters (garage build active, tax season, etc.)

### Correction Protocol
When Jim corrects a classification:
1. Acknowledge: "Got it—filing under Personal, not Grove"
2. Log correction here with date
3. Look for pattern - if corrected twice for same thing, add explicit rule
4. Apply adjusted weighting going forward
```

Add new section:

```markdown
## Atlas Settings

### auto_create_sprouts
**Value:** on
**Options:** on | off | ask
**Description:** When Grove research is identified, automatically create a sprout in Grove Sprout Factory.

*(Atlas can update this setting when Jim requests)*
```

---

## Implementation Steps

### Phase 1: Update Identity Files (Do First)
1. Update SOUL.md with interpretation logic
2. Update USER.md with five pillars + signals
3. Update MEMORY.md with expanded rules + settings
4. **No code changes needed** - just file edits

### Phase 2: Create Grove Sprout Factory
1. Create Notion database with schema above
2. Add database ID to .env
3. Add `create_sprout` tool to agents.ts or new sprouts.ts
4. Wire into classification flow

### Phase 3: Update Classification Flow
1. Add Atlas Dev to pillar enum in types.ts
2. Update classification prompt to reference SOUL.md interpretation logic
3. Add weekend heuristic to classifier
4. Update existing Work Queue items (Grove → Atlas Dev where appropriate)

### Phase 4: Sprout Auto-Creation
1. When classification = Grove + Research intent
2. Generate sprout prompt from template
3. Create page in Grove Sprout Factory
4. Link back to Feed entry
5. Respect `auto_create_sprouts` setting

---

## Database ID Needed

**Grove Sprout Factory** - Jim needs to create this database in Notion and share the ID.

Suggested location: Same workspace as Feed 2.0 and Work Queue 2.0.

---

## Success Criteria

1. **Identity-driven:** Classification emerges from SOUL/USER/MEMORY, not hardcoded logic
2. **Five pillars:** Atlas Dev recognized as distinct from Grove
3. **Sprout Factory:** Grove research auto-populates prompt library
4. **Configurable:** Jim can toggle auto-sprout on/off via Atlas
5. **Weekend-aware:** Temporal context improves accuracy
6. **Client-aware:** All Take Flight clients route to Consulting

---

## Next Steps

1. **Jim reviews this plan**
2. **Jim creates Grove Sprout Factory database in Notion**
3. **Atlas updates SOUL.md, USER.md, MEMORY.md** (Phase 1)
4. **Atlas wires up Sprout Factory** (Phase 2-4)

---

*Ready for Jim's approval.*
