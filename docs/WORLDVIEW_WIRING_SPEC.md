# Worldview Wiring Spec

**Sprint:** Worldview Database + Informed Haiku Classification
**Status:** PM-only (no code in this sprint)
**Author:** Atlas
**Date:** 2026-02-21

---

## Purpose

Transform Atlas research from survey-style ("here's what people say about X") to hypothesis-driven synthesis ("here's what this means given Jim's existing positions"). The Worldview database gives Haiku a structured belief system to reason against, so Gemini receives a research angle that reflects Jim's intellectual positions — not just the content topic.

---

## Database IDs

### Atlas Worldview

| Context | ID |
|---------|-----|
| Notion SDK (`@notionhq/client`) | `39f6ddf7-8866-4523-8daf-2a7688ab0eca` |
| MCP Data Source (`collection://`) | `a23e83aa-c6a4-422d-a9b8-edbb3d5d8e02` |

### POV Library (existing, now linked)

| Context | ID |
|---------|-----|
| Notion SDK | `ea3d86b7-cdb8-403e-ba03-edc410ae6498` |
| MCP Data Source | `19c88251-6a7a-4f0a-ad9f-c2c468409c66` |

### Schema: Atlas Worldview

```
Claim          title       — The contestable position (e.g., "The Ratchet Thesis")
Domain         select      — sovereign-ai | agentic-cognition | consulting-market |
                             applied-psychology | automotive-craft
Tension        rich_text   — The counter-argument or unresolved question
Signal Patterns rich_text  — What evidence would strengthen or weaken this claim
Research Angles rich_text  — Specific questions Gemini should investigate
POV Link       relation    — Links to POV Library entries (bidirectional)
Confidence     select      — high | medium | emerging
Active         checkbox    — Whether this claim is active for matching
```

### Canonical Domain Tags

| Tag | Scope | Examples |
|-----|-------|---------|
| `sovereign-ai` | AI infrastructure, data ownership, ratchet dynamics | Lock-in, moats, provider switching costs |
| `agentic-cognition` | Multi-model orchestration, human-AI collaboration | Tool use, cognitive offloading, epistemic risk |
| `consulting-market` | Professional services market shifts | AI displacement, hybrid delivery, talent models |
| `applied-psychology` | Behavioral science in product/UX/AI contexts | Cognitive load, decision architecture, nudges |
| `automotive-craft` | Hands-on vehicle/garage work | Restoration, fabrication, diagnostic patterns |

These tags are shared across Worldview (Domain select) and POV Library (Domain Coverage multi_select). POV Library retains its legacy tags (DrumWave, Grove Research, etc.) alongside canonical tags for backward compatibility.

---

## Pipeline Insertion Point

### Current Flow (shipped at `82436fb`)

```
URL → Jina Extract → Haiku Pre-Read → Socratic Question → Jim's Answer → Gemini Research
       (fullContent)   (summary)        (display summary)   (userContext)   (sourceContent +
                                                                             sourceUrl +
                                                                             userContext)
```

### Proposed Flow (this sprint's wiring target)

```
URL → Jina Extract → Haiku Pre-Read ──→ Socratic Question → Jim's Answer → Gemini Research
       (fullContent)   (summary +          (display summary    (userContext)   (sourceContent +
                        contentType)        + worldview hint)                   sourceUrl +
                                                                                userContext +
                                                                                worldviewContext)
                            │
                            ▼
                     ┌─────────────────┐
                     │  Step 3b: Query │
                     │  Worldview DB   │
                     │  by domain      │
                     └─────────────────┘
                            │
                            ▼
                     ┌─────────────────┐
                     │  Match claims + │
                     │  research angles│
                     │  + POV anchors  │
                     └─────────────────┘
```

**Insertion point:** Between Step 3 (Haiku Pre-Read) and Step 4 (Socratic Question) in `content-flow.ts`, approximately at line 299. After `preReadContent()` returns, a new `queryWorldview()` call uses the `contentType` and extracted content to find matching Worldview claims.

---

## Query Patterns

### Step 3b: Worldview Lookup

