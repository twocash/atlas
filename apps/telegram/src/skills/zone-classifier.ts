/**
 * Zone Classifier — Maps pit crew operations to permission zones.
 *
 * Three permission zones for autonomous repair:
 *   Zone 1 (auto-execute): Skill-only file changes, Tier 0, no notification
 *   Zone 2 (auto-notify): Tier 1 skills, known-safe code, notify after
 *   Zone 3 (approve): Everything else, human must approve first
 *
 * Design principle: ALLOWLIST for Zone 1/2. Everything unknown = Zone 3.
 * This means new operation types are safe by default (they require approval).
 *
 * Sprint: Pit Stop (Autonomous Skill Repair)
 */

import { logger } from '../logger';

// ==========================================
// Types
// ==========================================

/**
 * Permission zone for pit crew operations
 */
export type PermissionZone = 'auto-execute' | 'auto-notify' | 'approve';

/**
 * Skill tier classification
 * - Tier 0: Read-only operations (safest)
 * - Tier 1: Creates/modifies Notion entries
 * - Tier 2: External API calls, webhooks, etc. (most dangerous)
 */
export type SkillTier = 0 | 1 | 2;

/**
 * Types of pit crew operations
 */
export type OperationType =
  | 'skill-create'     // Creating a new skill
  | 'skill-edit'       // Editing existing skill
  | 'skill-delete'     // Deleting a skill
  | 'code-fix'         // Bug fix in code
  | 'config-change'    // Configuration file change
  | 'restart'          // Service restart
  | 'dependency-add'   // Adding npm/bun dependency
  | 'schema-change';   // Database schema change

/**
 * Pit crew operation descriptor
 */
export interface PitCrewOperation {
  /** Type of operation */
  type: OperationType;

  /** Skill tier (0 = safest, 2 = most dangerous) */
  tier: SkillTier;

  /** Files that will be modified */
  targetFiles: string[];

  /** Whether operation touches core routing files */
  touchesCore: boolean;

  /** Whether operation touches auth/credentials */
  touchesAuth: boolean;

  /** Whether operation touches external API configs */
  touchesExternal: boolean;

  /** Human-readable description of the operation */
  description: string;

  /** Optional: skill name if this is a skill operation */
  skillName?: string;

  /** Optional: error/issue context that triggered this operation */
  context?: string;
}

/**
 * Classification result with reasoning
 */
export interface ZoneClassification {
  zone: PermissionZone;
  reason: string;
  ruleApplied: string;
}

// ==========================================
// Core Files (ALWAYS require approval)
// ==========================================

/**
 * Core routing and handler files that ALWAYS require human approval
 * These files can break the entire bot if modified incorrectly
 */
const CORE_FILES = [
  'src/index.ts',
  'src/bot.ts',
  'src/handler.ts',
  'src/handlers/chat.ts',
  'src/supervisor/',
  'supervisor.ts',
];

/**
 * Auth and credential files that ALWAYS require human approval
 */
const AUTH_FILES = [
  '.env',
  '.env.local',
  '.env.production',
  'credentials',
  'secrets',
  'api-key',
  'token',
];

/**
 * External API configuration files
 */
const EXTERNAL_CONFIG_FILES = [
  'webhook',
  'api-config',
  'external-',
];

// ==========================================
// Safe Directories (Zone 1/2 eligible)
// ==========================================

/**
 * Directories where Zone 1 (auto-execute) is allowed
 * Only skill definition files in these directories
 */
const ZONE_1_DIRECTORIES = [
  'data/skills/',
  'data/pit-crew/',
];

/**
 * Directories where Zone 2 (auto-notify) is allowed
 * Includes skill code and safe configuration
 */
const ZONE_2_DIRECTORIES = [
  'data/skills/',
  'data/pit-crew/',
  'src/skills/',
];

// ==========================================
// Classification Logic
// ==========================================

/**
 * Check if a file path matches any pattern in the list
 */
function matchesPattern(filePath: string, patterns: string[]): boolean {
  const normalizedPath = filePath.replace(/\\/g, '/').toLowerCase();
  return patterns.some(pattern => {
    const normalizedPattern = pattern.toLowerCase();
    return normalizedPath.includes(normalizedPattern);
  });
}

/**
 * Check if all files are within allowed directories
 * Returns false if files array is empty (no files = no safe classification)
 */
function allFilesInDirectories(files: string[], directories: string[]): boolean {
  if (files.length === 0) {
    return false; // Empty file list cannot be verified as safe
  }
  return files.every(file => {
    const normalizedFile = file.replace(/\\/g, '/').toLowerCase();
    return directories.some(dir => normalizedFile.startsWith(dir.toLowerCase()));
  });
}

/**
 * Detect if operation touches core files based on file paths
 */
export function detectTouchesCore(targetFiles: string[]): boolean {
  return targetFiles.some(file => matchesPattern(file, CORE_FILES));
}

/**
 * Detect if operation touches auth files based on file paths
 */
export function detectTouchesAuth(targetFiles: string[]): boolean {
  return targetFiles.some(file => matchesPattern(file, AUTH_FILES));
}

/**
 * Detect if operation touches external config based on file paths
 */
export function detectTouchesExternal(targetFiles: string[]): boolean {
  return targetFiles.some(file => matchesPattern(file, EXTERNAL_CONFIG_FILES));
}

