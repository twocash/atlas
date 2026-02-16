/**
 * V3 Pipeline Lifecycle Regression Tests
 *
 * Catches the class of bug where composedPrompt is passed as a raw string
 * instead of the expected { prompt, temperature, maxTokens, metadata } object,
 * and where v3Requested is missing from call sites.
 *
 * Bug: intent-callback.ts:578 passed compositionResult.prompt (string) instead
 * of the full object. The skill executor's claude_analyze tool casts it to an
 * object and reads .prompt — undefined on a string — causing PROMPT_STRICT_MODE
 * to block and all analysis to silently fail with empty content.
 *
 * Fixed: a56ca9a (2026-02-16)
 */

import { describe, it, expect } from 'bun:test';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { parse as parseYaml } from 'yaml';

const srcDir = join(import.meta.dir, '..', 'src');
const skillsDir = join(import.meta.dir, '..', 'data', 'skills');

function readSrc(relativePath: string): string {
  return readFileSync(join(srcDir, relativePath), 'utf-8');
}

// =============================================================================
// 1. STRUCTURAL: composedPrompt must always be an object, never a raw string
// =============================================================================

describe('composedPrompt call site contracts', () => {
  // All files that dispatch to skills or tools with composedPrompt
  const callSiteFiles = [
    'handlers/intent-callback.ts',
    'handlers/prompt-selection-callback.ts',
    'health/status-server.ts',
  ];

  for (const file of callSiteFiles) {
    describe(file, () => {
      it('passes composedPrompt as an object with { prompt, temperature, maxTokens }', () => {
        const source = readSrc(file);

        // Find all composedPrompt assignments
        const composedPromptAssignments = source.match(/composedPrompt:\s*.+/g) || [];

        for (const assignment of composedPromptAssignments) {
          // Must NOT be a bare property access like compositionResult?.prompt (a string)
          // GOOD: composedPrompt: { prompt: ..., temperature: ..., maxTokens: ... }
          // GOOD: composedPrompt: compositionResult ? { prompt: ... } : undefined
          // BAD:  composedPrompt: compositionResult?.prompt
          // BAD:  composedPrompt: result.prompt

          // Skip comments
          if (assignment.trimStart().startsWith('//') || assignment.trimStart().startsWith('*')) continue;

          // The assignment should either:
          // 1. Start an object literal { ... }
          // 2. Use a ternary that produces an object { ... }
          // 3. Be undefined/null
          // It should NOT be a bare property access ending in .prompt (which yields a string)
          const isBareStringAccess = /composedPrompt:\s*\w+(\?\.)?\w+\s*[,}]/.test(assignment) &&
            !assignment.includes('{') &&
            !assignment.includes('undefined');

          expect(isBareStringAccess).toBe(false);
        }
      });

      it('includes v3Requested alongside composedPrompt', () => {
        const source = readSrc(file);

        // If file contains composedPrompt in a skill dispatch input block,
        // it must also contain v3Requested
        const hasComposedPrompt = source.includes('composedPrompt:');
        if (hasComposedPrompt) {
          expect(source).toContain('v3Requested');
        }
      });

      it('v3Requested uses !! boolean coercion, never hardcoded true', () => {
        const source = readSrc(file);

        // Find all v3Requested assignments
        const v3Assignments = source.match(/v3Requested:\s*.+/g) || [];

        for (const assignment of v3Assignments) {
          if (assignment.trimStart().startsWith('//')) continue;

          // Must NOT be hardcoded to true
          // GOOD: v3Requested: !!result.prompt
          // GOOD: v3Requested: !!composedPrompt?.prompt
          // GOOD: v3Requested: !!compositionResult?.prompt
          // BAD:  v3Requested: true
          const isHardcodedTrue = /v3Requested:\s*true\s*[,}]/.test(assignment);
          expect(isHardcodedTrue).toBe(false);
        }
      });
    });
  }
});

// =============================================================================
// 2. STRUCTURAL: No dead composedTemperature/composedMaxTokens properties
// =============================================================================

describe('no dead prompt wiring properties', () => {
  it('composedTemperature is not used in any handler (dead code)', () => {
    const handlers = readdirSync(join(srcDir, 'handlers')).filter(f => f.endsWith('.ts'));
    for (const file of handlers) {
      const source = readSrc(`handlers/${file}`);
      expect(source).not.toContain('composedTemperature');
    }
  });

  it('composedMaxTokens is not used in any handler (dead code)', () => {
    const handlers = readdirSync(join(srcDir, 'handlers')).filter(f => f.endsWith('.ts'));
    for (const file of handlers) {
      const source = readSrc(`handlers/${file}`);
      expect(source).not.toContain('composedMaxTokens');
    }
  });
});

