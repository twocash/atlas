/**
 * Telegram Shortcuts Quality Tests
 *
 * Validates quality and completeness of commonly-used Telegram shortcuts:
 * - list_skills — skill listing via executeSelfModTools
 * - read_memory — memory reading via executeSelfModTools
 * - read_skill — individual skill reading via executeSelfModTools
 * - /help — command help text completeness
 * - SELF_MOD_TOOLS — infrastructure tool definitions
 *
 * Run: cd apps/telegram && bun test test/telegram-shortcuts-quality.test.ts
 */

import { describe, it, expect, mock } from 'bun:test';

// =============================================================================
// MOCK DATA
// =============================================================================

const MOCK_SKILL_NAMES = [
  'quick-capture',
  'triage-inbox',
  'self-diagnosis',
  'weekly-review',
  'pit-crew-collab',
  'feed-first-classification',
  'research-prompt-builder',
];

function makeSkillContent(name: string): string {
  return [
    '---',
    `name: ${name}`,
    `description: ${name.replace(/-/g, ' ')} skill for Atlas`,
    `trigger: ${name.split('-')[0]}, ${name}`,
    `created: 2026-01-30T00:00:00.000Z`,
    '---',
    '',
    `# ${name}`,
    '',
    `${name.replace(/-/g, ' ')} skill for Atlas`,
    '',
    '## Trigger',
    '',
    `${name.split('-')[0]}, ${name}`,
    '',
    '## Instructions',
    '',
    'Step 1: Execute the skill',
    'Step 2: Report results',
    '',
  ].join('\n');
}

const MOCK_MEMORY = [
  '# Atlas Memory',
  '',
  '## Classification Rules',
  '- Permits → always Home/Garage',
  '',
  '## Corrections Log',
  '- Fixed pillar routing for vehicles',
  '',
  '## Preferences',
  '- Jim prefers concise responses',
  '',
  '## Patterns',
  '- URL shares are usually captures',
  '',
].join('\n');

// =============================================================================
// MOCKS — must be before imports
// =============================================================================

mock.module('../src/logger', () => ({
  logger: {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  },
}));

mock.module('fs/promises', () => ({
  readFile: async (filePath: string) => {
    if (filePath.includes('MEMORY.md')) return MOCK_MEMORY;
    if (filePath.includes('SOUL.md')) return '# Atlas Soul\n\n## Core Truths\n- Be helpful';
    for (const name of MOCK_SKILL_NAMES) {
      if (filePath.includes(name) && filePath.includes('SKILL.md')) {
        return makeSkillContent(name);
      }
    }
    throw new Error(`ENOENT: no such file: ${filePath}`);
  },
  writeFile: async () => {},
  mkdir: async () => {},
  readdir: async () =>
    MOCK_SKILL_NAMES.map((name) => ({
      name,
      isDirectory: () => true,
      isFile: () => false,
    })),
}));

// Import AFTER mocks are set up
const { executeSelfModTools, SELF_MOD_TOOLS } = await import(
  '../src/conversation/tools/self-mod'
);
const { getHelpText } = await import('../src/commands/help');

// =============================================================================
// GROUP 1: list_skills Quality
// =============================================================================

