# Atlas Migration Analysis

**From:** `claude-assist/` (legacy Python + disparate tools)
**To:** `atlas/` (TypeScript monorepo with Agent SDK)

---

## Migration Status

### ✅ MIGRATED (Working in New System)

| Capability | Old Location | New Location | Notes |
|------------|--------------|--------------|-------|
| Telegram Interface | `atlas-telegram/` | `apps/telegram/` | Rewritten, cleaner |
| Research Agent | `atlas_research.py` | `packages/agents/src/agents/research.ts` | Now uses Gemini grounding |
| Work Queue | `NOTION_ATLAS_INBOX_ID` | Work Queue 2.0 database | New schema, better |
| Agent Infrastructure | Ad-hoc Python | `packages/agents/` (Agent SDK) | Proper TypeScript SDK |
| Cognitive Router | Manual triage | `apps/telegram/src/router.ts` | AI-powered classification |
| Model Selector | Hard-coded | `/model` command | User can switch |

### ⚠️ PARTIALLY MIGRATED

| Capability | Old Location | Status | Gap |
|------------|--------------|--------|-----|
| Token Tracking | Estimated in Python | Types exist, estimates used | Need real API usage extraction |
| Voice/Style Configs | `editorial_memory.md` | Spec'd for Draft Agent | Not implemented yet |

### ❌ NOT MIGRATED (Need Work Queue Items)

| Capability | Old Location | Priority | Notes |
|------------|--------------|----------|-------|
| @atlas Mention Scanner | `atlas_mention_scanner.py` | P2 | Polls Notion comments for triggers |
| Editorial Learning Loop | `grove_research_generator/` | P3 | Learns from Jim's edits |
| Grove RAG/LEANN Index | `grove_research_generator/build_index.py` | P3 | Context retrieval for drafts |
| Multi-Machine Identity | CLAUDE.md pattern | P3 | "Atlas [laptop]" vs "Atlas [grove-node-1]" |
| Docs Refinery Pipeline | `grove_docs_refinery/` | P3 | Batch polish existing docs |
| PhantomBuster ETL | `phantombuster_etl.py` | P4 | LinkedIn data → Notion |
| Chrome Extension | `atlas-chrome-ext/` | P4 | Sales Nav lead management |

### 🗄️ DEPRECATED (Not Migrating)

| Capability | Reason |
|------------|--------|
| Atlas Inbox (old DB) | Replaced by Work Queue 2.0 |
| Atlas Feed (old DB) | Replaced by Telegram + Briefings |
| Python Notion CLI | Redundant with MCP tools |
| Launchers (batch files) | Not needed with monorepo |

---

## High-Value Migration Candidates

### 1. @atlas Mention Scanner → Notion Trigger Agent (P2)

**What it did:** Polled Notion every 15 minutes for `@atlas` comments, created Work Queue items.

**Why it matters:** Enables async workflows. Jim tags `@atlas research X` in any Notion page → Atlas sees it and executes.

**Migration path:**
- Create `packages/agents/src/agents/notion-trigger.ts`
- Poll Notion comments API (same logic, TypeScript)
- When mention found → create Work Queue item → notify via Telegram
- Optional: Notion webhook instead of polling (faster)

**Effort:** 2-3 hours

---

### 2. Editorial Learning Loop (P3)

**What it did:** 
1. Atlas writes draft to Notion
2. Jim edits it
3. Atlas diffs original vs edited
4. Extracts patterns → updates `editorial_memory.md`

**Why it matters:** Drafts get better over time. Currently Draft Agent would start from zero.

**Migration path:**
- Store drafts in `apps/telegram/data/drafts/`
- After Jim marks complete, fetch Notion version
- Diff with Claude → extract learnings
- Append to `config/voice/editorial_memory.md`

**Effort:** 3-4 hours

---

### 3. Grove RAG Index (P3)

**What it did:** Built vector index of Grove docs for context retrieval during drafting.

**Why it matters:** Drafts need Grove context (architecture, terminology) to be accurate.

**Migration path:**
- Option A: Rebuild with Gemini embeddings + local storage
- Option B: Use Gemini's long context (1M tokens) to stuff relevant docs
- Option C: Notion search as lightweight RAG

**Effort:** 4-6 hours (Option A), 1-2 hours (Option B/C)

---

### 4. Multi-Machine Identity (P3)

**What it did:** Logged "Atlas [laptop]" vs "Atlas [grove-node-1]" to Feed.

**Why it matters:** When running on multiple machines, prevents confusion about which session did what.

**Migration path:**
- Add `ATLAS_NODE_NAME` env var
- Include in Work Queue item metadata
- Show in Daily Briefing if relevant

**Effort:** 30 minutes

---

## What to Leave Behind

### grove_docs_refinery/ 
The batch document polishing pipeline is complex and rarely used. Keep it in `claude-assist/` as a standalone tool. Don't migrate.

### PhantomBuster ETL
LinkedIn lead pipeline is dormant. If needed later, rewrite from scratch rather than port Python.

### Chrome Extension
Sales Nav extension is specialized. Keep separate, consider future integration via webhooks.

---

## Recommended Migration Order

| Order | Item | Priority | Effort | Value |
|-------|------|----------|--------|-------|
| 1 | Daily Briefing | P1 | 2-3h | **HIGH** - First monitoring loop |
| 2 | Expense Capture | P1 | 3-4h | **HIGH** - Garage budget visibility |
| 3 | Draft Agent | P1 | 4-5h | **HIGH** - Content production |
| 4 | Token Tracking | P2 | 2-3h | **MEDIUM** - Cost visibility |
| 5 | @atlas Triggers | P2 | 2-3h | **MEDIUM** - Async workflows |
| 6 | Editorial Learning | P3 | 3-4h | **MEDIUM** - Draft quality |
| 7 | Multi-Machine ID | P3 | 0.5h | **LOW** - Nice to have |
| 8 | Grove RAG | P3 | 2-4h | **LOW** - Context quality |

---

## Files to Reference (Don't Delete)

These files in `claude-assist/` contain useful logic to port:

```
claude-assist/
├── atlas_mention_scanner.py      # Notion polling logic
├── grove_research_generator/
│   ├── orchestrator.py           # Draft pipeline flow
│   ├── editorial_memory.md       # Current learnings
│   └── agents/prompt_builder.py  # Prompt structure
└── grove_docs_refinery/
    ├── refinery.py               # Batch processing
    └── notion_corpus_sync.py     # Sync patterns
```

---

## Success State

When migration is complete:

1. ✅ Everything in `atlas/` monorepo
2. ✅ `claude-assist/` archived (read-only reference)
3. ✅ All daily workflows via Telegram
4. ✅ Notion triggers work async
5. ✅ Drafts learn from edits
6. ✅ Full cost visibility
