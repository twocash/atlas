/**
 * Command Surface Audit — Tests every /command for expected vs actual behavior.
 *
 * Documents known bugs as failing tests (marked with .todo or explicit assertions).
 * This is the regression net for the command UX layer.
 *
 * Created: 2026-02-09
 * Context: v4.1.0-rc3 hardening sweep
 */

import { describe, it, expect, mock, beforeAll } from 'bun:test';

// ============================================================================
// Group 1: /help completeness
// ============================================================================

describe('/help command completeness', () => {
  let helpText: string;

  beforeAll(async () => {
    const { getHelpText } = await import('../src/commands/help');
    helpText = getHelpText();
  });

  it('contains all registered command categories', () => {
    const categories = [
      'RESEARCH & AGENTS',
      'WORK QUEUE EXECUTION',
      'BRIEFINGS',
      'MODEL SELECTION',
      'SESSION',
      'SKILLS',
    ];
    // HTML entities in the actual text
    for (const cat of categories) {
      const escaped = cat.replace('&', '&amp;');
      expect(helpText).toContain(escaped);
    }
  });

  it('documents /agent subcommands', () => {
    expect(helpText).toContain('/agent research');
    expect(helpText).toContain('/agent status');
    expect(helpText).toContain('/agent cancel');
    expect(helpText).toContain('/agent test');
  });

  it('documents /work subcommands', () => {
    expect(helpText).toContain('/work');
    expect(helpText).toContain('/work status');
    expect(helpText).toContain('/work start');
    expect(helpText).toContain('/work stop');
  });

  it('documents /briefing subcommands', () => {
    expect(helpText).toContain('/briefing now');
    expect(helpText).toContain('/briefing status');
  });

  it('documents /model command', () => {
    expect(helpText).toContain('/model');
  });

  it('documents all session commands', () => {
    expect(helpText).toContain('/new');
    expect(helpText).toContain('/status');
    expect(helpText).toContain('/health');
    expect(helpText).toContain('/stats');
    expect(helpText).toContain('/help');
  });

  it('documents /skills subcommands', () => {
    expect(helpText).toContain('/skills');
    expect(helpText).toContain('/skills pending');
    expect(helpText).toContain('/skills list');
    expect(helpText).toContain('/skills stats');
  });

  it('documents /stop command', () => {
    expect(helpText).toContain('/stop');
  });

  // =========================================================================
  // BUG: /rollback is registered in bot.ts but missing from help text
  // SOP-001 requires all commands to be documented in help.ts
  // =========================================================================
  it('BUG: /rollback command is missing from help text (SOP-001)', () => {
    expect(helpText).toContain('/rollback');
  });

  // =========================================================================
  // BUG: /start is registered in bot.ts but missing from help text
  // =========================================================================
  it('BUG: /start command is missing from help text', () => {
    expect(helpText).toContain('/start');
  });

  // =========================================================================
  // BUG: Help says "/skill new" (singular) but registered command is "/skills"
  // Users typing /skill new get no response since /skill isn't registered
  // =========================================================================
  it('BUG: COMING SOON uses /skill (singular) instead of /skills (plural)', () => {
    // The help text should NOT reference /skill (singular) without /skills prefix
    // because /skill is not a registered command
    const lines = helpText.split('\n');
    const skillNewLine = lines.find(l => l.includes('skill new'));

    // If the line exists, it should say "/skills new" not "/skill new"
    if (skillNewLine) {
      expect(skillNewLine).toContain('/skills new');
    }
  });
});

// ============================================================================
// Group 2: skill-callback.ts correctness
// ============================================================================

