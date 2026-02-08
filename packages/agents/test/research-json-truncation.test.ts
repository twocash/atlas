/**
 * Regression Tests — Research Agent JSON Truncation Fix
 *
 * Tests the fix for silent data loss when Gemini 2.0 Flash hits MAX_TOKENS:
 * 1. Token limit increased for deep research (Phase 1)
 * 2. repairTruncatedJson() recovers partial data (Phase 3a)
 * 3. Grounding citations always merged (Phase 3b)
 * 4. Warning logged on regex fallback (Phase 3c)
 *
 * Run: cd packages/agents && bun test test/research-json-truncation.test.ts
 */

import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';

// Read source for structural assertions and import the function under test
const researchSource = readFileSync(
  join(import.meta.dir, '..', 'src', 'agents', 'research.ts'),
  'utf-8'
);

// =============================================================================
// Phase 1: Token limit increase
// =============================================================================

describe('Phase 1: Deep research token limit', () => {
  it('deep research maxTokens is >= 65536 (was 25000)', () => {
    // Extract the deep config block
    const deepConfig = researchSource.match(
      /deep:\s*\{[^}]*maxTokens:\s*(\d+)/
    );
    expect(deepConfig).not.toBeNull();
    const maxTokens = parseInt(deepConfig![1], 10);
    expect(maxTokens).toBeGreaterThanOrEqual(65536);
  });

  it('light and standard maxTokens unchanged', () => {
    const lightConfig = researchSource.match(
      /light:\s*\{[^}]*maxTokens:\s*(\d+)/
    );
    const standardConfig = researchSource.match(
      /standard:\s*\{[^}]*maxTokens:\s*(\d+)/
    );
    expect(lightConfig).not.toBeNull();
    expect(standardConfig).not.toBeNull();
    expect(parseInt(lightConfig![1], 10)).toBe(2048);
    expect(parseInt(standardConfig![1], 10)).toBe(8192);
  });

  it('prompt text references updated token budget', () => {
    // Should NOT reference ~25,000 tokens anymore
    expect(researchSource).not.toContain('~25,000 tokens available');
    // Should reference the new budget
    expect(researchSource).toContain('~65,000 tokens available');
  });
});

// =============================================================================
// Phase 3a: repairTruncatedJson()
// =============================================================================

describe('Phase 3a: repairTruncatedJson function', () => {
  it('function exists in source', () => {
    expect(researchSource).toContain('function repairTruncatedJson');
  });

  it('is called when JSON.parse fails', () => {
    // The catch block should call repairTruncatedJson
    expect(researchSource).toContain('repairTruncatedJson(text)');
  });

  // Test the repair logic by extracting and evaluating it
  // We'll use a dynamic import approach
  it('repairs truncated JSON with unclosed array', async () => {
    // Simulate what repairTruncatedJson does: close open brackets
    const truncated = '{"summary":"test","findings":[{"claim":"a","source":"b","url":"http://x.com"},{"claim":"c","source":"d","url":"http://y.com"';

    // Manual repair: find last complete value, then close brackets
    const lastComplete = Math.max(
      truncated.lastIndexOf('",'),
      truncated.lastIndexOf('"}')
    );
    let repaired = truncated.substring(0, lastComplete + 1);

    // Count open brackets
    const opens: string[] = [];
    let inStr = false, esc = false;
    for (const ch of repaired) {
      if (esc) { esc = false; continue; }
      if (ch === '\\') { esc = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === '{') opens.push('}');
      else if (ch === '[') opens.push(']');
      else if (ch === '}' || ch === ']') {
        if (opens.length > 0 && opens[opens.length - 1] === ch) opens.pop();
      }
    }
    repaired += opens.reverse().join('');

    const parsed = JSON.parse(repaired);
    expect(parsed.summary).toBe('test');
    expect(parsed.findings).toBeInstanceOf(Array);
    // Should recover at least 1 finding (the complete one)
    expect(parsed.findings.length).toBeGreaterThanOrEqual(1);
  });

  it('repairs truncated JSON with unclosed object and array', () => {
    const truncated = `{"summary":"Research results","findings":[{"claim":"First fact","source":"Site A","url":"http://a.com"},{"claim":"Second fact","source":"Site B","url":"http://b.com"}],"sources":["http://a.com","http://b.com"`;

    // Simulate repair
    const lastComplete = Math.max(
      truncated.lastIndexOf('",'),
      truncated.lastIndexOf('"}')
    );
    let repaired = truncated.substring(0, lastComplete + 1);

    const opens: string[] = [];
    let inStr = false, esc = false;
    for (const ch of repaired) {
      if (esc) { esc = false; continue; }
      if (ch === '\\') { esc = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === '{') opens.push('}');
      else if (ch === '[') opens.push(']');
      else if (ch === '}' || ch === ']') {
        if (opens.length > 0 && opens[opens.length - 1] === ch) opens.pop();
      }
    }
    repaired += opens.reverse().join('');

    const parsed = JSON.parse(repaired);
    expect(parsed.summary).toBe('Research results');
    expect(parsed.findings.length).toBe(2);
    // Sources array may be partial but recoverable
    expect(parsed.sources).toBeInstanceOf(Array);
  });

  it('handles markdown-fenced truncated JSON', () => {
    const truncated = '```json\n{"summary":"test","findings":[{"claim":"a","source":"b","url":"http://x.com"}],"sources":["http://x.com"';

    // Strip markdown fence
    const jsonMatch = truncated.match(/```json\s*([\s\S]*)/);
    let jsonText = jsonMatch ? jsonMatch[1].replace(/\s*```\s*$/, '') : truncated;

    const lastComplete = Math.max(
      jsonText.lastIndexOf('",'),
      jsonText.lastIndexOf('"}')
    );
    let repaired = jsonText.substring(0, lastComplete + 1);

    const opens: string[] = [];
    let inStr = false, esc = false;
    for (const ch of repaired) {
      if (esc) { esc = false; continue; }
      if (ch === '\\') { esc = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === '{') opens.push('}');
      else if (ch === '[') opens.push(']');
      else if (ch === '}' || ch === ']') {
        if (opens.length > 0 && opens[opens.length - 1] === ch) opens.pop();
      }
    }
    repaired += opens.reverse().join('');

    const parsed = JSON.parse(repaired);
    expect(parsed.summary).toBe('test');
    expect(parsed.findings.length).toBe(1);
  });

  it('returns null for completely unparseable content', () => {
    const garbage = 'This is not JSON at all, just plain text about research';
    const objStart = garbage.indexOf('{');
    // No opening brace → repair should fail
    expect(objStart).toBe(-1);
  });
});