/**
 * Classify a pit crew operation into a permission zone.
 *
 * Classification rules (in order of precedence):
 *
 * RULE 1: Core/Auth/External → ALWAYS approve
 * RULE 2: Schema changes, dependency additions → ALWAYS approve
 * RULE 3: Tier 2 skills → ALWAYS approve
 * RULE 4: Files outside safe directories → approve or auto-notify based on tier
 * RULE 5: Tier 0 skill operations in data/skills/ → auto-execute
 * RULE 6: Tier 1 skill operations in data/skills/ → auto-notify
 * RULE 7: Skill deletion → auto-notify (minimum)
 * DEFAULT: When in doubt → approve
 */
export function classifyZone(operation: PitCrewOperation): ZoneClassification {
  const { type, tier, targetFiles, touchesCore, touchesAuth, touchesExternal } = operation;

  // RULE 1: Anything touching core routing, auth, or external = ALWAYS approve
  if (touchesCore || detectTouchesCore(targetFiles)) {
    return {
      zone: 'approve',
      reason: 'Operation touches core routing files',
      ruleApplied: 'RULE_1_CORE',
    };
  }

  if (touchesAuth || detectTouchesAuth(targetFiles)) {
    return {
      zone: 'approve',
      reason: 'Operation touches authentication or credentials',
      ruleApplied: 'RULE_1_AUTH',
    };
  }

  if (touchesExternal || detectTouchesExternal(targetFiles)) {
    return {
      zone: 'approve',
      reason: 'Operation touches external API configuration',
      ruleApplied: 'RULE_1_EXTERNAL',
    };
  }

  // RULE 2: Schema changes and dependency additions = ALWAYS approve
  if (type === 'schema-change') {
    return {
      zone: 'approve',
      reason: 'Schema changes require human review',
      ruleApplied: 'RULE_2_SCHEMA',
    };
  }

  if (type === 'dependency-add') {
    return {
      zone: 'approve',
      reason: 'Dependency additions require human review',
      ruleApplied: 'RULE_2_DEPENDENCY',
    };
  }

  // RULE 3: Tier 2 skills = ALWAYS approve
  if (tier === 2) {
    return {
      zone: 'approve',
      reason: 'Tier 2 skills (external API access) require human approval',
      ruleApplied: 'RULE_3_TIER2',
    };
  }

  // RULE 4: Check if files are within allowed directories
  const inZone1Dirs = allFilesInDirectories(targetFiles, ZONE_1_DIRECTORIES);
  const inZone2Dirs = allFilesInDirectories(targetFiles, ZONE_2_DIRECTORIES);

  if (!inZone2Dirs) {
    // Files outside safe directories
    return {
      zone: 'approve',
      reason: 'Operation targets files outside safe directories',
      ruleApplied: 'RULE_4_OUTSIDE_SAFE',
    };
  }

  // RULE 5: Tier 0 skill operations in data/skills/ = auto-execute
  if (tier === 0 && inZone1Dirs && (type === 'skill-create' || type === 'skill-edit')) {
    return {
      zone: 'auto-execute',
      reason: 'Tier 0 skill operation in safe directory',
      ruleApplied: 'RULE_5_TIER0_SKILL',
    };
  }

  // RULE 6: Tier 1 skill operations in data/skills/ or src/skills/ = auto-notify
  if (tier === 1 && (type === 'skill-create' || type === 'skill-edit' || type === 'code-fix')) {
    return {
      zone: 'auto-notify',
      reason: 'Tier 1 operation in safe directory - will notify after execution',
      ruleApplied: 'RULE_6_TIER1_SAFE',
    };
  }

  // RULE 7: Skill deletion always requires notification at minimum
  if (type === 'skill-delete') {
    return {
      zone: 'auto-notify',
      reason: 'Skill deletion requires notification',
      ruleApplied: 'RULE_7_SKILL_DELETE',
    };
  }

  // RULE 8: Config changes in safe directories = auto-notify
  if (type === 'config-change' && tier <= 1 && inZone2Dirs) {
    return {
      zone: 'auto-notify',
      reason: 'Configuration change in safe directory',
      ruleApplied: 'RULE_8_CONFIG_SAFE',
    };
  }

  // DEFAULT: When in doubt, require approval
  logger.info('Zone classifier defaulting to approve', {
    operation: type,
    tier,
    targetFiles,
    reason: 'No specific rule matched',
  });

  return {
    zone: 'approve',
    reason: 'No specific rule matched - defaulting to human approval',
    ruleApplied: 'DEFAULT_APPROVE',
  };
}

/**
 * Helper to create a PitCrewOperation from partial data
 * Automatically detects core/auth/external based on file paths
 */
export function createOperation(
  partial: Omit<PitCrewOperation, 'touchesCore' | 'touchesAuth' | 'touchesExternal'>
): PitCrewOperation {
  return {
    ...partial,
    touchesCore: detectTouchesCore(partial.targetFiles),
    touchesAuth: detectTouchesAuth(partial.targetFiles),
    touchesExternal: detectTouchesExternal(partial.targetFiles),
  };
}

/**
 * Get human-readable zone description
 */
export function getZoneDescription(zone: PermissionZone): string {
  switch (zone) {
    case 'auto-execute':
      return 'Zone 1 (Auto-Execute): Deploys immediately without notification';
    case 'auto-notify':
      return 'Zone 2 (Auto-Notify): Deploys and sends Telegram notification';
    case 'approve':
      return 'Zone 3 (Approve): Requires human approval via Telegram';
  }
}
