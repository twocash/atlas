# Changelog

All notable changes to Atlas Telegram Bot will be documented in this file.

## [0.1.0] - 2026-01-29

### Added

**Sprint 1: Bot Foundation ✅**
- Telegram bot setup with grammy
- User allowlist security (silent rejection)
- Audit logging to `./logs/audit.log`
- Claude integration for classification
- Workspace context loading (CLAUDE.md, SPARKS.md)
- Graceful shutdown handlers
- Commands: /start, /status, /new

**Sprint 2: URL Processing & Classification ✅**
- URL extraction from messages
- URL content fetching with timeout
- SPARKS-based classification via Claude
- Fallback heuristic classifier
- Confidence thresholds (90/70/50)
- Clarification question generation
- Inline keyboard buttons (A/B/C/D)
- Callback query handling

**Sprint 3: Notion Integration ✅**
- Notion client setup
- Atlas Inbox 2.0 item creation
- Comment-based conversation memory
- Work Queue routing
- Bidirectional relations
- Confirmation messages

**Documentation**
- README.md - Project overview
- ARCHITECTURE.md - Technical architecture
- IMPLEMENTATION.md - Sprint plan (updated with progress)
- HANDOFF.md - Design session context
- QUICKSTART.md - 5-minute setup guide
- CLAUDE.md - Dev instructions
- CHANGELOG.md - This file

**Test Scripts**
- `bun run test:notion` - Notion connection test
- `bun run test:claude` - Claude connection test

### Project Structure
```
apps/telegram/
├── src/
│   ├── index.ts        # Entry point
│   ├── bot.ts          # Telegram bot setup + routing
│   ├── handler.ts      # Message processing orchestration
│   ├── types.ts        # TypeScript types
│   ├── logger.ts       # Logging utility
│   ├── audit.ts        # Audit trail
│   ├── url.ts          # URL extraction & fetching
│   ├── classifier.ts   # SPARKS classification (heuristics)
│   ├── claude.ts       # Claude API integration
│   ├── clarify.ts      # Clarification questions + keyboards
│   ├── notion.ts       # Notion API integration
│   ├── test-notion.ts  # Notion connection test
│   └── test-claude.ts  # Claude connection test
├── workspace/
│   ├── CLAUDE.md       # Atlas identity for Claude
│   └── SPARKS.md       # Classification framework
├── logs/               # Audit logs (gitignored)
├── README.md
├── ARCHITECTURE.md
├── IMPLEMENTATION.md
├── HANDOFF.md
├── QUICKSTART.md
├── CLAUDE.md           # Dev instructions
└── CHANGELOG.md
```

### Technical Decisions
- grammy over node-telegram-bot-api (better TypeScript)
- Bun runtime for speed
- Direct Anthropic SDK (Claude Agent SDK deferred)
- Direct Notion API (MCP server deferred)
- In-memory session storage (SQLite deferred)
- Long polling (webhooks deferred)

### Notion Databases
- Inbox 2.0: `04c04ac3-b974-4b7a-9651-e024ee484630`
- Work Queue 2.0: `6a8d9c43-b084-47b5-bc83-bc363640f2cd`

---

## [Unreleased]

### Planned (Sprint 4)
- Rate limiting for API calls
- Session persistence (SQLite/Redis)
- systemd/Windows service setup
- Log rotation
- Webhook support (optional)

---

*Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)*
