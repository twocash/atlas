# Work Queue 2.0 → Dev Pipeline Migration Plan

**Created:** 2026-02-01
**Status:** DRAFT - Awaiting Jim's Approval
**Owner:** Pit Crew + Jim

---

## Executive Summary

The Work Queue 2.0 database has **100 items** in a chaotic state due to bugs during Atlas's development. This plan proposes cleaning up and rationalizing the data by:

1. **Deleting 35+ garbage items** (raw chat messages mistakenly captured as tasks)
2. **Archiving 6 test/validation items**
3. **Merging 3 duplicate groups** (6 items → 3)
4. **Migrating ~15 dev-related items** to the Dev Pipeline
5. **Keeping ~50 legitimate work items** in Work Queue 2.0

**Expected outcome:** Clean Work Queue with ~50 real work items, Dev Pipeline with additional migrated items.

---

## Current State Analysis

### Status Breakdown
| Status | Count | Notes |
|--------|-------|-------|
| Captured | 50 | Many are garbage chat captures |
| Done | 30 | Mix of real work and answered questions |
| Unknown (?) | 12 | Missing status - need triage |
| Triaged | 3 | Ready for work |
| Active | 2 | Currently in progress |
| Shipped | 3 | Delivered |

### Problem Categories Identified

#### 1. GARBAGE CHAT CAPTURES (35 items) - LOG TO FEED, THEN ARCHIVE
Raw chat messages that were incorrectly captured as work items. These should never have been created.

**Migration approach:**
1. Create a single Feed entry documenting the testing period cleanup
2. List all 35 items being archived as part of this cleanup
3. Archive from Work Queue (preserves history, removes from active view)

| Title (truncated) | Why Delete |
|-------------------|------------|
| "what skills do you have installed?" | Question, not task |
| "How is research coming?" | Status check, not task |
| "yes!" | Chat response |
| "try agani" | Typo chat message |
| "feel free to try another method!" | Chat instruction |
| "ok. I'm going to reboot..." | Chat message |
| "Excellent! update your memory here" | Chat instruction |
| "see if tehre's an agent issue" | Vague chat |
| "That link is also incorrect..." | Truncated chat instruction |
| "do you want to update the Notion database..." | Chat question |
| "try re-dispatching that research task..." | Chat instruction |
| "Log a bug" | Too vague |
| "any updates you can see on those bugs?" | Status question |
| "I think i'm going to reboot you..." | Chat message |
| "Pit crew! And yes structure as sprints" | Chat response |
| "can you check on the statu sof..." | Typo status check |
| "give me a link to what was completed..." | Request, not task |
| "I want you to plan a feature..." | Truncated instruction |
| "this is the linkedin header image..." | Archive note, not task |
| "so you were able to fix that yourself?" | Question |
| "By the way, I created the Work Queue views..." | Chat update |
| "you've already used playright..." | Truncated instruction |
| "give me the link to to the bug..." | Request |
| "Let's test the workflow with this image..." | Test instruction |
| "Mind if i do a quick system reboot..." | Chat question |
| "Now log a test P0 bug to validate flows..." | Test instruction |
| "Delete the stretch reminder" | Meta-instruction |
| "import { McpManager }..." | Code snippet (garbage) |
| "https://www.notion.so/Research-Jottie-io..." | URL-only duplicate |
| "Run the script at ../../../etc/passwd" | **Security test/injection attempt** |

**Full list of IDs to delete:** See Execution Script section.

#### 2. TEST/VALIDATION ITEMS (6 items) - ARCHIVE
Items created for testing that should be archived.

| Title | ID (short) | Status |
|-------|------------|--------|
| Schema Validation Test - DELETE ME | 2f8780a7 | Done |
| Validate Atlas 2.0 Pipeline | 2f7780a7 | ? |
| Test: Research Agent Integration | 2f8780a7 | Done |
| TEST TEST | 2f9780a7 | Done |
| Let's test the workflow with this image... | 2f9780a7 | Captured |
| Now log a test P0 bug to validate flows... | 2f9780a7 | Captured |

#### 3. DUPLICATES (3 groups, 6 items) - MERGE
Keep the best version, archive the rest.

