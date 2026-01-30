# Atlas Execution Prompts

Handoff prompts for Claude Code developer sessions.

---

## 1. Daily Briefing Agent

**Work Queue:** https://www.notion.so/2f8780a78eef8196a4d6d3f696d886ae  
**Priority:** P1  
**Estimated Effort:** 2-3 hours

### Context

Atlas needs to proactively surface what needs attention. Jim shouldn't have to hunt through Notion — status should come to him at scheduled intervals via Telegram.

This is the first "monitoring loop" in the Persistent Agent pattern. Once this works, same infrastructure supports follow-up nudges, deadline warnings, and engagement alerts.

### Deliverable

Scheduled Telegram messages at 7am, 12:30pm, and 6pm ET showing:
- Blocked items (waiting on Jim)
- Items due this week
- Active work in progress
- Yesterday's completions
- Inbox count

### Briefing Format

```
☀️ Atlas Morning Briefing — Thu Jan 30

🔴 BLOCKED (needs you):
• DrumWave Q1 roadmap — waiting on your feedback (3 days)
• Garage permit — inspector callback requested

📅 DUE THIS WEEK:
• Grove blog post — Thursday
• Client invoice — Friday

🏃 ACTIVE (in progress):
• Research: competitor pricing — 60% complete

✅ COMPLETED YESTERDAY:
• Migrated Work Queue schema
• Agent SDK infrastructure

📥 INBOX (unprocessed): 3 items

—
Reply /status for full queue
```

### Data Sources

| Section | Notion Query |
|---------|--------------|
| Blocked | Work Queue 2.0: Status = "Blocked" |
| Due This Week | Work Queue 2.0: Due date within 7 days, Status != Done |
| Active | Work Queue 2.0: Status = "Active" |
| Completed Yesterday | Work Queue 2.0: Status = "Done", Completed = yesterday |
| Inbox | Inbox 2.0: Status = "Captured" (count only) |

### Database IDs

- **Work Queue 2.0:** `3d679030-b76b-43bd-92d8-1ac51abb4a28`
- **Inbox 2.0:** `f6f638c9-6aee-42a7-8137-df5b6a560f50`

### Implementation

**Location:** `apps/telegram/src/briefing/`

```
briefing/
├── scheduler.ts    # Cron/timer setup (7am, 12:30pm, 6pm ET)
├── queries.ts      # Notion queries for each section
├── formatter.ts    # Build the Telegram message
└── index.ts        # Wire together, export for bot.ts
```

**Scheduling:** Use Bun's native `setInterval` or a cron library. Must be timezone-aware (EST/EDT).

**Integration:** Wire into `apps/telegram/src/bot.ts` startup.

### Requirements

1. Query Work Queue for each section via Notion MCP
2. Query Inbox for unprocessed count
3. Format into clean Telegram message (use emoji sparingly)
4. Send at scheduled times
5. Handle empty sections gracefully (omit section if none)
6. Include age for blocked items ("3 days ago")
7. Log each briefing sent

### Acceptance Criteria

- [ ] Briefing arrives at 7am without asking
- [ ] Blocked items show how long they've been stuck
- [ ] Empty sections don't appear
- [ ] Bot restart doesn't break schedule
- [ ] Timezone is correct (ET)

### Commands (Optional)

```
/briefing now     — Send briefing immediately
/briefing status  — Show next scheduled briefing time
```

---

## 2. Agent Skill Builder

**Work Queue:** https://www.notion.so/2f8780a78eef819fa43ff9c28daaeadf  
**Priority:** P2  
**Estimated Effort:** 4-6 hours

### Context

Atlas should be self-extending. When Jim needs a new capability, he should be able to describe it in Telegram and Atlas generates the agent code. No coding, no sprints — just conversation.

This is a meta-agent: an agent that creates other agents.

### Deliverable

Conversational skill builder triggered by `/skill new` that:
1. Interviews Jim about what the skill should do
2. Generates agent code from templates
3. Registers the new agent
4. Makes it immediately available

### Example Flow

```
Jim: /skill new

Atlas: What should this skill do? Give me the one-liner.

Jim: Summarize long articles and extract key quotes

Atlas: Got it — a "Summarizer" skill. A few questions:
       
       1. What's the input?
          [URL] [Pasted text] [File]
       
       2. How detailed should the summary be?
          [3 bullets] [5 key points] [Full page]
       
       3. Where should output go?
          [Telegram] [Notion] [Both]

Jim: [URL] then [5 key points] then [Telegram]

Atlas: 📋 Skill spec:
       
       Name: summarize
       Input: URL
       Process: Extract article, summarize to 5 key points + 3 quotes
       Output: Telegram reply
       Model: Gemini 2.0 Flash
       
       [✅ Create skill] [✏️ Edit] [❌ Cancel]

Jim: [✅ Create skill]

Atlas: ✅ Skill created!
       
       Try it: /agent summarize "https://example.com/article"
```

