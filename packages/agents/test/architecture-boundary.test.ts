/**
 * Architecture Boundary Scanner — CPE Integrity Enforcement
 *
 * Static analysis test ensuring the cognitive layer (packages/agents/src/)
 * stays surface-agnostic and that the surface layer (apps/telegram/src/)
 * doesn't bypass the Content Router pipeline.
 *
 * 5 Rules:
 *   1. No Grammy/Telegram imports in packages/agents/src/
 *   2. No Telegram HTML formatting in packages/agents/src/
 *   3. No URL handler bypasses in apps/telegram/src/conversation/content-flow.ts
 *   4. No direct model SDK instantiation in packages/agents/src/ (outside backends/)
 *   5. No hardcoded prompts (>100 char string literals) in packages/agents/src/
 *
 * Hotfix: hotfix/notion-handler-pipeline-migration
 */

import { describe, it, expect } from 'bun:test';
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join } from 'path';

// Resolve project root (packages/agents/test/ → project root)
const PROJECT_ROOT = join(import.meta.dir, '..', '..', '..');
const AGENTS_SRC = join(PROJECT_ROOT, 'packages', 'agents', 'src');
const CONTENT_FLOW = join(PROJECT_ROOT, 'apps', 'telegram', 'src', 'conversation', 'content-flow.ts');

// =============================================================================
// UTILITIES (same patterns as test/architecture/boundary.test.ts)
// =============================================================================

function getAllTsFiles(dir: string): string[] {
  const files: string[] = [];
  if (!existsSync(dir)) return files;

  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (entry === 'node_modules' || entry === 'dist' || entry === '.git') continue;
    const stat = statSync(full);
    if (stat.isDirectory()) {
      files.push(...getAllTsFiles(full));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts') && !entry.endsWith('.test.ts')) {
      files.push(full);
    }
  }
  return files;
}

function relPath(filePath: string): string {
  return filePath.replace(PROJECT_ROOT + '\\', '').replace(PROJECT_ROOT + '/', '').replace(/\\/g, '/');
}

function scanFiles(
  files: string[],
  test: (content: string, line: string, lineNum: number, filePath: string) => boolean,
  excludePatterns: RegExp[] = [],
): { file: string; line: number; text: string }[] {
  const violations: { file: string; line: number; text: string }[] = [];

  for (const filePath of files) {
    const rp = relPath(filePath);

    // Skip excluded paths
    if (excludePatterns.some(p => p.test(rp))) continue;

    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Skip comments
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;

      if (test(content, line, i + 1, filePath)) {
        violations.push({ file: rp, line: i + 1, text: trimmed });
      }
    }
  }
  return violations;
}

function formatViolations(violations: { file: string; line: number; text: string }[]): string {
  return violations.map(v => `  ${v.file}:${v.line} — ${v.text}`).join('\n');
}

// =============================================================================
// Rule 1: No Grammy/Telegram imports in cognitive layer
// =============================================================================

