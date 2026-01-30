# Atlas Telegram: Design Session Handoff

**From:** Jim Calhoun & Claude (Product Design Session)  
**To:** Claude Code (Implementation)  
**Date:** 2026-01-29

---

## Context

This document captures the key insights, decisions, and context from the product design session. Read this before starting implementation to understand the "why" behind the design.

---

## The Core Insight

**Sparks need interpretation while the thought is fresh.**

Jim's brain works through rapid capture — links, ideas, references — scattered across surfaces. The current system (drop in Notion → async processing → check later) creates a problem: by the time triage happens, Jim's context has faded.

The solution: a **real-time clarification loop** that happens *immediately* after capture, while Jim still remembers why he captured it.

```
OLD: Spark → [hours pass] → Cold triage → Context lost → Friction
NEW: Spark → [10 seconds] → Hot clarify → Context captured → Flow
```

---

## Why Telegram

We evaluated multiple options for the clarification channel:

| Option | Pros | Cons |
|--------|------|------|
| Notion comments | Already there | Async, loses context |
| Extension chat | Rich context | Desktop only |
| **Telegram** | **Mobile, instant, conversational** | Another app |
| SMS/iMessage | Universal | Limited interaction |
| Email | Familiar | Too slow |

**Telegram won because:**
1. Jim can clarify from anywhere (mobile-first)
2. Instant push notifications while context is fresh
3. Inline keyboards make A/B/C choices tap-friendly
4. Bot API is well-documented and reliable
5. Proves the model before investing in extension chat

---

## The 10-Second Rule

Clarification questions must be answerable in under 10 seconds. This means:
- Yes/no questions
- A/B/C/D multiple choice
- Single-tap inline keyboard buttons
- No typing required for most flows

**Good clarification:**
```
GitHub repo: cool/tool — Grove tool evaluation?
[Confirm] [Change pillar] [Dismiss]
```

**Bad clarification:**
```
I found a GitHub repository. Can you tell me more about what
you want to do with this? Is it for research, or are you
planning to build something, or perhaps use it as a reference?
```

---

## Inbox = Decision Journal

This is a mental model shift from Atlas 1.0.

**Old model:** Inbox is a holding pen. Items sit until triaged.

**New model:** Inbox is a decision journal. Every spark expects delivery. The inbox documents:
- What came in
- How Atlas classified it
- The clarification exchange
- The decision made
- Where it was routed

The **comment stream** is the canonical memory. Future sessions (or the persistent agent) can read the comment thread to understand exactly what happened.

---

## Work Queue = Execution Journal

When a spark becomes actionable work, it moves to the Work Queue. The Work Queue tracks:
- Task setup with full context from inbox
- Progress updates via comments
- Back-and-forth during execution
- Final disposition (completed, dismissed, revisit, etc.)

**The relation is the thread:**
```
Spark → Inbox (decision documented) → Work Queue (execution tracked) → Done
```

---

## Classification Framework: SPARKS.md

All classification logic lives in `../SPARKS.md`. This file documents:
- How to identify the Pillar (Grove, Personal, Consulting, Home)
- How to determine Intent (Research, Catalog, Build, Content, Reference, Task, Question)
- Confidence thresholds and what to do at each level
- Common patterns and examples

**Copy this file to the workspace** and inject it into Claude's context for classification decisions.

---

## The Four Pillars

All Atlas work routes to one of four life domains:

| Pillar | Scope | Examples |
|--------|-------|----------|
| **Personal** | Health, relationships, growth, finances | Fitness, learning, family |
| **The Grove** | AI venture, architecture, research | Sprints, blog posts, specs |
| **Consulting** | Client work, professional services | DrumWave, Take Flight |
| **Home/Garage** | Physical space, house, vehicles | Garage build, repairs |

**These are equal citizens.** The architecture should serve a garage receipt capture just as well as an AI research link.

---

## Notion Database Details

Two new databases were created for Atlas 2.0:

### Atlas Inbox 2.0
- **URL:** https://www.notion.so/f6f638c96aee42a78137df5b6a560f50
- **Collection ID:** `04c04ac3-b974-4b7a-9651-e024ee484630`
- **Purpose:** Decision journal for incoming sparks

### Atlas Work Queue 2.0
- **URL:** https://www.notion.so/3d679030b76b43bd92d81ac51abb4a28
- **Collection ID:** `6a8d9c43-b084-47b5-bc83-bc363640f2cd`
- **Purpose:** Execution journal for actionable work

**Relations:**
- Inbox has `Routed To` → Work Queue
- Work Queue has `Inbox Source` → Inbox

**Test items exist** to validate the schema. Look for items titled "TEST:" to see examples.

---

## Open Source Reference

We researched existing Telegram/Claude integrations:

### linuz90/claude-telegram-bot (RECOMMENDED)
- Lightweight (~500 lines TypeScript)
- Uses Claude Agent SDK
- Bun runtime
- MIT licensed
- Good security model (user allowlist, path validation, audit logging)
- Built-in `ask_user` MCP for inline keyboards

**Recommendation:** Fork or heavily reference this implementation.

### Moltbot (TOO HEAVY)
- Full gateway architecture with 10+ channel adapters
- Way more than we need
- Recent security concerns (exposed instances found via Shodan)
- But: good workspace pattern (CLAUDE.md, MEMORY.md, TOOLS.md)

---

## Security Considerations

1. **Single-user bot:** Only Jim's Telegram ID should be able to interact
2. **Audit logging:** Every interaction logged for accountability
3. **Path restrictions:** File system access limited to workspace
4. **No exposed ports:** Bot uses long-polling, not webhooks (for now)
5. **API keys in .env:** Never committed to git

---

## Future Integration Points

### grove-node-1 (Persistent Agent)
The Work Queue will eventually be picked up by a persistent Claude Code instance. This bot is the capture layer; grove-node-1 is the execution layer.

### Browser Extension
Extension can show items captured via Telegram. Eventually, extension chat becomes the desktop equivalent of this Telegram flow.

### Voice Messages
linuz90's bot supports voice transcription via OpenAI. Could add later if Jim wants to capture by speaking.

---

## Questions for Dev to Answer

1. **grammy vs node-telegram-bot-api?** — Leaning grammy for TS support
2. **Claude Agent SDK vs direct API?** — SDK for tool support
3. **MCP for Notion vs direct API?** — Start with direct, add MCP later
4. **Polling vs webhooks?** — Polling for MVP, evaluate webhooks for production
5. **Session storage?** — In-memory OK for MVP

---

## What Success Looks Like

**Jim's experience:**
1. Share link from phone while on the go
2. See classification + quick clarify question (< 5 seconds)
3. Tap button to confirm or adjust (< 10 seconds)
4. See "✓ Captured" confirmation
5. Later: find fully classified item in Notion with full context

**System behavior:**
- 100% of confirmed sparks land in Notion
- < 30% of sparks need clarification (classification is good)
- 0 items lost or orphaned
- Full audit trail of every interaction

---

## Final Notes

This is Atlas's first real-time interface. It will be rough at first. The goal is to prove the clarification model works before investing in the browser extension chat.

Start simple:
1. Get the bot working
2. Get classification working
3. Get Notion integration working
4. Then polish

Don't over-engineer. This is an MVP to validate the concept.

---

*Good luck! Ping Jim or this Claude project if you hit blockers.*
