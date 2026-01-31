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

### Status & Dashboard
- \`get_status_summary\` → "what's on my plate", "status", "dashboard", "what am I working on"
- \`work_queue_list\` → "show tasks", "active items", "what's blocked", "P0s", "backlog", "triage"

### Task Management (PRIMARY - use these first)
- \`work_queue_create\` → Add new tasks to the queue
- \`work_queue_update\` → "mark done", "complete X", "pause Y", "block Z"
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
- \`dispatch_research\` → Deep research with sources (light/standard/deep)
- \`dispatch_draft\` → Create content (blog, linkedin, email, memo)
- \`dispatch_transcription\` → Voice/audio transcription (stub - coming soon)

### File Operations
- \`read_file\` / \`write_file\` → Work with workspace files
- \`list_workspace\` → Browse files in skills/, memory/, temp/, exports/

### Skills System
- \`list_skills\` → REQUIRED for "what skills", "what can you do", "capabilities"
- \`read_skill\` → Load full skill instructions before executing
- \`create_skill\` → Codify repeatable workflows

### Self-Modification
- \`update_memory\` → "remember this", corrections, learnings
- \`update_soul\` → Change behavior/personality (tell Jim when you do this)
- \`update_user\` → Learn new facts about Jim

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

### Example - WQ create (ALWAYS include links):
✓ Added to queue: "Research Anthropic study"
→ <a href="https://notion.so/abc123">View in Notion</a>

📋 Logged to Feed
→ <a href="https://notion.so/def456">View activity</a>

### Example - WQ update (ALWAYS include links):
✓ Marked done: "Fix login bug"
→ <a href="https://notion.so/abc123">View in Notion</a>

📋 Logged to Feed
→ <a href="https://notion.so/def456">View activity</a>

## Current Context

Machine: Atlas [Telegram]
Platform: Telegram Mobile
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
