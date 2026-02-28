/**
 * Atlas Telegram Bot - Self-Modification Tools
 *
 * Tools for Atlas to update its own memory and manage skills.
 *
 * Identity resolution is Notion-governed (ADR-001):
 * - update_memory → appends to atlas.memory page in Notion
 * - read_memory → reads atlas.memory via PromptManager
 * - Skills tools → filesystem (skills are local, not identity)
 *
 * KILLED (identity unification):
 * - update_soul → identity is Notion-governed, not filesystem-mutable
 * - update_user → identity is Notion-governed, not filesystem-mutable
 * - read_soul → identity is Notion-governed, use composeAtlasIdentity()
 */

import type Anthropic from '@anthropic-ai/sdk';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Client } from '@notionhq/client';
import { logger } from '../../logger';
import { parseSkillFrontmatter, validateSkillFrontmatter, generateFrontmatter } from '../../skills/frontmatter';
import { getPromptManager } from '../../services/prompt-manager';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_DIR = join(__dirname, '../../../data');

/** Notion page ID for atlas.memory — resolved lazily from System Prompts DB */
let memoryPageId: string | null = null;

/**
 * Resolve the Notion page ID for atlas.memory from the System Prompts DB.
 * Cached after first resolution.
 */
async function resolveMemoryPageId(): Promise<string | null> {
  if (memoryPageId) return memoryPageId;

  const apiKey = process.env.NOTION_API_KEY;
  const dbId = process.env.NOTION_PROMPTS_DB_ID;
  if (!apiKey || !dbId) {
    logger.error('[self-mod] Cannot resolve atlas.memory: NOTION_API_KEY or NOTION_PROMPTS_DB_ID not set');
    return null;
  }

  try {
    const notion = new Client({ auth: apiKey });
    const response = await notion.databases.query({
      database_id: dbId,
      filter: {
        and: [
          { property: 'ID', rich_text: { equals: 'atlas.memory' } },
          { property: 'Active', checkbox: { equals: true } },
        ],
      },
      page_size: 1,
    });

    if (response.results.length === 0) {
      logger.error('[self-mod] atlas.memory not found in System Prompts DB');
      return null;
    }

    memoryPageId = response.results[0].id;
    logger.info('[self-mod] Resolved atlas.memory page', { pageId: memoryPageId });
    return memoryPageId;
  } catch (err) {
    logger.error('[self-mod] Failed to resolve atlas.memory page', { error: err });
    return null;
  }
}

export const SELF_MOD_TOOLS: Anthropic.Tool[] = [
  {
    name: 'update_memory',
    description: 'Record a persistent learning to Atlas Memory in Notion. Use when Jim corrects you or teaches you something to remember across sessions.',
    input_schema: {
      type: 'object' as const,
      properties: {
        category: {
          type: 'string',
          enum: ['Classification Rules', 'Corrections Log', 'Preferences', 'Patterns', 'Learnings'],
          description: 'Which category to update',
        },
        content: {
          type: 'string',
          description: 'What to add to memory',
        },
      },
      required: ['category', 'content'],
    },
  },
  {
    name: 'create_skill',
    description: 'Create a new skill to codify a repeatable pattern. Use when you notice a workflow that Jim might repeat.',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: {
          type: 'string',
          description: 'Skill name in kebab-case (e.g., "weekly-timesheet")',
        },
        description: {
          type: 'string',
          description: 'When to use this skill (shown in skill list)',
        },
        trigger: {
          type: 'string',
          description: 'What phrases or patterns trigger this skill',
        },
        instructions: {
          type: 'string',
          description: 'Step-by-step instructions for executing the skill',
        },
      },
      required: ['name', 'description', 'trigger', 'instructions'],
    },
  },
  {
    name: 'read_memory',
    description: 'Read current Atlas Memory from Notion. Use to recall persistent learnings, corrections, and patterns.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'list_skills',
    description: 'REQUIRED when Jim asks "what skills", "what can you do", "your capabilities", or similar. Lists installed skills from data/skills/. Do NOT hallucinate skills - always call this tool first.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'read_skill',
    description: 'Read the full instructions for a specific skill. Use before executing a skill workflow.',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: {
          type: 'string',
          description: 'Skill name (e.g., "research-prompt-builder")',
        },
      },
      required: ['name'],
    },
  },
];

/**
 * Execute self-modification tools
 */
export async function executeSelfModTools(
  toolName: string,
  input: Record<string, unknown>
): Promise<{ success: boolean; result: unknown; error?: string } | null> {
  switch (toolName) {
    case 'update_memory':
      return await executeUpdateMemory(input);
    case 'create_skill':
      return await executeCreateSkill(input);
    case 'read_memory':
      return await executeReadMemory();
    case 'list_skills':
      return await executeListSkills();
    case 'read_skill':
      return await executeReadSkill(input);
    default:
      return null;
  }
}

/**
 * Append a learning to the atlas.memory page in Notion.
 *
 * Strategy: Append a bulleted_list_item block to the page.
 * The PromptManager cache will pick up the change on next TTL expiry (5 min).
 */