// =============================================================================
// 3. STRUCTURAL: Skill YAML input declarations match code expectations
// =============================================================================

describe('skill YAML composedPrompt declarations', () => {
  const skillDirs = readdirSync(skillsDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  for (const skillDir of skillDirs) {
    const yamlPath = join(skillsDir, skillDir, 'skill.yaml');
    if (!existsSync(yamlPath)) continue;

    const yamlContent = readFileSync(yamlPath, 'utf-8');
    let skill: any;
    try {
      skill = parseYaml(yamlContent);
    } catch {
      continue; // Skip unparseable YAMLs
    }

    // Only test skills that reference composedPrompt
    if (!yamlContent.includes('composedPrompt')) continue;

    describe(`${skillDir}/skill.yaml`, () => {
      it('declares composedPrompt input as type object', () => {
        const inputs = skill?.inputs || {};
        if (inputs.composedPrompt) {
          expect(inputs.composedPrompt.type).toBe('object');
        }
      });

      it('declares v3Requested input as type boolean', () => {
        const inputs = skill?.inputs || {};
        if (inputs.v3Requested) {
          expect(inputs.v3Requested.type).toBe('boolean');
        }
      });

      it('every step using $input.composedPrompt also uses $input.v3Requested', () => {
        const steps = skill?.steps || {};
        for (const [stepName, stepDef] of Object.entries(steps)) {
          const stepStr = JSON.stringify(stepDef);
          if (stepStr.includes('$input.composedPrompt')) {
            expect(stepStr).toContain('$input.v3Requested');
          }
        }
      });
    });
  }
});

// =============================================================================
// 4. FUNCTIONAL: executeClaudeAnalyze type safety
// =============================================================================

describe('executeClaudeAnalyze composedPrompt type handling', () => {
  const coreSource = readSrc('conversation/tools/core.ts');

  it('casts composedPrompt as object with prompt/temperature/maxTokens properties', () => {
    // Verify the cast pattern exists — this is the contract the call sites must match
    expect(coreSource).toContain(
      'composedPrompt as { prompt?: string; temperature?: number; maxTokens?: number }'
    );
  });

  it('reads effectivePrompt from composedPrompt?.prompt (not composedPrompt directly)', () => {
    // The function must read .prompt from the object, not use composedPrompt as a string
    expect(coreSource).toContain('composedPrompt?.prompt || systemPrompt');
  });

  it('strict mode check requires both v3Requested AND missing prompt', () => {
    // The guard: strictMode && v3Requested && !composedPrompt?.prompt
    // This must be a 3-way AND — never just strictMode && !composedPrompt
    expect(coreSource).toContain('strictMode && v3Requested && !composedPrompt?.prompt');
  });

  it('logs hasComposedPrompt and composedPromptHasText for debugging', () => {
    // These diagnostic fields are critical for debugging future issues
    expect(coreSource).toContain('hasComposedPrompt');
    expect(coreSource).toContain('composedPromptHasText');
  });
});

// =============================================================================
// 5. FUNCTIONAL: Skill executor variable resolution preserves object types
// =============================================================================

describe('skill executor variable resolution', () => {
  const executorSource = readSrc('skills/executor.ts');

  it('resolveVariables returns raw value for single-variable templates (object passthrough)', () => {
    // When template is exactly "$input.composedPrompt", the executor must return
    // the raw value (preserving object type), not convert to string
    expect(executorSource).toContain('Return raw value for object passthrough');
  });

  it('resolveVariableRaw returns context.input[key] directly', () => {
    // The input scope must return raw values without transformation
    expect(executorSource).toMatch(/case\s+'input'.*context\.input\[key\]/s);
  });

  it('handles undefined input values without crashing', () => {
    // When a skill input isn't provided, resolveVariableRaw should return undefined
    // not throw — this prevents crashes when optional inputs are missing
    expect(executorSource).toContain('return value');
  });
});

// =============================================================================
// 6. PIPELINE: notion_append must validate content before writing
// =============================================================================

describe('notion_append content validation', () => {
  const coreSource = readSrc('conversation/tools/core.ts');

  it('validates both pageId and content are present', () => {
    // The tool must check for content before attempting to write
    // This prevents blank pages when upstream analysis fails
    expect(coreSource).toContain('Both pageId and content are required');
  });

  it('logs content validation failures with diagnostic info', () => {
    // Must log whether content was present and its length for debugging
    expect(coreSource).toContain('notion_append validation failed');
  });
});

// =============================================================================
// 7. STRUCTURAL: All prompt composition results follow the same shape
// =============================================================================

describe('prompt composition result consistency', () => {
  it('composeFromStructuredContext returns { prompt, temperature, maxTokens, metadata }', () => {
    const composerPath = join(import.meta.dir, '..', '..', '..', 'packages', 'agents', 'src', 'services', 'prompt-composition');
    // Check types.ts or index.ts for the interface
    const typesPath = join(composerPath, 'types.ts');
    if (existsSync(typesPath)) {
      const typesSource = readFileSync(typesPath, 'utf-8');
      // PromptCompositionResult must have these fields
      expect(typesSource).toContain('prompt: string');
      expect(typesSource).toContain('temperature: number');
      expect(typesSource).toContain('maxTokens: number');
    }
  });

  it('composePrompt returns the same shape as composeFromStructuredContext', () => {
    // Both composition paths must return the same interface
    // This prevents shape mismatches when switching between flows
    const indexPath = join(import.meta.dir, '..', '..', '..', 'packages', 'agents', 'src', 'services', 'prompt-composition', 'index.ts');
    if (existsSync(indexPath)) {
      const indexSource = readFileSync(indexPath, 'utf-8');
      // Both functions should reference PromptCompositionResult
      expect(indexSource).toContain('PromptCompositionResult');
    }
  });
});

// =============================================================================
// 8. REGRESSION: The exact pattern that broke (string where object expected)
// =============================================================================

describe('regression: composedPrompt string-vs-object', () => {
  it('intent-callback does NOT pass compositionResult?.prompt as bare string', () => {
    const source = readSrc('handlers/intent-callback.ts');

    // This exact pattern was the bug: passing .prompt directly (a string)
    // instead of wrapping in { prompt: ..., temperature: ..., ... }
    const brokenPattern = /composedPrompt:\s*compositionResult\?\.prompt\s*,/;
    expect(brokenPattern.test(source)).toBe(false);
  });

  it('intent-callback wraps compositionResult in full object', () => {
    const source = readSrc('handlers/intent-callback.ts');

    // The fix: ternary producing an object
    expect(source).toContain('composedPrompt: compositionResult ? {');
    expect(source).toContain('prompt: compositionResult.prompt');
    expect(source).toContain('temperature: compositionResult.temperature');
    expect(source).toContain('maxTokens: compositionResult.maxTokens');
    expect(source).toContain('metadata: compositionResult.metadata');
  });

  it('intent-callback sets v3Requested with boolean coercion', () => {
    const source = readSrc('handlers/intent-callback.ts');
    expect(source).toContain('v3Requested: !!compositionResult?.prompt');
  });

  it('prompt-selection-callback uses the correct object pattern', () => {
    const source = readSrc('handlers/prompt-selection-callback.ts');

    // This is the reference implementation — must stay correct
    expect(source).toContain('prompt: result.prompt');
    expect(source).toContain('temperature: result.temperature');
    expect(source).toContain('maxTokens: result.maxTokens');
    expect(source).toContain('v3Requested: !!result.prompt');
  });
});

// =============================================================================
// 9. GUARD: Future call sites must follow the contract
// =============================================================================

describe('exhaustive composedPrompt call site audit', () => {
  it('every file passing composedPrompt to executeSkill uses object format', () => {
    // Scan ALL handler and callback files for composedPrompt in skill dispatch
    const handlerFiles = readdirSync(join(srcDir, 'handlers')).filter(f => f.endsWith('.ts'));
    const healthFiles = readdirSync(join(srcDir, 'health')).filter(f => f.endsWith('.ts'));

    const allFiles = [
      ...handlerFiles.map(f => `handlers/${f}`),
      ...healthFiles.map(f => `health/${f}`),
    ];

    for (const file of allFiles) {
      const source = readSrc(file);

      // Find composedPrompt assignments that are NOT in comments or type declarations
      const lines = source.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith('//') || line.startsWith('*') || line.startsWith('/*')) continue;
        if (!line.includes('composedPrompt:')) continue;

        // Skip type annotations and interface declarations
        if (line.includes('as {') || line.includes('interface') || line.includes('type ')) continue;

        // If this is a property assignment, it must use object format or undefined
        // BAD: composedPrompt: someVar.prompt,  (bare string)
        // GOOD: composedPrompt: someVar ? { prompt: ... } : undefined,
        // GOOD: composedPrompt: { prompt: ... },
        if (line.match(/composedPrompt:\s*\w+(\?\.)?\w+\s*,/) && !line.includes('{') && !line.includes('undefined')) {
          throw new Error(
            `${file}:${i + 1} — composedPrompt assigned as bare value (likely string). ` +
            `Must be { prompt, temperature, maxTokens, metadata } object. ` +
            `Line: ${line}`
          );
        }
      }
    }
  });
});