describe('list_skills Quality', () => {
  it('returns all 7 SKILL.md-based skills', async () => {
    const result = await executeSelfModTools('list_skills', {});
    expect(result).not.toBeNull();
    expect(result!.success).toBe(true);
    const { skills, count } = result!.result as any;
    expect(count).toBe(7);
    expect(skills).toHaveLength(7);
  });

  it('every skill has non-empty name, description, trigger, and path', async () => {
    const result = await executeSelfModTools('list_skills', {});
    const { skills } = result!.result as any;
    for (const skill of skills) {
      expect(skill.name.length).toBeGreaterThan(0);
      expect(skill.description.length).toBeGreaterThan(0);
      expect(skill.trigger.length).toBeGreaterThan(0);
      expect(skill.path.length).toBeGreaterThan(0);
    }
  });

  it('no skill has "No description" (indicates parse failure)', async () => {
    const result = await executeSelfModTools('list_skills', {});
    const { skills } = result!.result as any;
    for (const skill of skills) {
      expect(skill.description).not.toBe('No description');
    }
  });

  it('no skill has empty trigger', async () => {
    const result = await executeSelfModTools('list_skills', {});
    const { skills } = result!.result as any;
    for (const skill of skills) {
      expect(skill.trigger).not.toBe('');
      expect(skill.trigger.trim().length).toBeGreaterThan(0);
    }
  });

  it('skill names are kebab-case', async () => {
    const result = await executeSelfModTools('list_skills', {});
    const { skills } = result!.result as any;
    for (const skill of skills) {
      expect(skill.name).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it('paths follow skills/<name>/SKILL.md pattern', async () => {
    const result = await executeSelfModTools('list_skills', {});
    const { skills } = result!.result as any;
    for (const skill of skills) {
      expect(skill.path).toMatch(/^skills\/[a-z0-9-]+\/SKILL\.md$/);
    }
  });
});

// =============================================================================
// GROUP 2: read_memory Quality
// =============================================================================

describe('read_memory Quality', () => {
  it('returns success=true with non-empty content', async () => {
    const result = await executeSelfModTools('read_memory', {});
    expect(result).not.toBeNull();
    expect(result!.success).toBe(true);
    const { content } = result!.result as any;
    expect(content.length).toBeGreaterThan(0);
  });

  it('content contains expected ## sections', async () => {
    const result = await executeSelfModTools('read_memory', {});
    const { content } = result!.result as any;
    expect(content).toContain('## Classification Rules');
    expect(content).toContain('## Corrections Log');
    expect(content).toContain('## Preferences');
    expect(content).toContain('## Patterns');
  });

  it('path field is data/MEMORY.md', async () => {
    const result = await executeSelfModTools('read_memory', {});
    const { path } = result!.result as any;
    expect(path).toBe('data/MEMORY.md');
  });
});

// =============================================================================
// GROUP 3: read_skill Quality
// =============================================================================

describe('read_skill Quality', () => {
  it('returns full content for a known skill', async () => {
    const result = await executeSelfModTools('read_skill', { name: 'quick-capture' });
    expect(result).not.toBeNull();
    expect(result!.success).toBe(true);
    const { content, name } = result!.result as any;
    expect(name).toBe('quick-capture');
    expect(content.length).toBeGreaterThan(50);
  });

  it('content includes frontmatter with all 4 fields', async () => {
    const result = await executeSelfModTools('read_skill', { name: 'quick-capture' });
    const { content } = result!.result as any;
    expect(content).toContain('name:');
    expect(content).toContain('description:');
    expect(content).toContain('trigger:');
    expect(content).toContain('created:');
    expect(content).toMatch(/^---/);
    // Second --- delimiter exists
    expect(content.indexOf('---', 3)).toBeGreaterThan(3);
  });

  it('returns error for nonexistent skill', async () => {
    const result = await executeSelfModTools('read_skill', { name: 'nonexistent-skill-xyz' });
    expect(result).not.toBeNull();
    expect(result!.success).toBe(false);
    expect(result!.error).toContain('not found');
  });

  it('path matches skills/<name>/SKILL.md', async () => {
    const result = await executeSelfModTools('read_skill', { name: 'triage-inbox' });
    const { path } = result!.result as any;
    expect(path).toBe('skills/triage-inbox/SKILL.md');
  });
});

// =============================================================================
// GROUP 4: /help Text Completeness
// =============================================================================

describe('/help Text Completeness', () => {
  const helpText = getHelpText();

  it('includes all registered command categories', () => {
    expect(helpText).toContain('RESEARCH');
    expect(helpText).toContain('WORK QUEUE');
    expect(helpText).toContain('BRIEFINGS');
    expect(helpText).toContain('MODEL');
    expect(helpText).toContain('SESSION');
    expect(helpText).toContain('SKILLS');
  });

  it('every /command line has a description after em-dash', () => {
    const lines = helpText.split('\n');
    const commandLines = lines.filter((l) => l.trim().startsWith('/'));
    // We know there are many command lines
    expect(commandLines.length).toBeGreaterThanOrEqual(10);
    for (const line of commandLines) {
      expect(line).toContain('\u2014'); // em-dash
      const afterDash = line.split('\u2014')[1]?.trim();
      expect(afterDash?.length).toBeGreaterThan(0);
    }
  });

  it('mentions natural language fallback', () => {
    expect(helpText.toLowerCase()).toContain('just message me naturally');
  });

  it('no stale commands — all /commands exist in bot.ts', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const botSource = fs.readFileSync(
      path.join(process.cwd(), 'src', 'bot.ts'),
      'utf-8'
    );

    // Extract registered commands from bot.ts
    const registeredCommands = new Set<string>();
    const commandRegex = /bot\.command\(['"](\w+)['"]/g;
    let m;
    while ((m = commandRegex.exec(botSource)) !== null) {
      registeredCommands.add(m[1]);
    }

    // Only check commands BEFORE the COMING SOON section
    const comingSoonIdx = helpText.indexOf('COMING SOON');
    const activeHelpText = comingSoonIdx > -1 ? helpText.slice(0, comingSoonIdx) : helpText;

    // Extract base commands from lines that start with / (avoids HTML </b> false matches)
    const helpCommands = new Set<string>();
    for (const line of activeHelpText.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('/')) {
        const cmdMatch = trimmed.match(/^\/(\w+)/);
        if (cmdMatch) helpCommands.add(cmdMatch[1]);
      }
    }

    for (const cmd of helpCommands) {
      expect(registeredCommands.has(cmd)).toBe(true);
    }
  });
});

// =============================================================================
// GROUP 5: Infrastructure — SELF_MOD_TOOLS Definitions
// =============================================================================

describe('SELF_MOD_TOOLS Infrastructure', () => {
  it('list_skills tool definition exists', () => {
    const tool = SELF_MOD_TOOLS.find((t: any) => t.name === 'list_skills');
    expect(tool).toBeDefined();
    expect(tool!.description.length).toBeGreaterThan(0);
  });

  it('read_skill tool definition exists with name parameter', () => {
    const tool = SELF_MOD_TOOLS.find((t: any) => t.name === 'read_skill');
    expect(tool).toBeDefined();
    expect(tool!.description.length).toBeGreaterThan(0);
    expect(tool!.input_schema.required).toContain('name');
  });

  it('read_memory tool definition exists', () => {
    const tool = SELF_MOD_TOOLS.find((t: any) => t.name === 'read_memory');
    expect(tool).toBeDefined();
    expect(tool!.description.length).toBeGreaterThan(0);
  });
});
