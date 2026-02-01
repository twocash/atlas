# Superpowers for Atlas 2.0: Strategic Integration Plan

**Date:** 2026-02-01
**Status:** DRAFT - Awaiting Review
**Sources:** [obra/superpowers](https://github.com/obra/superpowers) (41k stars), [Jesse Vincent's blog](https://blog.fsck.com/2025/10/09/superpowers/)

---

## Executive Summary

Superpowers is a skills-based framework that enforces disciplined agent workflows. Key insight: **skills are mandatory, not suggestions** - the agent checks for applicable skills before any task and follows them.

This plan adapts Superpowers' best ideas for Atlas Dev agents (Pit Crew) while respecting Atlas' existing architecture and minimizing new pattern introduction.

---

## What Superpowers Gets Right

### 1. Brainstorm → Plan → Execute Workflow
Agents can't jump straight to coding. Must:
1. **Understand** existing context (files, patterns, architecture)
2. **Discuss** approach with user (one question at a time, multiple choice preferred)
3. **Plan** detailed implementation with 2-5 minute chunks
4. **Execute** with TDD (RED → GREEN → REFACTOR)

### 2. YAGNI Ruthlessly
Every design/implementation must ask: "Is this the simplest solution?" Remove features, not add them.

### 3. Pattern Analysis Before Implementation
> "Locate similar functioning code within the same codebase. Study reference implementations thoroughly without skimming."

### 4. Systematic Debugging
**No fixes without root cause investigation first.** If 3+ attempted fixes fail, question the architecture.

### 5. Skills as Mandatory Workflows
~100 tokens to scan skill relevance, <5k tokens when activated. Efficient, targeted context.

---

## Atlas-Specific Adaptations

### The Atlas Problem
Atlas has:
- Established patterns (Notion integration, conversation handling, MCP architecture)
- Domain-specific vocabulary (Sparks, Pillars, Work Queue, Feed)
- A human-in-the-loop (Jim) who wants visibility, not surprises
- Multiple execution contexts (Telegram bot, Chrome extension, Claude Code agents)

### The Goal
Agents receiving Atlas Dev tasks should:
1. **Understand Atlas' existing patterns** before proposing solutions
2. **Ask strategic questions** to clarify scope and constraints
3. **Minimize new pattern introduction** - extend, don't invent
4. **Write tests** that verify behavior without breaking existing flows
5. **Document decisions** so future sessions have context

---

## Proposed Skills for Atlas Dev

### 1. `atlas-onboarding` (Always runs first)
**When:** Any new Atlas Dev task

```markdown
# Atlas Onboarding

Before any Atlas Dev work, you MUST:

1. Read context files:
   - apps/telegram/data/SOUL.md (Atlas identity)
   - apps/telegram/data/USER.md (Jim's profile)
   - apps/telegram/data/MEMORY.md (corrections, learnings)
   - workspace/mcp-sprint/CLAUDE.md (Pit Crew identity)

2. Understand the task domain:
   - If Telegram-related: Read apps/telegram/CLAUDE.md
   - If MCP-related: Read apps/telegram/src/mcp/index.ts
   - If Notion-related: Read apps/telegram/CLAUDE.md for DB IDs

3. Check for existing patterns:
   - Search codebase for similar functionality
   - Study how related features are implemented
   - Note naming conventions, file organization, error handling
```

### 2. `atlas-patterns` (Reference, always available)
**When:** Before proposing any new code

```markdown
# Atlas Patterns to Follow

## Database IDs (NEVER invent these)
| Database | ID |
|----------|-----|
| Feed 2.0 | 90b2b33f-4b44-4b42-870f-8d62fb8cbf18 |
| Work Queue 2.0 | 3d679030-b76b-43bd-92d8-1ac51abb4a28 |
| Atlas Dev Pipeline | ce6fbf1bee30433da9e6b338552de7c9 |

## Tool Namespacing
- Native tools: `toolName`
- MCP tools: `mcp__{serverId}__{toolName}`

## Logging
- User-facing: Use logger.info/warn/error
- MCP servers: ONLY console.error (stdout reserved for JSON-RPC)

## Error Handling
- Never catch and swallow errors silently
- Log full error details for debugging
- Return structured { success, result, error } responses

## File Organization
- Conversation logic: apps/telegram/src/conversation/
- MCP client: apps/telegram/src/mcp/
- MCP servers: packages/mcp-*/
```

### 3. `atlas-clarification` (Adapted from Superpowers brainstorming)
**When:** Before implementing any feature or fix

```markdown
# Atlas Clarification Protocol

Before writing code, verify understanding:

## Phase 1: Context Gathering (Silent)
- Read relevant existing code
- Check MEMORY.md for related corrections
- Search for similar patterns

## Phase 2: Clarification (If needed)
Ask ONE question at a time. Prefer multiple choice:

GOOD: "The MCP tool returns null. Should I:
A) Retry with backoff
B) Return error to user
C) Fall back to direct Notion API"

BAD: "What error handling strategy do you prefer and
how should failures be logged and should we retry?"

## Phase 3: Confirm Scope
Before implementing, state:
1. What you're going to do
2. Files you'll modify
3. Patterns you'll follow
4. What you WON'T do (scope boundary)

Wait for confirmation before proceeding.
```

### 4. `atlas-tdd` (Adapted from Superpowers TDD)
**When:** Any code change

```markdown
# Atlas TDD Protocol

## The Rule
NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST.

## Exceptions (Require Jim's approval)
- Pure configuration changes
- Documentation updates
- Logging additions that don't change behavior

## Process
1. Write test that demonstrates desired behavior
2. Run test - verify it FAILS correctly (not syntax error)
3. Write minimal code to make test pass
4. Run test - verify it PASSES
5. Refactor if needed (keep tests green)
6. Commit

## Atlas-Specific Testing
- Use Bun test runner: `bun test`
- Test Notion integration with mocks (don't hit live API in tests)
- Test MCP tools with mock server responses
```

### 5. `atlas-debugging` (Adapted from Superpowers systematic debugging)
**When:** Any bug fix

```markdown
# Atlas Debugging Protocol

## The Rule
NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST.

## Phase 1: Reproduce
- Get exact steps to reproduce
- Check console logs for errors
- Identify the specific failure point

## Phase 2: Root Cause Analysis
- Trace the code path from trigger to failure
- Check for recent changes (git log, MEMORY.md)
- Compare with working similar code

## Phase 3: Pattern Check
- Is this a known pattern issue? (Check MEMORY.md)
- Have we fixed similar bugs before? How?
- Is this the same root cause as another bug?

## Phase 4: Fix
- Write test that reproduces the bug
- Implement minimal fix
- Verify fix doesn't break other tests
- Update MEMORY.md if this reveals a new rule

## Circuit Breaker
If 3+ fix attempts fail: STOP. Question the architecture.
```

### 6. `atlas-completion` (New - Atlas-specific)
**When:** Before marking any task done

```markdown
# Atlas Completion Checklist

Before marking a task complete:

## Verification
- [ ] All tests pass (`bun test`)
- [ ] No TypeScript errors (`bun run typecheck`)
- [ ] Tried the feature manually
- [ ] Console shows no unexpected errors

## Documentation
- [ ] Updated MEMORY.md if learned something new
- [ ] Updated SOUL.md if identity-relevant (REQUIRES JIM'S APPROVAL)
- [ ] Comments added for non-obvious logic

## Communication
- [ ] Updated Pit Crew discussion with status
- [ ] Notion sync working (check for notion_url in response)
- [ ] Jim has visibility into what was done

## Commit
- [ ] Atomic commit with clear message
- [ ] Format: `<type>(<scope>): <description>`
- [ ] Co-authored-by footer included
```

---

## Implementation Phases

### Phase 1: Foundation (This Sprint)
1. Create `packages/skills/atlas-dev/` directory
2. Write the 6 skill files as SKILL.md documents
3. Update `workspace/mcp-sprint/CLAUDE.md` to reference skills
4. Test with manual Pit Crew session

### Phase 2: Integration (Next Sprint)
1. Add skill loading to Pit Crew workflow
2. Create `/atlas-dev` skill for Claude Code that loads all Atlas skills
3. Hook into superpowers-marketplace for discoverability

### Phase 3: Enforcement (Future)
1. Pre-commit hooks that verify TDD compliance
2. Automated skill scanning on task assignment
3. Metrics: track pattern adherence, test coverage, bug recurrence

---

## Key Differences from Vanilla Superpowers

| Superpowers | Atlas Adaptation |
|-------------|------------------|
| Generic TDD | Atlas-specific test patterns (Bun, mocks) |
| Git worktrees | Single worktree (Atlas is simpler) |
| Parallel subagents | Sequential (Jim wants visibility) |
| Generic brainstorming | Atlas clarification (knows the domain) |
| Skill marketplace | Atlas-internal skills (domain-specific) |

---

## Decision Points for Jim

1. **Skill enforcement level:** Advisory (skills suggest) vs Mandatory (skills required)?
2. **TDD strictness:** All changes or just new features?
3. **Subagent use:** Keep Pit Crew as single agent or enable dispatch?
4. **Skill location:** Separate package or embedded in CLAUDE.md files?

---

## Next Steps

1. **Review this plan** - Does the approach align with your vision?
2. **Prioritize skills** - Which 2-3 should we implement first?
3. **Test manually** - Try the clarification protocol in a live session
4. **Iterate** - Refine based on real usage

---

*This plan adapts [Superpowers](https://github.com/obra/superpowers) methodology for Atlas' specific needs.*
