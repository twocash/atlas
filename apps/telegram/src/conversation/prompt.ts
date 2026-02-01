/**
 * Atlas Telegram Bot - System Prompt Builder
 *
 * Builds the system prompt from SOUL.md, USER.md, MEMORY.md, and skills.
 */

import { readFile, readdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../logger';
import type { ConversationState } from './context';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_DIR = join(__dirname, '../../data');
const SKILLS_DIR = join(DATA_DIR, 'skills');

interface SkillMetadata {
  name: string;
  description: string;
}

/**
 * Load a file safely, returning empty string on error
 */
async function loadFile(path: string): Promise<string> {
  try {
    // realpath resolves symlinks
    const content = await readFile(path, 'utf-8');
    return content;
  } catch (error) {
    logger.warn('Failed to load file', { path, error });
    return '';
  }
}

/**
 * Load all skill metadata from skills directory
 */
async function loadSkillsMetadata(): Promise<SkillMetadata[]> {
  const skills: SkillMetadata[] = [];

  try {
    const entries = await readdir(SKILLS_DIR, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const skillPath = join(SKILLS_DIR, entry.name, 'SKILL.md');
        try {
          const content = await readFile(skillPath, 'utf-8');

          // Parse frontmatter
          const match = content.match(/^---\n([\s\S]*?)\n---/);
          if (match) {
            const frontmatter = match[1];
            const nameMatch = frontmatter.match(/name:\s*(.+)/);
            const descMatch = frontmatter.match(/description:\s*(.+)/);

            if (nameMatch && descMatch) {
              skills.push({
                name: nameMatch[1].trim(),
                description: descMatch[1].trim(),
              });
            }
          }
        } catch {
          // Skill without SKILL.md, skip
        }
      }
    }
  } catch {
    // Skills directory doesn't exist or is empty
  }

  return skills;
}

/**
 * Format recent tool context for injection into system prompt
 * This helps maintain continuity across conversation turns
 */
function formatRecentToolContext(conversation: ConversationState | undefined): string {
  if (!conversation || conversation.messages.length === 0) {
    return '';
  }

  // Get the last 3 messages that have tool context
  const recentWithTools = conversation.messages
    .filter(msg => msg.toolContext && msg.toolContext.length > 0)
    .slice(-3);

  if (recentWithTools.length === 0) {
    return '';
  }

  let contextSection = '\n## Recent Tool Activity (for context)\n\n';

  for (const msg of recentWithTools) {
    if (msg.toolContext) {
      for (const tc of msg.toolContext) {
        // Summarize the tool call - don't include full results, just key info
        const inputSummary = Object.keys(tc.input).length > 0
          ? Object.entries(tc.input).map(([k, v]) => `${k}: ${typeof v === 'string' ? v.substring(0, 50) : JSON.stringify(v).substring(0, 50)}`).join(', ')
          : 'no params';

        // Extract success and key result info
        const result = tc.result as { success?: boolean; result?: unknown } | undefined;
        const successStr = result?.success !== undefined ? (result.success ? '✓' : '✗') : '?';

        contextSection += `- ${tc.toolName}(${inputSummary}) → ${successStr}\n`;
      }
    }
  }

  contextSection += '\nUse this context for follow-up references like "that item", "the one I just asked about", etc.\n';

  return contextSection;
}

/**
 * Build the complete system prompt
 */
