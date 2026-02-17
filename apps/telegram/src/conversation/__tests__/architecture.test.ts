/**
 * Architecture Regression Tests
 *
 * Verifies structural invariants of the content pipeline.
 * These tests catch drift BEFORE it becomes a runtime bug.
 *
 * Updated for Gate 2: Socratic Interview Engine replaces keyboard flows.
 * prompt-selection.ts, prompt-selection-callback.ts, intent-callback.ts deleted.
 *
 * NOTE: Uses Bun.file() instead of fs.readFileSync to avoid contamination
 * from vitest mock side effects in sibling test files.
 *
 * Run with: bun test src/conversation/__tests__/architecture.test.ts
 */

import { describe, it, expect } from 'bun:test';
import { join, resolve } from 'path';
import { file as bunFile } from 'bun';

// Use CWD-relative paths (bun test runs from apps/telegram/)
const ROOT = process.cwd();
const SRC = join(ROOT, 'src');
const CONVERSATION = join(SRC, 'conversation');
const SOCRATIC = resolve(ROOT, '..', '..', 'packages', 'agents', 'src', 'socratic');
const COMPOSITION = resolve(ROOT, '..', '..', 'packages', 'agents', 'src', 'services', 'prompt-composition');

function fileExists(filePath: string): boolean {
  return bunFile(filePath).size > 0;
}

async function readFileContent(filePath: string): Promise<string> {
  try {
    return await bunFile(filePath).text();
  } catch {
    return '';
  }
}

