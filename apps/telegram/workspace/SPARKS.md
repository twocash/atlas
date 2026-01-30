# How Jim Thinks: The Spark Interpretation Guide

**Purpose:** Help Atlas correctly interpret and route input with minimal clarification.  
**Updated:** 2026-01-29

---

## What Is a Spark?

A spark is any raw input Jim shares with Atlas: a link, a thought, a file, a screenshot. Sparks are *unprocessed*—they carry intent that must be interpreted before action.

**The challenge:** The same input can mean different things depending on context. A GitHub repo about "agent memory" could be:
- Grove research to catalog
- Something for Atlas to implement
- A personal tool Jim wants to try
- All three

**The goal:** Use context clues to classify correctly 80%+ of the time, and ask smart clarifying questions for the rest.

---

## Classification Framework

### Step 1: Identify the Pillar

Use these signals in priority order:

#### Explicit Signals (Highest Confidence)
Jim may include direct hints. Watch for:

| Signal | Pillar | Confidence |
|--------|--------|------------|
| "#grove", "for grove", "grove research" | The Grove | High |
| "#atlas", "for us", "we should try" | Atlas Dev (→ Grove) | High |
| "#home", "#garage", "for the house" | Home/Garage | High |
| "#personal", "for me" | Personal | High |
| Client name (DrumWave, etc.) | Consulting | High |
| "interesting", "fyi", "saw this" | Lower priority, needs classification | Medium |

#### URL Pattern Signals

| URL Contains | Likely Pillar | Notes |
|--------------|---------------|-------|
| `arxiv.org`, `papers.`, `research` | Grove | Research corpus candidate |
| `github.com` + AI/agent keywords | Grove or Atlas Dev | Check content for clarity |
| `github.com` + home automation | Home/Garage | Smart home, etc. |
| `linkedin.com` | Grove | Community/marketing context |
| `homedepot.com`, `lowes.com`, contractor sites | Home/Garage | High confidence |
| Health, fitness, medical sites | Personal | High confidence |
| Productivity tools, PKM, Notion templates | Personal or Atlas Dev | Needs clarification |
| News, general tech blogs | Varies | Use keyword analysis |

#### Keyword Signals in Content

**Grove indicators:**
- distributed, decentralized, edge computing, p2p, local-first
- collective intelligence, knowledge graph, multi-agent
- LEANN, Grove (explicit), thesis, research corpus
- AI infrastructure, open source AI, federated

**Atlas Dev indicators:**
- "we should implement", "Atlas could use this"
- agent memory, context management, orchestration
- productivity system, task management, triage
- MCP, Claude, Anthropic, tool use

**Home/Garage indicators:**
- construction, renovation, permits, inspection
- contractor, materials, lumber, concrete
- tools, workshop, garage
- repair, maintenance, HVAC, electrical, plumbing

**Personal indicators:**
- health, fitness, diet, sleep, exercise
- family, travel, vacation
- learning, courses, books, reading
- finance, investment, budget (personal)

**Consulting indicators:**
- Client names: DrumWave, [add others]
- "for the client", "deliverable", "presentation"
- Invoice, billing, SOW, engagement

#### Temporal/Session Context

| Context | Interpretation |
|---------|----------------|
| Just discussed Grove sprint | Next AI link likely Grove-related |
| Active garage build conversation | Home improvement links → Home/Garage |
| Client call this week | Related industry news → possibly Consulting |
| Weekend, evening | More likely Personal or Home/Garage |

#### Recency Window
If Jim shared something about topic X in the last 24 hours, the next spark about X is probably a continuation. Maintain a short-term context window.

---

### Step 2: Determine Intent

Once pillar is identified, classify the *type* of engagement:

#### Intent Taxonomy

| Intent | Signals | Action |
|--------|---------|--------|
| **Research** | "look into", "what do we know about", academic sources | Create sprout, structured investigation |
| **Catalog** | "add to corpus", "file this", arxiv/papers | Tag and store in research corpus |
| **Experiment** | "try this", "test", "implement", GitHub repos | Create technical exploration task |
| **Content Seed** | Social posts, interesting takes, quotable | Flag for content pipeline |
| **Reference** | "fyi", "interesting", no action verb | Low-priority storage, tag for retrieval |
| **Task** | "do this", "set up", "create", "fix" | Create actionable task |
| **Question** | "what do you think", "how should we" | Requires response/analysis |

---

### Step 3: Grove-Specific Subcategorization

When pillar = Grove, further classify:

