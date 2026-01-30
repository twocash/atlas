# Outreach Integration Requirements - Phase 4

## Current State (Manual CSV Workflow)

**Flow:**
1. User filters Notion Contacts by "Sales Nav List Status" (e.g., "Saved - Technical")
2. User exports filtered view as CSV from Notion
3. User uploads CSV to Atlas Outreach view
4. User clicks "Start"
5. Atlas automates:
   - Opens LinkedIn profiles in singleton tab (reuses same window ✓)
   - Clicks "Save to list" → selects list by segment name
   - Clicks "Follow"
   - Random delays for rate limiting
   - Logs success/failure per contact

**Pain Points:**
- Manual export from Notion
- Manual CSV upload
- One-time operation (not repeatable)
- No tracking of who's already been processed
- No feedback loop to Notion (saves to Sales Nav, but Notion doesn't know)

---

## Desired State (Notion-Integrated Repeatable Task)

### User Model

**Weekly workflow:**
1. User posts on LinkedIn → Sync creates new contacts in Notion
2. Atlas shows: "15 new contacts classified as 'Saved - Technical'"
3. User reviews classification in Notion (optional - fix any misclassifications)
4. User clicks "Process Technical Contacts" in Atlas
5. Atlas:
   - Queries Notion for "Saved - Technical" + "Connection Status ≠ Following"
   - Loads into Queue
   - Auto-starts Save+Follow automation
   - Updates Notion: "Connection Status → Following" when complete
6. Next week: repeat for new contacts only (already-processed contacts skipped)

**Key Requirements:**

1. **Repeatable** - Track state so same person isn't processed twice
2. **Notion-driven** - Query contacts directly, no CSV export/import
3. **Feedback loop** - Update Notion when contact is saved/followed
4. **Manual review** - User can see the queue before clicking Start
5. **Segmented** - "Process Technical", "Process Academic", etc. (separate buttons)
6. **Progressive** - Works with CSV fallback if Notion API fails

---

## Technical Design

### Database Schema Changes (Notion Contacts)

**Existing field to use:**
- `Connection Status` (select: Not Connected | Following | Connected | InMail Sent)

**Current:** Populated during initial sync as "Not Connected"
**New:** Updated by Atlas after Save+Follow completes → "Following"

**This becomes the dedup key:** Only process contacts where `Connection Status = "Not Connected"`

### New Flow

```
┌─────────────────────────────────────────────────────┐
│ OUTREACH VIEW                                       │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Segments Ready to Process:                         │
│                                                     │
│  ┌──────────────────────────────────────────────┐  │
│  │ 📘 Technical (Builders)           [15 new]   │  │
│  │ 15 contacts • 0 processed • 15 pending       │  │
│  │ [Review List] [Process All]                  │  │
│  └──────────────────────────────────────────────┘  │
│                                                     │
│  ┌──────────────────────────────────────────────┐  │
│  │ 🎓 Academic (Academics)            [3 new]   │  │
│  │ 3 contacts • 0 processed • 3 pending         │  │
│  │ [Review List] [Process All]                  │  │
│  └──────────────────────────────────────────────┘  │
│                                                     │
│  ┌──────────────────────────────────────────────┐  │
│  │ 🏢 Enterprise                       [0 new]  │  │
│  │ 0 contacts pending                           │  │
│  └──────────────────────────────────────────────┘  │
│                                                     │
│  Or upload custom CSV:                              │
│  [Choose File] [Import]                             │
└─────────────────────────────────────────────────────┘
```

**User clicks "Process All" for Technical:**

```
┌─────────────────────────────────────────────────────┐
│ Processing Technical Contacts (15)                  │
├─────────────────────────────────────────────────────┤
│ ████████░░░░░░░░░░  8/15 (53%)                     │
│                                                     │
│ Current: Sarah Chen                                 │
│ AI/ML Engineer @ Google • ⭐⭐⭐⭐ Strong Alignment   │
│                                                     │
│ ✓ Saved to "Builders" list                          │
│ ✓ Followed                                          │
│                                                     │
│ [Pause] [Skip] [View in LinkedIn]                   │
│                                                     │
│ Completed: 8 ✓ | Failed: 0 ✗ | Remaining: 7        │
└─────────────────────────────────────────────────────┘
```

**When processing completes:**
- Atlas updates Notion: `Connection Status → "Following"` for each successful contact
- Shows summary: "Processed 15 contacts: 14 succeeded, 1 failed"
- Failed contacts: user can retry or mark as skipped

---

## API Integration Points

### Query Contacts by Segment (Read from Notion)

```typescript
// Get contacts needing processing for a specific segment
async function getContactsToProcess(salesNavStatus: string): Promise<Contact[]> {
  return await queryDatabase(NOTION_DBS.CONTACTS, {
    and: [
      {
        property: 'Sales Nav List Status',
        select: { equals: salesNavStatus }  // e.g., "Saved - Technical"
      },
      {
        property: 'Connection Status',
        select: { equals: 'Not Connected' }  // Only unprocessed
      }
    ]
  })
}
```

### Update After Processing (Write to Notion)

```typescript
// Mark contact as processed
async function markContactFollowed(contactPageId: string): Promise<void> {
  await updatePage(contactPageId, {
    'Connection Status': select('Following'),
    'Last Active': date(today),
    // Optionally add a "Processed At" timestamp
  })
}
```

---

## UI Components Needed

### 1. SegmentCard Component
```tsx
interface SegmentCardProps {
  segment: 'academic' | 'technical' | 'enterprise' | 'influencer'
  displayName: string  // "Academics", "Builders", etc.
  icon: string
  pendingCount: number
  onProcess: () => void
  onReview: () => void
}
```

Shows:
- Segment name + icon
- Count of pending contacts
- "Review List" button (shows contacts before processing)
- "Process All" button (starts automation)

### 2. ProcessingView Component

Shows during active automation:
- Progress bar
- Current contact being processed
- Their info (name, headline, alignment)
- Action status (Saved ✓, Followed ✓)
- Controls (Pause, Skip)
- Summary stats

### 3. ReviewList Component (optional)

Before clicking "Process All":
- Shows table of contacts that will be processed
- User can deselect any
- Confirm → starts automation

---

## State Management

### New Storage Key: `OUTREACH_QUEUE_STATE`

```typescript
interface OutreachQueueState {
  segment: string                 // Current segment being processed
  contacts: Contact[]             // Contacts in queue
  current: number                 // Index of current contact
  status: 'idle' | 'running' | 'paused' | 'completed'
  results: {
    succeeded: string[]           // Contact page IDs
    failed: string[]
    skipped: string[]
  }
  startedAt?: string
  completedAt?: string
}
```

**Persistence:** Saved in Chrome storage, survives extension reload

**Reset:** After completion, queue is cleared (or archived)

---

## Edge Cases & Error Handling

### 1. Contact Already Following
- LinkedIn shows "Following" button instead of "Follow"
- Atlas detects this, logs as "Already Following"
- Updates Notion: `Connection Status → "Following"`
- Continues to next contact

### 2. Profile URL Invalid (404, private, etc.)
- LinkedIn shows error or redirect
- Atlas logs as "Failed - Invalid Profile"
- Does NOT update Notion Connection Status
- User can manually fix URL in Notion and retry

### 3. Rate Limiting (LinkedIn throttles)
- Built-in delays: 5-12s between contacts, 30-60s every 10 contacts
- If Atlas detects rate limit warning, pauses for 5 min
- User can manually resume

### 4. Selector Failure (LinkedIn DOM changed)
- Atlas tries multi-selector fallback
- If all fail, logs as "Failed - Selector Not Found"
- User gets notified to update selectors in code

### 5. Extension Crash Mid-Process
- On restart, checks for interrupted queue
- Offers to resume from where it left off
- Already-processed contacts marked in Notion (idempotent)

---

## Migration Path (Backward Compatibility)

**Phase 4A: Add Notion integration (this phase)**
- Add "Process [Segment]" buttons
- Keep CSV upload (don't remove)
- Notion-sourced queues update Notion after processing
- CSV-sourced queues work as before (no Notion updates)

**Phase 4B: Deprecate CSV (later)**
- Once Notion flow is proven reliable
- Remove CSV upload UI
- Keep CSV parsing code for emergency recovery

---

## Open Questions for Gemini

### 1. Segment Selection UX

**Option A: Card Grid (current design proposal)**
- Each segment is a card
- Shows pending count
- Click to process

**Option B: Dropdown Selector**
```
┌────────────────────────────────────┐
│ Select Segment: [Technical ▼]     │
│ 15 contacts pending                │
│ [Review] [Process All]             │
└────────────────────────────────────┘
```

**Option C: Tabs**
```
[ Technical (15) ] [ Academic (3) ] [ Enterprise (0) ] [ Influencer (2) ]
```

Which feels most natural for a 400px-wide side panel?

### 2. Review Step - Required or Optional?

**Option A: Always require review**
- Click "Process Technical" → shows list of 15 contacts → user confirms → runs
- Safer, but extra click

**Option B: Direct processing with undo**
- Click "Process Technical" → immediately starts → user can pause/skip
- Faster, but riskier

**Option C: Smart default**
- Small batches (<10): auto-start
- Large batches (≥10): show review first

### 3. Progress Display

**During processing, what's most valuable to show?**
- A. Current contact's full profile (name, headline, bio)
- B. Just name + status (minimal)
- C. List view with checkmarks as they complete
- D. Just a progress bar + count

### 4. Post-Processing Actions

**After automation completes, what should happen?**
- A. Show summary → click "Done" → returns to segment cards
- B. Show summary → auto-return after 5 seconds
- C. Show summary → offer "Export Report" or "View in Notion"
- D. Immediately show next segment with pending contacts

### 5. Notion Sync Timing

**When should Atlas update Notion?**
- A. After each contact (slower, but safer if crash occurs)
- B. Batch updates every 10 contacts (faster, some risk)
- C. All at the end (fastest, higher risk if crash)
- D. Hybrid: update locally, batch-sync to Notion every 10

---

## Technical Constraints

**Must work:**
- Notion pagination (>100 contacts)
- LinkedIn rate limiting (respect delays)
- Singleton tab (reuse window, no tab explosion)
- Crash recovery (resume from checkpoint)

**Nice to have:**
- Real-time Notion sync per contact
- Visual profile preview during processing
- Export completion report to Notion

**Cannot do:**
- Process >50 contacts in one session (LinkedIn limits)
- Guarantee 100% success rate (LinkedIn varies)
- Run headless (LinkedIn detects automated clicks)

---

## Success Metrics

A successful Outreach integration would:
1. Eliminate CSV export/import (query Notion directly)
2. Track state (don't re-process same contacts)
3. Update Notion automatically (feedback loop)
4. Support segmented processing (by Sales Nav list)
5. Gracefully handle errors and crashes
6. Complete workflow in <3 clicks (Select segment → Process → Done)

---

## Request for Gemini

**Given:**
- Outreach view needs to transition from "CSV upload" to "Notion-integrated segments"
- Users want repeatable, trackable automation
- Side panel is narrow (400px)
- Processing happens live (user watches profiles open/close)

**Please recommend:**
1. Best UX for segment selection (cards, dropdown, tabs?)
2. Whether review step should be required or optional
3. What to show during processing (full profile vs minimal)
4. Post-processing flow (summary handling)
5. When to sync to Notion (per-contact, batched, or end)

**Context:** This is the "execution" mode (unlike Inbox which is "triage"). Users will run this weekly on 10-50 contacts per segment.
