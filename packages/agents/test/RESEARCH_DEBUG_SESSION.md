# Research Agent Debug Session - 2026-02-02

## Problem Statement
Research agent hallucinating content when Gemini's Google Search grounding fails.
Symptoms:
- Placeholder URLs like `url1.com`, `url2.com` appearing in output
- "Unspecified source" in findings
- Generic content with no real citations
- Status showing "Done" instead of "Blocked"

## Root Causes Found

### 1. Prompt Template Bug (FIXED)
Prompt showed example placeholder URLs that model copied when grounding failed:
```
"sources": ["https://url1.com", "https://url2.com"]
```
**Fix:** Changed to `["<REAL_URL_1>", "<REAL_URL_2>", "..."]`

### 2. No Hallucination Detection (FIXED)
Added `detectHallucination()` function that checks:
- Pattern 1: Placeholder URL patterns (url1.com, source-url.com, example.com)
- Pattern 2: Zero grounding citations + "unspecified" sources
- Pattern 3: All findings have empty URLs

### 3. No Error Format for Failed Search (FIXED)
Added prompt instruction for model to return:
```json
{
  "error": "NO_SEARCH_RESULTS",
  "summary": "explanation...",
  "findings": [],
  "sources": []
}
```

### 4. Early Return Bug (FIXED)
When model reports NO_SEARCH_RESULTS, summary now ALWAYS starts with "Research FAILED:"

### 5. Missing Grounding Validation Logging (FIXED)
Added extensive logging for:
- SDK being used (new vs legacy)
- Web search queries generated
- Grounding chunks count
- Warnings when grounding fails

## Success Criteria

A successful research run should show in logs:
1. `[Research] Using NEW/LEGACY SDK` - confirms SDK loaded
2. `[Research] Calling Gemini with Google Search grounding...` - request made
3. `[Research] Web search queries: [array of queries]` - grounding was used
4. `[Research] Grounding chunks count: N` - N > 0 means real citations
5. `[Research] SUCCESS via regex extraction` - parsing worked
6. `[WorkQueue] Successfully appended all blocks` - Notion updated

A FAILED research (hallucination detected) should show:
1. `[Research] WARNING: No web search queries were generated` OR
2. `[Research] WARNING: Web search ran but returned 0 grounding chunks!`
3. `[Research] HALLUCINATION DETECTED: <reason>`
4. Result: `success: false`
5. Notion status: "Blocked" with error message

## Test Command
```bash
cd packages/agents
bun run test/research-spike.ts
```

## Test Queries

### Should SUCCEED (real topics):
- "GitHub Copilot pricing 2026"
- "TypeScript vs JavaScript performance"
- "React Server Components best practices"

### Should FAIL (fake/niche topics):
- "openclaw agent skills for claude code" (gibberish)
- "xyzfake nonexistent technology 2026" (made up)

## Iteration Log

### Iteration 1: 2026-02-02T04:29
- Query: "TypeScript refactoring best practices 2024"
- Result: SUCCESS - Real URLs returned
- Grounding: `groundingMetadata` exists but `groundingChunks` is empty (Gemini 2.0 uses different structure)
- URLs returned: `https://www.sitepoint.com/typescript-refactoring/` - looks real
- Action: Understand Gemini 2.0 grounding structure

### Iteration 2: 2026-02-02T04:31
- Query: Same
- Result: SUCCESS
- Grounding: `groundingSupports` array found with 1 segment
- Finding: Gemini 2.0 uses `groundingSupports` not `groundingChunks`!
- Action: Update code to check `groundingSupports`

### Iteration 3: 2026-02-02T04:33
- Query: Same
- Result: SUCCESS but `groundingMetadata` was empty `{}`
- Finding: API behavior is INCONSISTENT - sometimes has groundingSupports, sometimes empty
- URLs: `https://www.sourcetoad.com/blog/typescript-refactoring/` - real domain
- Conclusion: Must rely on detecting OBVIOUS hallucination (placeholder URLs, unspecified sources)

## Key Findings

### Gemini 2.0 Grounding Structure
- Does NOT use `groundingChunks` or `webSearchQueries` like expected
- Uses `groundingSupports` array with segment text marked as grounded
- `groundingChunkIndices` references non-existent chunks
- Behavior is INCONSISTENT - sometimes metadata is empty

### Reliable Hallucination Detection
Since we can't reliably detect grounding usage, we must catch OBVIOUS hallucination:
1. **Placeholder URLs**: `url1.com`, `source-url.com`, `example.com`
2. **Unspecified sources**: "Unspecified source", "unavailable" in findings
3. **Empty URLs**: All findings have blank URL fields
4. **Model error format**: `error: "NO_SEARCH_RESULTS"` response

### What We CAN'T Detect
- Model using real-looking URLs from training data (not verified)
- URLs that existed in training but are now dead
- Slightly wrong URLs (close but not exact)

## Status: FUNCTIONAL but NOT PERFECT

The hallucination detection catches OBVIOUS cases (placeholder URLs).
For real-looking URLs, we trust the model.

---

## Files Modified

| File | Changes |
|------|---------|
| `packages/agents/src/agents/research.ts` | Hallucination detection, logging, prompt fixes |
| `apps/telegram/src/conversation/tools/dispatcher.ts` | Feature routing to Pit Crew |

## Code Location Quick Reference

- Hallucination detection: `research.ts:697-750`
- Prompt template: `research.ts:380-420`
- Gemini SDK init: `research.ts:180-320`
- Parsing: `research.ts:758-950`
- WorkQueue sync: `workqueue.ts:243-305`
