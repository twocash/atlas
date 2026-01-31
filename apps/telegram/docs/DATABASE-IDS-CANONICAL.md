# PATCH: Database Wiring Spec Violation Fix

**Priority:** P0 — STOP SHIP  
**Work Queue:** https://www.notion.so/2f8780a78eef8161a22efcd8e70545a0

---

## What's Wrong

You wired up an orphaned "Inbox 2.0" database that the spec **explicitly says to NOT use**.

### The Spec Says (verbatim):

> **"Inbox is SUPPLANTED — Telegram replaces it entirely"**

### Spec Database IDs (Data Source IDs):

```typescript
const ATLAS_DBS = {
  FEED_2: 'a7493abb-804a-4759-b6ac-aeca62ae23b8',
  WORK_QUEUE_2: '6a8d9c43-b084-47b5-bc83-bc363640f2cd',
  INBOX: '4ae9001e-ce13-4211-aeed-d8085ada5abe',  // SUPPLANTED - DO NOT USE
};
```

### What You Built (WRONG):

```typescript
// From core.ts lines 17-19 — ALL THREE ARE WRONG
const FEED_DATABASE_ID = '3e8867d58aa5495780c2860dada8c993';        // WRONG
const WORK_QUEUE_DATABASE_ID = '3d679030-b76b-43bd-92d8-1ac51abb4a28'; // WRONG
const INBOX_DATABASE_ID = 'f6f638c9-6aee-42a7-8137-df5b6a560f50';     // SHOULD NOT EXIST
```

### Three Violations:

| # | Issue | Spec | Implementation |
|---|-------|------|----------------|
| 1 | Wrong Feed ID | `a7493abb...` | `3e8867d5...` |
| 2 | Wrong WQ ID | `6a8d9c43...` | `3d679030...` |
| 3 | Inbox exists | SUPPLANTED | Has `inbox_list` tool |

---

## Correct Architecture (Two Databases Only)

```
User Message → Claude
                 ↓
         createAuditTrail()
                 ↓
    ┌────────────┴────────────┐
    ↓                         ↓
  Feed 2.0               Work Queue 2.0
  (audit log)            (task ledger)
    ↓                         ↓
    └──── bidirectional link ─┘
```

**NO INBOX.** Telegram IS the inbox now.

---

## Fix Instructions

### File 1: `src/conversation/tools/core.ts`

#### 1.1 Replace Database Constants (lines 17-19)

**DELETE:**
```typescript
const FEED_DATABASE_ID = '3e8867d58aa5495780c2860dada8c993';
const WORK_QUEUE_DATABASE_ID = '3d679030-b76b-43bd-92d8-1ac51abb4a28';
const INBOX_DATABASE_ID = 'f6f638c9-6aee-42a7-8137-df5b6a560f50';
```

**REPLACE WITH:**
```typescript
// Notion Data Source IDs — from spec, verified correct
// IMPORTANT: Use DATA SOURCE IDs, not database IDs
const FEED_DATA_SOURCE_ID = 'a7493abb-804a-4759-b6ac-aeca62ae23b8';
const WORK_QUEUE_DATA_SOURCE_ID = '6a8d9c43-b084-47b5-bc83-bc363640f2cd';
// NO INBOX — Telegram replaces it per spec
```

#### 1.2 Remove `inbox_list` Tool Definition

**DELETE the entire tool object** (lines ~58-80):
```typescript
{
  name: 'inbox_list',
  description: 'List items from Inbox 2.0 with optional filters...',
  input_schema: { ... },
},
```

#### 1.3 Update `notion_search` Tool Definition

**FIND:**
```typescript
enum: ['inbox', 'feed', 'work_queue', 'all'],
```

**REPLACE WITH:**
```typescript
enum: ['feed', 'work_queue', 'all'],
```

#### 1.4 Remove `inbox_list` from Switch Statement

**DELETE:**
```typescript
case 'inbox_list':
  return await executeInboxList(input);
```

#### 1.5 Delete `executeInboxList` Function

**DELETE the entire function** (approximately lines 300-345):
```typescript
async function executeInboxList(
  input: Record<string, unknown>
): Promise<{ success: boolean; result: unknown; error?: string }> {
  // ... entire function
}
```

#### 1.6 Fix `executeNotionSearch` Function

**DELETE the entire Inbox search block** (approximately lines 225-245):
```typescript
// Search Inbox 2.0
if (database === 'all' || database === 'inbox') {
  const inboxResults = await notion.databases.query({
    database_id: INBOX_DATABASE_ID,
    // ... rest of block
  });
  // ... result processing
}
```

