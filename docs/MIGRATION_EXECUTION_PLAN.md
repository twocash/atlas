# Atlas 2.0 Complete Migration Plan

**Created:** 2026-01-31
**Author:** Atlas [laptop]
**Status:** SPEC READY FOR EXECUTION

---

## Executive Summary

This plan consolidates all remaining functionality from `claude-assist/` into the `atlas/` monorepo while addressing bugs, enhancements, and introducing browser extension integration via Claude in Chrome.

**Key Insight:** The chrome extension is the most mature, production-ready component in legacy. It needs attention but NOT a rewrite—just synchronization, bug fixes, and enhancement.

---

## Current State Assessment

### ✅ MIGRATED & WORKING
| Capability | Location | Status |
|------------|----------|--------|
| Telegram Bot | `apps/telegram/` | Production |
| Cognitive Router | `apps/telegram/src/cognitive/` | Production |
| Research Agent | `packages/agents/src/agents/research.ts` | Production |
| Work Queue 2.0 | Notion integration | Production |
| Daily Briefings | `apps/telegram/src/briefing/` | Production |
| Help System | `apps/telegram/src/commands/help.ts` | Production |

### ⚠️ PARTIAL - NEEDS COMPLETION
| Capability | Issue | Fix Needed |
|------------|-------|------------|
| Chrome Extension | In monorepo but may lag legacy | Sync + test |
| Token Tracking | Types exist, uses estimates | Extract real API counts |
| Voice/Style Configs | Spec'd, not implemented | Wire to Draft Agent |

### ❌ NOT MIGRATED
| Capability | Source | Priority | Effort |
|------------|--------|----------|--------|
| @atlas Mention Scanner | `atlas_mention_scanner.py` | P1 | 3h |
| Editorial Learning Loop | `grove_research_generator/` | P2 | 4h |
| Multi-Machine Identity | CLAUDE.md pattern | P3 | 30m |
| PhantomBuster Webhook | New capability | P3 | 2h |

---

## Phase 1: Chrome Extension Sync & Bug Fixes (1-2 hours)

### 1.1 Verify Extension Sync Status

**Goal:** Confirm `apps/chrome-ext/` matches latest `claude-assist/atlas-chrome-ext/`

```bash
# Compare file listings
cd C:\github\atlas\apps\chrome-ext
dir /s /b > C:\temp\atlas-ext-files.txt

cd C:\github\claude-assist\atlas-chrome-ext
dir /s /b > C:\temp\legacy-ext-files.txt

# Manual diff or use Beyond Compare
```

**Expected:** Files should match except for build artifacts and node_modules

### 1.2 Known Bug Fixes

**Bug 1: Selector Drift**
- LinkedIn changes selectors quarterly
- File: `src/lib/constants.ts`
- Fix: Update SELECTORS object with current aria-labels
- Test: Run Follow on 1 contact, verify success

**Bug 2: Auto-Sync Partial Failures**
- Sometimes auto-sync reports success but Notion unchanged
- File: `src/lib/sync-engine.ts:872-945`
- Fix: Add verification read after write
- Test: Process 3 contacts, verify all updated in Notion

**Bug 3: Rate Limit Recovery**
- 429 errors cause silent failures
- File: `src/background/lib/orchestrator.ts`
- Fix: Add retry with exponential backoff
- Test: Trigger rate limit, verify recovery

### 1.3 Build & Test

```bash
cd C:\github\atlas\apps\chrome-ext
npm install
npm run build
# Load in Chrome, test each view
```

**Acceptance:**
- [ ] All 5 views load (Inbox, Outreach, Studio, Data, Settings)
- [ ] Sync button triggers PhantomBuster fetch
- [ ] Outreach workflow completes 3 contacts
- [ ] Auto-sync updates Notion

---

## Phase 2: Chrome Extension Enhancements (4-6 hours)

### 2.1 PhantomBuster Leads API Integration

**Status:** User has paid PB account—API accessible

**Files:**
- `src/lib/phantombuster-api.ts` (new endpoints)
- `sidepanel/components/DataView.tsx` (trigger button)

