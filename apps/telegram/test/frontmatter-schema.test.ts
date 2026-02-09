/**
 * Regression test suite for SKILL.md frontmatter schema contract.
 *
 * Validates:
 * - Shared parser handles valid/invalid frontmatter
 * - Windows \r\n line endings
 * - Normalization of drift patterns (triggers → trigger)
 * - Write-gate rejects missing fields, non-kebab-case
 * - All existing SKILL.md files pass validation
 * - SKILL_SCHEMA_PROMPT includes all required fields
 * - generateFrontmatter() produces valid output
 *
 * Sprint: Schema Contract Pipeline (commit 6)
 */

import { describe, it, expect } from 'bun:test';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import {
  parseSkillFrontmatter,
  extractSkillBody,
  validateSkillFrontmatter,
  generateFrontmatter,
  REQUIRED_FIELDS,
  NORMALIZATION_MAP,
  SKILL_SCHEMA_PROMPT,
} from '../src/skills/frontmatter';

// =============================================================================
// Test data
// =============================================================================

const VALID_SKILL = `---
name: test-skill
description: A test skill for validation
trigger: test, validate, check
created: 2026-02-08T00:00:00Z
---

# test-skill

A test skill for validation.
`;

const VALID_SKILL_WINDOWS = VALID_SKILL.replace(/\n/g, '\r\n');

const VALID_SKILL_WITH_OPTIONAL = `---
name: full-skill
description: Skill with all fields
trigger: test, validate
created: 2026-02-08T00:00:00Z
version: 1.2.0
tier: 1
---

# full-skill
`;

const DRIFTED_TRIGGERS_PLURAL = `---
name: drifted-skill
description: Has plural triggers
triggers: test, validate
created: 2026-02-08T00:00:00Z
---

# drifted-skill
`;

const DRIFTED_DESC_AND_TIMESTAMP = `---
name: drifted-fields
desc: Short description
trigger: test
timestamp: 2026-02-08T00:00:00Z
---

# drifted-fields
`;

const MISSING_NAME = `---
description: No name field
trigger: test
created: 2026-02-08T00:00:00Z
---
`;

const MISSING_REQUIRED = `---
name: incomplete
---
`;

const NON_KEBAB = `---
name: MySkill_v2
description: Not kebab case
trigger: test
created: 2026-02-08T00:00:00Z
---
`;

const NO_FRONTMATTER = `# Just Markdown

No frontmatter block at all.
`;

// =============================================================================
// Parser tests
// =============================================================================

describe('parseSkillFrontmatter', () => {
  it('parses valid Unix frontmatter', () => {
    const result = parseSkillFrontmatter(VALID_SKILL);
    expect(result).not.toBeNull();
    expect(result!.name).toBe('test-skill');
    expect(result!.description).toBe('A test skill for validation');
    expect(result!.trigger).toBe('test, validate, check');
    expect(result!.created).toBe('2026-02-08T00:00:00Z');
  });

  it('parses valid Windows (\\r\\n) frontmatter', () => {
    const result = parseSkillFrontmatter(VALID_SKILL_WINDOWS);
    expect(result).not.toBeNull();
    expect(result!.name).toBe('test-skill');
    expect(result!.description).toBe('A test skill for validation');
    expect(result!.trigger).toBe('test, validate, check');
    expect(result!.created).toBe('2026-02-08T00:00:00Z');
  });

  it('parses optional version and tier fields', () => {
    const result = parseSkillFrontmatter(VALID_SKILL_WITH_OPTIONAL);
    expect(result).not.toBeNull();
    expect(result!.version).toBe('1.2.0');
    expect(result!.tier).toBe('1');
  });

  it('normalizes triggers → trigger', () => {
    const result = parseSkillFrontmatter(DRIFTED_TRIGGERS_PLURAL);
    expect(result).not.toBeNull();
    expect(result!.trigger).toBe('test, validate');
  });

  it('normalizes desc → description, timestamp → created', () => {
    const result = parseSkillFrontmatter(DRIFTED_DESC_AND_TIMESTAMP);
    expect(result).not.toBeNull();
    expect(result!.description).toBe('Short description');
    expect(result!.created).toBe('2026-02-08T00:00:00Z');
  });

  it('returns null when name is missing', () => {
    const result = parseSkillFrontmatter(MISSING_NAME);
    expect(result).toBeNull();
  });

  it('returns null when no frontmatter block exists', () => {
    const result = parseSkillFrontmatter(NO_FRONTMATTER);
    expect(result).toBeNull();
  });

  it('returns empty strings for missing optional-ish fields', () => {
    const result = parseSkillFrontmatter(MISSING_REQUIRED);
    expect(result).not.toBeNull();
    expect(result!.name).toBe('incomplete');
    expect(result!.description).toBe('');
    expect(result!.trigger).toBe('');
    expect(result!.created).toBe('');
  });
});

// =============================================================================
// Body extraction tests
// =============================================================================

describe('extractSkillBody', () => {
  it('extracts body after frontmatter', () => {
    const body = extractSkillBody(VALID_SKILL);
    expect(body).toContain('# test-skill');
    expect(body).not.toContain('---');
  });

  it('extracts body with Windows line endings', () => {
    const body = extractSkillBody(VALID_SKILL_WINDOWS);
    expect(body).toContain('# test-skill');
  });

  it('returns full content when no frontmatter', () => {
    const body = extractSkillBody(NO_FRONTMATTER);
    expect(body).toContain('# Just Markdown');
  });
});

// =============================================================================
// Write-gate validation tests
// =============================================================================

