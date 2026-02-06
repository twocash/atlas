/**
 * Atlas Skill System - Feature Flags
 *
 * Controls gradual rollout of skill-centric architecture features.
 * Each phase has independent toggles for safe deployment.
 *
 * Toggle via environment variables. All flags default to safe (disabled)
 * except where explicitly noted.
 */

import { logger } from '../logger';

/**
 * Feature flag configuration
 */
export interface FeatureFlags {
  /**
   * Phase 1: Action Logging
   * When enabled, logs all Atlas actions to Feed 2.0 with intent hashes
   * for pattern detection.
   * @default false
   */
  skillLogging: boolean;

  /**
   * Phase 2: Skill Execution
   * When enabled, executes matched skills from the registry.
   * Requires skillLogging to be effective.
   * @default false
   */
  skillExecution: boolean;

  /**
   * Phase 2: Hot Reload
   * When enabled, watches skill files for changes and reloads automatically.
   * @default false
   */
  skillHotReload: boolean;

  /**
   * Phase 3: Pattern Detection
   * When enabled, auto-proposes skills based on detected patterns.
   * @default false
   */
  patternDetection: boolean;

  /**
   * Phase 3: Auto-deploy Tier 0
   * When enabled, Tier 0 (read-only) skills deploy without approval.
   * @default false
   */
  autoDeployTier0: boolean;

  /**
   * Phase 4: Skill Composition
   * When enabled, skills can invoke other skills.
   * @default false
   */
  skillComposition: boolean;

  // === Autonomous Repair (Sprint: Pit Stop) ===

  /**
   * Zone Classifier
   * When enabled, routes pit crew operations through zone-based permissions
   * (auto-execute, auto-notify, approve) instead of always requiring approval.
   * @default false
   */
  zoneClassifier: boolean;

  /**
   * Swarm Dispatch
   * When enabled, spawns Claude Code sessions for autonomous skill repairs.
   * Only triggers for Zone 1/2 operations when zone classifier is also enabled.
   * @default false
   */
  swarmDispatch: boolean;

  /**
   * Self-Improvement Listener
   * When enabled, polls Feed 2.0 for entries tagged "self-improvement"
   * and auto-dispatches to pit crew for Zone 1/2 operations.
   * @default false
   */
  selfImprovementListener: boolean;

  /**
   * API Swarm Dispatch
   * When enabled, uses Anthropic SDK directly instead of spawning
   * Claude Code CLI for autonomous repairs. Bypasses CLI overhead
   * (MCP servers, session init) for faster execution.
   * @default false
   */
  apiSwarmDispatch: boolean;
}

/**
 * Detection parameters for pattern matching
 */
export interface DetectionConfig {
  /**
   * Time window for pattern detection (days)
   * @default 14
   */
  windowDays: number;

  /**
   * Minimum occurrences to trigger skill proposal
   * @default 5
   */
  minFrequency: number;

  /**
   * Cooldown period before re-proposing rejected patterns (hours)
   * @default 24
   */
  cooldownHours: number;
}

/**
 * Safety limits for skill system
 */
export interface SafetyLimits {
  /**
   * Maximum skills that can be created per week
   * @default 5
   */
  maxSkillsPerWeek: number;

  /**
   * Maximum Tier 2 skills per week
   * @default 1
   */
  maxTier2PerWeek: number;

  /**
   * Auto-disable skill after this many consecutive errors
   * @default 3
   */
  autoDisableOnErrors: number;

  /**
   * Time window to rollback a skill after deployment (hours)
   * @default 24
   */
  rollbackWindowHours: number;

  // === Autonomous Repair (Sprint: Pit Stop) ===

  /**
   * Maximum swarm dispatches allowed per hour
   * Prevents runaway autonomous repair loops
   * @default 5
   */
  maxSwarmDispatchesPerHour: number;

  /**
   * Timeout for swarm fix sessions (seconds)
   * Claude Code sessions are terminated after this duration.
   * With --max-turns 10 and focused prompts, 600s should be sufficient.
   * @default 600 (10 minutes)
   */
  swarmTimeoutSeconds: number;

  /**
   * Polling interval for self-improvement listener (milliseconds)
   * How often to check Feed 2.0 for new self-improvement entries
   * @default 60000 (60 seconds)
   */
  selfImprovementPollIntervalMs: number;
}

/**
 * Load feature flags from environment
 */