describe('skill-callback handler correctness', () => {
  // =========================================================================
  // BUG: Edit handler references skill.yaml but Atlas uses SKILL.md
  // =========================================================================
  it('BUG: edit handler references skill.yaml instead of SKILL.md', async () => {
    const { readFileSync } = await import('fs');
    const content = readFileSync(
      new URL('../src/handlers/skill-callback.ts', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'),
      'utf-8'
    );

    // Should NOT contain skill.yaml reference
    expect(content).not.toContain('skill.yaml');

    // Should reference SKILL.md instead
    expect(content).toContain('SKILL.md');
  });

  it('/skills subcommand routing handles known subcommands', async () => {
    // Verify the switch cases exist for documented subcommands
    const { readFileSync } = await import('fs');
    const content = readFileSync(
      new URL('../src/handlers/skill-callback.ts', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'),
      'utf-8'
    );

    expect(content).toContain("case 'pending'");
    expect(content).toContain("case 'list'");
    expect(content).toContain("case 'stats'");
  });
});

// ============================================================================
// Group 3: /briefing handler correctness
// ============================================================================

describe('/briefing command handler', () => {
  // =========================================================================
  // BUG: /briefing now has no success confirmation
  // User sees typing indicator, then silence (briefing arrives separately)
  // No "Briefing sent" acknowledgment in the chat where /briefing now was typed
  // =========================================================================
  it('BUG: /briefing now success path has no user confirmation', async () => {
    const { readFileSync } = await import('fs');
    const content = readFileSync(
      new URL('../src/bot.ts', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'),
      'utf-8'
    );

    // Find the briefing now handler section
    const briefingNowIdx = content.indexOf('args === "now"');
    expect(briefingNowIdx).toBeGreaterThan(-1);

    // Get the try block after sendNow()
    const afterSendNow = content.substring(briefingNowIdx, briefingNowIdx + 400);

    // There should be a ctx.reply after sendNow() for success confirmation
    // Currently only the catch block has a reply
    const sendNowIdx = afterSendNow.indexOf('sendNow()');
    const catchIdx = afterSendNow.indexOf('catch');
    const betweenSendAndCatch = afterSendNow.substring(sendNowIdx, catchIdx);

    // BUG: No ctx.reply between sendNow() and catch
    expect(betweenSendAndCatch).toContain('ctx.reply');
  });
});

// ============================================================================
// Group 4: bot.ts command registration vs help.ts parity
// ============================================================================

describe('bot.ts registration parity with help.ts', () => {
  let botContent: string;

  beforeAll(async () => {
    const { readFileSync } = await import('fs');
    botContent = readFileSync(
      new URL('../src/bot.ts', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'),
      'utf-8'
    );
  });

  it('registers all documented commands', () => {
    const registeredCommands = [
      'bot.command("start"',
      'bot.command("help"',
      'bot.command("status"',
      'bot.command("new"',
      'bot.command("model"',
      'bot.command("agent"',
      'bot.command("health"',
      'bot.command("work"',
      'bot.command("stats"',
      'bot.command("skills"',
      'bot.command("stop"',
      'bot.command("rollback"',
      'bot.command("briefing"',
    ];

    for (const cmd of registeredCommands) {
      expect(botContent).toContain(cmd);
    }
  });

  it('all command handlers have try/catch error handling', () => {
    // Commands that should have try/catch:
    // agent, health, work, stats, skills are async with external calls
    const commandsNeedingTryCatch = ['agent', 'health', 'work', 'stats', 'skills'];

    for (const cmd of commandsNeedingTryCatch) {
      const cmdIdx = botContent.indexOf(`bot.command("${cmd}"`);
      expect(cmdIdx).toBeGreaterThan(-1);

      // Look ahead for catch block (some handlers are large)
      const block = botContent.substring(cmdIdx, cmdIdx + 1200);
      expect(block).toContain('catch');
    }
  });

  it('global HTML parse_mode middleware is present', () => {
    expect(botContent).toContain('parse_mode');
    expect(botContent).toContain('PARSE_MODE_METHODS');
    expect(botContent).toContain('sendMessage');
  });
});

// ============================================================================
// Group 5: health.ts correctness
// ============================================================================

describe('/health command correctness', () => {
  it('checks all three canonical databases', async () => {
    const { readFileSync } = await import('fs');
    const content = readFileSync(
      new URL('../src/commands/health.ts', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'),
      'utf-8'
    );

    // Canonical database IDs are now imported from @atlas/shared/config
    expect(content).toContain('NOTION_DB.FEED'); // Feed 2.0
    expect(content).toContain('NOTION_DB.WORK_QUEUE'); // Work Queue 2.0
    expect(content).toContain('NOTION_DB.DEV_PIPELINE'); // Dev Pipeline
  });

  it('does NOT reference any legacy database IDs', async () => {
    const { readFileSync } = await import('fs');
    const content = readFileSync(
      new URL('../src/commands/health.ts', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'),
      'utf-8'
    );

    // Legacy IDs that should NOT appear
    expect(content).not.toContain('f6f638c9-6aee-42a7-8137-df5b6a560f50'); // Inbox 2.0
    expect(content).not.toContain('c298b60934d248beb2c50942436b8bfe');     // Inbox 1.0
  });

  it('runs checks in parallel with Promise.all', async () => {
    const { readFileSync } = await import('fs');
    const content = readFileSync(
      new URL('../src/commands/health.ts', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'),
      'utf-8'
    );

    expect(content).toContain('Promise.all');
  });
});

// ============================================================================
// Group 6: API dispatch write-gate (the bug we just fixed)
// ============================================================================

describe('api-dispatch write-gate parity', () => {
  it('api-dispatch.ts imports validateSkillFrontmatter', async () => {
    const { readFileSync } = await import('fs');
    const content = readFileSync(
      new URL('../src/pit-crew/api-dispatch.ts', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'),
      'utf-8'
    );

    expect(content).toContain('validateSkillFrontmatter');
    expect(content).toContain('SKILL_SCHEMA_PROMPT');
  });

  it('api-dispatch.ts has write-gate before writeFile', async () => {
    const { readFileSync } = await import('fs');
    const content = readFileSync(
      new URL('../src/pit-crew/api-dispatch.ts', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'),
      'utf-8'
    );

    // Write-gate must come BEFORE writeFile
    const gateIdx = content.indexOf('Write-gate');
    const writeIdx = content.indexOf("writeFile(targetFile, fixedContent");
    expect(gateIdx).toBeGreaterThan(-1);
    expect(writeIdx).toBeGreaterThan(-1);
    expect(gateIdx).toBeLessThan(writeIdx);
  });

  it('swarm-dispatch.ts also has write-gate', async () => {
    const { readFileSync } = await import('fs');
    const content = readFileSync(
      new URL('../src/pit-crew/swarm-dispatch.ts', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'),
      'utf-8'
    );

    expect(content).toContain('validateSkillFrontmatter');
    expect(content).toContain('SKILL_SCHEMA_PROMPT');
  });
});
