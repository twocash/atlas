# Atlas Telegram Bot

**The real-time clarification layer for Atlas — capture sparks while the thought is fresh.**

## What This Is

Atlas Telegram is a Telegram bot that enables Jim to share links and sparks from anywhere (especially mobile) and get instant classification + clarification before routing to Notion for async processing.

**The Core Problem:**  
Sparks need interpretation *while the thought is fresh*. Pure async processing (share link → check Notion later) means clarification happens after Jim's context has faded. This creates cold triage, lost context, and friction.

**The Solution:**  
A real-time clarification loop via Telegram:

```
Jim shares link → Atlas fetches + classifies → Quick clarify (10 sec) → 
Jim confirms → Notion inbox item created with full context
```

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        ATLAS TELEGRAM                                │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│   ┌─────────────┐         ┌─────────────────────────────────────┐   │
│   │  Telegram   │         │  Atlas Bot (Bun/TypeScript)         │   │
│   │  (Jim)      │◄───────►│  - User allowlist (Jim only)        │   │
│   │             │         │  - Session persistence              │   │
│   └─────────────┘         │  - MCP: Notion, Web Fetch           │   │
│                           └─────────────────┬───────────────────┘   │
│                                             │                        │
│                                             ▼                        │
│                           ┌─────────────────────────────────────┐   │
│                           │  Claude Agent SDK                   │   │
│                           │  - CLAUDE.md (Atlas personality)    │   │
│                           │  - SPARKS.md (classification)       │   │
│                           │  - ask_user MCP (inline keyboards)  │   │
│                           └─────────────────┬───────────────────┘   │
│                                             │                        │
│                                             ▼                        │
│                           ┌─────────────────────────────────────┐   │
│                           │  Notion Integration                 │   │
│                           │  - Atlas Inbox 2.0 (Decision Jrnl)  │   │
│                           │  - Atlas Work Queue 2.0 (Exec Jrnl) │   │
│                           │  - Comments as canonical memory     │   │
│                           └─────────────────────────────────────┘   │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

## Key Concepts

### The 10-Second Rule
Clarification should take Jim <10 seconds to answer. Yes/no or A/B/C choices only.

### Comment Streams as Canonical Memory
Every Telegram exchange is captured in Notion comments. Both parties should be detailed in comments to instantiate context for the next touch.

### Inbox = Decision Journal
The inbox documents: what came in, how Atlas classified it, the clarification exchange, the decision made, where it was routed.

### Work Queue = Execution Journal  
Where actual work happens: task setup with full context, progress tracking via comments, back-and-forth during execution, final disposition.

## Getting Started

See `IMPLEMENTATION.md` for the development plan.  
See `HANDOFF.md` for context from the design session.

## Tech Stack

- **Runtime:** Bun
- **Language:** TypeScript  
- **AI:** Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`)
- **Telegram:** `node-telegram-bot-api` or grammy
- **Notion:** Notion API via MCP server
- **Reference:** Fork/adapt from [linuz90/claude-telegram-bot](https://github.com/linuz90/claude-telegram-bot)

## Notion Databases

| Database | Purpose | Collection ID |
|----------|---------|---------------|
| Atlas Inbox 2.0 | Decision journal — where sparks are classified | `04c04ac3-b974-4b7a-9651-e024ee484630` |
| Atlas Work Queue 2.0 | Execution journal — where work happens | `6a8d9c43-b084-47b5-bc83-bc363640f2cd` |

---

*Part of the Atlas system. See `../PRODUCT.md` for full product vision.*
