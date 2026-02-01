# Atlas Superpowers

Mandatory workflow skills for Atlas development agents.

## Philosophy

These are not suggestions. They are **executable protocols** that agents must follow.
Every skill produces verifiable output, enabling human verification.

## Skills

| Skill | Purpose | When |
|-------|---------|------|
| `atlas-onboarding` | Load context before work | Session start |
| `atlas-patterns` | Architectural constraints | Always (reference) |
| `atlas-tdd` | Test-driven development | Any code change |
| `atlas-debug` | Root cause investigation | Any bug fix |
| `atlas-completion` | Verification checklist | Before marking done |

## Usage

### For Agents (Atlas, Pit Crew)
Reference in CLAUDE.md:
```markdown
## MANDATORY STARTUP
Execute `atlas-onboarding` at session start.

## MANDATORY DEVELOPMENT
Follow `atlas-tdd` for all code changes.
Follow `atlas-debug` for all bug fixes.
Follow `atlas-completion` before marking done.
```

### For Humans
These skills are readable documentation. Review them to understand
what the agents should be doing.

## Key Principles

1. **Mandatory, not advisory** - Agents must follow these
2. **Verifiable outputs** - Each skill produces confirmation
3. **YAGNI ruthlessly** - Simplest solution wins
4. **No fixes without root cause** - Debug systematically
5. **No code without tests** - TDD enforced

## Forbidden Actions

See `atlas-patterns.md` for the full list. Key items:
- Creating new database IDs
- Using npm/node instead of bun
- Writing console.log in MCP servers
- Skipping tests for logic changes

## Circuit Breaker

If 3+ fix attempts fail: **STOP**. Question the architecture.
This signals a design problem, not a bug.