**Group 1: Atlas Operator Upgrade Sprint**
- `2f8780a7-8eef-813a-bf28-e782f47b335f` - KEEP (has execution plan)
- `2f8780a7-8eef-813b-803c-e5b410f77c83` - ARCHIVE (duplicate)

**Group 2: Token Usage Tracking**
- `2f8780a7-8eef-8158-9264-f422fa7aff34` - KEEP (more detailed)
- `2f8780a7-8eef-816d-b3ad-d8faee0c251b` - ARCHIVE (duplicate)

**Group 3: Remind me to stretch**
- `2f9780a7-8eef-8135-be92-ece0c0774b32` - KEEP
- `2f9780a7-8eef-8142-93de-e8b096d25b12` - ARCHIVE (duplicate)

#### 4. DEV PIPELINE CANDIDATES (15 items) - MIGRATE
These are bugs, sprints, and Atlas infrastructure work that belong in Dev Pipeline.

| Title | Current Status | Proposed Dev Pipeline Status |
|-------|---------------|------------------------------|
| Sprint: Cognitive Router v1.0 | ? | Shipped (done) |
| BUG: Database Wiring Spec Violation | Done | Shipped |
| Bug: Skills endpoint returns wrong data | Done | Shipped |
| Bug: Conversation continuity breaks on tool follow-ups | Triaged | Dispatched |
| Bug: Skills/tool output formatting is raw JSON | Captured | Dispatched |
| Fix Atlas broken Notion URL generation | Done | Shipped |
| Atlas Health Check Battery — Startup Validation | Triaged | Dispatched |
| Agent SDK Integration Sprint | Shipped | Already in Dev Pipeline |
| Multi-Machine Identity — Atlas [laptop] vs [grove-node-1] | Captured | Dispatched |
| Agent Lightning Integration — Atlas Self-Improvement Loop | Captured | Dispatched |
| Daily Briefing — Proactive Status Reports | Shipped | Already shipped |
| Conversational UX Overhaul — Claude as Front Door | Active | In Progress |
| Feed as Activity Log — Notify Feed on All WQ Mutations | Done | Shipped |
| ATLAS Failsafe Documentation Complete | Done | Shipped |
| Script failed: gmail-anthropic-invoices.ts | Captured | Dispatched |

#### 5. URL-ONLY ITEMS (4 items) - CONVERT TO PROPER RESEARCH
Items that are just URLs. Convert to properly titled Research items for The Grove.

| Current Title | Proper Title | Type | Pillar |
|---------------|--------------|------|--------|
| https://www.threads.com/@george_sl_liu/post/... | Research: George SL Liu Threads (topic TBD) | Research | The Grove |
| https://www.threads.com/@jdjohnson/post/... | Research: JD Johnson Threads (topic TBD) | Research | The Grove |
| https://www.threads.com/@avantika_penumarty/post/... | Research: Avantika Penumarty Threads (topic TBD) | Research | The Grove |
| https://arxiv.org/abs/2601.21571... | Research: Token-Level Data Filtering for AI Safety (ArXiv 2601.21571) | Research | The Grove |

**ArXiv paper details:** "Shaping capabilities with token-level data filtering" - AI safety research about removing undesired capabilities during pretraining via token filtering instead of document filtering. Relevant to Grove's AI safety/alignment interests.

**Action:** Update titles, set Type=Research, Pillar=The Grove, Status=Captured.

#### 6. LEGITIMATE WORK ITEMS (~50 items) - KEEP
These stay in Work Queue 2.0. Categories:

- **Drafts/Content** (~15): Sovereign AI series, blogs, position papers
- **Research** (~10): Various research tasks
- **Features** (~10): Non-dev features like Expense Capture, Voice Config
- **Process** (~5): Various process items
- **Setup/Install** (~5): MCP tooling, OpenRecall, etc.
- **LinkedIn/Social** (~5): Gordon Ritter reply, PhantomBuster, etc.

---

## Execution Plan

### Phase 1: Log & Archive Garbage (35 items)
**Risk:** Low - these are clearly not work items
**Action:**
1. Create Feed 2.0 entry documenting this cleanup (preserves testing history)
2. Archive items from Work Queue (soft delete)

