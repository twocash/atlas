# ADR-001: handler.ts as Thin Orchestrator

**Status:** Accepted
**Date:** 2026-02-09
**Decision:** handler.ts is a thin orchestrator. All classification, prompt composition, and intelligence logic lives in dedicated modules.

## Context
handler.ts contained an inline CLASSIFICATION_PROMPT, parseClassification(), and classifyMessage() that made direct Anthropic API calls, bypassing the prompt composition system at packages/agents/src/services/prompt-composition/. This caused the smart titles regression and acted as a drift magnet.

## Decision
- All classification routes through triage-skill.ts adapters: triageForAudit() and classifyWithFallback()
- handler.ts contains NO prompt text, NO direct LLM calls for classification, NO parsing logic
- Flow: handler.ts → triage-skill.ts → prompt-composition/composer.ts → PromptManager → Notion System Prompts DB

## Consequences
- handler.ts is shorter and easier to review
- Classification changes happen in one place (triage-skill.ts / prompt-composition)
- Regressions from inline prompt edits are eliminated
- Future Claude Code sessions are guided by header guardrails and this ADR

## Enforcement
- handler.ts header contains FORBIDDEN section listing prohibited patterns
- This ADR documents rationale for future developers
- Future: CI lint rule to flag direct Anthropic classification calls in handler.ts
