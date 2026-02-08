# ADR-001: Content Pipeline Architecture

**Status:** Accepted
**Date:** 2026-02-08
**Context:** Post-incident architectural documentation (false regression alarm exposed documentation gap)

---

## Context

The Atlas Telegram bot processes "sparks" — URLs, media, and text shared by Jim from mobile. The content pipeline classifies, routes, and stores these sparks through a multi-stage flow.

In February 2026, Atlas PM incorrectly diagnosed the Classifier Pillar Router prompt as blank during a Notion fetch, triggering an emergency sprint. The pipeline was intact; the diagnosis was wrong. This ADR documents the architecture to prevent future misdiagnosis and protect against drift.

The pipeline spans three layers:
1. **Telegram adapter** (`apps/telegram/`) — UI, handlers, content detection
2. **Shared composition engine** (`packages/agents/`) — prompt resolution, pillar/action/voice config
3. **External state** (Notion System Prompts DB) — drafter prompts, voice modifiers

## Decision

### Content Pipeline Call Chain

```
[User sends message to Telegram]
       │
       ▼
handler.ts ──── handleConversationWithTools()
       │
       ├── maybeHandleAsContentShare()          ← content-flow.ts
       │     │
       │     ├── detectContentShare()           ← URL detection + context check
       │     ├── isNotionUrl()?                 ← notion-url.ts (special handling)
       │     └── triggerContentConfirmation()
       │           │
       │           ├── triageMessage()          ← cognitive/triage-skill.ts
       │           │     (Haiku: intent + title + pillar + complexity)
       │           │
       │           └── startPromptSelection()   ← handlers/prompt-selection-callback.ts
       │                 │
       │                 └── [User taps: Pillar → Action → Voice]
       │                       │
       │                       └── composePromptFromState()  ← composer.ts
       │                             │
       │                             ├── resolveDrafterId()  (drafter.{slug}.{action})
       │                             ├── resolveVoiceId()    (voice.{id})
       │                             └── PromptManager.composePrompts()
       │                                   │
       │                                   └── [Notion System Prompts DB]
       │
       ├── triggerInstantClassification()       ← media without Gemini
       └── triggerMediaConfirmation()           ← media with Gemini analysis
```

### Separation of Concerns

| Layer | Responsibility | Files |
|-------|---------------|-------|
| **Orchestration** | Route messages to the right flow | `handler.ts`, `content-flow.ts` |
| **Triage** | Classify intent, suggest pillar/title | `cognitive/triage-skill.ts`, `classifier.ts` |
| **Selection UI** | Pillar → Action → Voice keyboards | `prompt-selection-callback.ts`, `prompt-selection.ts` |
| **Composition** | Resolve prompt IDs, assemble prompt | `packages/agents/.../composer.ts` |
| **Registry** | Define available pillars/actions/voices | `packages/agents/.../registry.ts` |
| **Storage** | Persist to Notion (Feed + Work Queue) | `notion.ts`, `audit.ts` |

### Prompt Resolution Strategy

1. **Pillar-specific drafter:** `drafter.{pillar-slug}.{action}` (e.g., `drafter.the-grove.research`)
2. **Default drafter:** `drafter.default.{action}` (fallback)
3. **Hardcoded fallback:** Built-in prompt template in `composer.ts` (last resort)

Prompts are stored in Notion's System Prompts database and fetched at composition time via `PromptManager`. They are NOT hardcoded in application code.

## Consequences

### Positive
- Clear ownership boundaries prevent accidental coupling
- Shared composition engine (`packages/agents/`) is reusable by Chrome extension
- Fallback chain ensures the system always produces output even if Notion is unreachable
- Triage skill (Haiku) provides sub-second classification without blocking the UI

### Negative
- Composition depends on Notion availability for pillar-specific prompts
- The prompt-selection flow is in-memory only (no persistence across bot restarts)
- Five-minute TTL on selections means abandoned flows silently expire

### Risks
- If `registry.ts` and Notion System Prompts DB diverge, composition will silently fall back to defaults
- No automated test verifies the prompt composition pipeline end-to-end against live Notion

## Architectural Invariants

These MUST remain true. Violations indicate regression:

1. `handler.ts` does NOT contain prompt text or classification logic
2. `content-flow.ts` delegates to `triage-skill.ts` for classification (never inline)
3. `prompt-selection-callback.ts` imports types from `packages/agents/src` (shared package)
4. All four pillars exist in `PILLAR_OPTIONS`, `PILLAR_SLUGS`, `PILLAR_ACTIONS`, `PILLAR_VOICES`
5. Drafter IDs follow the pattern `drafter.{pillar-slug}.{action}`
6. Voice IDs follow the pattern `voice.{voice-id}`
7. `composer.ts` has a three-level fallback chain (pillar-specific → default → hardcoded)

---

*ADR-001 created 2026-02-08 as part of Content Pipeline Protection Sprint.*
