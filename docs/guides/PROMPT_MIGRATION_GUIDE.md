# Prompt Migration Guide

**Version:** 1.0.0
**Status:** Active
**Last Updated:** 2026-02-03

---

## Overview

This guide documents how to migrate hardcoded prompts from TypeScript to the **Atlas System Prompts** Notion database. This enables runtime prompt tuning without code deployments.

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   TypeScript    │────▶│  PromptManager   │────▶│ Notion Database │
│   (fallback)    │     │   (with cache)   │     │ (primary source)│
└─────────────────┘     └──────────────────┘     └─────────────────┘
                               │
                               ▼
                        ┌──────────────────┐
                        │  prompts-v1.json │
                        │  (Safe Mode)     │
                        └──────────────────┘
```

### Fallback Chain

1. **Cache** - In-memory, 5-minute TTL
2. **Notion** - Primary source, fetched on cache miss
3. **Local JSON** - Safe Mode fallback if Notion unavailable
4. **Error String** - Last resort if all else fails

## Database Schema

| Property | Type | Purpose |
|----------|------|---------|
| **ID** | Text | Immutable key (e.g., `research.grove.sprout`) |
| **Capability** | Select | System using prompt: Research Agent, Voice, Classifier, Refinery |
| **Pillar** | Multi-Select | Context: The Grove, Consulting, Personal, Home/Garage, All |
| **Use Case** | Select | Specific intent: General, Sprout Generation, Market Analysis, etc. |
| **Stage** | Select | Pipeline stage: 1-Spark, 2-Research, 3-Refine, 4-Execute |
| **Prompt Text** | Rich Text | Template with `{{variables}}` |
| **Model Config** | Text | JSON config: `{"temperature": 0.2}` |
| **Active** | Checkbox | Kill switch |
| **Version** | Number | For tracking changes |

## Prompt ID Convention

```
{capability}.{pillar}.{useCase}
```

Examples:
- `voice.grove-analytical` - Grove analytical writing voice
- `research-agent.standard` - Standard research depth
- `research-agent.the-grove.sprout-generation` - Grove-specific sprout research

## Migration Pattern

### Step 1: Extract Prompt to JSON

Add the prompt to `apps/telegram/data/migrations/prompts-v1.json`:

```json
{
  "id": "voice.new-voice",
  "capability": "Voice",
  "pillars": ["All"],
  "useCase": "General",
  "stage": "4-Execute",
  "promptText": "## Writing Voice: New Voice\n\nYour voice instructions here...",
  "modelConfig": { "temperature": 0.3 },
  "active": true,
  "version": 1
}
```

### Step 2: Add to Notion Database

Run the seed script or manually add to the Atlas System Prompts database:

```bash
npx tsx scripts/seed-prompts.ts
```

### Step 3: Replace Hardcoded with PromptManager

**Before:**
```typescript
const voiceInstructions = `## Voice: My Voice
Instructions here...`;
```

**After:**
```typescript
import { getPrompt } from "@atlas/agents";

const voiceInstructions = await getPrompt({
  capability: "Voice",
  pillar: "All",
  useCase: "General",
}) || FALLBACK_VOICE;
```

### Step 4: Keep Fallback Inline

Always maintain a hardcoded fallback for reliability:

```typescript
const FALLBACK_VOICE = `## Voice: Default
Fallback instructions...`;

const voiceInstructions = await getPrompt({...}) || FALLBACK_VOICE;
```

## Variable Injection

Prompts support `{{variable}}` syntax. System variables are auto-injected:

| Variable | Description |
|----------|-------------|
| `{{current_date}}` | "Monday, February 3, 2026" |
| `{{current_time}}` | "3:45 PM" |
| `{{iso_date}}` | "2026-02-03" |
| `{{iso_datetime}}` | Full ISO timestamp |
| `{{pillar}}` | Current pillar context |

Custom variables can be passed:

```typescript
const prompt = await getPrompt(
  { capability: "Research Agent", pillar: "The Grove" },
  { query: "AI coding assistants", depth: "deep" }
);
```

## Deferred Migrations

The following prompts are candidates for future migration:

### High Priority

| File | Prompts | Effort |
|------|---------|--------|
| `claude.ts` | 4 classification prompts | ~2 hours |
| `prompt.ts` | Master system sections | ~4 hours |

### Medium Priority

| File | Prompts | Effort |
|------|---------|--------|
| `profiler.ts` | Pattern dictionaries | ~1 hour |
| `supervisor.ts` | Mini prompts | ~30 min |

## Testing

### Verify PromptManager

```typescript
import { getPromptManager } from "@atlas/agents";

const pm = getPromptManager();

// Check cache stats
console.log(pm.getCacheStats());

// Force cache invalidation
pm.invalidateCache("voice.grove-analytical");

// Fetch fresh
const prompt = await pm.getPrompt({
  capability: "Voice",
  pillar: "The Grove"
});
```

### Safe Mode Testing

1. Set invalid `NOTION_PROMPTS_DB_ID` in .env
2. Restart Atlas
3. Verify prompts load from `prompts-v1.json`
4. Check logs for "[PromptManager] Fallback hit: ..."

## Troubleshooting

### "Prompt not found" Errors

1. Check prompt ID matches exactly (case-sensitive)
2. Verify `Active` checkbox is checked in Notion
3. Check pillar multi-select includes correct value
4. Try cache invalidation: `pm.invalidateCache()`

### Notion API Errors

- **401 Unauthorized**: Check `NOTION_API_KEY`
- **404 Not Found**: Check `NOTION_PROMPTS_DB_ID`
- **Rate Limited**: Cache should prevent this; increase TTL if needed

### Safe Mode Not Working

- Verify `apps/telegram/data/migrations/prompts-v1.json` exists
- Check JSON syntax is valid
- Look for load errors in startup logs

## Files Reference

| File | Purpose |
|------|---------|
| `packages/agents/src/services/prompt-manager.ts` | Core service |
| `scripts/setup-prompts-db.ts` | Database creation |
| `scripts/seed-prompts.ts` | Populate database |
| `apps/telegram/data/migrations/prompts-v1.json` | Seed data + Safe Mode fallback |
| `apps/telegram/src/features/procedural-ui.ts` | Dynamic Telegram keyboards |

---

*ATLAS Procedural Memory System - v1.0.0*