describe('validateSkillFrontmatter', () => {
  it('accepts valid frontmatter', () => {
    const result = validateSkillFrontmatter(VALID_SKILL);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('accepts valid frontmatter with Windows line endings', () => {
    const result = validateSkillFrontmatter(VALID_SKILL_WINDOWS);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects triggers: (plural) explicitly', () => {
    const result = validateSkillFrontmatter(DRIFTED_TRIGGERS_PLURAL);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('triggers:'))).toBe(true);
  });

  it('rejects missing frontmatter block', () => {
    const result = validateSkillFrontmatter(NO_FRONTMATTER);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('Missing YAML frontmatter'))).toBe(true);
  });

  it('rejects missing required fields', () => {
    const result = validateSkillFrontmatter(MISSING_REQUIRED);
    expect(result.valid).toBe(false);
    // Should flag description, trigger, created as missing
    expect(result.errors.some(e => e.includes('description'))).toBe(true);
    expect(result.errors.some(e => e.includes('trigger'))).toBe(true);
    expect(result.errors.some(e => e.includes('created'))).toBe(true);
  });

  it('rejects non-kebab-case names', () => {
    const result = validateSkillFrontmatter(NON_KEBAB);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('kebab-case'))).toBe(true);
  });

  it('includes schema prompt in error messages', () => {
    const result = validateSkillFrontmatter(MISSING_REQUIRED);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('SKILL.md Canonical Frontmatter Schema'))).toBe(true);
  });
});

// =============================================================================
// Generator tests
// =============================================================================

describe('generateFrontmatter', () => {
  it('produces valid frontmatter that passes validation', () => {
    const fm = generateFrontmatter({
      name: 'generated-skill',
      description: 'Auto-generated skill',
      trigger: 'gen, auto',
      created: '2026-02-08T00:00:00Z',
    });

    const fullContent = `${fm}\n\n# generated-skill\n`;
    const validation = validateSkillFrontmatter(fullContent);
    expect(validation.valid).toBe(true);
  });

  it('includes optional fields when provided', () => {
    const fm = generateFrontmatter({
      name: 'versioned',
      description: 'Has version and tier',
      trigger: 'test',
      created: '2026-02-08T00:00:00Z',
      version: '2.0.0',
      tier: '1',
    });

    expect(fm).toContain('version: 2.0.0');
    expect(fm).toContain('tier: 1');
  });

  it('omits optional fields when not provided', () => {
    const fm = generateFrontmatter({
      name: 'minimal',
      description: 'Minimal skill',
      trigger: 'test',
      created: '2026-02-08T00:00:00Z',
    });

    expect(fm).not.toContain('version:');
    expect(fm).not.toContain('tier:');
  });
});

// =============================================================================
// Schema prompt completeness
// =============================================================================

describe('SKILL_SCHEMA_PROMPT', () => {
  it('mentions all required fields', () => {
    for (const field of REQUIRED_FIELDS) {
      expect(SKILL_SCHEMA_PROMPT).toContain(field);
    }
  });

  it('mentions singular trigger: rule', () => {
    expect(SKILL_SCHEMA_PROMPT).toContain('trigger:');
    expect(SKILL_SCHEMA_PROMPT).toContain('SINGULAR');
  });

  it('warns against triggers: (plural)', () => {
    expect(SKILL_SCHEMA_PROMPT).toMatch(/Never.*triggers:/i);
  });

  it('mentions kebab-case requirement', () => {
    expect(SKILL_SCHEMA_PROMPT).toContain('kebab-case');
  });
});

// =============================================================================
// Normalization map coverage
// =============================================================================

describe('NORMALIZATION_MAP', () => {
  it('maps triggers → trigger', () => {
    expect(NORMALIZATION_MAP['triggers']).toBe('trigger');
  });

  it('maps desc → description', () => {
    expect(NORMALIZATION_MAP['desc']).toBe('description');
  });

  it('maps timestamp → created', () => {
    expect(NORMALIZATION_MAP['timestamp']).toBe('created');
  });

  it('maps date → created', () => {
    expect(NORMALIZATION_MAP['date']).toBe('created');
  });
});

// =============================================================================
// Live SKILL.md file validation (regression guard)
// =============================================================================

describe('existing SKILL.md files pass validation', () => {
  const skillsDir = join(__dirname, '..', 'data', 'skills');

  // Only run if skills directory exists
  if (existsSync(skillsDir)) {
    const entries = readdirSync(skillsDir, { withFileTypes: true });
    const skillDirs = entries.filter(e => e.isDirectory());

    // Only test directories that actually contain SKILL.md (some use YAML)
    const dirsWithSkillMd = skillDirs.filter(dir =>
      existsSync(join(skillsDir, dir.name, 'SKILL.md'))
    );

    it('has at least one SKILL.md to validate', () => {
      expect(dirsWithSkillMd.length).toBeGreaterThan(0);
    });

    for (const dir of dirsWithSkillMd) {
      const skillPath = join(skillsDir, dir.name, 'SKILL.md');

      it(`${dir.name}/SKILL.md parses successfully`, () => {
        const content = readFileSync(skillPath, 'utf-8');
        const parsed = parseSkillFrontmatter(content);
        expect(parsed).not.toBeNull();
        expect(parsed!.name).toBeTruthy();
      });

      it(`${dir.name}/SKILL.md passes write-gate validation`, () => {
        const content = readFileSync(skillPath, 'utf-8');
        const validation = validateSkillFrontmatter(content);
        expect(validation.valid).toBe(true);
        expect(validation.errors).toHaveLength(0);
      });
    }
  }
});
