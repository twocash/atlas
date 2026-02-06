# EXECUTION PROMPT: Bug Fix Sprint

Read `apps/telegram/workspace/BUGS_SPRINT.md` for full specs.

## Scope
Six confirmed bugs in the Atlas Telegram bot's cognitive routing system. Fix HIGH severity first (#2, #3, #6), then MEDIUM (#1, #4, #5).

## Key Files
- `src/intent.ts` — Intent detection (bugs #2, #3, #6)
- `src/cognitive/triage-skill.ts` — Haiku triage, pillar classification (bugs #3, #4, #6)
- `src/conversation/handler.ts` — Main message handler (bugs #1, #2)
- `src/conversation/content-flow.ts` — URL share detection, confirmation flow (bugs #1, #2)
- `src/classifier.ts` — Confidence thresholds (bug #3)
- `src/conversation/prompt.ts` — System prompt, pillar routing rules (bugs #2, #4)

## Rules
- Read CLAUDE.md before starting
- Read BUGS_SPRINT.md for full repro steps and fix strategies
- Feature-flag all changes (default: false, zero behavior change until enabled)
- Each fix should be independently revertable
- Run `bun run scripts/master-blaster.ts` after each fix to check for regressions
- Do NOT modify database IDs — they are canonical and correct
