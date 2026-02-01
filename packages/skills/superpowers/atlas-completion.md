# Skill: Atlas Completion

## Purpose
Ensure no task is marked "done" without verification.
This is the final gate before declaring victory.

## When to Execute
Before marking ANY task complete - bug fix, feature, refactor, or documentation.

---

## The Checklist

### 1. Tests Pass
```bash
bun test
```
- [ ] All tests pass
- [ ] No skipped tests (unless documented why)
- [ ] New code has test coverage

### 2. Types Check
```bash
bun run typecheck
```
- [ ] No TypeScript errors
- [ ] No implicit `any` types in new code

### 3. Manual Verification
- [ ] Tried the feature/fix manually
- [ ] Works as expected
- [ ] No console errors

### 4. No Regressions
- [ ] Related functionality still works
- [ ] Didn't break existing features
- [ ] Performance is acceptable

---

## Documentation Updates

### Required:
- [ ] Code comments for non-obvious logic
- [ ] Updated MEMORY.md if learned something new

### If Applicable:
- [ ] Updated SOUL.md (REQUIRES JIM'S APPROVAL)
- [ ] Updated CLAUDE.md files
- [ ] Updated README or docs

---

## Communication

### For Pit Crew Tasks:
- [ ] Discussion JSON updated with status
- [ ] Notion sync successful (check for `notion_url`)
- [ ] Final message summarizes what was done

### MANDATORY: Notion Sprint Record Update
**Every completed task MUST update its Notion record:**

- [ ] **Dev Pipeline item** → Status: "Shipped" (or "Needs Approval")
- [ ] **Resolution field** populated with:
  - Commit hash(es): `abc123 feat: description`
  - What was delivered (bullet points)
  - Any follow-up needed
- [ ] **Work Queue item** (if exists) → Status: "Done"
- [ ] **Resolution Notes** field on WQ item updated

**CRITICAL: Commits without Notion updates = incomplete work.**

Use `submit_ticket` tool for new work to ensure tracking from the start.

### Format:
```markdown
**COMPLETED:** [Task Title]

**Changes:**
- [File]: [What changed]
- [File]: [What changed]

**Testing:**
- [X] Unit tests pass
- [X] Manual verification complete

**Notes:**
[Any gotchas or things to watch]
```

---

## Commit Standards

### Format:
```
<type>(<scope>): <description>

[optional body]

Co-Authored-By: Claude <noreply@anthropic.com>
```

### Types:
| Type | Use For |
|------|---------|
| `feat` | New feature |
| `fix` | Bug fix |
| `refactor` | Code change that doesn't fix bug or add feature |
| `docs` | Documentation only |
| `test` | Adding/fixing tests |
| `chore` | Maintenance (deps, config) |

### Rules:
- [ ] Atomic commit (one logical change)
- [ ] Clear description (what, not how)
- [ ] Co-authored-by footer included

---

## Final Verification Output

Before marking complete, output:

```
COMPLETION CHECKLIST:
- Tests: [PASS/FAIL]
- Types: [PASS/FAIL]
- Manual: [VERIFIED/SKIPPED]
- Docs: [UPDATED/N/A]
- Commit: [READY/PENDING]

Status: [COMPLETE/BLOCKED]
```

---

## Blocked States

If any check fails, do NOT mark complete:

| Blocker | Action |
|---------|--------|
| Tests failing | Fix tests or implementation |
| Type errors | Fix types |
| Manual verification fails | Debug (use `atlas-debug`) |
| Docs needed but not written | Write docs |
| Approval needed | Request approval, wait |

---

## Anti-Patterns

| Bad | Good |
|-----|------|
| "It works on my machine" | Tests prove it works |
| "I'll clean this up later" | Clean it now |
| "The test is flaky" | Fix the flaky test |
| "It's just a small change" | Small changes still need verification |
| "I manually tested it" | Manual + automated tests |