**Implementation:**
```typescript
// Add to phantombuster-api.ts
export async function fetchLeadsFromOrg(listId: string): Promise<Lead[]> {
  const response = await fetch(
    `https://api.phantombuster.com/api/v2/org-storage/leads/by-list/${listId}`,
    { headers: { 'X-Phantombuster-Key': apiKey } }
  );
  return response.json();
}
```

**Acceptance:**
- [ ] "Enrich All" button in Data view
- [ ] Contacts updated with: bio, skills, follower count, location
- [ ] No CSV upload required

### 2.2 Reply Context Enhancement

**Currently:** Name, headline, comment text only
**Target:** Full bio, job history, previous engagement count

**Files:**
- `sidepanel/components/ReplyHelper.tsx`
- `src/lib/notion-api.ts` (fetch expanded contact)

**Acceptance:**
- [ ] Collapsible "Profile Context" in Reply Helper
- [ ] Shows: bio (first 500 chars), current role, skills
- [ ] Previous engagement count badge

### 2.3 Analytics Dashboard (Basic)

**Files:**
- `sidepanel/components/PostsTab.tsx` (add chart section)
- New: `src/lib/analytics.ts`

**MVP Scope:**
- Engagement trend (last 30 days)
- Top 5 engagers by frequency
- Alignment distribution pie chart

**Acceptance:**
- [ ] Charts render in Posts tab
- [ ] Data updates on sync

---

## Phase 3: @atlas Mention Scanner Migration (3 hours)

### 3.1 Port Logic to TypeScript

**Source:** `claude-assist/atlas_mention_scanner.py`
**Target:** `packages/agents/src/agents/notion-trigger.ts`

**Core Logic:**
1. Poll Notion comments API every 15 minutes
2. Find comments containing `@atlas` or `@Atlas`
3. Extract the instruction/request
4. Create Work Queue item with proposed approach
5. Notify via Telegram

**Implementation:**

```typescript
// packages/agents/src/agents/notion-trigger.ts
import { Client } from '@notionhq/client';

interface AtlasMention {
  pageId: string;
  pageTitle: string;
  commentText: string;
  mentionedAt: Date;
}

export async function scanForMentions(
  notion: Client,
  since: Date
): Promise<AtlasMention[]> {
  // Query comments API
  // Filter for @atlas mentions
  // Return new mentions since last scan
}

export async function createWorkQueueFromMention(
  mention: AtlasMention,
  notion: Client
): Promise<string> {
  // Analyze the request
  // Create Work Queue item
  // Return item ID
}
```

### 3.2 Integrate with Telegram Bot

**File:** `apps/telegram/src/index.ts`

**Add scheduler:**
```typescript
import { scanForMentions, createWorkQueueFromMention } from '@atlas/agents';

// Run every 15 minutes
const mentionScanner = setInterval(async () => {
  const mentions = await scanForMentions(notion, lastScanTime);
  for (const mention of mentions) {
    const itemId = await createWorkQueueFromMention(mention, notion);
    await bot.api.sendMessage(
      TELEGRAM_CHAT_ID,
      `📝 Found @atlas mention in "${mention.pageTitle}"\n` +
      `Created Work Queue item: ${itemId}`
    );
  }
  lastScanTime = new Date();
}, 15 * 60 * 1000);
```

**Acceptance:**
- [ ] Add `@atlas research X` comment in any Notion page
- [ ] Within 15 min, Work Queue item created
- [ ] Telegram notification received

---

## Phase 4: Editorial Learning Loop (4 hours)

### 4.1 Migrate Editorial Memory

**Source:** `claude-assist/grove_research_generator/editorial_memory.md`
**Target:** `apps/telegram/workspace/editorial_memory.md`

### 4.2 Implement Learning Pipeline

**New Files:**
- `apps/telegram/src/editorial/diff-analyzer.ts`
- `apps/telegram/src/editorial/memory-updater.ts`

**Flow:**
1. Atlas drafts document → saves to `apps/telegram/data/drafts/{id}.md`
2. Draft posts to Notion page
3. Jim edits in Notion
4. Jim comments `@atlas this is complete`
5. Atlas fetches Notion version
6. Diff original vs edited
7. Extract patterns (terminology, structure, voice)
8. Append to `editorial_memory.md`

**Acceptance:**
- [ ] Draft stored locally before Notion
- [ ] Diff detection identifies changes
- [ ] Memory file grows with new rules
- [ ] Future drafts apply learned rules

---

## Phase 5: Token Tracking Enhancement (2 hours)

### 5.1 Extract Real Token Counts

**Current:** Estimates based on character count
**Target:** Actual usage from API responses

**Files:**
- `packages/agents/src/agents/research.ts` (Gemini)
- `apps/telegram/src/claude.ts` (Anthropic)

**Anthropic Response Structure:**
```typescript
interface AnthropicResponse {
  usage: {
    input_tokens: number;
    output_tokens: number;
  }
}
```

**Gemini Response Structure:**
```typescript
interface GeminiResponse {
  usageMetadata: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  }
}
```

### 5.2 Cost Calculation

**Add pricing constants:**
```typescript
const PRICING = {
  'claude-sonnet-4': { input: 3, output: 15 }, // per 1M tokens
  'claude-haiku-4': { input: 0.25, output: 1.25 },
  'gemini-2.0-flash': { input: 0.10, output: 0.40 },
};
```

### 5.3 Daily Summary

**Add to briefing:**
```typescript
// apps/telegram/src/briefing/queries.ts
export async function getTokenUsageToday(): Promise<TokenUsage> {
  // Query logged usage
  // Calculate costs
  // Return summary
}
```

**Acceptance:**
- [ ] Real token counts captured per request
- [ ] Daily briefing shows: "API costs: $X.XX (Y,YYY tokens)"
- [ ] Alert if daily cost > $5

---

## Phase 6: Multi-Machine Identity (30 minutes)

### 6.1 Add Environment Variable

**File:** `.env.example` and `.env`

```bash
ATLAS_NODE_NAME=laptop  # or grove-node-1
```

### 6.2 Include in Work Queue Items

**File:** `packages/agents/src/workqueue.ts`

```typescript
const machineName = process.env.ATLAS_NODE_NAME || 'unknown';