Haiku classifies content into a domain during pre-read (it already returns `contentType`). We extend this to also return a `domain` tag. The domain tag maps to the Worldview DB's Domain select field.

**Query logic (pseudocode):**

```typescript
async function queryWorldview(
  domain: string,
  contentSummary: string
): Promise<WorldviewContext> {
  // 1. Query Worldview DB for active claims in this domain
  const claims = await notion.databases.query({
    database_id: WORLDVIEW_DB_ID,  // 39f6ddf7-8866-4523-8daf-2a7688ab0eca
    filter: {
      and: [
        { property: 'Domain', select: { equals: domain } },
        { property: 'Active', checkbox: { equals: true } },
      ],
    },
  });

  // 2. For each claim, extract research angles
  const matchedClaims = claims.results.map(claim => ({
    title: claim.properties['Claim'].title[0]?.plain_text,
    tension: claim.properties['Tension'].rich_text[0]?.plain_text,
    angles: claim.properties['Research Angles'].rich_text[0]?.plain_text,
    confidence: claim.properties['Confidence'].select?.name,
  }));

  // 3. Optionally: fetch linked POV entries for deeper framing
  // (only if the claim has a POV Link relation populated)

  // 4. Build worldview context string
  return {
    domain,
    claims: matchedClaims,
    hypothesisBrief: buildHypothesisBrief(matchedClaims, contentSummary),
  };
}
```

**Haiku domain classification extension:**

The existing `PRE_READ_PROMPT` in `content-pre-reader.ts` returns `contentType` (article | social_post | etc.). We add a `domain` field to the response schema:

```typescript
// Extended ContentPreRead interface
export interface ContentPreRead {
  summary: string;
  contentType: string;
  /** Canonical domain tag for Worldview lookup */
  domain?: string;  // NEW — sovereign-ai | agentic-cognition | etc.
  success: boolean;
  failureReason?: string;
  latencyMs: number;
}
```

The Haiku prompt is extended with domain classification instructions and the list of canonical tags. Cost impact: negligible (already paying for the pre-read call, domain is 1-2 extra tokens in the response).

---

## Prompt Injection Format (Slot 3)

### Current Research Prompt Structure (in `buildResearchPrompt`)

```
## STYLE GUIDELINES
{voiceInstructions}

## Research Task
Query: "{query}"
Source URL: {sourceUrl}
Focus Area: {focus}
Depth: {depth}

## Source Content
{sourceContent (1500 chars)}

## User's Intent
"{userContext (300 chars)}"
```

### Proposed: Add Worldview Context (Slot 3)

Insert between Source Content and User's Intent:

```
## Worldview Context (Jim's existing positions on this domain)
Domain: {domain}

Active Claims:
- {claim.title} (confidence: {claim.confidence})
  Tension: {claim.tension}
  Research Angles: {claim.angles}

Hypothesis Brief:
{hypothesisBrief}

INSTRUCTION: Use these positions as analytical lenses. Do NOT simply confirm them —
stress-test them against the source content. Surface where the evidence supports,
contradicts, or extends these claims. Prioritize the Research Angles listed above.
```

**Token budget:** ~200-400 tokens for worldview context (2-4 claims with angles). Well within Gemini's context window. The hypothesis brief is generated by Haiku from the matched claims + content summary — a single sentence framing the research question through Jim's lens.

---

## ResearchConfig Extensions

```typescript
// In packages/agents/src/agents/research.ts
export interface ResearchConfig {
  // ... existing fields ...

  /** Worldview context from Atlas Worldview DB — Jim's positions on this domain.
   * Injected into Slot 3 of the research prompt so Gemini stress-tests
   * against existing claims rather than producing survey-style output. */
  worldviewContext?: WorldviewContext;
}

export interface WorldviewContext {
  /** Canonical domain tag (sovereign-ai, agentic-cognition, etc.) */
  domain: string;
  /** Matched active claims from Worldview DB */
  claims: WorldviewClaim[];
  /** Haiku-generated hypothesis brief connecting claims to the content */
  hypothesisBrief: string;
}

export interface WorldviewClaim {
  title: string;
  tension?: string;
  angles?: string;
  confidence: 'high' | 'medium' | 'emerging';
  /** POV Library entry title, if linked */
  povAnchor?: string;
}
```