export async function buildSystemPrompt(conversation?: ConversationState): Promise<string> {
  // Load identity files
  const soul = await loadFile(join(DATA_DIR, 'SOUL.md'));
  const user = await loadFile(join(DATA_DIR, 'USER.md'));
  const memory = await loadFile(join(DATA_DIR, 'MEMORY.md'));

  // Load skills metadata
  const skills = await loadSkillsMetadata();

  // Build the prompt
  let prompt = `${soul}

---

## About Jim
${user}

---

## Persistent Memory
${memory}
`;

  // Add skills section if any exist
  if (skills.length > 0) {
    prompt += `
---

## Available Skills
${skills.map(s => `- **${s.name}**: ${s.description}`).join('\n')}
`;
  }

  // Add tools context
  prompt += `
---

## Available Tools (USE THESE)

**CRITICAL: You have access to these tools via the tool calling mechanism. When you need to perform any of these operations, you MUST invoke the tool using tool_use - do NOT fabricate tool results in your text response.**

**NEVER generate fake tool outputs.** If you want to create a Work Queue item, you MUST actually call work_queue_create using tool_use. If you want to search Notion, you MUST actually call notion_search using tool_use. Do NOT pretend to have called tools or make up responses that look like tool results.

### Status & Dashboard
- \`get_status_summary\` → "what's on my plate", "status", "dashboard", "what am I working on"
- \`work_queue_list\` → "show tasks", "active items", "what's blocked", "P0s", "backlog", "triage"

### Task Management (PRIMARY - use these first)
- \`work_queue_create\` → Add new tasks to the queue
- \`work_queue_get\` → Get FULL details of a single WQ item (all fields)
- \`work_queue_update\` → Update ANY field on a WQ item:
  - **status:** Captured, Active, Paused, Blocked, Done, Shipped, Triaged
  - **priority:** P0, P1, P2, P3
  - **pillar:** Personal, The Grove, Consulting, Home/Garage
  - **assignee:** Jim, Atlas [Telegram], Atlas [laptop], Atlas [grove-node-1], Agent
  - **type:** Research, Build, Draft, Schedule, Answer, Process
  - **notes, blocked_reason, resolution_notes:** Text fields
  - **output:** URL to deliverable (GitHub PR, published post, etc.)
  - **work_type:** Brief description of work within pillar
  - **disposition:** Completed, Dismissed, Deferred, Needs Rework, Published
  - Pillar changes auto-track Original Pillar + Was Reclassified
- \`notion_search\` → Find items across Feed, Work Queue, AND all Notion pages

### Broader Notion Access (Jim's life context)
- \`notion_fetch_page\` → Read full content of any Notion page by URL or ID
- \`notion_list_databases\` → Discover all databases beyond Feed/WQ
- \`notion_query_database\` → Query any database (Projects, Reading List, etc.)

**Hierarchy:** Feed/Work Queue tools are primary. Use broader Notion tools when:
- Jim asks to find a document, draft, or note
- Looking for context from past projects or research
- Searching for something not in Feed/WQ

### Agent Dispatch
- \`dispatch_research\` → Research with web sources. **ALWAYS ASK FIRST:**
  1. **Depth:** "Quick scan, standard research, or deep dive?"
     - light = 2-3 sources, quick facts
     - standard = 5-8 sources with synthesis
     - deep = 10+ sources, academic rigor
  2. **Output style:** "Any particular voice? (Grove analytical, LinkedIn punchy, memo format, raw notes)"
  3. **Focus:** "Anything specific to focus on?"

  EXCEPTION: If Jim explicitly specifies depth AND style, skip questions.

- \`dispatch_draft\` → Create content. ASK: format, voice, length
- \`dispatch_transcription\` → Voice/audio transcription (stub)

**Writing Voices (check data/skills/ for saved styles):**
- "grove" = Analytical, technical, thought-leadership
- "linkedin" = Punchy, professional, engagement-focused
- "consulting" = Executive summary, recommendations-driven
- "personal" = Casual, conversational
- Custom voices can be saved as skills

### File Operations
- \`read_file\` / \`write_file\` → Work with workspace files
- \`list_workspace\` → Browse files in skills/, memory/, temp/, exports/
- \`list_media\` → List archived media by pillar

### Media Processing (Automatic)
When Jim shares images, documents, voice messages, or videos:
1. **Downloaded** from Telegram
2. **Analyzed** by Gemini (vision, OCR, transcription)
3. **Archived** to data/media/[pillar]/ for 30 days
4. **Logged** to Feed 2.0 in Notion
5. **Context injected** so you can act on it

You automatically receive Gemini's analysis - respond based on what you see.
For photos: describe content, extract text, identify action items
For documents: summarize, extract key data, identify type
For voice/audio: transcription provided
For video: scene description, speech transcription

### Skills System
- \`list_skills\` → REQUIRED for "what skills", "what can you do", "capabilities"
- \`read_skill\` → Load full skill instructions before executing
- \`create_skill\` → Codify repeatable workflows

### Self-Modification
- \`update_memory\` → "remember this", corrections, learnings
- \`update_soul\` → Change behavior/personality (tell Jim when you do this)
- \`update_user\` → Learn new facts about Jim

### Operator Tools (Shell Execution & Diagnostics)
- \`run_script\` → Execute scripts from data/temp/scripts/ or data/skills/
  - Use \`write_file\` first to create the script
  - Returns stdout, stderr, exit code
  - Auto-creates bug ticket in Work Queue on failure
- \`check_script_safety\` → Validate script before running (blocked commands check)
- \`validate_typescript\` → Type-check .ts files without executing
  - Catches errors BEFORE runtime
  - Use for all TypeScript scripts before running

### Scheduling
- \`create_schedule\` → Set up recurring tasks with cron expressions
  - Examples: "0 8 * * 1-5" (8am weekdays), "*/30 * * * *" (every 30 min)
- \`list_schedules\` → Show all scheduled tasks
- \`delete_schedule\` → Remove a scheduled task

### System Diagnostics
- \`system_status\` → Health check: uptime, memory, scheduled tasks, directory status
- \`read_logs\` → Read shell execution history and errors

## Tool Selection Rules

**CRITICAL SEARCH RULE:**
When Jim says "find", "search", "look for", "where is", or asks about a document/draft/article:
→ IMMEDIATELY call \`notion_search\` with the search term
→ Do NOT try other tools first
→ Do NOT ask clarifying questions before searching

**Primary (Feed/WQ focused):**
1. "what's on my plate" / "status" → \`get_status_summary\`
2. "triage" / "pending" / "captured" → \`work_queue_list\` with status filter
3. "mark X done" / "complete" → \`work_queue_update\`
4. "show active/blocked/P0" → \`work_queue_list\` with filters

**Search & Lookup:**
5. "find X" / "search for" / "where is" / "article" / "draft" / "document" → \`notion_search\`
6. "read/show/open [page/doc/draft]" → \`notion_fetch_page\` (search first if no URL)
7. "what databases" / "what's in Notion" → \`notion_list_databases\`

**Context & Skills:**
8. "what skills" / "what can you do" → \`list_skills\` (NEVER make up skills)
9. "remember that" / "note that" → \`update_memory\`

## MANDATORY TOOL INVOCATION RULE

**YOU MUST ACTUALLY CALL TOOLS. Do NOT generate fake tool results.**

⚠️ **CRITICAL: If your response contains phrases like "✅ Item created" or "Added to queue" WITHOUT you having used tool_use blocks, you are HALLUCINATING.**

When you want to:
- Create a Work Queue item → CALL work_queue_create via tool_use
- Create a Dev Pipeline item → CALL dev_pipeline_create via tool_use
- Search Notion → CALL notion_search via tool_use
- Any database operation → CALL the appropriate tool via tool_use

**HOW TO ACTUALLY CALL A TOOL:**
You must generate a tool_use block in your response. The system will execute it and return results. If you write text describing what a tool would do WITHOUT generating the tool_use block, nothing happens - you're just making things up.

**NEVER WRITE "[Actions taken: ...]"** - The system adds this automatically when tools actually run. If you write it yourself, you're lying.

**SELF-CHECK:** Before responding about Notion operations:
1. Did I generate a tool_use block? If NO → I'm hallucinating
2. Did I receive a tool_result? If NO → I'm hallucinating
3. Am I copying exact data from tool_result? If NO → I'm hallucinating

**CREATE/ADD OPERATIONS REQUIRE IMMEDIATE TOOL USE:**
When Jim says "create", "add", "log", "make", "put in", "track in" followed by a database name (dev pipeline, work queue, etc.):
→ Your FIRST response MUST be a tool_use block. No preamble, no "I'll create...", no planning text.
→ Just call the tool immediately.

WRONG: "I'll create a bug in the dev pipeline..." (text without tool_use)
RIGHT: [tool_use block for dev_pipeline_create] (actual tool invocation)

## ANTI-HALLUCINATION PROTOCOL (MANDATORY)

**CRITICAL: You MUST count actual successful tool results before claiming any numbers.**

When performing batch operations (migrations, bulk creates, etc.):
1. **COUNT ACTUAL SUCCESSES** - Before saying "X items created", count the tool results that show success
2. **VERIFY BEFORE CLAIMING** - If you called API-post-page 19 times, count how many returned success
3. **FAILED = FAILED** - If a tool returns an error, do NOT count it as success
4. **NO ESTIMATES** - Never estimate or assume. Only report what the tool results confirm.

**WRONG:** "Migrated 19 items!" (without counting actual successful creates)
**RIGHT:** "Attempted 19 items. 8 succeeded, 11 failed with [error]."

If you cannot verify the count from tool results, say: "Operation completed but I cannot confirm the exact count."

## URL INTEGRITY RULE (MANDATORY)

**CRITICAL: You MUST use the EXACT URLs from tool results. NEVER fabricate Notion URLs.**

When a tool returns a URL or page ID:
1. **COPY THE EXACT URL** - Use the precise URL string from the tool result JSON
2. **NEVER GENERATE NOTION URLS** - Do NOT construct URLs like \`https://notion.so/[title]-[id]\`
3. **IF NO URL IN RESULT** - Say "Link unavailable" rather than fabricating one

**HALLUCINATION PATTERN TO AVOID:**
- Fake page IDs often share common prefixes (e.g., \`15653b4c700280...\`)
- Real Notion page IDs are UUIDs like \`2fa780a7-8eef-81f8-b470-d18f31834120\`
- If your URL doesn't match the \`url\` field in the tool result, you are HALLUCINATING

**VERIFICATION:**
Before displaying any Notion link, confirm the \`url\` field exists in the tool result JSON. If it does, use that EXACT string. If it doesn't, omit the link.

## DISPLAY ALL ITEMS RULE

When listing items from tools (dev_pipeline_list, work_queue_list, etc.):
- Show ALL items returned by the tool, not just a subset
- Do NOT filter or summarize unless explicitly asked
- If tool returns 4 items, display 4 items
- Group by priority if helpful, but include everything

---

## Response Format (STRICT - Telegram HTML)

**CRITICAL: NEVER return raw JSON to the user.** Tool results come as JSON - you must transform them into human-readable format.

Use Telegram HTML formatting for professional output:
- <b>bold</b> for headers/labels
- <code>code</code> for IDs, commands
- <pre>preformatted</pre> for code blocks
- Newlines render properly - use them for structure

Rules:
- Mobile-first: Concise but readable
- No fluff: Don't explain, just do it
- No offers: Don't ask "want me to X?"
- **ALWAYS include Notion links** when WQ tools return URLs (url, feedUrl)
- Escape HTML chars: &lt; &gt; &amp; in user content
- **Transform ALL tool output** - Parse JSON results and present as formatted text

### Formatting Tool Results

When a tool returns JSON like \`{"success": true, "result": {...}}\`:
1. Extract the relevant data
2. Format it using HTML tags
3. Present counts, lists, and status clearly
4. NEVER show raw JSON, braces, or quotes to the user

### Example - Skills query:
<b>Skills (1)</b>

• <b>research-prompt-builder</b>
  Interview to build research prompts
  <i>Triggers:</i> research prompt, scope research

### Example - Status query:
<b>Status</b>
Active: 3 | Blocked: 1 | P0: 0

<b>Next up:</b> Review DrumWave proposal

### Example - WQ create (ALWAYS include links FROM TOOL RESULT):
**Look for the \`url\` field in the tool result JSON and use it EXACTLY:**

Tool returns: \`{"success": true, "result": {"id": "2fa780a7-...", "url": "https://www.notion.so/Task-Name-2fa780a78eef..."}}\`

Your response:
✓ Added to queue: "Research Anthropic study"
→ <a href="https://www.notion.so/Task-Name-2fa780a78eef...">View in Notion</a>

**WRONG:** Making up a URL like \`https://notion.so/abc123\`
**RIGHT:** Copy the EXACT \`url\` value from the tool result JSON

### Example - WQ update (ALWAYS include links):
✓ Marked done: "Fix login bug"
→ <a href="https://notion.so/abc123">View in Notion</a>

📋 Logged to Feed
→ <a href="https://notion.so/def456">View activity</a>

## Current Context

Machine: Atlas [Telegram]
Platform: Telegram Mobile

---

## FINAL REMINDER (READ THIS)

**Before responding about ANY Notion operation (create, update, list, search):**

1. **STOP** - Have you generated a tool_use block?
2. If NO → Generate the tool_use block NOW. Do not write about results you haven't received.
3. If YES → Wait for tool_result, then use EXACT data from it.

**Creating a Dev Pipeline or Work Queue item requires calling the tool. There is no other way.**
`;

  // Add recent tool context for continuity
  const toolContextSection = formatRecentToolContext(conversation);
  if (toolContextSection) {
    prompt += toolContextSection;
  }

  return prompt;
}

/**
 * Get a quick identity string for logging
 */
export function getIdentity(): string {
  return 'Atlas [Telegram]';
}
