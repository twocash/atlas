# Skill: Atlas TDD

## Purpose
Ensure no logic is written without a verification mechanism.
This is the RED → GREEN → REFACTOR cycle, enforced.

## When to Apply

**ALWAYS for:**
- New features
- Bug fixes
- Refactoring that changes behavior
- Any code that touches data or logic

**SKIP for (with acknowledgment):**
- Documentation changes
- CSS/styling only
- Configuration files
- Pure logging additions

If skipping, state: "Skipping TDD: [reason]"

---

## The Protocol

### Step 1: Create Test File

Location: `src/__tests__/[feature].test.ts` or alongside the file as `[file].test.ts`

```typescript
import { describe, test, expect, beforeEach, mock } from 'bun:test';

describe('[Feature Name]', () => {
  // Tests go here
});
```

### Step 2: Write Failing Test (RED)

```typescript
test('should [expected behavior]', async () => {
  // Arrange
  const input = { /* test data */ };

  // Act
  const result = await functionUnderTest(input);

  // Assert
  expect(result.success).toBe(true);
  expect(result.data).toEqual(expectedOutput);
});
```

**Run:** `bun test [file]`
**Expected:** FAIL (Red)

If it passes immediately, your test is wrong. Delete and rewrite.

### Step 3: Implement Minimum Code (GREEN)

Write the **smallest amount of code** to make the test pass.
Do not add features. Do not optimize. Just pass the test.

**Run:** `bun test [file]`
**Expected:** PASS (Green)

### Step 4: Refactor

Now that tests pass:
- Remove duplication
- Improve naming
- Extract helpers if needed

**Run:** `bun test`
**Expected:** ALL TESTS PASS

### Step 5: Commit

```bash
git add [files]
git commit -m "feat(scope): description

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Mocking External Dependencies

### Notion API
```typescript
import { mock } from 'bun:test';

const mockNotion = mock(() => ({
  pages: {
    create: mock(() => Promise.resolve({ id: 'test-id', url: 'https://notion.so/test' })),
  },
}));
```

### MCP Tools
```typescript
const mockMcpTool = mock(() => Promise.resolve({
  content: [{ type: 'text', text: JSON.stringify({ success: true }) }],
}));
```

### Anthropic API
```typescript
const mockClaude = mock(() => Promise.resolve({
  content: [{ type: 'text', text: 'Mock response' }],
  usage: { input_tokens: 100, output_tokens: 50 },
}));
```

---

## Rules

1. **No external API calls in unit tests** - Mock everything
2. **Integration tests** go in separate `test:e2e` script
3. **One assertion concept per test** - Multiple expects OK if testing same thing
4. **Descriptive test names** - `should return error when API key missing`
5. **Test edge cases** - null, undefined, empty arrays, error conditions

---

## Common Rationalizations (All Rejected)

| Excuse | Response |
|--------|----------|
| "It's too simple to test" | Simple code still breaks. Test it. |
| "I'll add tests later" | You won't. Write them now. |
| "Manual testing is enough" | Manual testing doesn't catch regressions. |
| "The test would just duplicate the code" | Then your code is too simple or your test is wrong. |
| "I'm in a hurry" | Bugs cost more time than tests. |

---

## Verification

Before marking any task complete, run:

```bash
bun test
```

All tests must pass. No exceptions.