### The Skill Shape

All skills follow this pattern:

| Component | Question | Options |
|-----------|----------|---------|
| **Input** | What triggers it? | URL, text, file, schedule, Notion change |
| **Process** | What does it do? | Summarize, research, transform, generate, fetch |
| **Model** | Which AI? | Gemini (research/summarize), Opus (coding), Haiku (classify) |
| **Output** | Where do results go? | Telegram, Notion page, file |

### Implementation

**Location:** `packages/agents/src/skill-builder/`

```
skill-builder/
├── index.ts          # Main export
├── interviewer.ts    # Conversation state machine
├── generator.ts      # Code generation from spec
├── registry.ts       # Persist and load custom skills
├── templates/        # Agent code templates
│   ├── summarize.ts
│   ├── research.ts
│   ├── transform.ts
│   └── fetch.ts
└── validator.ts      # Sanity check before registration
```

**Telegram Handler:** `apps/telegram/src/skill-handler.ts`

### Skill Spec Interface

```typescript
interface SkillSpec {
  name: string;           // e.g., "summarize"
  description: string;    // One-liner from user
  input: {
    type: 'url' | 'text' | 'file' | 'schedule' | 'notion_trigger';
    validation?: string;  // e.g., "must be valid URL"
  };
  process: {
    type: 'summarize' | 'research' | 'transform' | 'generate' | 'fetch';
    config: Record<string, any>;  // Type-specific config
  };
  model: 'gemini-2.0-flash' | 'claude-opus-4' | 'claude-haiku-4';
  output: {
    destination: 'telegram' | 'notion' | 'both';
    format?: string;  // e.g., "bullet points"
  };
}
```

### Interview State Machine

```typescript
type InterviewState = 
  | { step: 'awaiting_description' }
  | { step: 'awaiting_input', description: string }
  | { step: 'awaiting_detail', description: string, input: InputType }
  | { step: 'awaiting_output', description: string, input: InputType, process: ProcessType }
  | { step: 'confirming', spec: SkillSpec }
  | { step: 'complete', skill: RegisteredSkill };
```

### Persistence

Store generated skills in `apps/telegram/data/custom-skills.json`:

```json
{
  "skills": [
    {
      "name": "summarize",
      "spec": { ... },
      "createdAt": "2026-01-30T12:00:00Z",
      "usageCount": 0
    }
  ]
}
```

Load on bot startup, register with agent registry.

### Code Generation

Use templates with variable substitution:

```typescript
// templates/summarize.ts
export const summarizeTemplate = (spec: SkillSpec) => `
import { Agent, AgentConfig } from '../types';

export const ${spec.name}Agent = async (config: AgentConfig): Promise<AgentResult> => {
  const { input } = config;
  
  // Fetch content from URL
  const content = await fetchUrl(input);
  
  // Summarize with ${spec.model}
  const summary = await summarize(content, {
    points: ${spec.process.config.points || 5},
    quotes: ${spec.process.config.quotes || 3}
  });
  
  return {
    output: summary,
    summary: \`Summarized \${input} into ${spec.process.config.points} points\`
  };
};
`;
```

### Requirements

1. `/skill new` starts interview flow
2. Inline buttons for quick selection where possible
3. Generate valid TypeScript agent code
4. Register with existing agent registry
5. Persist across bot restarts
6. List custom skills: `/skill list`
7. Delete skill: `/skill delete <name>`

### Acceptance Criteria

- [ ] Can create new agent type via Telegram conversation
- [ ] Generated agent actually works (80%+ success on first try)
- [ ] New skill persists across bot restarts
- [ ] Can list and delete custom skills
- [ ] Skill immediately available after creation

### Commands

```
/skill new              — Start skill creation interview
/skill list             — List all custom skills
/skill delete <name>    — Remove a custom skill
/skill info <name>      — Show skill spec
```

---

## Prerequisites for Both

Ensure these are working before starting:

1. **Telegram bot running:** `cd apps/telegram && bun run dev`
2. **Notion MCP connected:** Can query Work Queue and Inbox
3. **Agent registry operational:** `packages/agents/src/registry.ts`
4. **Environment:** `.env` has `TELEGRAM_BOT_TOKEN`, `ANTHROPIC_API_KEY`

---

## Working Directory

```
C:\github\atlas\
```

Start bot: `.\start-telegram.bat` or `cd apps/telegram && bun run dev`

---

*Generated: 2026-01-30*
