# Skill: Atlas Debug

## Purpose
Systematic root cause investigation before any fix attempt.
Random troubleshooting wastes time and masks underlying problems.

## The Rule

**NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST.**

---

## Phase 1: Reproduce

### Step 1: Get Exact Reproduction Steps
- What input triggered the bug?
- What was the expected behavior?
- What actually happened?

### Step 2: Check Logs
```bash
# Recent Atlas logs
tail -100 apps/telegram/logs/atlas.log

# Console output
# Look for [MCP], [Tools], [ERROR] prefixes
```

### Step 3: Identify Failure Point
- Which function threw the error?
- What was the call stack?
- What were the input values at failure?

### Step 4: Reproduce Reliably
Before proceeding, you must be able to trigger the bug on demand.
If you can't reproduce it, you can't verify a fix.

---

## Phase 2: Root Cause Analysis

### Step 1: Trace the Code Path
Start from the trigger point, trace backward:
1. Where does the input come from?
2. What transformations happen?
3. Where does it diverge from expected behavior?

### Step 2: Check Recent Changes
```bash
git log --oneline -20
git diff HEAD~5
```

Also check `MEMORY.md` - has this pattern caused issues before?

### Step 3: Compare with Working Code
Find similar functionality that works:
- How does it handle the same input type?
- What error handling does it have?
- What's different?

Create a detailed list of differences, no matter how minor.

---

## Phase 3: Hypothesis

### Step 1: Form Specific Hypothesis
Not: "Something is wrong with the API call"
But: "The Notion API is returning 400 because the database ID is a data source ID, not a page ID"

### Step 2: Test with Minimal Change
One variable at a time. Do not bundle fixes.

### Step 3: Verify or Refute
If hypothesis is wrong, return to Phase 2.
Do not proceed without understanding WHY the bug occurs.

---

## Phase 4: Fix

### Step 1: Write Test That Reproduces Bug
```typescript
test('should not throw when Notion returns 400', async () => {
  // Arrange: Set up condition that triggers bug
  // Act: Call the function
  // Assert: Verify correct behavior (not the bug)
});
```

**Run:** `bun test` - Test should FAIL (proves bug exists)

### Step 2: Implement Targeted Fix
Fix only the root cause. Do not "improve" surrounding code.

**Run:** `bun test` - Test should PASS

### Step 3: Verify No Regressions
```bash
bun test  # All tests pass
bun run typecheck  # No type errors
```

### Step 4: Update MEMORY.md
If this reveals a new rule or pattern, document it:

```markdown
- 2026-02-01: [Bug type] - [Root cause] - [Fix pattern]
```

---

## Circuit Breaker

**If 3 or more fix attempts fail: STOP.**

This signals a fundamental design problem, not an isolated bug.

### When Circuit Breaker Triggers:
1. Stop attempting patches
2. Document what you've tried and why it failed
3. Question the architecture:
   - Is this the right approach?
   - Are we fighting the framework?
   - Is there a simpler solution?
4. Escalate to Jim with findings

---

## When to Apply This Skill

- Test failures
- Production bugs
- Unexpected behavior
- Performance issues
- Build/compile failures
- Integration failures (Notion, MCP, APIs)

**Especially important:**
- Under time pressure (resist urge to quick-fix)
- After multiple unsuccessful attempts
- When the "obvious" fix didn't work

---

## Anti-Patterns (Do Not Do These)

| Anti-Pattern | Why It's Bad |
|--------------|--------------|
| "Let me just try this..." | Random changes obscure root cause |
| Changing multiple things at once | Can't tell what fixed it |
| Fixing symptoms not cause | Bug will return |
| Not verifying the fix | Might have introduced new bugs |
| Not documenting | Same bug will happen again |

---

## Verification

Before marking a bug fixed:
- [ ] Root cause identified and documented
- [ ] Test reproduces the bug (and now passes)
- [ ] All other tests still pass
- [ ] MEMORY.md updated if new learning
- [ ] No console errors in manual testing