**UPDATE remaining queries to use new constant names:**
- `FEED_DATABASE_ID` → `FEED_DATA_SOURCE_ID`
- `WORK_QUEUE_DATABASE_ID` → `WORK_QUEUE_DATA_SOURCE_ID`

#### 1.7 Fix `executeStatusSummary` Function

**DELETE all Inbox-related code** and simplify to:

```typescript
async function executeStatusSummary(): Promise<{ success: boolean; result: unknown; error?: string }> {
  try {
    const statusCounts: Record<string, number> = {};
    const pillarCounts: Record<string, number> = {};
    const p0Items: Array<{ task: string; pillar: string }> = [];

    // Query Work Queue ONLY — no Inbox per spec
    const activeResults = await notion.databases.query({
      database_id: WORK_QUEUE_DATA_SOURCE_ID,
      filter: {
        or: [
          { property: 'Status', select: { equals: 'Active' } },
          { property: 'Status', select: { equals: 'Blocked' } },
          { property: 'Status', select: { equals: 'Captured' } },
        ],
      },
      page_size: 50,
    });

    for (const page of activeResults.results) {
      if ('properties' in page) {
        const props = page.properties as Record<string, unknown>;
        const status = getSelect(props, 'Status') || 'Unknown';
        const pillar = getSelect(props, 'Pillar') || 'Unknown';
        const priority = getSelect(props, 'Priority');
        const task = getTitle(props, 'Task');

        statusCounts[status] = (statusCounts[status] || 0) + 1;
        pillarCounts[pillar] = (pillarCounts[pillar] || 0) + 1;

        if (priority === 'P0') {
          p0Items.push({ task, pillar });
        }
      }
    }

    return {
      success: true,
      result: {
        workQueue: {
          totalActive: activeResults.results.length,
          byStatus: statusCounts,
          byPillar: pillarCounts,
        },
        p0Items,
        summary: p0Items.length > 0
          ? `${p0Items.length} P0 items need attention`
          : 'No P0 items. Queue is manageable.',
      },
    };
  } catch (error: any) {
    logger.error('Status summary failed', { error });
    return {
      success: false,
      result: null,
      error: `Notion error: ${error?.code || 'unknown'} - ${error?.message || String(error)}`
    };
  }
}
```

---

### File 2: `src/conversation/audit.ts`

#### 2.1 Replace Database Constants (lines 15-16)

**DELETE:**
```typescript
const FEED_DATABASE_ID = '3e8867d58aa5495780c2860dada8c993';
const WORK_QUEUE_DATABASE_ID = '3d679030-b76b-43bd-92d8-1ac51abb4a28';
```

**REPLACE WITH:**
```typescript
// Notion Data Source IDs — from spec, verified correct
const FEED_DATA_SOURCE_ID = 'a7493abb-804a-4759-b6ac-aeca62ae23b8';
const WORK_QUEUE_DATA_SOURCE_ID = '6a8d9c43-b084-47b5-bc83-bc363640f2cd';
```

#### 2.2 Update All References

Find and replace throughout the file:
- `FEED_DATABASE_ID` → `FEED_DATA_SOURCE_ID`
- `WORK_QUEUE_DATABASE_ID` → `WORK_QUEUE_DATA_SOURCE_ID`

---

## Verification Checklist

After making changes, verify:

- [ ] `grep -r "INBOX" src/` returns NO results
- [ ] `grep -r "f6f638c9" src/` returns NO results  
- [ ] `grep -r "3e8867d5" src/` returns NO results
- [ ] `grep -r "3d679030" src/` returns NO results
- [ ] `grep "a7493abb" src/` returns 2 results (core.ts, audit.ts)
- [ ] `grep "6a8d9c43" src/` returns 2 results (core.ts, audit.ts)

---

## Test After Fix

```bash
# 1. Start the bot
cd apps/telegram && bun run dev

# 2. Send a test message via Telegram

# 3. Verify in Notion:
#    - Feed 2.0 (a7493abb...) has new entry
#    - Work Queue 2.0 (6a8d9c43...) has linked entry
#    - Bidirectional relation works

# 4. Test "what's my status" — should NOT mention Inbox

# 5. Test "search for [term]" — should NOT search Inbox
```

---

## Root Cause

Developer found orphaned "Inbox 2.0" database stub (`f6f638c9...`) and wired it in without reading the spec which explicitly says **"Inbox is SUPPLANTED"**. Also used wrong database IDs (database IDs instead of data source IDs).

**Lesson:** Always verify database IDs against the spec. The spec has a dedicated section called "Notion Database IDs (Reference)" for exactly this reason.