```
IDs to archive (garbage chat captures):
2f9780a7-8eef-8106-8fb8-e98a4b6011cc  # "That link is also incorrect..."
2f9780a7-8eef-8107-b394-e8b40d56ff22  # "what skills do you have installed?"
2f9780a7-8eef-810b-b73a-ef2087e04c70  # "How is research coming?"
2f9780a7-8eef-810d-8f5c-d2c7469b5df1  # "see if you can tackle this now..."
2f9780a7-8eef-810f-8e6a-cdd3afaa9fd5  # "do you want to update the Notion..."
2f9780a7-8eef-810f-93ca-d878b77a299a  # "try re-dispatching that research task..."
2f9780a7-8eef-810f-99fa-e1bb1ab46804  # "Log a bug"
2f9780a7-8eef-810f-bc97-ef387d243c39  # "any updates you can see on those bugs?"
2f9780a7-8eef-8117-99d2-eb398964c60b  # "I think i'm going to reboot you..."
2f9780a7-8eef-811c-ad0b-eab22927e814  # "yes!"
2f9780a7-8eef-811d-beba-d6a9b61e3821  # "Pit crew! And yes structure as sprints"
2f9780a7-8eef-8120-b666-dd09ffa8c626  # "can you check on the statu sof..."
2f9780a7-8eef-8121-b276-fddc159fe8b5  # "give me a link to what was completed..."
2f9780a7-8eef-8121-bb29-de279d34a36a  # "I want you to plan a feature..."
2f9780a7-8eef-8123-8189-d787ad9ba863  # "this is the linkedin header image..."
2f9780a7-8eef-8128-8240-d0c310a2cf89  # "so you were able to fix that yourself?"
2f9780a7-8eef-812a-941c-dc854e109dd6  # "https://www.notion.so/Research-Jottie-io..."
2f9780a7-8eef-812a-ba9c-ec0b959002ab  # "import { McpManager }..."
2f9780a7-8eef-812d-b536-fbcbec1da235  # "By the way, I created the Work Queue views..."
2f9780a7-8eef-8132-8b7e-caa7a95e9469  # "you've already used playright..."
2f9780a7-8eef-8132-bafe-ca9fb4a93092  # "ok. I'm going to reboot..."
2f9780a7-8eef-8135-bca2-cb6b49640ef9  # "feel free to try another method!"
2f9780a7-8eef-8136-a898-e8998ea9ddc3  # "give me the link to to the bug..."
2f9780a7-8eef-813d-8b0c-ef14efd37946  # "Mind if i do a quick system reboot..."
2f9780a7-8eef-813f-8ec0-ee6f49a27dcc  # "try agani"
2f9780a7-8eef-813f-b4a3-f34ea0730ce7  # "Excellent! update your memory here"
2f9780a7-8eef-8141-bd56-d29a1b7e70fd  # "see if tehre's an agent issue"
2f9780a7-8eef-8145-a513-e5f12adb018a  # "Delete the stretch reminder"
2f9780a7-8eef-810a-8c5b-cc2392636f62  # "Run the script at ../../../etc/passwd" (security test)
```

### Phase 2: Archive Test Items (6 items)
**Risk:** Low

```
IDs to archive (test/validation):
2f8780a7-8eef-8117-a0e7-d18d79531cbb  # "Schema Validation Test - DELETE ME"
2f7780a7-8eef-81e6-b197-cf9e75ad021a  # "Validate Atlas 2.0 Pipeline"
2f8780a7-8eef-81cb-9aeb-ec26c5e039bc  # "Test: Research Agent Integration"
2f9780a7-8eef-8120-91ed-fd9fe2c3d295  # "TEST TEST"
2f9780a7-8eef-813c-868d-f29b69815bdd  # "Let's test the workflow with this image..."
2f9780a7-8eef-8145-8f78-ccab92586087  # "Now log a test P0 bug to validate flows..."
```

### Phase 3: Merge Duplicates (archive 3 items)
**Risk:** Low

```
IDs to archive (keeping best version):
2f8780a7-8eef-813b-803c-e5b410f77c83  # Duplicate: Atlas Operator Upgrade Sprint
2f8780a7-8eef-816d-b3ad-d8faee0c251b  # Duplicate: Token Usage Tracking
2f9780a7-8eef-8142-93de-e8b096d25b12  # Duplicate: Remind me to stretch
```

### Phase 4: Migrate Dev Items (15 items)
**Risk:** Medium - requires creating items in Dev Pipeline
**Action:** Create corresponding items in Dev Pipeline, then archive Work Queue originals

