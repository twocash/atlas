# ADR-002: Architectural Constraints & UX Invariants

**Status:** Accepted
**Date:** 2026-02-19
**Author:** Jim Calhoun, with Claude (Atlas PM)
**Triggered by:** Socratic URL Intent sprint executing a violation of the Notion-governs-all-prompts principle before the principle was formally codified

---

## Context

Atlas development has reached a maturity point where architectural decisions made across multiple sprints need to be formalized as categorical constraints. Without codification, each sprint contract re-teaches decisions that should be ambient knowledge, and Claude Code sessions (which compact context) lose awareness of governing principles mid-execution.

The triggering incident: the Socratic URL Intent sprint contract (dispatched 2026-02-19) specified adding a hardcoded `URL_QUESTIONS` constant in TypeScript — directly contradicting the Notion-governs-all-prompts principle established by Production Hardening N+3 (shipped 2026-02-18, one day prior). The sprint was faithfully executed by Claude Code, producing the exact anti-pattern we'd just spent a sprint eliminating.

This confirmed that architectural decisions not codified in CLAUDE.md (the only file Claude Code reads at session start) are effectively invisible to execution agents.

## Decision

Establish 8 categorical constraints in CLAUDE.md under a new "Architectural Constraints & UX Invariants" section. Each constraint includes:

- **Rule:** One-sentence categorical statement
- **What this means in practice:** Concrete implementation guidance (3-4 bullets)
- **Violation pattern:** Specific anti-pattern to watch for
- **Established by:** Sprint or decision that created the constraint

The constraints are backed by two companion documents:
- `docs/ARCHITECTURE.md` — reasoning, history, design philosophy
- This ADR — the formal decision record

### The 8 Constraints

1. **Notion Governs All Prompts and Routing** — Zero hardcoded prompts in TypeScript
2. **Conversational, Not Command-Based** — Natural language intent, not button menus
3. **URL Shares Always Get Asked** — URLs never auto-draft, always Socratic
4. **Fail Fast, Fail Loud** — No silent fallbacks or swallowed exceptions
5. **Feed + Work Queue Bidirectionally Linked** — Two databases, always paired
6. **Chain Tests, Not Just Unit Tests** — Multi-file changes need end-to-end tests
7. **Worktree Isolation** — Production on master, development in worktrees
8. **Measure First, Systematize Later** — Free text before structured dropdowns

## Consequences

**Positive:**
- Claude Code sessions read constraints at startup via CLAUDE.md — survives compaction
- Sprint contracts can reference constraints by number (e.g., "per CONSTRAINT 1")
- Violations are identifiable before execution, not after cleanup
- New contributors (human or AI) get the operating rules in one read

**Negative:**
- CLAUDE.md grows by ~120 lines — acceptable given it's the single enforcement surface
- Constraints may need amendment as architecture evolves — ADR process handles this
- Existing sprint contracts written before codification may contain violations — the Socratic URL Intent amendment demonstrates the correction pattern

**Neutral:**
- Constraints are empirical, not theoretical — each comes from a real incident
- The constraint system itself was validated in real-time (URL_QUESTIONS caught mid-execution)

## Amendments

Constraints can be modified through an ADR process: propose with rationale, update CLAUDE.md, update ARCHITECTURE.md, create/update ADR. The bar is high (each constraint represents a sprint of cleanup) but not immovable.

---

## Related Documents

- `CLAUDE.md` § Architectural Constraints & UX Invariants
- `docs/ARCHITECTURE.md`
- ADR-001: Content Pipeline Architecture
- Sprint: Socratic URL Intent (SOCRATIC-URL-INTENT) — amendment for Change 3
- Sprint: Production Hardening N+3 (PromptManager Wiring)
- Project file: `atlas-schema-remediation-notes.md`
- Project file: `work-type-progressive-classification.md`
- Project file: `atlas-philosophy-of-cognitive-partnership.md`
