# Atlas Telegram Implementation Plan

**Detailed sprint plan for Claude Code to execute.**

---

## Overview

This document breaks the Atlas Telegram project into executable sprints. Each sprint has clear deliverables, acceptance criteria, and technical guidance.

**Total estimated effort:** 3-4 sprints (~1-2 weeks)

**Status:** Sprints 1-3 COMPLETE ✅ | Sprint 4 PENDING

---

## Sprint 1: Bot Foundation ✅ COMPLETE

**Goal:** Working Telegram bot that can receive messages and respond via Claude

**Duration:** 1-2 days

### Tasks

#### 1.1 Project Setup
- [x] Initialize Bun project: `bun init`
- [x] Install dependencies:
  ```bash
  bun add grammy @anthropic-ai/sdk @notionhq/client dotenv
  bun add -d typescript @types/node @types/bun
  ```
- [x] Create `tsconfig.json` with strict mode
- [x] Create `.env.example` with all required variables
- [x] Create `.gitignore` (node_modules, .env, logs/)

#### 1.2 Telegram Bot Shell
- [x] Create `src/bot.ts`:
  - Initialize grammy bot with token
  - Add middleware for user allowlist check
  - Log all messages to console
  - Routes to handler for processing
- [x] Create `src/index.ts`:
  - Load environment variables
  - Initialize bot
  - Start polling
  - Graceful shutdown handlers

#### 1.3 Claude Integration
- [x] Create `workspace/CLAUDE.md` with Atlas personality
- [x] Copy `SPARKS.md` from parent repo to `workspace/`
- [x] Create `src/claude.ts`:
  - Initialize Anthropic SDK
  - Load workspace context files
  - Classify sparks with SPARKS.md context
- [x] Connect bot to Claude:
  - On message → classify with Claude → return structured result

#### 1.4 Basic Security
- [x] Implement user allowlist check (reject non-allowed users silently)
- [x] Create `src/audit.ts`:
  - Log all interactions to file
  - Include timestamp, user ID, message content, response

### Acceptance Criteria
- [x] Bot responds to messages from allowed user
- [x] Bot ignores messages from other users
- [x] Claude processes messages and returns intelligent responses
- [x] All interactions logged to `logs/audit.log`

---

## Sprint 2: URL Processing & Classification ✅ COMPLETE

**Goal:** Bot fetches URLs, classifies using SPARKS.md, and asks clarifying questions

**Duration:** 1-2 days

### Tasks

#### 2.1 URL Extraction
- [x] Create `src/url.ts`:
  - Extract URLs from message text
  - Handle multiple URLs (process first, note others)
  - Validate URL format
  - Get domain for display

#### 2.2 Content Fetching
- [x] Implemented in `src/url.ts`:
  - Fetch URL content (title, meta description, body snippet)
  - Handle fetch failures gracefully
  - Timeout after 10 seconds
  - Return structured UrlContent object

#### 2.3 SPARKS Classification
- [x] Create `src/classifier.ts`:
  - Simple heuristic classifier (fallback)
  - Confidence thresholds defined
  - Helper functions for threshold checking
- [x] Create `src/claude.ts`:
  - Load SPARKS.md as system context
  - Send to Claude with URL content
  - Parse classification response (JSON)
- [x] Confidence thresholds implemented:
  - 90%+: Auto-classify with single confirm
  - 70-90%: Classify with caveat
  - 50-70%: Quick clarification (A/B/C)
  - <50%: Must ask

#### 2.4 Clarification Questions
- [x] Create `src/clarify.ts`:
  - Generate 10-second questions based on classification
  - Different question styles per confidence level
  - Use inline keyboards for A/B/C/D options
  - Handle button callbacks via parseCallbackData()
- [x] Implement clarification flow in `src/handler.ts`:
  - Low confidence → present options
  - User taps button → capture choice
  - Store pending clarification in memory

### Acceptance Criteria
- [x] Bot extracts URLs from messages
- [x] Bot fetches and summarizes URL content
- [x] Bot classifies using SPARKS.md framework (Claude or heuristics)
- [x] Bot presents inline keyboard for clarification when needed
- [x] User can tap button to clarify intent

---

## Sprint 3: Notion Integration ✅ COMPLETE

**Goal:** Every message creates Feed + Work Queue entries with bidirectional linking

**Architecture:** Feed 2.0 (activity log) + Work Queue 2.0 (task ledger)
**NO INBOX** — Telegram IS the inbox.

**Duration:** 1-2 days

### Tasks

#### 3.1 Notion Client Setup
- [x] Create `src/notion.ts`:
  - Initialize Notion client with API key
  - Define canonical database IDs as constants:
    - Feed 2.0: `90b2b33f-4b44-4b42-870f-8d62fb8cbf18`
    - Work Queue 2.0: `3d679030-b76b-43bd-92d8-1ac51abb4a28`
  - TypeScript interfaces for properties (in types.ts)

