# Atlas Architecture — Governing Principles

**Version:** 1.0
**Last Updated:** 2026-02-19
**Companion to:** `CLAUDE.md` (Architectural Constraints & UX Invariants)
**ADR:** `docs/adr/002-architectural-constraints.md`

---

## Purpose

This document explains *why* the constraints in CLAUDE.md exist. CLAUDE.md states the rules. This document provides the reasoning, the history, and the design philosophy so developers (human or AI) can make good judgment calls in novel situations.

If you're a Claude Code session, you don't need to read this at startup. You need CLAUDE.md. Come here when you're unsure whether a particular approach violates the spirit of a constraint.

---

## Design Philosophy

Atlas is a cognitive prosthetic built on the extended mind thesis. It functions as external executive function — not a tool Jim operates, but a partner that completes Jim's thinking. Three implications flow from this:

1. **Cognitive load is the enemy.** Every feature, prompt, or interaction that adds decision burden has failed before it ships. The guiding question: does this reduce load, or add it?

2. **Conversation is the interface.** Atlas gathers intent through natural dialogue, not structured UI. Jim says what he wants in plain language. Atlas figures out the rest. Buttons are convenience shortcuts, never the primary path.

3. **Decide once, execute forever.** When Jim blesses a pattern, that decision covers all future instances. The system should never ask the same question twice about the same type of situation.

