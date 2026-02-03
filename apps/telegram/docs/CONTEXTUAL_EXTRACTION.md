# Contextual Extraction - Feature Documentation

**Status:** Implemented
**Version:** 1.0.0
**Date:** 2026-02-03

---

## What This Feature Does

Contextual Extraction transforms the Feed from a simple activity log into an intelligent content processing pipeline. After URL classification, the system automatically triggers pillar-aware extraction based on the content's life domain.

### The Core Insight

**The pillar isn't just metadata—it's an instruction to the extraction engine.**

| Pillar | Depth | Extraction Behavior |
|--------|-------|---------------------|
| **The Grove** | `deep` | Expand replies, extract external links, analyze for research value, summarize key arguments |
| **Consulting** | `standard` | Scan for competitor mentions, pricing signals, partnership opportunities |
| **Personal/Home** | `shallow` | Quick snapshot, vibe capture, save for later reference |

---

## What This Unlocks

### 1. **Intelligent Content Triage**
URLs are no longer just saved—they're processed with appropriate depth based on context. A Threads post saved for Grove research gets full treatment; the same URL saved as a personal bookmark gets lightweight handling.

### 2. **Feed Entry Enrichment**
Every Feed entry now tracks:
- **Extraction Status**: `pending` → `running` → `complete`/`failed`/`skipped`
- **Extraction Depth**: What level of processing was applied
- **Extracted Links**: External URLs discovered during extraction

### 3. **Skill-Driven Automation**
The `threads-lookup` skill (v2.0.0) demonstrates the pattern:
- Browser automation via claude-in-chrome MCP
- Pillar-conditional analysis steps
- `always_run` cleanup guarantees (no zombie tabs)
- Telegram notification on completion

### 4. **Foundation for Recursive Discovery**
With extracted links tracked, future iterations can:
- Suggest following up on discovered Arxiv papers
- Chain skills: `threads-lookup` → `arxiv-extract` → `research-synthesize`
- Build knowledge graphs from content relationships

---

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Telegram Bot   │────▶│  Classification  │────▶│  Skill Match    │
│  (URL shared)   │     │  Confirmation    │     │  (registry)     │
└─────────────────┘     └──────────────────┘     └────────┬────────┘
                                                          │
                        ┌─────────────────────────────────▼────────┐
                        │           Skill Executor                 │
                        │  ┌─────────────────────────────────────┐ │
                        │  │ 1. Open browser tab (MCP)           │ │
                        │  │ 2. Wait for content hydration       │ │
                        │  │ 3. [if deep] Expand replies         │ │
                        │  │ 4. [if deep] Extract links          │ │
                        │  │ 5. Get page text                    │ │
                        │  │ 6. [Grove] Research analysis        │ │
                        │  │ 7. [Consulting] Business intel      │ │
                        │  │ 8. Update Feed entry                │ │
                        │  │ 9. Send Telegram notification       │ │
                        │  │ 10. [always_run] Close tab          │ │
                        │  └─────────────────────────────────────┘ │
                        └──────────────────────────────────────────┘
```

---

## Database Schema (Feed 2.0)

### New Properties

| Property | Type | Options | Purpose |
|----------|------|---------|---------|
| **Extraction Status** | Select | `pending`, `running`, `complete`, `failed`, `skipped` | Track extraction lifecycle |
| **Extraction Depth** | Select | `shallow`, `standard`, `deep` | Record processing level applied |
| **Extracted Links** | Rich Text | JSON array of URLs | Store discovered external links |

### Existing Properties (Used)

| Property | Purpose in Extraction |
|----------|----------------------|
| **Pillar** | Determines extraction depth |
| **Source URL** | Input to skill |
| **Content Type** | Skill matching |

---

## Files Modified

| File | Change |
|------|--------|
| `config/mcp.yaml` | Added claude-in-chrome MCP server |
| `src/skills/schema.ts` | Added `always_run` field |
| `src/skills/executor.ts` | Implemented always_run in finally block |
| `src/conversation/tools/core.ts` | Added `claude_analyze`, `telegram_send`, `notion_update` |
| `data/skills/threads-lookup/skill.yaml` | Pillar-conditional v2.0.0 |
| `src/handlers/content-callback.ts` | Skill trigger after confirmation |
| `src/bot.ts` | Registered telegram_send callback |

---

## Testing

Run the smoke test to verify:

```bash
cd apps/telegram
bun run scripts/smoke-test-all.ts
```

Expected: `CONTEXTUAL EXTRACTION (NEW): 4/4`

### Manual Verification

1. Send a threads.net URL to Telegram
2. Select "The Grove" pillar → Confirm
3. Watch Chrome open tab, expand replies
4. Receive Telegram notification
5. Check Feed entry: Status = `complete`, Depth = `deep`

---

## Future Roadmap

### Phase 2: More Platform Skills
- `arxiv-extract` - Academic paper summarization
- `youtube-extract` - Video transcript analysis
- `linkedin-extract` - Professional content capture
- `substack-extract` - Newsletter archiving

### Phase 3: Recursive Discovery
- "I found 3 external links in this thread. Should I extract them too?"
- Composed skill chains
- Knowledge graph construction

### Phase 4: Proactive Insights
- "You've saved 5 Grove items about attention mechanisms this week. Want a synthesis?"
- Pattern detection across extracted content
- Automated research digests

---

## Configuration

### Feature Flags

```env
ATLAS_SKILL_EXECUTION=true    # Enable skill execution after classification
ATLAS_SKILL_LOGGING=true      # Log skill actions to Feed
```

### MCP Prerequisites

- chrome-ext must be running (chrome extension)
- claude-in-chrome MCP server configured in `config/mcp.yaml`

---

*Contextual Extraction v1.0.0 - Making content processing context-aware*
