/**
 * Atlas Telegram Bot - System Prompt Builder
 *
 * Composes the system prompt from two Notion-governed layers:
 *   1. Identity: composeAtlasIdentity() — constitution, soul, user, memory, goals
 *   2. Operational Doctrine: composeOperationalDoctrine() — integrity, dispatch, tools, format, surface
 *
 * Both layers resolve from Notion via PromptManager. Safety-critical entries
 * hard-fail if missing (ADR-008). Behavioral entries degrade gracefully.
 *
 * ADR-001: Notion as source of truth. ADR-008: fail fast, fail loud.
 */

import { readFile, readdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { NOTION_DB } from '@atlas/shared/config';
import { logger } from '../logger';
import type { ConversationState } from './context';
import { composeAtlasIdentity, composeOperationalDoctrine } from '../services/prompt-composition';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_DIR = join(__dirname, '../../data');
const SKILLS_DIR = join(DATA_DIR, 'skills');

interface SkillMetadata {
  name: string;
  description: string;
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
 *
 * Two-layer Notion-governed composition:
 *   Layer 1: composeAtlasIdentity('telegram') — who Atlas is
 *   Layer 2: composeOperationalDoctrine('telegram') — how Atlas operates
 * Plus: canonical databases, skills, and tool context.
 */
export async function buildSystemPrompt(conversation?: ConversationState): Promise<string> {
  // ── Identity Resolution (Notion-governed) ──────────────────────
  // Resolves: atlas.constitution, atlas.soul, atlas.user, atlas.memory, atlas.goals
  // Hard-fails if constitution or soul missing (ADR-008).
  let identityPrompt: string;
  try {
    const identity = await composeAtlasIdentity('telegram');

    // Log warnings (degraded components) but don't fail — only constitution+soul are hard requirements
    for (const warning of identity.warnings) {
      logger.warn(`[identity] ${warning}`);
    }

    logger.info('[prompt] Identity resolved from Notion', {
      surface: identity.surface,
      tokenCount: identity.tokenCount,
      components: identity.components,
      warningCount: identity.warnings.length,
    });

    identityPrompt = identity.prompt;
  } catch (err) {
    // ADR-008: Identity resolution failure is fatal. No filesystem fallback.
    logger.error('[prompt] FATAL: Identity resolution failed — cannot build system prompt', { error: err });
    throw err;
  }

  // Load skills metadata (still filesystem — skills are local, not identity)
  const skills = await loadSkillsMetadata();

  // Canonical database list - prevents hallucination of non-existent databases
  // IDs sourced from @atlas/shared/config (NOTION_DB) — single source of truth
  const CANONICAL_DATABASES = `
## CANONICAL DATABASE LIST (IMMUTABLE TRUTH)

You have access to EXACTLY these databases. No others exist.

| Database | ID |
|----------|-----|
| Atlas Dev Pipeline | ${NOTION_DB.DEV_PIPELINE} |
| Atlas Work Queue 2.0 | ${NOTION_DB.WORK_QUEUE} |
| Atlas Feed 2.0 | ${NOTION_DB.FEED} |
| Atlas Token Ledger | ${NOTION_DB.TOKEN_LEDGER} |
| Atlas Worker Results | ${NOTION_DB.WORKER_RESULTS} |
| Contacts | ${NOTION_DB.CONTACTS} |
| Engagements | ${NOTION_DB.ENGAGEMENTS} |
| Grove Feature Roadmap | cb49453c-022c-477d-a35b-744531e7d161 |
| Posts | ${NOTION_DB.POSTS} |
| Grove Corpus | 00ea815d-e6fa-40da-a79b-f5dd29b85a29 |
| Atlas Tasks | aca39688-4dd1-4050-a73f-20242b362db5 |
| Atlas Capabilities | 0e06b146-3f48-4065-9be2-d9efa7e0608e |
| Grove Scattered Content Inventory | 973d0191-d455-4f4f-8aa2-18555ed01f67 |
| Grove Content Inventory | e99246e9-3983-47c0-aad7-f2a2171a2c42 |
| Agent Skills Registry | ${NOTION_DB.SKILLS_REGISTRY} |

**HALLUCINATION CHECK:** "Grove Sprout Factory", "Reading List", "Personal CRM", "Bookmarks", "Projects" do NOT exist. If asked about a database not in this list, respond: "I don't have a database called [name]."
`;

  // Build the prompt — identity FIRST, then Telegram operational layers
  let prompt = identityPrompt;

  // Canonical databases (anti-hallucination)
  prompt += `\n\n---\n\n${CANONICAL_DATABASES}`;

  // Add skills section if any exist
  if (skills.length > 0) {
    prompt += `\n---\n\n## Available Skills\n${skills.map(s => `- **${s.name}**: ${s.description}`).join('\n')}\n`;
  }

  // ── Operational Doctrine (Notion-governed) ──────────────────────
  // Resolves: ops.core.integrity, ops.core.dispatch, ops.core.tools,
  //           ops.core.format, ops.surface.telegram
  // Critical entries (integrity, dispatch) hard-fail if missing (ADR-008).
  // Behavioral entries (tools, format, surface) degrade gracefully.
  try {
    const doctrine = await composeOperationalDoctrine('telegram');

    // Log warnings (degraded components) but don't fail
    for (const warning of doctrine.warnings) {
      logger.warn(`[ops-doctrine] ${warning}`);
    }

    logger.info('[prompt] Operational doctrine resolved from Notion', {
      resolved: doctrine.resolved,
      missing: doctrine.missing,
      warningCount: doctrine.warnings.length,
    });

    prompt += `\n---\n\n${doctrine.content}`;
  } catch (err) {
    // ADR-008: Critical doctrine failure is fatal. No hardcoded fallback.
    logger.error('[prompt] FATAL: Operational doctrine resolution failed', { error: err });
    throw err;
  }

  // ── Runtime Context (stays in code — changes every turn) ──────
  prompt += `\n\n## Current Context\n\nMachine: Atlas [Telegram]\nPlatform: Telegram Mobile\n`;

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