| Subcategory | Description | Signals |
|-------------|-------------|---------|
| **Thesis Support** | Foundational concepts that support Grove's core argument | distributed intelligence, collective cognition, knowledge commons |
| **Research Corpus** | Papers, articles to catalog in LEANN | arxiv, academic, "add to corpus" |
| **Technical Exploration** | Implementations, architectures to study | GitHub, code, "how do they do X" |
| **Content Seed** | Could become blog post, talking point | Social posts, hot takes, quotable insights |
| **Competitive Intel** | Other projects in the space | Similar products, market moves |
| **Community Lead** | Person to engage with | LinkedIn profiles, interesting commenters |

#### Sprout Suggestion Logic

When Grove research is identified, suggest a **sprout**—a structured research task:

```
Sprout: [Topic]
Questions to answer:
1. How does this relate to Grove's thesis?
2. What's the key insight or mechanism?
3. How could Grove incorporate or respond to this?
4. What sources should we catalog?
5. Is there content potential here?
```

---

## The Clarification Protocol

When confidence is < 70%, ask a focused question:

**Good clarification questions:**
- "Is this for Grove research or something for Atlas to implement?"
- "Should I set up a sprout for structured research, or just catalog it?"
- "Is this a task or just filing for reference?"
- "Home project or consulting-related?"

**Bad clarification questions:**
- "What do you want me to do with this?" (too open)
- "Can you tell me more?" (too vague)
- Long multi-part questions (loses the moment)

**The 10-second rule:** Clarification should take Jim < 10 seconds to answer. Yes/no or A/B/C choices.

---

## Context Accumulation

Atlas should maintain awareness of:

1. **Active Projects** - What's currently in flight per pillar
2. **Recent Sparks** - Last 24-48 hours of input (topic continuity)
3. **Pending Decisions** - What's blocked on Jim
4. **Seasonal Context** - Garage build is active now, tax season, etc.

This context helps interpret ambiguous sparks without asking.

---

## Confidence Thresholds

| Confidence | Action |
|------------|--------|
| **90%+** | Classify and route automatically, note assumption in brief |
| **70-90%** | Classify with caveat: "Filing as Grove research—correct?" |
| **50-70%** | Quick clarification: "Grove research or Atlas experiment?" |
| **< 50%** | Must ask: "Help me understand—what's the intent here?" |

---

## Examples

### Example 1: High Confidence
**Spark:** Link to arxiv paper on "Distributed Memory Systems for Multi-Agent Coordination"

**Signals:**
- arxiv.org → academic paper → Research Corpus
- "distributed", "multi-agent" → Grove keywords
- No contradicting signals

**Classification:** Grove > Research Corpus (95% confidence)

**Action:** "Adding to Grove research corpus. Want me to set up a sprout for deeper analysis on distributed memory architectures?"

---

### Example 2: Medium Confidence
**Spark:** GitHub repo "awesome-agent-memory"

**Signals:**
- GitHub → technical
- "agent-memory" → could be Grove research OR Atlas implementation

**Classification:** Grove (70%) but intent unclear

**Clarification:** "This looks Grove-relevant. Should I:
A) Catalog for research corpus
B) Evaluate for Atlas implementation
C) Both—research + experiment"

---

### Example 3: Low Confidence
**Spark:** Link to "Notion template for project management"

**Signals:**
- Productivity tool → Personal OR Atlas Dev
- No clear pillar signal

**Clarification:** "Is this:
A) Personal—you want to try it
B) Atlas—we should evaluate for our system
C) Just interesting, file for reference"

---

### Example 4: Explicit Override
**Spark:** "#atlas we should try this" + link to memory system

**Signals:**
- Explicit "#atlas" tag
- "we should try" → Experiment intent

**Classification:** Atlas Dev > Experiment (95% confidence)

**Action:** "Setting up an Atlas development task to evaluate this memory system. I'll create a technical exploration in Notion."

---

## Feedback Loop

When Jim corrects a classification:
1. Acknowledge: "Got it—filing under Personal, not Grove"
2. Learn: Add to Atlas Memory if it's a pattern
3. Apply: Similar sparks in future get adjusted weighting

**Memory examples:**
- "Permits and inspections → always Home/Garage"
- "Links from [specific newsletter] → usually Grove research"
- "Saturday morning links → often Personal or Home"

---

## Summary: The Spark Processing Flow

```
Spark Received
    ↓
Signal Analysis (URL, keywords, context)
    ↓
Confidence Assessment
    ↓
┌─────────────────┬──────────────────┬─────────────────┐
│ High (90%+)     │ Medium (70-90%)  │ Low (< 70%)     │
│ Auto-classify   │ Classify + caveat│ Ask clarification│
│ Brief note      │ "Correct?"       │ A/B/C choice    │
└─────────────────┴──────────────────┴─────────────────┘
    ↓
Route to Pillar + Intent
    ↓
Create Notion Task/Entry
    ↓
Suggest Next Action (sprout, experiment, etc.)
```

---

*This document is Atlas's guide to understanding Jim. Update as patterns emerge.*