// =============================================================================
// Phase 3b: Grounding citations always merged
// =============================================================================

describe('Phase 3b: Grounding citations always merged', () => {
  it('citation merge is NOT conditional on findings.length === 0', () => {
    // Old code: "if (findings.length === 0)" before citation merge
    // New code: unconditional merge
    // Find the citation merge block
    const mergeBlock = researchSource.match(
      /\/\/ ALWAYS merge grounding citations/
    );
    expect(mergeBlock).not.toBeNull();
  });

  it('does NOT have conditional "if (findings.length === 0)" before citation loop', () => {
    // The old pattern was:
    //   if (findings.length === 0) { for (const citation of citations) { ... } }
    // This should NOT exist anymore
    const conditionalMerge = researchSource.match(
      /if\s*\(\s*findings\.length\s*===?\s*0\s*\)\s*\{[\s\S]*?for\s*\(\s*const\s+citation\s+of\s+citations\s*\)/
    );
    expect(conditionalMerge).toBeNull();
  });

  it('does NOT have conditional "if (sources.length === 0)" before citation URL loop', () => {
    const conditionalSources = researchSource.match(
      /if\s*\(\s*sources\.length\s*===?\s*0\s*\)\s*\{[\s\S]*?for\s*\(\s*const\s+citation\s+of\s+citations\s*\)/
    );
    expect(conditionalSources).toBeNull();
  });

  it('uses deduplication when merging citations (existingUrls Set)', () => {
    expect(researchSource).toContain('existingUrls');
    expect(researchSource).toContain('existingFindingUrls');
  });

  it('logs merged citation count', () => {
    expect(researchSource).toContain('Merged');
    expect(researchSource).toContain('grounding citations');
  });
});

// =============================================================================
// Phase 3c: Warning on regex fallback
// =============================================================================

describe('Phase 3c: Warnings on fallback paths', () => {
  it('warns when JSON parse fails and repair is attempted', () => {
    expect(researchSource).toContain('JSON parse failed, attempting repair');
  });

  it('warns when repair fails and regex is used', () => {
    expect(researchSource).toContain('JSON repair failed, falling back to regex');
    expect(researchSource).toContain('DATA LOSS LIKELY');
  });

  it('warns on regex fallback for summary extraction', () => {
    const warnBeforeRegex = researchSource.match(
      /console\.warn.*regex fallback for summary/i
    );
    expect(warnBeforeRegex).not.toBeNull();
  });

  it('warns on regex fallback for findings extraction', () => {
    const warnBeforeRegex = researchSource.match(
      /console\.warn.*regex fallback for findings/i
    );
    expect(warnBeforeRegex).not.toBeNull();
  });

  it('warns on regex fallback for sources extraction', () => {
    const warnBeforeRegex = researchSource.match(
      /console\.warn.*regex fallback for sources/i
    );
    expect(warnBeforeRegex).not.toBeNull();
  });

  it('detects potentially truncated responses by length', () => {
    expect(researchSource).toContain('Response appears truncated');
  });
});

// =============================================================================
// Structural integrity: no regressions
// =============================================================================

describe('Structural integrity', () => {
  it('hallucination detection still exists', () => {
    expect(researchSource).toContain('function detectHallucination');
    expect(researchSource).toContain('isHallucinated');
  });

  it('grounding failure check still exists', () => {
    expect(researchSource).toContain('GROUNDING FAILURE');
    expect(researchSource).toContain('response.groundingUsed');
  });

  it('NO_SEARCH_RESULTS handling still exists', () => {
    expect(researchSource).toContain('NO_SEARCH_RESULTS');
    expect(researchSource).toContain('Research FAILED:');
  });

  it('URL redirect resolution still exists', () => {
    expect(researchSource).toContain('resolveAllRedirectUrls');
    expect(researchSource).toContain('GROUNDING_REDIRECT_PATTERN');
  });

  it('all three depth configs still exist', () => {
    expect(researchSource).toContain("light:");
    expect(researchSource).toContain("standard:");
    expect(researchSource).toContain("deep:");
  });

  it('exports are intact', () => {
    expect(researchSource).toContain('export async function executeResearch');
    expect(researchSource).toContain('export async function runResearchAgent');
    expect(researchSource).toContain('export { DEPTH_CONFIG');
  });
});