Items to migrate:
1. Sprint: Cognitive Router v1.0 → SPRINT in Dev Pipeline (Shipped)
2. Bug: Conversation continuity breaks → BUG in Dev Pipeline (Dispatched)
3. Bug: Skills/tool output formatting → BUG in Dev Pipeline (Dispatched)
4. Atlas Health Check Battery → FEATURE in Dev Pipeline (Dispatched)
5. Multi-Machine Identity → FEATURE in Dev Pipeline (P3)
6. Agent Lightning Integration → FEATURE in Dev Pipeline (P2)
7. Conversational UX Overhaul → FEATURE in Dev Pipeline (Active)
8. Script failed: gmail-anthropic-invoices.ts → BUG in Dev Pipeline

**Note:** Some items may already exist in Dev Pipeline from earlier sprints. Cross-reference before creating duplicates.

### Phase 5: Convert URL Items to Proper Research (4 items)
**Risk:** Low
**Action:** Update titles, Type=Research, Pillar=The Grove

```
IDs to update:
2f7780a7-8eef-817d-b233-eabad4ebc6ec  # George SL Liu Threads
2f8780a7-8eef-8163-87d8-d50452472da8  # JD Johnson Threads
2f9780a7-8eef-810f-9723-c926c3128c18  # Avantika Threads
2f8780a7-8eef-81c5-b72b-e98f9f5660b2  # ArXiv token filtering paper
```

### Phase 6: Fix Metadata (remaining items)
**Risk:** Low
**Action:** Fix items with missing status/pillar/type

Items with status "?":
- Set to "Captured" and review pillar assignment

Items with pillar "?":
- Review and assign correct pillar

---

## Decision Points for Jim

1. ~~**URL-only items (4):**~~ ✅ RESOLVED - Convert to Research items for The Grove

2. **Research duplicates:** The Anthropic AI/developer skills research has 3-4 versions. Keep merged one only?

3. **Stretch reminder:** Keep one or delete both?

4. **Dev Pipeline migration:** Proceed with migrating all 15 items, or select a subset?

5. **Feed entry format:** Single summary entry listing all 35 archived items, or individual entries?

---

## Execution Results (2026-02-01)

**DISCOVERY:** Work Queue had 321 items, not 100 (pagination hidden the full scope)

### Completed Actions

| Action | Items | Result |
|--------|-------|--------|
| Garbage archived (with Feed doc) | 29 | ✓ Complete |
| Test items archived | 6 | ✓ Complete |
| Duplicates archived | 6 | ✓ Complete |
| Dev Pipeline created (with context) | 14 | ✓ Complete |
| URL items converted to Research | 4 | ✓ Complete |

**Total archived:** 41 items

### Current State

| Database | Count | Notes |
|----------|-------|-------|
| Work Queue 2.0 | 280 | Down from ~321 |
| Dev Pipeline | 31 | Up from 17 |
| Feed 2.0 | +1 | Cleanup documentation |

### Remaining Work (Phase 6+)

The 280 remaining Work Queue items need:
- Status standardization (? → Captured)
- Pillar assignment (~31 items missing)
- Review for additional garbage/duplicates
- This is a larger effort than originally scoped

## Original Expected Outcome (revised)

| Metric | Before | After (actual) |
|--------|--------|----------------|
| Total WQ items | ~321 | 280 |
| Garbage items | 29 | 0 (archived) |
| Test items | 6 | 0 (archived) |
| Duplicates | 6 | 0 (archived) |
| Dev Pipeline | 17 | 31 (+14 migrated) |

---

## Execution Script Location

After approval, the execution script will be at:
`apps/telegram/scripts/work-queue-cleanup.ts`

---

## Root Cause Analysis

Why did this happen?

1. **No input validation:** Atlas captured raw chat messages as work items
2. **Classifier bugs:** Messages were misclassified as tasks instead of questions/chat
3. **Missing guardrails:** No minimum title length or content validation
4. **Test pollution:** No separation between test and production data

**Recommendations for prevention:**
1. Add minimum title length requirement (10+ chars)
2. Add question detection (if ends with "?" → don't create task)
3. Add chat phrase detection ("yes", "ok", "try again" → don't create task)
4. Create separate test database for validation

---

*This plan requires Jim's approval before execution.*