function loadFeatureFlags(): FeatureFlags {
  return {
    skillLogging: process.env.ATLAS_SKILL_LOGGING === 'true',
    skillExecution: process.env.ATLAS_SKILL_EXECUTION === 'true',
    skillHotReload: process.env.ATLAS_SKILL_HOT_RELOAD === 'true',
    patternDetection: process.env.ATLAS_PATTERN_DETECTION === 'true',
    autoDeployTier0: process.env.ATLAS_AUTO_DEPLOY_TIER0 === 'true',
    skillComposition: process.env.ATLAS_SKILL_COMPOSITION === 'true',
    // Autonomous Repair (Sprint: Pit Stop)
    zoneClassifier: process.env.ATLAS_ZONE_CLASSIFIER === 'true',
    swarmDispatch: process.env.ATLAS_SWARM_DISPATCH === 'true',
    selfImprovementListener: process.env.ATLAS_SELF_IMPROVEMENT_LISTENER === 'true',
    apiSwarmDispatch: process.env.ATLAS_API_SWARM === 'true',
  };
}

/**
 * Load detection configuration from environment
 */
function loadDetectionConfig(): DetectionConfig {
  return {
    windowDays: parseInt(process.env.ATLAS_PATTERN_WINDOW_DAYS || '14', 10),
    minFrequency: parseInt(process.env.ATLAS_PATTERN_MIN_FREQUENCY || '5', 10),
    cooldownHours: parseInt(process.env.ATLAS_PATTERN_COOLDOWN_HOURS || '24', 10),
  };
}

/**
 * Load safety limits from environment
 */
function loadSafetyLimits(): SafetyLimits {
  return {
    maxSkillsPerWeek: parseInt(process.env.ATLAS_SKILL_MAX_WEEKLY || '5', 10),
    maxTier2PerWeek: parseInt(process.env.ATLAS_SKILL_MAX_TIER2_WEEKLY || '1', 10),
    autoDisableOnErrors: parseInt(process.env.ATLAS_SKILL_AUTO_DISABLE_ERRORS || '3', 10),
    rollbackWindowHours: parseInt(process.env.ATLAS_SKILL_ROLLBACK_HOURS || '24', 10),
    // Autonomous Repair (Sprint: Pit Stop)
    maxSwarmDispatchesPerHour: parseInt(process.env.ATLAS_SWARM_MAX_PER_HOUR || '15', 10), // Bumped from 5 for testing
    swarmTimeoutSeconds: parseInt(process.env.ATLAS_SWARM_TIMEOUT_SECONDS || '300', 10), // 5 min - CLI startup is slow
    selfImprovementPollIntervalMs: parseInt(process.env.ATLAS_SELF_IMPROVEMENT_POLL_MS || '60000', 10),
  };
}

// Singleton instances - lazy loaded
let _features: FeatureFlags | null = null;
let _detection: DetectionConfig | null = null;
let _safety: SafetyLimits | null = null;

/**
 * Get feature flags (singleton)
 */
export function getFeatureFlags(): FeatureFlags {
  if (!_features) {
    _features = loadFeatureFlags();
    logger.info('Feature flags loaded', { features: _features });
  }
  return _features;
}

/**
 * Get detection configuration (singleton)
 */
export function getDetectionConfig(): DetectionConfig {
  if (!_detection) {
    _detection = loadDetectionConfig();
  }
  return _detection;
}

/**
 * Get safety limits (singleton)
 */
export function getSafetyLimits(): SafetyLimits {
  if (!_safety) {
    _safety = loadSafetyLimits();
  }
  return _safety;
}

/**
 * Check if a specific feature is enabled
 */
export function isFeatureEnabled(feature: keyof FeatureFlags): boolean {
  return getFeatureFlags()[feature];
}

/**
 * Reload all configuration (for testing or hot-reload scenarios)
 */
export function reloadConfig(): void {
  _features = null;
  _detection = null;
  _safety = null;
  logger.info('Feature configuration reloaded');
}

/**
 * Get a summary of enabled features (for logging/debugging)
 */
export function getEnabledFeaturesSummary(): string {
  const flags = getFeatureFlags();
  const enabled = Object.entries(flags)
    .filter(([_, value]) => value)
    .map(([key]) => key);

  if (enabled.length === 0) {
    return 'No skill features enabled';
  }

  return `Enabled: ${enabled.join(', ')}`;
}