---

## Pipeline File Changes (Implementation Roadmap)

| # | File | Change | Complexity |
|---|------|--------|------------|
| 1 | `content-pre-reader.ts` | Extend Haiku prompt to classify domain; add `domain` to `ContentPreRead` | Low |
| 2 | `types.ts` | Add `preReadDomain?: string` to `UrlContent` | Trivial |
| 3 | `content-flow.ts` | After pre-read (line ~299), call `queryWorldview(domain)` | Medium |
| 4 | New: `worldview-query.ts` | `queryWorldview()` — Notion query + claim extraction + hypothesis brief | Medium |
| 5 | `socratic-adapter.ts` | Pass `worldviewContext` to `ResearchConfig` in `handleResolved()` | Low |
| 6 | `research.ts` | Add `WorldviewContext` types; inject Slot 3 in `buildResearchPrompt()` | Low |
| 7 | Tests | Chain tests for worldview lookup + injection + graceful degradation | Medium |

**Estimated total:** ~200 lines of new code, ~50 lines of modifications.

---

## Chain Test Scenarios

### Happy Path
1. **URL with clear domain** — Share an AI infrastructure article → Haiku classifies `sovereign-ai` → Worldview returns "Ratchet Thesis" + "Data sovereignty" claims → Gemini receives hypothesis brief → Research output references Jim's positions
2. **URL with POV anchor** — Share content matching a POV Library topic → Worldview claim has POV Link → `povAnchor` populated → Research prompt names the POV position

### Edge Cases
3. **No domain match** — Share a cooking recipe → Haiku returns no domain or unrecognized domain → `worldviewContext` is undefined → Research proceeds without Slot 3 (graceful degradation, no error)
4. **Domain match but no active claims** — All claims in that domain have `Active: false` → Empty claims array → Skip Slot 3 injection
5. **Notion unreachable** — Worldview query fails → Log warning → Continue without worldview context (CONSTRAINT 4: Fail Fast, but this is a non-blocking enrichment)
6. **Multiple domains** — Content spans sovereign-ai and agentic-cognition → Haiku picks primary domain → Query returns claims from that domain only (future: multi-domain query)

### Regression Guards
7. **Existing pipeline unaffected** — Text messages (no URL) skip worldview entirely → All existing Socratic + research flows unchanged
8. **Pre-read failure doesn't block worldview** — If Haiku pre-read fails but URL is valid, worldview query can still run with fallback domain classification from content-extractor metadata
9. **Token budget** — Worldview context injection stays under 500 tokens → Verify total prompt stays within Gemini's optimal range

---

## Constraints Compliance

| Constraint | How This Spec Complies |
|-----------|----------------------|
| **C1: Notion Governs Prompts** | All claims, tensions, and research angles live in Worldview DB — zero hardcoded positions in TypeScript |
| **C3: URLs Always Get Asked** | Worldview context enriches the Socratic question display, not bypasses it. Jim still decides the play |
| **C4: Fail Fast, Fail Loud** | Worldview query failures log warnings and skip enrichment — no silent fallbacks |
| **C5: Feed + WQ Bidirectional** | No change to Feed/WQ flow — worldview is a read-only enrichment path |
| **C6: Chain Tests** | 9 test scenarios specified covering happy path, edge cases, and regression guards |
| **C8: Measure First** | Domain tags are a controlled vocabulary (5 tags) derived from observed POV Library patterns, not assumptions |

---

## Open Questions for Jim

1. **Multi-domain content:** Should Haiku pick one primary domain or return ranked list? (Recommend: single primary for v1, multi in v2)
2. **Hypothesis brief author:** Should Haiku generate the brief during pre-read (cheap, fast) or as a separate call after worldview query (more context, slightly slower)?
3. **Claim selection:** When a domain has 4+ claims, should all be injected or top-N by confidence? (Recommend: all active, let Gemini prioritize)
4. **Socratic hint:** Should the Socratic question show a worldview hint to Jim? e.g., "Atlas sees this through the Ratchet Thesis lens — what's the play?" (Recommend: yes, helps Jim steer)
