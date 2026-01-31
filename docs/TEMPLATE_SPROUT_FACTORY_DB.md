# Notion Database Template: Grove Sprout Factory

**Instructions for Atlas:** Create this database in Notion using the schema below.

---

## Database Setup

**Name:** Grove Sprout Factory
**Icon:** 🌱
**Description:** Research prompts ready for execution. Auto-populated by Atlas when Grove research is identified.

---

## Properties Schema

Create these properties in order:

### 1. Title (default)
- **Name:** Title
- **Type:** Title
- **Description:** Research topic or question

### 2. Status
- **Name:** Status
- **Type:** Select
- **Options:**
  - `Draft` (gray)
  - `Ready` (blue)
  - `Executing` (yellow)
  - `Complete` (green)
  - `Archived` (default/gray)
- **Default:** Ready

### 3. Prompt
- **Name:** Prompt
- **Type:** Text (Rich text)
- **Description:** The full research prompt - formatted as code block when populated

### 4. Source Spark
- **Name:** Source Spark
- **Type:** Relation
- **Related Database:** Feed 2.0 (ID: 90b2b33f-4b44-4b42-870f-8d62fb8cbf18)
- **Description:** Links to the original Feed entry that triggered this sprout

### 5. Executor
- **Name:** Executor
- **Type:** Select
- **Options:**
  - `Grove Software` (purple)
  - `Atlas Research Agent` (blue)
  - `Manual` (gray)
- **Default:** Manual

### 6. Priority
- **Name:** Priority
- **Type:** Select
- **Options:**
  - `P0` (red)
  - `P1` (orange)
  - `P2` (yellow)
  - `P3` (gray)
- **Default:** P2

### 7. Depth
- **Name:** Depth
- **Type:** Select
- **Options:**
  - `light` (gray)
  - `standard` (blue)
  - `deep` (purple)
- **Default:** standard

### 8. Pillar
- **Name:** Pillar
- **Type:** Select
- **Options:**
  - `The Grove` (green)
  - `Atlas Dev` (blue)
- **Default:** The Grove

### 9. Grove Subcategory
- **Name:** Grove Subcategory
- **Type:** Select
- **Options:**
  - `Thesis Support` (purple)
  - `Research Corpus` (blue)
  - `Technical Exploration` (cyan)
  - `Content Seed` (yellow)
  - `Competitive Intel` (orange)
  - `Community Lead` (pink)

### 10. Created
- **Name:** Created
- **Type:** Created time
- **Description:** Auto-set when sprout is created

### 11. Executed
- **Name:** Executed
- **Type:** Date
- **Description:** Set when marked Executing or Complete

### 12. Output
- **Name:** Output
- **Type:** URL
- **Description:** Link to research output (doc, blog post, etc.)

---

## Views to Create

### 1. Default View: Ready Queue
- **Type:** Table
- **Filter:** Status = Ready
- **Sort:** Priority (ascending), then Created (descending)
- **Visible columns:** Title, Status, Priority, Depth, Executor, Created

### 2. By Executor
- **Type:** Board
- **Group by:** Executor
- **Visible columns:** Title, Priority, Depth, Status

### 3. All Sprouts
- **Type:** Table
- **Filter:** None
- **Sort:** Created (descending)
- **Visible columns:** All

### 4. Archive
- **Type:** Table
- **Filter:** Status = Complete OR Status = Archived
- **Sort:** Executed (descending)

---

## Sample Sprout Entry

For testing, create one sample entry:

**Title:** Distributed Memory Systems for Multi-Agent Coordination

**Status:** Ready

**Prompt:**
```
# Research Sprout: Distributed Memory Systems for Multi-Agent Coordination

## Core Question
How are distributed memory architectures being implemented in multi-agent AI systems, and what patterns could inform Grove's approach?

## Grove Relevance
- How does this relate to Grove's distributed intelligence thesis?
- What's the key insight or mechanism?
- How could Grove incorporate or respond to this?

## Research Parameters
- **Depth:** standard
- **Sources to prioritize:** academic (arxiv), technical (GitHub), industry blogs
- **Sources to avoid:** marketing fluff, vendor whitepapers
- **Time horizon:** 2023-present, focus on recent developments

## Expected Output
- [ ] Key findings summary (3-5 bullet points)
- [ ] Relevant sources cataloged with links
- [ ] Content potential assessed (blog? whitepaper? tweet thread?)
- [ ] Next actions identified
- [ ] Grove corpus additions tagged

## Original Context
Link shared via Telegram: arxiv paper on distributed memory

## Execution Notes
[Space for notes during research]
```

**Executor:** Manual

**Priority:** P2

**Depth:** standard

**Pillar:** The Grove

**Grove Subcategory:** Technical Exploration

---

## After Creation

1. **Share database ID** with Jim for `.env` configuration
2. **Share database** with Atlas Notion integration (if not auto-shared)
3. **Test** by having Atlas call `create_sprout` tool

---

## Database ID Location

After creating the database:
1. Open the database as a full page
2. Copy the URL - it looks like: `https://notion.so/workspace/xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx?v=...`
3. The 32-character string after the last `/` and before `?` is the database ID
4. Format with hyphens: `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`

Add to `.env`:
```
NOTION_SPROUT_FACTORY_DB=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

---

*Template ready for Atlas to execute.*
