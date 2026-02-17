/**
 * Regression Tests — V3 Strict Mode + URL Fabrication Fix (ATLAS-V3URL-001)
 *
 * Tests the fixes for:
 * RC1: v3Requested guard — only true when prompt composition succeeds
 * RC2a: URL fabrication removal — no more fabricated notion.so URLs
 * RC2b: Claude prompt directive — anti-fabrication instructions in system prompt
 *
 * Run: cd apps/telegram && bun test test/v3-strict-url-fabrication.test.ts
 */

import { describe, it, expect } from 'bun:test';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

// Read source files for structural assertions
const srcDir = join(import.meta.dir, '..', 'src');

function readSrc(relativePath: string): string {
  return readFileSync(join(srcDir, relativePath), 'utf-8');
}

// =============================================================================
// RC1: v3Requested guard
// Gate 2: prompt-selection-callback.ts deleted — Socratic engine replaces
// keyboard flow. Only surviving call site (status-server.ts) is tested.
// =============================================================================

describe('RC1: v3Requested guard', () => {
  it('status-server.ts guards v3Requested correctly', () => {
    const statusSource = readSrc('health/status-server.ts');
    expect(statusSource).toContain('!!composedPrompt?.prompt');
  });
});

// =============================================================================
// RC2a: URL fabrication removal
// =============================================================================

describe('RC2a: URL fabrication removal', () => {
  it('no notion.so/${...} fabrication in src/ directory', () => {
    // Recursively read all .ts files and check for fabrication pattern
    const fabricationPattern = /notion\.so\/\$\{/;
    const tsFiles = findTsFiles(srcDir);

    const violations: string[] = [];
    for (const file of tsFiles) {
      const content = readFileSync(file, 'utf-8');
      if (fabricationPattern.test(content)) {
        // Allow in comments only
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (fabricationPattern.test(line)) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('//') && !trimmed.startsWith('*')) {
              violations.push(`${file}:${i + 1}: ${trimmed}`);
            }
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('notionUrl() function is deleted from audit.ts', () => {
    const auditSource = readSrc('conversation/audit.ts');
    expect(auditSource).not.toContain('export function notionUrl(');
    expect(auditSource).toContain('notionUrl() DELETED');
  });

  it('getNotionPageUrl() function is deleted from notion.ts', () => {
    const notionSource = readSrc('notion.ts');
    expect(notionSource).not.toContain('export function getNotionPageUrl(');
    expect(notionSource).toContain('getNotionPageUrl() DELETED');
  });

  it('no imports of notionUrl remain', () => {
    const tsFiles = findTsFiles(srcDir);
    const importPattern = /import.*notionUrl/;

    for (const file of tsFiles) {
      const content = readFileSync(file, 'utf-8');
      expect(importPattern.test(content)).toBe(false);
    }
  });

  it('no imports of getNotionPageUrl remain', () => {
    const tsFiles = findTsFiles(srcDir);
    const importPattern = /import.*getNotionPageUrl/;

    for (const file of tsFiles) {
      const content = readFileSync(file, 'utf-8');
      expect(importPattern.test(content)).toBe(false);
    }
  });

  it('Notion API responses used for URL (response.url pattern)', () => {
    // Verify the replacement pattern exists in key files
    const auditSource = readSrc('conversation/audit.ts');
    const coreSource = readSrc('conversation/tools/core.ts');

    // audit.ts should use (response as { url?: string }).url
    expect(auditSource).toContain("(response as { url?: string }).url || ''");

    // core.ts should use (page as { url?: string }).url or (response as ...).url
    expect(coreSource).toContain("(page as { url?: string }).url || ''");
    expect(coreSource).toContain("(response as { url?: string }).url || ''");
  });
});

// =============================================================================
// RC2b: Claude prompt directive
// =============================================================================

describe('RC2b: Claude prompt directive for URL integrity', () => {
  const promptSource = readSrc('conversation/prompt.ts');

  it('has URL INTEGRITY RULE section', () => {
    expect(promptSource).toContain('URL INTEGRITY RULE');
  });

  it('instructs NEVER fabricate Notion URLs', () => {
    expect(promptSource).toContain('NEVER fabricate Notion URLs');
  });

  it('instructs NEVER GENERATE NOTION URLS', () => {
    expect(promptSource).toContain('NEVER GENERATE NOTION URLS');
  });

  it('provides fallback instruction for missing URLs', () => {
    expect(promptSource).toContain('Link unavailable');
  });

  it('requires verification before displaying links', () => {
    expect(promptSource).toContain('confirm the');
    expect(promptSource).toContain('field exists in the tool result JSON');
  });
});

// =============================================================================
// Helpers
// =============================================================================

function findTsFiles(dir: string): string[] {
  const results: string[] = [];
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== '__tests__') {
        results.push(...findTsFiles(fullPath));
      } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
        results.push(fullPath);
      }
    }
  } catch {
    // Ignore permission errors
  }
  return results;
}