See `docs/PHILOSOPHY.md` for the full design manifesto (Clark & Chalmers' extended mind thesis, ADHD-native design principles, emotional architecture).

---

## System Architecture

### The Two Databases

Atlas has exactly two operational databases. This is deliberate and categorical.

**Feed 2.0** is the audit log. Every inbound request, every classification, every routing decision gets a Feed entry. Feed entries are immutable records of what happened. Think of it as the system's memory of events.

**Work Queue 2.0** is the task ledger. Items that need action live here with status, priority, assignee, and lifecycle dates. Think of it as the system's model of what needs doing.

They are always bidirectionally linked. A Feed entry without a Work Queue item means "logged but no action needed." A Work Queue item without a Feed entry is a bug — it means something entered the task ledger without being recorded.

**Why not more databases?** Every additional database is a new integration surface, a new set of IDs to track, a new source of drift. We spent an entire sprint (2026-01-30) cleaning up duplicate databases created during context compaction events. The two-database model is load-bearing.

### Notion as Configuration Layer

All prompts, routing rules, interview questions, and classification logic live in Notion databases — not in TypeScript. Code reads configuration at runtime via PromptManager and the Socratic Interview Config.

**Why?** Three reasons:

1. **Iteration speed.** Changing a prompt in Notion takes seconds and requires no deploy. Changing a hardcoded string requires a branch, edit, test, merge, restart cycle.

2. **Auditability.** Notion has version history. When a prompt changes, you can see who changed it, when, and what it said before. Hardcoded constants require git archaeology.

3. **Compaction safety.** Claude Code sessions compact context. When they do, they lose awareness of why a hardcoded value was chosen. Notion config entries survive compaction because they're external state, not session knowledge.

The pattern that nearly broke the system twice: a Claude Code session adds "just a small constant" as a "temporary" measure. The next session sees the constant, assumes it's canonical, and builds on it. Within two sprints, you have parallel prompt sources that disagree. Production Hardening N+3 (PromptManager Wiring) replaced 8 such locations.

### The Socratic Engine

Atlas doesn't classify-then-execute. It classifies-then-asks-then-executes. The Socratic engine sits between triage and dispatch:

1. **Context Assessment** — Score 5 slots (contact_data, content_signals, classification, bridge_context, skill_requirements) from 0.0 to 1.0
2. **Confidence Regime** — Sum weighted scores. ≥0.85 = auto_draft, ≥0.50 = ask_one, <0.50 = ask_framing
3. **Gap Analysis** — Find the lowest-scored slot. That's what we ask about.
4. **Question Generation** — Read the Notion config entry for that slot. Present the question.
5. **Answer Resolution** — Parse the natural language response. Extract pillar, intent, depth, direction.
6. **Dispatch** — Route to research, draft, capture, or other execution path with full context.

URLs are a special case: `bridge_context` and `contact_data` are bypassed (they're person-context slots, not content-context), and confidence is capped at 0.84 to ensure URLs always get asked "What's the play?" before any action.

### Three-Tier Intelligence Stack

Not every cognitive task needs the same model:

- **Tier 0 (Local):** Pattern matching, regex, cached lookups. Zero cost, zero latency.
- **Tier 1 (Cheap Cognition):** Gemini Flash, Haiku. Classification, simple routing, keyword extraction.
- **Tier 2 (Premium Cognition):** Claude Sonnet/Opus, Gemini Pro. Research synthesis, content drafting, complex reasoning.

The Spotter system (on the horizon) will handle tier allocation at runtime. Until then, the cognitive router makes static assignments.

---

## Development Model

### Worktree Isolation

Production never stops for development. The bot runs on `master` in `C:\github\atlas\`. All development happens in separate git worktrees (`C:\github\atlas-sprint-<name>\`). This was established on day one and has prevented every class of "I edited a file while the bot was running" incident.

### Sprint Contracts

Multi-file changes get a sprint contract: a document specifying exactly which files change, what the find/replace blocks are, what tests must pass, and what the rollback plan is. Sprint contracts are dispatched to the Pit Crew (Claude Code) via the Dev Pipeline database.

The contract format exists because context compaction is real. A Claude Code session that starts with a 500-line sprint contract can lose the middle 200 lines to compaction and still execute correctly because each change is self-contained with file paths, line numbers, and explicit before/after blocks.

### Chain Testing

The system's failure modes are almost never "this function is wrong." They're "these three functions each work but the wire between them is disconnected." Unit tests miss this. Chain tests catch it.

A chain test traces the complete user-visible flow: input → classification → question → answer → dispatch → output. The Socratic URL Intent sprint includes 13 such tests because the root cause was five correct components with broken wiring between them.

Master Blaster (`bun run verify --strict`) must pass before any merge. This is the final quality gate.

### Measure First, Systematize Later

New categorization fields start as free text (`rich_text`), not structured dropdowns (`select`). Atlas fills them with 2-5 word descriptions. After 30+ days of data, we analyze patterns and decide if structured options are warranted.

This prevents the premature optimization trap: designing a taxonomy from assumptions, discovering it doesn't match reality, then spending a sprint migrating data to a new taxonomy. Let the data tell you what the categories are.

---

## Failure Modes We've Seen

These are real incidents that shaped the constraints:

| Incident | What Happened | Constraint Established |
|----------|---------------|----------------------|
| Database duplication storm | Context compaction caused Claude Code to create 3 duplicate Feed 2.0 databases | C5: Two databases only, no new DBs without approval |
| Hardcoded prompt drift | 8 locations accumulated hardcoded prompts that disagreed with Notion config | C1: Notion governs all prompts |
| Bridge context hijack | URL shares asked "Any recent context?" instead of "What's the play?" | C3: URLs always get asked |
| Silent research failure | Research agent failed but user saw no error — just silence | C4: Fail fast, fail loud |
| Unit test false confidence | All unit tests passed but the end-to-end flow was broken at 5 wiring points | C6: Chain tests required |
| Production file edit | Source file edited in primary worktree while bot was running | C7: Worktree isolation |
| Premature taxonomy | Select dropdown created with assumed categories that didn't match real usage | C8: Measure first |
| URL_QUESTIONS hardcode | Sprint contract specified a TypeScript constant for URL questions — caught mid-execution | C1: Notion governs (real-time validation of the constraint system) |

---

## Constraint Evolution

These constraints are not permanent. They can be modified through an ADR process:

1. Propose the change with rationale
2. Document what constraint is being modified and why
3. Update CLAUDE.md (the enforcement layer)
4. Update this document (the reasoning layer)
5. Create or update the ADR in `docs/adr/`

The bar for modifying a constraint is high because each one represents a sprint's worth of cleanup after a violation. But they're not sacred — they're empirical. If we learn something that makes a constraint obsolete, we update it.

---

*This document is the reasoning layer. CLAUDE.md is the enforcement layer. The ADR index in `docs/adr/` is the record layer. All three must agree.*
