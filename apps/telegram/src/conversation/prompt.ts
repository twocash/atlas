/**
 * Atlas Telegram Bot - System Prompt Builder
 *
 * Builds the system prompt from SOUL.md, USER.md, MEMORY.md, and skills.
 */

import { readFile, readdir } from 'fs/promises';
import { join } from 'path';
import { logger } from '../logger';

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
 * Build the complete system prompt
 */
export async function buildSystemPrompt(): Promise<string> {
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

## Available Actions

You can use tools to help Jim. When you need to:
- **Search Notion**: Look up items in inbox, work queue, or feed
- **Research**: Dispatch research agent for deep investigation
- **Create tasks**: Add items to the work queue
- **Read/Write files**: Work with files in your workspace
- **Create skills**: Codify repeatable patterns for future use

## Guidelines

1. **Act, don't just chat** — If Jim asks for something, do it. Don't describe what you would do.
2. **Classify everything** — Every request has a Pillar (Personal, The Grove, Consulting, Home/Garage).
3. **Log everything** — Every interaction becomes a Feed entry and Work Queue item.
4. **Be resourceful** — Check context before asking for clarification.
5. **Be concise** — This is mobile. No walls of text.

## Current Context

Machine: Atlas [Telegram]
Platform: Telegram Mobile
`;

  return prompt;
}

/**
 * Get a quick identity string for logging
 */
export function getIdentity(): string {
  return 'Atlas [Telegram]';
}
