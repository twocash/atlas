# Atlas Development SOPs

Standard operating procedures for Atlas development.

---

## SOP-001: Help System Updates

**Effective:** 2026-01-30  
**Scope:** All new commands, agents, and user-facing features

### Rule

**Every new user-facing capability MUST update the help system before merging.**

This is a required acceptance criterion for all PRs that add:
- New `/commands`
- New agent types
- New Telegram interactions
- Modified command syntax

### Process

1. **Add feature** — Implement the new capability
2. **Update help.ts** — Add entry to `apps/telegram/src/commands/help.ts`
3. **Verify** — Run `/help` and confirm new command appears
4. **Include in PR** — Help update must be in same commit/PR as feature

### Help Entry Format

```
/command <args>             — One-line description
  --flag                    — Optional flag explanation
```

**Guidelines:**
- Command left-aligned, description right-aligned with `—` separator
- Keep descriptions under 40 characters
- Group related commands under category headers
- New unreleased features go under "COMING SOON"

### Categories

| Category | What Goes Here |
|----------|----------------|
| RESEARCH & AGENTS | Agent commands, research, long-running tasks |
| MODEL SELECTION | Model switching, preferences |
| STATUS | System status, briefings, queue info |
| CONTENT | Draft, writing, content generation |
| CAPTURE | Expense, inbox, quick capture |
| SKILLS | Skill builder, custom agents |
| COMING SOON | Planned but not yet implemented |

### Acceptance Criteria Template

When writing specs for new features, include:

```markdown
### Acceptance Criteria

- [ ] Feature works as specified
- [ ] Tests pass
- [ ] **Help system updated** ← REQUIRED
- [ ] Documentation updated (if applicable)
```

### Enforcement

- PR reviewers should check for help.ts changes
- Missing help updates = PR blocked
- "Coming Soon" entries should be promoted when feature ships

---

## SOP-002: Command Naming Conventions

### Rules

1. **Lowercase only** — `/agent` not `/Agent`
2. **No underscores** — `/skill-new` not `/skill_new` (actually, prefer `/skill new`)
3. **Subcommands with space** — `/agent status` not `/agentstatus`
4. **Flags with double-dash** — `--thorough` not `-t`

### Examples

✅ Good:
```
/agent research "query"
/agent status
/model list
/skill new
/briefing now
```

❌ Bad:
```
/AgentResearch
/agent_status
/modelList
/skillNew
```

---

## SOP-003: Feature Shipping Checklist

Before marking any Work Queue item as "Done":

- [ ] Feature works in Telegram
- [ ] Help system updated (SOP-001)
- [ ] Notion Work Queue item updated with Output link
- [ ] Tested on mobile (if applicable)
- [ ] No console errors in bot logs

---

*SOPs are living documents. Update as patterns emerge.*
