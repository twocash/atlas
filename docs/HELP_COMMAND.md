# /help Command Implementation

**Priority:** Quick add (15-20 min)  
**Location:** `apps/telegram/src/commands/help.ts`

## Deliverable

Add `/help` command that shows all available commands with examples.

## Output Format

```
🤖 Atlas Commands

RESEARCH & AGENTS
/agent research "query"     — Research a topic
  --thorough                — More sources (5-8)
  --focus "area"            — Narrow focus
/agent status               — List running agents
/agent cancel <id>          — Stop an agent
/agent test                 — Test agent system

MODEL SELECTION
/model                      — Show current model
/model list                 — Show all available models
/model <name>               — Switch model

STATUS
/status                     — Quick system status
/help                       — This message

COMING SOON
/briefing now               — Trigger daily briefing
/expense summary            — Budget overview
/skill new                  — Create new agent type
/draft "topic"              — Generate content

—
💡 Or just message me naturally — I'll figure out what you need.
```

## Implementation

```typescript
// apps/telegram/src/commands/help.ts

export const helpCommand = () => {
  return `🤖 Atlas Commands

RESEARCH & AGENTS
/agent research "query"     — Research a topic
  --thorough                — More sources (5-8)
  --focus "area"            — Narrow focus
/agent status               — List running agents
/agent cancel <id>          — Stop an agent
/agent test                 — Test agent system

MODEL SELECTION
/model                      — Show current model
/model list                 — Show all available models
/model <name>               — Switch model

STATUS
/status                     — Quick system status
/help                       — This message

COMING SOON
/briefing now               — Trigger daily briefing
/expense summary            — Budget overview
/skill new                  — Create new agent type
/draft "topic"              — Generate content

—
💡 Or just message me naturally — I'll figure out what you need.`;
};
```

## Wire into bot.ts

```typescript
import { helpCommand } from './commands/help';

// In message handler
if (text === '/help') {
  await bot.api.sendMessage(chatId, helpCommand());
  return;
}
```

## Acceptance Criteria

- [ ] `/help` returns formatted command list
- [ ] Groups commands by category
- [ ] Shows "Coming Soon" for planned features
- [ ] Ends with natural language hint
