# Conversation Module Architecture

**Location:** `apps/telegram/src/conversation/`
**Purpose:** Conversational UX — Claude as the front door for all Telegram interactions
**Related:** `packages/agents/src/services/prompt-composition/` (shared composition engine)

---

## Directory Map

### Core Orchestration
| File | Purpose |
|------|---------|
| `handler.ts` | Main entry point. Routes messages through Claude with tool use. Delegates content shares to `content-flow.ts`. **Does NOT contain prompt text or classification logic.** |
| `index.ts` | Module exports |
| `context.ts` | Conversation state management (in-memory per-user) |
| `context-manager.ts` | Extended context management utilities |
| `prompt.ts` | System prompt builder for Claude conversations |
| `router.ts` | Task depth estimation and model selection |

### Content Pipeline (URL + Media Capture)
| File | Purpose |
|------|---------|
| `content-flow.ts` | Entry point for content shares. Detects URLs, calls triage, triggers selection flow. |
| `content-router.ts` | Routes URLs to extraction method (Fetch/Browser/Gemini) based on domain |
| `content-confirm.ts` | Pending content storage, confirmation keyboard builder |
| `content-patterns.ts` | Pattern detection for content shares |
| `prompt-selection.ts` | In-memory state for Pillar → Action → Voice selection (5-min TTL) |
| `notion-url.ts` | Special handling for Notion URLs |
| `dispatch-choice.ts` | Routing choice UI for dispatch decisions |

### Media Processing
| File | Purpose |
|------|---------|
| `media.ts` | Media processing (Gemini Vision), pillar inference from media |
| `attachments.ts` | Attachment detection and prompt building |

### Audit + Stats
| File | Purpose |
|------|---------|
| `audit.ts` | Audit trail creation, Work Queue status updates, reclassification logging |
| `stats.ts` | Usage recording, stats formatting, pattern detection |

### Tool System
| File | Purpose |
|------|---------|
| `tools/index.ts` | Tool registry and exports |
| `tools/core.ts` | Core tool definitions (30+ tools). Contains `composedPrompt` override for V3 Active Capture. |
| `tools/dispatcher.ts` | Tool routing (native vs MCP) |
| `tools/agents.ts` | Agent-related tools |
| `tools/operator.ts` | Operator/admin tools |
| `tools/workspace.ts` | Workspace file tools |
| `tools/self-mod.ts` | Self-modification tools |
| `tools/browser.ts` | Browser automation tools |
| `tools/supervisor.ts` | Supervisor tools |

### Types
| File | Purpose |
|------|---------|
| `types.ts` | Pillar, RequestType, FeedStatus, WQStatus, ClassificationResult, tool types |

---

## Content Pipeline Call Chain

```
User sends URL to Telegram
  │
  ▼
handler.ts
  │ calls maybeHandleAsContentShare(ctx)
  ▼
content-flow.ts
  │ detectContentShare(text) → { isContentShare, primaryUrl, needsBrowser }
  │ isNotionUrl(url)? → notion-url.ts (special path)
  │ triggerContentConfirmation(ctx, url, context)
  ▼
cognitive/triage-skill.ts (external)
  │ triageMessage(input) → { intent, confidence, title, pillar, complexityTier }
  │ (Single Haiku call, sub-second)
  ▼
handlers/prompt-selection-callback.ts (external)
  │ startPromptSelection(ctx, url, 'url', title, triageResult)
  │ → Pillar keyboard (highlighted if triage suggested one)
  │ → User taps Pillar → Action keyboard
  │ → User taps Action → Voice keyboard
  │ → User taps Voice → compose + save
  ▼
packages/agents/src/services/prompt-composition/
  │ composePromptFromState(state)
  │ → resolveDrafterId(pillar, action) → 'drafter.the-grove.research'
  │ → resolveVoiceId(voiceId) → 'voice.grove-analytical'
  │ → PromptManager.composePrompts(ids, variables)
  │ → Fallback: pillar-specific → default → hardcoded
  ▼
notion.ts (external)
  │ createFeedItem() + createWorkItem()
  └── Spark saved to Feed 2.0 + Work Queue 2.0
```

---

## Key Design Rules

1. **handler.ts orchestrates, never composes.** No prompt text, no classification logic, no pillar routing rules.
2. **Prompts live in Notion.** Fetched at composition time via PromptManager, not hardcoded.
3. **Registry is the single source of truth** for pillar/action/voice mappings (`packages/agents/.../registry.ts`).
4. **Triage is external.** `cognitive/triage-skill.ts` owns classification. `classifier.ts` owns heuristic fallback.
5. **Composition is shared.** `packages/agents/src/services/prompt-composition/` is used by both Telegram and Chrome extension.

---

## Feature Flags

| Flag | Default | Effect |
|------|---------|--------|
| `ATLAS_CONTENT_CONFIRM` | `true` | Enables content confirmation keyboard |
| `triageSkill` | `true` | Uses Haiku triage instead of legacy classification |
| `duplicateConfirmationGuard` | `true` | Prevents duplicate keyboards from race conditions |
| `PROMPT_STRICT_MODE` | `false` | Fails hard when V3 composedPrompt is expected but missing |

---

*Architecture documented 2026-02-08. See ADR-001 for decision rationale.*
*See atlas-patterns.md Section 8 for forbidden patterns and invariants.*