describe('Content Pipeline Architecture', () => {

  describe('Critical files exist', () => {
    const conversationFiles = [
      'handler.ts',
      'content-flow.ts',
      'content-router.ts',
      'content-confirm.ts',
      'socratic-adapter.ts',
      'socratic-session.ts',
      'pending-content.ts',
      'types.ts',
      'index.ts',
    ];

    for (const f of conversationFiles) {
      it(`conversation/${f} exists`, () => {
        expect(fileExists(join(CONVERSATION, f))).toBe(true);
      });
    }

    it('cognitive/triage-skill.ts exists', () => {
      expect(fileExists(join(SRC, 'cognitive', 'triage-skill.ts'))).toBe(true);
    });

    it('classifier.ts exists', () => {
      expect(fileExists(join(SRC, 'classifier.ts'))).toBe(true);
    });
  });

  describe('Deleted keyboard files do NOT exist (Gate 2)', () => {
    it('prompt-selection.ts is deleted', () => {
      expect(fileExists(join(CONVERSATION, 'prompt-selection.ts'))).toBe(false);
    });

    it('handlers/prompt-selection-callback.ts is deleted', () => {
      expect(fileExists(join(SRC, 'handlers', 'prompt-selection-callback.ts'))).toBe(false);
    });

    it('handlers/intent-callback.ts is deleted', () => {
      expect(fileExists(join(SRC, 'handlers', 'intent-callback.ts'))).toBe(false);
    });
  });

  describe('Socratic engine package exists (Gate 0)', () => {
    it('engine.ts exists', () => {
      expect(fileExists(join(SOCRATIC, 'engine.ts'))).toBe(true);
    });

    it('types.ts exists', () => {
      expect(fileExists(join(SOCRATIC, 'types.ts'))).toBe(true);
    });

    it('index.ts barrel exists', () => {
      expect(fileExists(join(SOCRATIC, 'index.ts'))).toBe(true);
    });
  });

  describe('Shared composition package exists', () => {
    it('composer.ts exists', () => {
      expect(fileExists(join(COMPOSITION, 'composer.ts'))).toBe(true);
    });

    it('registry.ts exists', () => {
      expect(fileExists(join(COMPOSITION, 'registry.ts'))).toBe(true);
    });

    it('types.ts exists', () => {
      expect(fileExists(join(COMPOSITION, 'types.ts'))).toBe(true);
    });
  });

  describe('handler.ts does NOT contain inline prompt logic', () => {
    it('does not contain system prompt strings', async () => {
      const content = await readFileContent(join(CONVERSATION, 'handler.ts'));
      expect(content.length).toBeGreaterThan(0);
      expect(content).not.toMatch(/You are (a|an) .{20,}/);
      expect(content).not.toMatch(/system:\s*["'`]You/);
    });

    it('does not contain hardcoded pillar routing rules', async () => {
      const content = await readFileContent(join(CONVERSATION, 'handler.ts'));
      expect(content).not.toMatch(/if\s*\(.*\.includes\(['"]permit['"]\).*Home\/Garage/);
    });

    it('imports content-flow functions (not inline)', async () => {
      const content = await readFileContent(join(CONVERSATION, 'handler.ts'));
      expect(content).toMatch(/from\s+['"]\.\/content-flow['"]/);
      expect(content).toMatch(/maybeHandleAsContentShare/);
    });

    it('imports Socratic session check (Gate 2)', async () => {
      const content = await readFileContent(join(CONVERSATION, 'handler.ts'));
      expect(content).toMatch(/from\s+['"]\.\/socratic-session['"]/);
      expect(content).toMatch(/hasPendingSocraticSessionForUser/);
    });

    it('does NOT import from prompt-selection', async () => {
      const content = await readFileContent(join(CONVERSATION, 'handler.ts'));
      expect(content).not.toMatch(/from\s+['"]\.\/prompt-selection['"]/);
      expect(content).not.toMatch(/hasPendingSelectionForUser/);
    });

    it('contains the guardrail comment block', async () => {
      const content = await readFileContent(join(CONVERSATION, 'handler.ts'));
      expect(content).toMatch(/CONTENT PIPELINE GUARDRAIL/);
    });
  });

  describe('content-flow.ts delegates to Socratic engine (Gate 2)', () => {
    it('imports triageMessage from cognitive/triage-skill', async () => {
      const content = await readFileContent(join(CONVERSATION, 'content-flow.ts'));
      expect(content.length).toBeGreaterThan(0);
      expect(content).toMatch(/from\s+['"]\.\.\/cognitive\/triage-skill['"]/);
      expect(content).toMatch(/triageMessage/);
    });

    it('imports socraticInterview from socratic-adapter', async () => {
      const content = await readFileContent(join(CONVERSATION, 'content-flow.ts'));
      expect(content).toMatch(/from\s+['"]\.\/socratic-adapter['"]/);
      expect(content).toMatch(/socraticInterview/);
    });

    it('does NOT import startPromptSelection', async () => {
      const content = await readFileContent(join(CONVERSATION, 'content-flow.ts'));
      expect(content).not.toMatch(/startPromptSelection/);
      expect(content).not.toMatch(/from\s+['"]\.\.\/handlers\/prompt-selection-callback['"]/);
    });

    it('does NOT import buildIntentKeyboard', async () => {
      const content = await readFileContent(join(CONVERSATION, 'content-flow.ts'));
      expect(content).not.toMatch(/buildIntentKeyboard/);
      expect(content).not.toMatch(/buildClassificationKeyboard/);
    });

    it('does not contain Anthropic API calls', async () => {
      const content = await readFileContent(join(CONVERSATION, 'content-flow.ts'));
      expect(content).not.toMatch(/anthropic.*messages\.create/i);
      expect(content).not.toMatch(/new Anthropic/);
    });
  });

  describe('socratic-adapter.ts structure (Gate 2)', () => {
    it('imports from Socratic engine package', async () => {
      const content = await readFileContent(join(CONVERSATION, 'socratic-adapter.ts'));
      expect(content.length).toBeGreaterThan(0);
      expect(content).toMatch(/from\s+['"].*packages\/agents\/src\/socratic['"]/);
      expect(content).toMatch(/getSocraticEngine/);
    });

    it('exports socraticInterview function', async () => {
      const content = await readFileContent(join(CONVERSATION, 'socratic-adapter.ts'));
      expect(content).toMatch(/export async function socraticInterview/);
    });

    it('exports handleSocraticAnswer function', async () => {
      const content = await readFileContent(join(CONVERSATION, 'socratic-adapter.ts'));
      expect(content).toMatch(/export async function handleSocraticAnswer/);
    });

    it('does NOT import or use InlineKeyboard', async () => {
      const content = await readFileContent(join(CONVERSATION, 'socratic-adapter.ts'));
      expect(content).not.toMatch(/InlineKeyboard/);
      expect(content).not.toMatch(/\.text\(/); // No keyboard button building
      expect(content).not.toMatch(/reply_markup/);
    });

    it('delegates to createAuditTrail for Notion entries', async () => {
      const content = await readFileContent(join(CONVERSATION, 'socratic-adapter.ts'));
      expect(content).toMatch(/createAuditTrail/);
    });
  });

  describe('content-confirm.ts gutted (Gate 2)', () => {
    it('does NOT export buildIntentKeyboard', async () => {
      const content = await readFileContent(join(CONVERSATION, 'content-confirm.ts'));
      expect(content).not.toMatch(/export function buildIntentKeyboard/);
    });

    it('does NOT export buildClassificationKeyboard', async () => {
      const content = await readFileContent(join(CONVERSATION, 'content-confirm.ts'));
      expect(content).not.toMatch(/export function buildClassificationKeyboard/);
    });

    it('does NOT export buildDepthKeyboard', async () => {
      const content = await readFileContent(join(CONVERSATION, 'content-confirm.ts'));
      expect(content).not.toMatch(/export function buildDepthKeyboard/);
    });

    it('does NOT export buildAudienceKeyboard', async () => {
      const content = await readFileContent(join(CONVERSATION, 'content-confirm.ts'));
      expect(content).not.toMatch(/export function buildAudienceKeyboard/);
    });

    it('still exports PendingContent type', async () => {
      const content = await readFileContent(join(CONVERSATION, 'content-confirm.ts'));
      expect(content).toMatch(/export interface PendingContent/);
    });

    it('still exports isContentCallback', async () => {
      const content = await readFileContent(join(CONVERSATION, 'content-confirm.ts'));
      expect(content).toMatch(/export function isContentCallback/);
    });

    it('still exports buildConfirmationKeyboard (legacy UCA)', async () => {
      const content = await readFileContent(join(CONVERSATION, 'content-confirm.ts'));
      expect(content).toMatch(/export function buildConfirmationKeyboard/);
    });
  });

  describe('handlers/index.ts routing (Gate 2)', () => {
    it('does NOT import from prompt-selection-callback', async () => {
      const content = await readFileContent(join(SRC, 'handlers', 'index.ts'));
      expect(content).not.toMatch(/prompt-selection-callback/);
    });

    it('does NOT import from intent-callback', async () => {
      const content = await readFileContent(join(SRC, 'handlers', 'index.ts'));
      expect(content).not.toMatch(/intent-callback/);
    });

    it('exports socraticInterview and handleSocraticAnswer', async () => {
      const content = await readFileContent(join(SRC, 'handlers', 'index.ts'));
      expect(content).toMatch(/socraticInterview/);
      expect(content).toMatch(/handleSocraticAnswer/);
    });
  });
});
