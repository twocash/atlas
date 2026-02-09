/**
 * Atlas Skill System — Canonical SKILL.md Frontmatter Schema
 *
 * Single source of truth for SKILL.md frontmatter format.
 * All parsers, writers, and prompts import from this file.
 *
 * @see Notion: P0 Bug: SKILL.md Frontmatter Schema Drift
 */

// =============================================================================
// CANONICAL SCHEMA
// =============================================================================

/**
 * Canonical SKILL.md frontmatter fields.
 *
 * ```yaml
 * ---
 * name: kebab-case-name           # required, must match directory name
 * description: one-line summary   # required
 * trigger: comma, separated, phrases  # required, SINGULAR flat string
 * created: ISO-8601 timestamp     # required
 * version: semver                 # optional
 * tier: 0|1|2                     # optional
 * ---
 * ```
 */
export interface SkillFrontmatter {
  name: string;
  description: string;
  trigger: string;
  created: string;
  version?: string;
  tier?: string;
}

/** Fields that MUST be present in every SKILL.md frontmatter block. */
export const REQUIRED_FIELDS: readonly (keyof SkillFrontmatter)[] = [
  'name',
  'description',
  'trigger',
  'created',
] as const;

/**
 * Known drift patterns → canonical field name.
 * Applied during parsing to silently normalize common mistakes.
 */
export const NORMALIZATION_MAP: Readonly<Record<string, keyof SkillFrontmatter>> = {
  triggers: 'trigger',
  desc: 'description',
  timestamp: 'created',
  date: 'created',
};

/**
 * Injectable schema prompt for swarm agents and skill-authoring prompts.
 * Paste this into any prompt where an agent writes SKILL.md files.
 */
export const SKILL_SCHEMA_PROMPT = `
SKILL.md Canonical Frontmatter Schema
======================================
Every SKILL.md MUST begin with a YAML frontmatter block in exactly this format:

\`\`\`yaml
---
name: kebab-case-name           # required — must match the directory name
description: one-line summary   # required — what the skill does
trigger: comma, separated, phrases  # required — SINGULAR key, flat string (NOT triggers:)
created: 2026-01-15T00:00:00Z  # required — ISO-8601 timestamp
version: 1.0.0                  # optional — semver
tier: 0                         # optional — 0, 1, or 2
---
\`\`\`

Rules:
- Use \`trigger:\` (SINGULAR). Never \`triggers:\` (plural).
- \`name\` must be kebab-case (lowercase, hyphens, digits only).
- \`trigger\` is a flat comma-separated string, NOT a YAML array.
- \`created\` must be a valid ISO-8601 date or datetime.
- Do NOT add fields not listed above.
- Do NOT delete existing fields.
`.trim();

// =============================================================================
// SHARED PARSER
// =============================================================================

/**
 * Parse SKILL.md frontmatter from raw file content.
 *
 * Handles both `\r\n` (Windows) and `\n` (Unix) line endings.
 * Normalizes known drift patterns (e.g. `triggers:` → `trigger:`).
 *
 * @returns Parsed frontmatter or null if missing/malformed.
 */
export function parseSkillFrontmatter(content: string): SkillFrontmatter | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;

  const raw = match[1];
  const fields: Record<string, string> = {};

  for (const line of raw.split(/\r?\n/)) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;

    let key = line.slice(0, colonIdx).trim().toLowerCase();
    const value = line.slice(colonIdx + 1).trim();

    // Normalize known drift keys
    if (key in NORMALIZATION_MAP) {
      key = NORMALIZATION_MAP[key];
    }

    fields[key] = value;
  }

  // Must have at least name to be considered valid frontmatter
  if (!fields.name) return null;

  return {
    name: fields.name,
    description: fields.description || '',
    trigger: fields.trigger || '',
    created: fields.created || '',
    version: fields.version,
    tier: fields.tier,
  };
}

/**
 * Extract the markdown body (everything after frontmatter).
 */
export function extractSkillBody(content: string): string {
  const match = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  if (!match) return content;
  return content.slice(match[0].length).trim();
}

// =============================================================================
// WRITE-GATE VALIDATION
// =============================================================================

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate SKILL.md content before writing.
 *
 * Rejects:
 * - Missing frontmatter block
 * - `triggers:` (plural) — must be `trigger:` (singular)
 * - Missing required fields
 * - Non-kebab-case names
 *
 * Error messages include the full valid schema so agents can self-correct.
 */
export function validateSkillFrontmatter(content: string): ValidationResult {
  const errors: string[] = [];

  // Check for frontmatter block existence
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fmMatch) {
    errors.push(
      'Missing YAML frontmatter block (must start with --- and end with ---).\n' +
      SKILL_SCHEMA_PROMPT,
    );
    return { valid: false, errors };
  }

  const rawBlock = fmMatch[1];

  // Reject `triggers:` (plural) explicitly
  if (/^triggers\s*:/m.test(rawBlock)) {
    errors.push(
      'Found `triggers:` (plural). Must be `trigger:` (singular flat string).',
    );
  }

  // Parse and check required fields
  const parsed = parseSkillFrontmatter(content);
  if (!parsed) {
    errors.push('Frontmatter block could not be parsed.');
    return { valid: false, errors };
  }

  for (const field of REQUIRED_FIELDS) {
    if (!parsed[field]) {
      errors.push(`Missing required field: \`${field}\`.`);
    }
  }

  // Validate kebab-case name
  if (parsed.name && !/^[a-z0-9][a-z0-9-]*$/.test(parsed.name)) {
    errors.push(
      `Name "${parsed.name}" is not kebab-case (must be lowercase letters, digits, hyphens).`,
    );
  }

  if (errors.length > 0) {
    errors.push('\nExpected schema:\n' + SKILL_SCHEMA_PROMPT);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Generate a SKILL.md frontmatter block from structured data.
 * Used by `create_skill` and other writers to produce canonical output.
 */
export function generateFrontmatter(fm: SkillFrontmatter): string {
  let block = '---\n';
  block += `name: ${fm.name}\n`;
  block += `description: ${fm.description}\n`;
  block += `trigger: ${fm.trigger}\n`;
  block += `created: ${fm.created}\n`;
  if (fm.version) block += `version: ${fm.version}\n`;
  if (fm.tier) block += `tier: ${fm.tier}\n`;
  block += '---';
  return block;
}
