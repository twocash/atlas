/**
 * Architecture Regression Tests
 *
 * Verifies structural invariants of the content pipeline.
 * These tests catch drift BEFORE it becomes a runtime bug.
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
      'prompt-selection.ts',
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

    it('handlers/prompt-selection-callback.ts exists', () => {
      expect(fileExists(join(SRC, 'handlers', 'prompt-selection-callback.ts'))).toBe(true);
    });

    it('classifier.ts exists', () => {
      expect(fileExists(join(SRC, 'classifier.ts'))).toBe(true);
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

    it('contains the guardrail comment block', async () => {
      const content = await readFileContent(join(CONVERSATION, 'handler.ts'));
      expect(content).toMatch(/CONTENT PIPELINE GUARDRAIL/);
    });
  });

  describe('content-flow.ts delegates classification', () => {
    it('imports triageMessage from cognitive/triage-skill', async () => {
      const content = await readFileContent(join(CONVERSATION, 'content-flow.ts'));
      expect(content.length).toBeGreaterThan(0);
      expect(content).toMatch(/from\s+['"]\.\.\/cognitive\/triage-skill['"]/);
      expect(content).toMatch(/triageMessage/);
    });

    it('imports startPromptSelection from handlers', async () => {
      const content = await readFileContent(join(CONVERSATION, 'content-flow.ts'));
      expect(content).toMatch(/from\s+['"]\.\.\/handlers\/prompt-selection-callback['"]/);
      expect(content).toMatch(/startPromptSelection/);
    });

    it('does not contain Anthropic API calls', async () => {
      const content = await readFileContent(join(CONVERSATION, 'content-flow.ts'));
      expect(content).not.toMatch(/anthropic.*messages\.create/i);
      expect(content).not.toMatch(/new Anthropic/);
    });
  });

  describe('prompt-selection-callback.ts uses shared package', () => {
    it('imports from packages/agents (shared composition)', async () => {
      const content = await readFileContent(join(SRC, 'handlers', 'prompt-selection-callback.ts'));
      expect(content.length).toBeGreaterThan(0);
      expect(content).toMatch(/from\s+['"].*packages\/agents\/src['"]/);
    });

    it('imports composePromptFromState', async () => {
      const content = await readFileContent(join(SRC, 'handlers', 'prompt-selection-callback.ts'));
      expect(content).toMatch(/composePromptFromState/);
    });
  });
});