#### 3.2 Feed Item Creation
- [x] Implement `createFeedItem()`:
  - Map classification to Notion properties
  - Fields: Entry (title), Pillar, Source, Status, Confidence, Date

#### 3.3 Comment Stream
- [x] Implement `addTelegramExchangeComment()`:
  - Format Telegram exchange as comment
  - Includes timestamp, URL, classification, clarification, action
- [x] Comment format matches spec

#### 3.4 Work Queue Routing (Bidirectional)
- [x] Implement `createWorkItem()`:
  - Create Work Queue item with Feed Source relation
  - Bidirectional linking (Feed → WQ and WQ → Feed auto-populates)
  - Status based on Request Type (Quick/Chat → Done, else Captured)
  - Priority based on confidence

#### 3.5 Confirmation Messages
- [x] Send confirmation to Telegram after Notion write
- [x] Format: "✓ Captured to Feed (Pillar / Intent) → routing to Work Queue"

### Acceptance Criteria
- [x] Every message creates Feed 2.0 entry with classification
- [x] Every Feed entry creates linked Work Queue item
- [x] Telegram exchange captured in Notion comments
- [x] Bidirectional relations properly linked
- [x] User receives confirmation in Telegram

---

## Sprint 4: Polish & Deployment ⏳ PENDING

**Goal:** Production-ready bot with proper error handling and deployment

**Duration:** 1 day

### Tasks

#### 4.1 Error Handling
- [x] Add try/catch around all external calls
- [x] Graceful failures with user feedback:
  - URL fetch failed → offer to capture anyway ✅
  - Notion write failed → alert user ✅
  - Claude timeout → fallback to low-confidence ✅
- [x] Log all errors with stack traces

#### 4.2 Rate Limiting
- [ ] Implement request rate limiting
- [ ] Track API usage (Claude, Notion)
- [ ] Alert if approaching limits

#### 4.3 Session Persistence
- [x] In-memory session storage (current implementation)
- [ ] Persist to SQLite or Redis for production
- [x] Prune old sessions (30 minute cleanup interval)

#### 4.4 Service Setup
- [ ] Create systemd service file (Linux) OR
- [ ] Create Windows service wrapper
- [ ] Auto-restart on crash
- [ ] Log rotation

#### 4.5 Documentation
- [x] README with overview
- [x] QUICKSTART.md with setup instructions
- [x] Document all environment variables (.env.example)
- [x] CHANGELOG.md
- [x] Troubleshooting in QUICKSTART.md

### Acceptance Criteria
- [x] Bot handles errors gracefully
- [ ] Bot runs as a system service
- [ ] Bot auto-restarts on crash
- [x] Documentation complete for handoff

---

## Testing Strategy

### Manual Testing (Each Sprint)
1. Send URL from allowed user → verify classification
2. Send URL from non-allowed user → verify rejection
3. Send ambiguous content → verify clarification flow
4. Tap button → verify Notion item created
5. Check Notion → verify all properties and comments

### Test Scripts
- `bun run test:notion` - Test Notion connection and database access
- `bun run test:claude` - Test Claude connection and classification

### Test Corpus
Use existing Atlas Inbox 1.0 items as test cases:
- GitHub repos (should classify as Grove + Build/Catalog)
- Threads posts (should ask for intent)
- LinkedIn content (should ask Personal vs Grove)
- Research papers (should classify as Grove + Research)

---

## Dependencies

### NPM Packages (Installed)
```json
{
  "dependencies": {
    "@anthropic-ai/sdk": "^0.39.0",
    "@notionhq/client": "^2.2.14",
    "grammy": "^1.21.1",
    "dotenv": "^16.3.1"
  },
  "devDependencies": {
    "typescript": "^5.3.3",
    "@types/node": "^20.10.6",
    "@types/bun": "latest"
  }
}
```

### External Services
- Telegram Bot (create via @BotFather)
- Anthropic API key
- Notion Integration (create in Notion settings)

---

## Success Metrics

After deployment, track:
- Time from spark to classification (target: < 30 seconds)
- Clarification rate (target: < 30% of sparks need clarification)
- Capture completion rate (target: 100% of confirmed sparks in Notion)
- User satisfaction (Jim's feedback)

---

## Resolved Questions

1. **grammy vs node-telegram-bot-api:** ✅ grammy - better TS support
2. **Claude Agent SDK vs direct API:** ✅ Direct Anthropic SDK for simplicity
3. **MCP for Notion vs direct API:** ✅ Direct API for MVP, MCP later
4. **Webhook vs polling:** ✅ Polling for MVP
5. **Session storage:** ✅ In-memory for MVP, SQLite for production

---

## Remaining Work (Sprint 4)

1. **Rate limiting** - Add request throttling
2. **Session persistence** - SQLite or Redis
3. **Service setup** - systemd/Windows service
4. **Log rotation** - Automatic cleanup

---

*Sprints 1-3 complete. Ready for testing and Sprint 4 polish.*
