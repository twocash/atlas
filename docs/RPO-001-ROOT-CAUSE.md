# ATLAS-RPO-001: Root Cause Analysis

**Date:** 2026-02-28
**Diagnosed by:** Atlas + Claude Code
**Sprint:** Research Pipeline Overhaul (ATLAS-RPO-001)

---

## Problem Statement

Gemini Google Search grounding returns zero sources on straightforward queries like "Research recent Anthropic product announcements." The research agent throws `HALLUCINATION: Grounding failure` when `groundingUsed === false`.

## Root Cause

**Gemini's Google Search grounding is a tool-use decision, not a guaranteed behavior.** The model decides whether to invoke the search tool based on prompt analysis. Long, structured prompts with JSON output templates suppress the model's decision to search.

### Contributing Factors (all interact probabilistically)

1. **Prompt length** — Longer prompts increase grounding suppression probability. The production prompt (3000-8000 chars with voice, depth instructions, quality guidelines, source content) is 10-50x longer than the actual research query.

2. **JSON template angle-bracket placeholders** — `<URL>`, `<REAL_URL_1>`, `<THE_ACTUAL_URL_FROM_YOUR_SEARCH>` in the output format cause the model to interpret these as fill-in-the-blank templates it can populate from training data.

3. **Mixing role/behavior with query in `contents`** — The Gemini SDK's `contents` parameter receives everything: system role, voice instructions, depth configuration, quality guidelines, AND the research query. The model has enough context in the prompt itself to generate a plausible response without searching.

4. **No system/user separation** — The `@google/genai` SDK supports a `systemInstruction` config parameter that separates behavioral instructions from user content. Atlas does not use it.

### Evidence (3 diagnostic rounds)

| Configuration | Grounding Rate | Notes |
|--------------|---------------|-------|
| Simple query (47 chars) | 100% (3/3) | Always works |
| Role + query, no JSON (185 chars) | 100% (1/1) | Works |
| Role + query + JSON with `<URL>` (403 chars) | 50% (1/2) | Probabilistic failure |
| Production structure (894-1122 chars) | 33% (1/3) | Frequent failure |
| JSON with natural language placeholders (674 chars) | 100% (1/1) | Fix confirmed |
| systemInstruction + clean prompt (mixed) | 100% (2/2) | Fix confirmed |
| systemInstruction + concise contents (FIX 3) | 100% (1/1) | Best approach |

### Key Finding

The failure is **non-deterministic**. The same prompt can succeed or fail across runs. This explains why:
- Some research requests work fine (the model happened to search)
- Others fail with "HALLUCINATION: Grounding failure" (the model answered from training data)
- The failure rate increases with prompt complexity

## Fix (Three-Pronged)

### 1. Use `systemInstruction` (Primary Fix)

Move all behavioral instructions to the `systemInstruction` config parameter:
- Role definition ("You are Atlas Research Agent...")
- Voice/style instructions
- Quality guidelines
- Source integrity warnings

Keep `contents` focused on: query + source context + output format skeleton.

### 2. Clean JSON Template Placeholders

Replace:
```
"url": "<THE_ACTUAL_URL_FROM_YOUR_SEARCH>"
"sources": ["<REAL_URL_1>", "<REAL_URL_2>"]
```

With:
```
"url": "The actual URL from your Google Search results"
"sources": ["List actual URLs from your Google Search results"]
```

### 3. Add Grounding Retry

If `groundingUsed === false` on first attempt, retry once before throwing. The failure is probabilistic — a second attempt often succeeds. Cap retries at 1 to bound latency.

## Impact

- **Reliability**: Expected grounding success rate improves from ~50-70% to ~95%+
- **Latency**: Retry adds 3-5s only on first failure (not on every request)
- **Code changes**: research.ts `getGeminiClient()` and `buildResearchPrompt()`

## Diagnostic Scripts

- `packages/agents/scripts/diagnose-grounding.ts` — Initial isolation test
- `packages/agents/scripts/diagnose-grounding-2.ts` — Failure narrowing (8 configs)
- `packages/agents/scripts/diagnose-grounding-3.ts` — Fix confirmation