await notion.pages.create({
  // ...existing properties
  properties: {
    // ...existing
    'Created By': { select: { name: `Atlas [${machineName}]` } },
  }
});
```

### 6.3 Include in Feed Entries

**File:** `apps/telegram/src/notion.ts`

Same pattern for Feed entries.

**Acceptance:**
- [ ] Work Queue items show "Atlas [laptop]" or "Atlas [grove-node-1]"
- [ ] Can filter by machine in Notion

---

## Phase 7: Claude in Chrome Integration (2-4 hours)

### 7.1 Identify Integration Points

**Browser Extension Capabilities (Claude in Chrome):**
- Navigate to URLs
- Read page content
- Fill forms
- Click buttons
- Take screenshots

**LinkedIn Automation Synergy:**
- Claude can assist with reply composition
- Can navigate to profiles during review
- Can help analyze engagement patterns

### 7.2 Implementation Options

**Option A: Manual Handoff (Low effort)**
- User opens LinkedIn in Claude-controlled tab
- Asks Claude to draft reply based on visible content
- User posts manually

**Option B: Automation Assist (Medium effort)**
- Extension sends context to Claude in Chrome
- Claude drafts reply with full page context
- User reviews and posts

**Option C: Full Automation (High effort)**
- Claude controls the posting flow
- Extension coordinates with Claude
- Requires careful safety guardrails

**Recommendation:** Start with Option A, evaluate value before investing in B/C.

---

## Execution Timeline

| Phase | Scope | Effort | Week |
|-------|-------|--------|------|
| 1 | Chrome Extension Sync | 2h | This week |
| 2 | Extension Enhancements | 6h | This week |
| 3 | @atlas Mention Scanner | 3h | Next week |
| 4 | Editorial Learning | 4h | Next week |
| 5 | Token Tracking | 2h | As time permits |
| 6 | Multi-Machine Identity | 30m | As time permits |
| 7 | Claude in Chrome | TBD | After evaluation |

**Total Estimated Effort:** 17-21 hours

---

## Acceptance Criteria for Full Migration

- [ ] All chrome extension features work from `atlas/apps/chrome-ext`
- [ ] PhantomBuster Leads API enrichment functional
- [ ] @atlas mentions create Work Queue items automatically
- [ ] Editorial memory captures Jim's edit patterns
- [ ] Token tracking shows real API costs in daily briefing
- [ ] Machine identity tracked in all Notion entries
- [ ] Legacy `claude-assist/` can be archived (read-only)

---

## Post-Migration Cleanup

**Archive Legacy:**
```bash
cd C:\github
git -C claude-assist tag archive-2026-01-31
# No more active development here
```

**Update Documentation:**
- README.md points to `atlas/` as primary
- This doc moves to `atlas/docs/` as historical reference

---

## Risk Mitigation

**Risk:** Chrome extension breaks after sync
**Mitigation:** Test each feature before declaring migration complete

**Risk:** Notion rate limits during mention scanning
**Mitigation:** 15-minute polling interval, not continuous

**Risk:** Editorial learning captures noise
**Mitigation:** Require explicit `@atlas this is complete` trigger

---

*Migration plan created by Atlas [laptop] for Jim's review and approval.*
