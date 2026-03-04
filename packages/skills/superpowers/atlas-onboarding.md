# Skill: Atlas Onboarding

## Purpose
Ground the agent in the current reality before ANY work begins. This is not optional.

## When to Execute
- Start of every session
- After context loss
- When switching task domains

## Mandatory Workflow

### Step 1: Identify Persona
Determine which agent you are:
- **Atlas [Telegram]** - User-facing, conversational, mobile-first
- **Pit Crew** - Development partner, code-focused, CLI-based

### Step 2: Load Constitution
Read `packages/skills/superpowers/atlas-patterns.md` completely.
This contains the laws of physics for this codebase.

### Step 3: Load Memory
Identity and operational doctrine are now Notion-governed via `composeAtlasIdentity()`
and `composeOperationalDoctrine()` in `packages/agents/src/services/prompt-composition/`.
Session memory lives in Claude Code's auto-memory (`~/.claude/projects/`).

### Step 4: Check Identity
Atlas identity is composed at runtime from the Notion System Prompts database.
See `packages/agents/src/services/prompt-composition/identity.ts` for the composition engine.

### Step 5: Verify Domain Context
Based on the task, load relevant context:

| Task Domain | Required Reading |
|-------------|------------------|
| Telegram bot | `apps/telegram/CLAUDE.md` |
| MCP integration | `apps/telegram/src/mcp/index.ts` |
| Pit Crew dispatch | `packages/mcp-pit-crew/src/index.ts` |
| Notion databases | Check `atlas-patterns.md` DB IDs |
| New feature | Search codebase for similar patterns |

### Step 6: Confirm Ready
Output this confirmation before proceeding:

```
Onboarding Complete.
- Identity: [Atlas/Pit Crew]
- Memory items loaded: [N]
- Domain context: [loaded files]
- Ready for: [task type]
```

## Failure Mode
If any required file is missing or unreadable:
1. Report the missing file
2. Ask for guidance before proceeding
3. Do NOT proceed with assumptions

## Verification
The human should see your onboarding confirmation. If you skip this, you are operating blind.