describe('Rule 1: No Grammy/Telegram imports in packages/agents/src/', () => {
  const agentFiles = getAllTsFiles(AGENTS_SRC);

  it('has zero Grammy framework imports', () => {
    const violations = scanFiles(agentFiles, (_content, line) => {
      return /from\s+['"]grammy['"]/.test(line) || /from\s+['"]telegraf['"]/.test(line);
    });

    if (violations.length > 0) {
      throw new Error(
        `Grammy/Telegraf imports found in cognitive layer:\n${formatViolations(violations)}`
      );
    }
  });

  it('has zero Grammy class references', () => {
    const violations = scanFiles(agentFiles, (_content, line) => {
      // Match InlineKeyboard, Keyboard, Bot from grammy usage patterns
      return /\bInlineKeyboard\b/.test(line) || /\bnew Bot\b/.test(line);
    }, [
      // Exclude pipeline surfaces (they define surface bindings, not Grammy imports)
      /pipeline\/surfaces\//,
    ]);

    if (violations.length > 0) {
      throw new Error(
        `Grammy class references found in cognitive layer:\n${formatViolations(violations)}`
      );
    }
  });
});

// =============================================================================
// Rule 2: No Telegram HTML formatting in cognitive layer
// =============================================================================

describe('Rule 2: No Telegram HTML formatting in packages/agents/src/', () => {
  const agentFiles = getAllTsFiles(AGENTS_SRC);

  it('has zero Telegram HTML tags in string literals', () => {
    const violations = scanFiles(agentFiles, (_content, line) => {
      // Match HTML tags used in Telegram's HTML parse mode: <b>, <i>, <code>, <pre>
      // Only match inside string contexts (quotes or template literals)
      if (/<b>|<\/b>|<i>|<\/i>|<code>|<\/code>|<pre>|<\/pre>/.test(line)) {
        // Verify it's in a string context (contains quotes or backtick)
        if (/['"`]/.test(line)) return true;
        // Or it's a template literal expression
        if (/push\(|return\s/.test(line)) return true;
      }
      return false;
    }, [
      // Exclude test files (they may assert on formatted output)
      /\.test\.ts$/,
      // PRE-EXISTING: These files have HTML formatting that predates CPE.
      // Each should get its own cleanup ticket. Tracked for future remediation.
      /conversation\/approval-session\.ts/,
      /conversation\/tools\/core\.ts/,
      /skills\/approval-queue\.ts/,
    ]);

    if (violations.length > 0) {
      throw new Error(
        `Telegram HTML formatting found in cognitive layer:\n${formatViolations(violations)}`
      );
    }
  });

  it('has zero parse_mode HTML references', () => {
    const violations = scanFiles(agentFiles, (_content, line) => {
      return /parse_mode.*['"]HTML['"]/.test(line) || /parseMode.*['"]HTML['"]/.test(line);
    }, [
      // PRE-EXISTING: orchestrator.ts uses parseMode for surface hooks.
      // This is a Phase 5 legacy pattern that Phase 6 CognitivePipeline will replace.
      /pipeline\/orchestrator\.ts/,
    ]);

    if (violations.length > 0) {
      throw new Error(
        `Telegram parse_mode HTML found in cognitive layer:\n${formatViolations(violations)}`
      );
    }
  });
});

// =============================================================================
// Rule 3: No URL handler bypasses in content-flow.ts
// =============================================================================

describe('Rule 3: No URL handler bypasses in content-flow.ts', () => {
  it('content-flow.ts exists', () => {
    expect(existsSync(CONTENT_FLOW)).toBe(true);
  });

  it('does not import handleNotionUrl or any direct URL handler bypass', () => {
    const content = readFileSync(CONTENT_FLOW, 'utf-8');

    // The specific bypass: importing a function that handles a URL type
    // directly instead of routing through Content Router
    const bypassPatterns = [
      /import\s+.*handleNotionUrl/,
      /import\s+.*handleTwitterUrl/,
      /import\s+.*handleLinkedInUrl/,
      /import\s+.*handleGithubUrl/,
    ];

    const violations: string[] = [];
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const pattern of bypassPatterns) {
        if (pattern.test(line)) {
          violations.push(`content-flow.ts:${i + 1} — ${line.trim()}`);
        }
      }
    }

    if (violations.length > 0) {
      throw new Error(
        `URL handler bypass imports found (URLs must route through Content Router):\n` +
        violations.map(v => `  ${v}`).join('\n')
      );
    }
  });

  it('does not contain early-return URL type checks before Content Router', () => {
    const content = readFileSync(CONTENT_FLOW, 'utf-8');

    // Pattern: checking isNotionUrl/isTwitterUrl/etc. and returning early
    // before the URL reaches routeForAnalysis()
    const bypassPatterns = [
      /if\s*\(\s*isNotionUrl\s*\(/,
      /if\s*\(\s*isTwitterUrl\s*\(/,
      /if\s*\(\s*isLinkedInUrl\s*\(/,
    ];

    const violations: string[] = [];
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      // Skip comments
      if (line.startsWith('//') || line.startsWith('*')) continue;
      for (const pattern of bypassPatterns) {
        if (pattern.test(line)) {
          violations.push(`content-flow.ts:${i + 1} — ${line}`);
        }
      }
    }

    if (violations.length > 0) {
      throw new Error(
        `URL type bypass checks found before Content Router:\n` +
        violations.map(v => `  ${v}`).join('\n')
      );
    }
  });
});

// =============================================================================
// Rule 4: No direct model SDK instantiation in cognitive layer
// =============================================================================

describe('Rule 4: No direct model SDK instantiation in packages/agents/src/', () => {
  const agentFiles = getAllTsFiles(AGENTS_SRC);

  it('has zero direct Anthropic/OpenAI client instantiation outside backends/', () => {
    const violations = scanFiles(agentFiles, (_content, line) => {
      return /new\s+Anthropic\s*\(/.test(line) || /new\s+OpenAI\s*\(/.test(line);
    }, [
      // backends/ is allowed to instantiate model clients
      /pipeline\/backends\//,
      // cognitive worker legitimately creates Anthropic clients
      /cognitive\/worker\.ts/,
      // research agent legitimately creates Google GenAI
      /agents\/research\.ts/,
      // emergence session-detector queries Notion (not a model client)
      /emergence\//,
      // PRE-EXISTING: These files instantiate Anthropic before Phase 6 routing exists.
      // Each will migrate to CognitivePipeline backends when Phase 6 goes live.
      /cognitive\/triage-skill\.ts/,
      /conversation\/content-pre-reader\.ts/,
      /conversation\/tools\/core\.ts/,
      /goal\/clarifier\.ts/,
      /goal\/parser\.ts/,
      /pipeline\/orchestrator\.ts/,
      /socratic\/intent-interpreter\.ts/,
    ]);

    if (violations.length > 0) {
      throw new Error(
        `Direct model SDK instantiation found outside backends/:\n${formatViolations(violations)}`
      );
    }
  });
});

// =============================================================================
// Rule 5: No hardcoded prompts in cognitive layer
// =============================================================================

describe('Rule 5: No hardcoded prompts (>100 chars) in packages/agents/src/', () => {
  const agentFiles = getAllTsFiles(AGENTS_SRC);

  it('has zero hardcoded prompt string literals >100 chars', () => {
    const violations = scanFiles(agentFiles, (_content, line) => {
      // Match long string literals that look like prompts
      // Heuristic: string literal >100 chars containing prompt-like words
      const stringMatch = line.match(/['"`]((?:[^'"`\\]|\\.){100,})['"`]/);
      if (!stringMatch) return false;

      const str = stringMatch[1];
      // Check for prompt-like content (instruction patterns)
      const promptIndicators = [
        /you are/i,
        /you must/i,
        /respond with/i,
        /your (role|task|job)/i,
        /classify the/i,
        /analyze the/i,
        /given the following/i,
        /instructions:/i,
      ];

      return promptIndicators.some(p => p.test(str));
    }, [
      // Config files may have legitimate long descriptions
      /config\//,
      // Test files
      /\.test\.ts$/,
      // prompt.ts is the prompt assembly layer (reads from Notion, but may have fallbacks)
      /conversation\/prompt\.ts/,
      // triage-skill.ts has legitimate fallback prompt assembly
      /cognitive\/triage-skill\.ts/,
      // worker.ts has system prompt assembly
      /cognitive\/worker\.ts/,
      // PRE-EXISTING: orchestrator.ts has error-handling prompt strings
      /pipeline\/orchestrator\.ts/,
    ]);

    if (violations.length > 0) {
      throw new Error(
        `Hardcoded prompts found in cognitive layer (Constraint 1: Notion governs all prompts):\n${formatViolations(violations)}`
      );
    }
  });
});