async function executeUpdateMemory(
  input: Record<string, unknown>
): Promise<{ success: boolean; result: unknown; error?: string }> {
  const category = input.category as string;
  const content = input.content as string;

  try {
    const pageId = await resolveMemoryPageId();
    if (!pageId) {
      return {
        success: false,
        result: null,
        error: 'Cannot resolve atlas.memory page in Notion. Check NOTION_API_KEY and NOTION_PROMPTS_DB_ID.',
      };
    }

    const apiKey = process.env.NOTION_API_KEY;
    if (!apiKey) {
      return { success: false, result: null, error: 'NOTION_API_KEY not set' };
    }

    const notion = new Client({ auth: apiKey });

    // Append: category header (heading_3) + content (bulleted_list_item)
    // The heading acts as a visual separator when multiple updates accumulate
    const timestamp = new Date().toISOString().split('T')[0];

    await notion.blocks.children.append({
      block_id: pageId,
      children: [
        {
          object: 'block',
          type: 'bulleted_list_item',
          bulleted_list_item: {
            rich_text: [
              {
                type: 'text',
                text: { content: `[${category}] ${content}` },
              },
              {
                type: 'text',
                text: { content: ` — ${timestamp}` },
                annotations: { italic: true, color: 'gray' },
              },
            ],
          },
        },
      ],
    });

    // Invalidate PromptManager cache so next identity resolution picks up the change
    try {
      const pm = getPromptManager();
      pm.invalidateCache('atlas.memory');
    } catch {
      // PromptManager not initialized — fine, cache will expire naturally
    }

    logger.info('[self-mod] Memory updated in Notion', { category, content: content.substring(0, 50), pageId });

    return {
      success: true,
      result: {
        category,
        added: content,
        target: 'Notion (atlas.memory)',
        message: 'Memory updated in Notion. Will be included in next identity resolution.',
      },
    };
  } catch (error) {
    logger.error('[self-mod] Update memory failed', { error, category });
    return { success: false, result: null, error: String(error) };
  }
}

async function executeCreateSkill(
  input: Record<string, unknown>
): Promise<{ success: boolean; result: unknown; error?: string }> {
  const name = input.name as string;
  const description = input.description as string;
  const trigger = input.trigger as string;
  const instructions = input.instructions as string;

  // Validate name format
  if (!/^[a-z0-9-]+$/.test(name)) {
    return { success: false, result: null, error: 'Skill name must be kebab-case (lowercase letters, numbers, hyphens)' };
  }

  const skillDir = join(DATA_DIR, 'skills', name);
  const skillPath = join(skillDir, 'SKILL.md');

  try {
    await mkdir(skillDir, { recursive: true });

    const frontmatter = generateFrontmatter({
      name,
      description,
      trigger,
      created: new Date().toISOString(),
    });

    const skillContent = `${frontmatter}

# ${name}

${description}

## Trigger

${trigger}

## Instructions

${instructions}
`;

    // Write-gate: validate before writing
    const validation = validateSkillFrontmatter(skillContent);
    if (!validation.valid) {
      return { success: false, result: null, error: `Invalid frontmatter: ${validation.errors.join('; ')}` };
    }

    await writeFile(skillPath, skillContent, 'utf-8');

    logger.info('Skill created', { name, description });

    return {
      success: true,
      result: {
        name,
        description,
        path: `skills/${name}/SKILL.md`,
        message: `Created skill: ${name}. I'll use it automatically when triggered.`,
      },
    };
  } catch (error) {
    logger.error('Create skill failed', { error, name });
    return { success: false, result: null, error: String(error) };
  }
}

/**
 * Read atlas.memory from Notion via PromptManager.
 */
async function executeReadMemory(): Promise<{ success: boolean; result: unknown; error?: string }> {
  try {
    const pm = getPromptManager();
    const content = await pm.getPromptById('atlas.memory');

    if (content) {
      return {
        success: true,
        result: {
          content,
          source: 'Notion (atlas.memory)',
        },
      };
    }

    return {
      success: false,
      result: null,
      error: 'atlas.memory not found in Notion System Prompts DB',
    };
  } catch (error) {
    logger.error('[self-mod] Read memory failed', { error });
    return { success: false, result: null, error: String(error) };
  }
}

async function executeListSkills(): Promise<{ success: boolean; result: unknown; error?: string }> {
  const skillsDir = join(DATA_DIR, 'skills');

  try {
    const { readdir } = await import('fs/promises');
    const entries = await readdir(skillsDir, { withFileTypes: true });

    const skills: Array<{
      name: string;
      description: string;
      trigger: string;
      path: string;
    }> = [];

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const skillPath = join(skillsDir, entry.name, 'SKILL.md');
        try {
          const content = await readFile(skillPath, 'utf-8');

          // Use shared parser (handles Windows \r\n, normalizes drift)
          const parsed = parseSkillFrontmatter(content);
          if (parsed) {
            skills.push({
              name: parsed.name || entry.name,
              description: parsed.description || 'No description',
              trigger: parsed.trigger || '',
              path: `skills/${entry.name}/SKILL.md`,
            });
          }
        } catch {
          // Skill without SKILL.md, skip
        }
      }
    }

    if (skills.length === 0) {
      return {
        success: true,
        result: {
          skills: [],
          message: 'No skills installed yet. Use create_skill to make one.',
        },
      };
    }

    return {
      success: true,
      result: {
        skills,
        count: skills.length,
        message: `Found ${skills.length} skill(s). Use read_skill to see full instructions.`,
      },
    };
  } catch (error) {
    logger.error('List skills failed', { error });
    return { success: false, result: null, error: String(error) };
  }
}

async function executeReadSkill(
  input: Record<string, unknown>
): Promise<{ success: boolean; result: unknown; error?: string }> {
  const name = input.name as string;
  const skillPath = join(DATA_DIR, 'skills', name, 'SKILL.md');

  try {
    const content = await readFile(skillPath, 'utf-8');

    // Parse out the instructions section
    const instructionsMatch = content.match(/## Instructions\n\n([\s\S]*?)(?:\n##|$)/);
    const instructions = instructionsMatch?.[1]?.trim() || content;

    return {
      success: true,
      result: {
        name,
        content,
        instructions,
        path: `skills/${name}/SKILL.md`,
      },
    };
  } catch (error) {
    logger.error('Read skill failed', { error, name });
    return { success: false, result: null, error: `Skill not found: ${name}` };
  }
}
