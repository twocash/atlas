---
name: quick-capture
description: Fast spark capture to Inbox with minimal friction
trigger: capture this, quick note, remember this, add to inbox
created: 2026-01-30T00:00:00.000Z
---

# quick-capture

Fast spark capture to Inbox with minimal friction

## Trigger

"capture this", "quick note", "remember this", "add to inbox", "log this"

## Instructions

1. **Extract the Spark**
   - Identify the core idea/task from Jim's message
   - Keep it concise but complete

2. **Auto-Classify**
   - Determine pillar based on context:
     - Permits, house, garage → Home/Garage
     - Client names (DrumWave, Take Flight) → Consulting
     - AI, LLM, research → The Grove
     - Health, gym, family → Personal
   - If unclear, default to The Grove

3. **Create Inbox Entry**
   - Call `notion_create` with:
     - Title: extracted spark
     - Status: Captured
     - Pillar: auto-classified
     - Source: Telegram

4. **Confirm Quickly**
   ```html
   <b>Captured</b>
   <code>[pillar]</code> [spark title]
   ```

5. **No Follow-up Questions**
   - This is a quick capture, don't ask clarifying questions
   - If context is ambiguous, make best guess and note it
