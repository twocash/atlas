# Standardization Sprint: Atlas Infrastructure Upgrades

**Sprint Goal:** Establish consistent patterns for context preservation, skill definitions, and Notion page body usage across the Atlas system.

**Trigger:** During Threads extraction debugging, discovered architectural gaps in how content flows through the system and how context is preserved for action-taking.

---

## Executive Summary

The Work Queue is where Jim takes ACTION. Content must flow there with rich, actionable context - not scattered across properties or lost in Feed waystations. This sprint establishes standards to ensure every piece of captured content becomes an actionable, context-rich Work Queue item.

---

## Sprint Backlog

### P0: Core Standards (This Week)

#### 1. SOP-009: Skill Output Standard
**Status:** Draft needed
**Owner:** Atlas

Define the required output format for all extraction/analysis skills:
- Source URL (mandatory, clickable)
- Author identification
- TL;DR summary
- Key insights (bullet points)
- Referenced links (extracted from content)
- Pillar relevance
- Next actions (specific, contextual)

**Acceptance Criteria:**
- [ ] SOP document in `docs/SOP.md`
- [ ] Template in Notion that skills can reference
- [ ] All extraction skills updated to comply

#### 2. SOP-010: Notion Template System
**Status:** Design needed
**Owner:** Atlas + Jim

Create a template repository in Notion that skills pull from:
- Templates vary by pillar (Grove vs Consulting vs Personal vs Home/Garage)
- Templates vary by task type (Research vs Draft vs Build vs Process)
- Templates are EDITABLE by Jim (declarative, not hardcoded)

**Structure:**
```
Atlas Templates (Notion DB)
├── Research / The Grove → Deep analysis template
├── Research / Consulting → Business intel template
├── Research / Personal → Quick capture template
├── Draft / The Grove → Blog post structure
├── Build / Any → Technical spec template
└── Process / Any → Checklist template
```

**Acceptance Criteria:**
- [ ] Notion database created for templates
- [ ] Template retrieval tool added (`notion_get_template`)
- [ ] Skills updated to fetch templates dynamically

#### 3. Skill MCP Declaration Standard
**Status:** Gap identified
**Owner:** Atlas

Skills should declare required MCP servers in frontmatter:
```yaml
name: threads-lookup
version: 7.0.0
mcp:
  servers:
    - notion  # Required for page operations
    - claude-in-chrome  # Optional for browser automation
  tools:
    - notion_append
    - notion_update
    - browser_open_page
```

**Acceptance Criteria:**
- [ ] Schema updated in `skills/schema.ts`
- [ ] All skills updated with MCP declarations
- [ ] Skill loader validates MCP availability at startup

---

### P1: Documentation (This Month)

#### 4. Skill Registry Documentation
**Status:** Missing
**Owner:** Atlas

Document how skills are:
- Discovered (directory scan? explicit registration?)
- Loaded (startup? on-demand?)
- Versioned (how do updates propagate?)
- Validated (schema checks? runtime checks?)

#### 5. Agent Lifecycle Documentation
**Status:** Thin
**Owner:** Atlas

Document agent states and transitions:
- `pending` → `running` → `completed`
- How agents are spawned
- Where state is persisted
- How long-running agents are monitored

#### 6. Cross-Session Context Strategy
**Status:** Undefined
**Owner:** Atlas + Jim

Define how context survives restarts:
- What's in MEMORY.md (permanent rules)
- What's in session state (ephemeral)
- How to restore context from Notion page bodies
- Multi-machine state synchronization

---

### P2: Enhancements (Backlog)

#### 7. Template Inheritance
Templates can inherit from base templates:
```
Base Research Template
└── Grove Research (extends Base, adds Grove-specific sections)
    └── AI Research (extends Grove, adds technical depth)
```

#### 8. Auto-Template Selection
Based on pillar + task type + keywords, automatically select best template without user intervention.

#### 9. Context Graph
Build a graph of related Work Queue items to show connections and prevent context fragmentation.

#### 10. Skill Performance Metrics
Track skill execution times, success rates, and content quality scores.

---

## Technical Implementation Notes

### Notion Template Retrieval

```typescript
// New tool: notion_get_template
async function getTemplate(pillar: Pillar, taskType: TaskType): Promise<string> {
  // Query Atlas Templates database
  // Return markdown template for skill to use
}
```

### Skill Schema Update

```typescript
// Addition to skills/schema.ts
interface SkillDefinition {
  // ... existing fields
  mcp?: {
    servers: string[];  // Required MCP servers
    tools?: string[];   // Specific tools used (optional, for validation)
  };
}
```

### Template Database Schema

| Property | Type | Purpose |
|----------|------|---------|
| Name | Title | Template identifier |
| Pillar | Multi-select | Which pillars this applies to |
| Task Type | Select | Research, Draft, Build, Process |
| Template | Rich text | The actual template content |
| Version | Number | For change tracking |
| Active | Checkbox | Can be disabled without deleting |

---

## Success Metrics

1. **Context Completeness:** 100% of Work Queue items have rich body content (not just properties)
2. **Action Clarity:** Every item has specific, contextual next actions (no generic placeholders)
3. **Source Traceability:** Every item links to original source and extracted references
4. **Template Coverage:** Templates exist for all pillar × task type combinations
5. **Skill Compliance:** All skills declare MCP requirements and output to Work Queue

---

## Dependencies

- Notion API access (existing)
- Skills system (existing)
- MCP client (existing)
- Template database (to be created)

---

## Timeline

| Week | Focus | Deliverables |
|------|-------|--------------|
| 1 | Core Standards | SOP-009, SOP-010 drafts, skill updates |
| 2 | Templates | Notion template DB, retrieval tool |
| 3 | Documentation | Registry docs, lifecycle docs |
| 4 | Polish | Cross-session strategy, testing |

---

*Created: 2026-02-03*
*Sprint Lead: Atlas*
*Stakeholder: Jim*
