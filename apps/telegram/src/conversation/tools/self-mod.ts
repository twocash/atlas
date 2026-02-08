/**
 * Atlas Telegram Bot - Self-Modification Tools
 *
 * Tools for Atlas to update its own identity, memory, and skills.
 */

import type Anthropic from '@anthropic-ai/sdk';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../../logger';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_DIR = join(__dirname, '../../../data');

export const SELF_MOD_TOOLS: Anthropic.Tool[] = [
  {
    name: 'update_soul',
    description: 'Update SOUL.md to change Atlas behavior/personality. Use when Jim asks to change how you operate. IMPORTANT: Always tell Jim when you update your soul.',
    input_schema: {
      type: 'object' as const,
      properties: {
        section: {
          type: 'string',
          enum: ['Core Truths', 'Boundaries', 'Vibe', 'Confirmation Threshold', 'Continuity'],
          description: 'Which section of SOUL.md to update',
        },
        action: {
          type: 'string',
          enum: ['append', 'replace'],
          description: 'Whether to append to the section or replace it entirely',
        },
        content: {
          type: 'string',
          description: 'New content to add or replace',
        },
        reason: {
          type: 'string',
          description: 'Why this change is being made (for logging)',
        },
      },
      required: ['section', 'action', 'content', 'reason'],
    },
  },
  {
    name: 'update_memory',
    description: 'Update MEMORY.md to record persistent learnings. Use when Jim corrects you or teaches you something to remember.',
    input_schema: {
      type: 'object' as const,
      properties: {
        category: {
          type: 'string',
          enum: ['Classification Rules', 'Corrections Log', 'Preferences', 'Patterns'],
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
    name: 'update_user',
    description: 'Update USER.md with new information about Jim. Use when you learn something new about Jim that should persist.',
    input_schema: {
      type: 'object' as const,
      properties: {
        section: {
          type: 'string',
          enum: ['Who Jim Is', 'The Four Pillars', 'Work Style', 'Current Context', 'Known Preferences', 'Communication'],
          description: 'Which section to update',
        },
        content: {
          type: 'string',
          description: 'What to add',
        },
      },
      required: ['section', 'content'],
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
    name: 'read_soul',
    description: 'Read current SOUL.md content. Use to check current settings before making changes.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'read_memory',
    description: 'Read current MEMORY.md content. Use to recall persistent learnings, corrections, and patterns.',
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
    case 'update_soul':
      return await executeUpdateSoul(input);
    case 'update_memory':
      return await executeUpdateMemory(input);
    case 'update_user':
      return await executeUpdateUser(input);
    case 'create_skill':
      return await executeCreateSkill(input);
    case 'read_soul':
      return await executeReadSoul();
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

async function executeUpdateSoul(
  input: Record<string, unknown>
): Promise<{ success: boolean; result: unknown; error?: string }> {
  const section = input.section as string;
  const action = input.action as 'append' | 'replace';
  const content = input.content as string;
  const reason = input.reason as string;

  const soulPath = join(DATA_DIR, 'SOUL.md');

  try {
    let soulContent = await readFile(soulPath, 'utf-8');

    // Find the section
    const sectionHeader = `## ${section}`;
    const sectionIndex = soulContent.indexOf(sectionHeader);

    if (sectionIndex === -1) {
      return { success: false, result: null, error: `Section not found: ${section}` };
    }

    // Find the end of this section (next ## or end of file)
    const nextSectionMatch = soulContent.slice(sectionIndex + sectionHeader.length).match(/\n## /);
    const sectionEnd = nextSectionMatch
      ? sectionIndex + sectionHeader.length + nextSectionMatch.index!
      : soulContent.length;

    if (action === 'append') {
      // Add content before the next section
      const insertPoint = sectionEnd;
      const newContent = `\n${content}\n`;
      soulContent = soulContent.slice(0, insertPoint) + newContent + soulContent.slice(insertPoint);
    } else {
      // Replace section content (keep header)
      const headerEnd = sectionIndex + sectionHeader.length;
      soulContent = soulContent.slice(0, headerEnd) + '\n\n' + content + '\n' + soulContent.slice(sectionEnd);
    }

    await writeFile(soulPath, soulContent, 'utf-8');

    logger.info('SOUL.md updated', { section, action, reason });

    return {
      success: true,
      result: {
        section,
        action,
        reason,
        message: `Updated ${section} in SOUL.md. Jim should be notified of this change.`,
      },
    };
  } catch (error) {
    logger.error('Update soul failed', { error, section });
    return { success: false, result: null, error: String(error) };
  }
}

async function executeUpdateMemory(
  input: Record<string, unknown>
): Promise<{ success: boolean; result: unknown; error?: string }> {
  const category = input.category as string;
  const content = input.content as string;

  const memoryPath = join(DATA_DIR, 'MEMORY.md');

  try {
    let memoryContent = await readFile(memoryPath, 'utf-8');

    // Find the category header
    const categoryHeader = `## ${category}`;
    const categoryIndex = memoryContent.indexOf(categoryHeader);

    if (categoryIndex === -1) {
      // Add the category if it doesn't exist
      memoryContent += `\n\n## ${category}\n\n${content}\n`;
    } else {
      // Find end of this category
      const nextSectionMatch = memoryContent.slice(categoryIndex + categoryHeader.length).match(/\n## /);
      const insertPoint = nextSectionMatch
        ? categoryIndex + categoryHeader.length + nextSectionMatch.index!
        : memoryContent.length;

      // Insert before next section or end
      memoryContent = memoryContent.slice(0, insertPoint) + `\n- ${content}` + memoryContent.slice(insertPoint);
    }

    // Update timestamp
    const timestampLine = `\n*Last updated: ${new Date().toISOString().split('T')[0]}*`;
    memoryContent = memoryContent.replace(/\n\*Last updated:.*\*/, timestampLine);
    if (!memoryContent.includes('*Last updated:')) {
      memoryContent += timestampLine;
    }

    await writeFile(memoryPath, memoryContent, 'utf-8');

    logger.info('MEMORY.md updated', { category, content: content.substring(0, 50) });

    return {
      success: true,
      result: {
        category,
        added: content,
        message: 'Memory updated successfully',
      },
    };
  } catch (error) {
    logger.error('Update memory failed', { error, category });
    return { success: false, result: null, error: String(error) };
  }
}

async function executeUpdateUser(
  input: Record<string, unknown>
): Promise<{ success: boolean; result: unknown; error?: string }> {
  const section = input.section as string;
  const content = input.content as string;

  const userPath = join(DATA_DIR, 'USER.md');

  try {
    let userContent = await readFile(userPath, 'utf-8');

    // Find the section
    const sectionHeader = `## ${section}`;
    const sectionIndex = userContent.indexOf(sectionHeader);

    if (sectionIndex === -1) {
      // Add section at end
      userContent += `\n\n## ${section}\n\n${content}\n`;
    } else {
      // Find end of section
      const nextSectionMatch = userContent.slice(sectionIndex + sectionHeader.length).match(/\n## /);
      const insertPoint = nextSectionMatch
        ? sectionIndex + sectionHeader.length + nextSectionMatch.index!
        : userContent.length;

      userContent = userContent.slice(0, insertPoint) + `\n- ${content}` + userContent.slice(insertPoint);
    }

    await writeFile(userPath, userContent, 'utf-8');

    logger.info('USER.md updated', { section, content: content.substring(0, 50) });

    return {
      success: true,
      result: {
        section,
        added: content,
        message: 'User knowledge updated',
      },
    };
  } catch (error) {
    logger.error('Update user failed', { error, section });
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

    const skillContent = `---
name: ${name}
description: ${description}
trigger: ${trigger}
created: ${new Date().toISOString()}
---

# ${name}

${description}

## Trigger

${trigger}

## Instructions

${instructions}
`;

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

async function executeReadSoul(): Promise<{ success: boolean; result: unknown; error?: string }> {
  const soulPath = join(DATA_DIR, 'SOUL.md');

  try {
    const content = await readFile(soulPath, 'utf-8');
    return {
      success: true,
      result: {
        content,
        path: 'data/SOUL.md',
      },
    };
  } catch (error) {
    logger.error('Read soul failed', { error });
    return { success: false, result: null, error: String(error) };
  }
}

async function executeReadMemory(): Promise<{ success: boolean; result: unknown; error?: string }> {
  const memoryPath = join(DATA_DIR, 'MEMORY.md');

  try {
    const content = await readFile(memoryPath, 'utf-8');
    return {
      success: true,
      result: {
        content,
        path: 'data/MEMORY.md',
      },
    };
  } catch (error) {
    logger.error('Read memory failed', { error });
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

          // Parse frontmatter
          const match = content.match(/^---\n([\s\S]*?)\n---/);
          if (match) {
            const frontmatter = match[1];
            const nameMatch = frontmatter.match(/name:\s*(.+)/);
            const descMatch = frontmatter.match(/description:\s*(.+)/);
            const triggerMatch = frontmatter.match(/trigger:\s*(.+)/);

            skills.push({
              name: nameMatch?.[1]?.trim() || entry.name,
              description: descMatch?.[1]?.trim() || 'No description',
              trigger: triggerMatch?.[1]?.trim() || '',
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
