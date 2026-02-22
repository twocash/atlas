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
   * @default true (disable with ATLAS_SKILL_LOGGING=false)
   */
  skillLogging: boolean;

  /**
   * Phase 2: Skill Execution
   * When enabled, executes matched skills from the registry.
   * Requires skillLogging to be effective.
   * @default true (disable with ATLAS_SKILL_EXECUTION=false)
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
   * @default true (disable with ATLAS_ZONE_CLASSIFIER=false)
   */
  zoneClassifier: boolean;

  /**
   * Swarm Dispatch
   * When enabled, spawns Claude Code sessions for autonomous skill repairs.
   * Only triggers for Zone 1/2 operations when zone classifier is also enabled.
   * @default true (disable with ATLAS_SWARM_DISPATCH=false)
   */
  swarmDispatch: boolean;

  /**
   * Self-Improvement Listener
   * When enabled, polls Feed 2.0 for entries tagged "self-improvement"
   * and auto-dispatches to pit crew for Zone 1/2 operations.
   * @default true (disable with ATLAS_SELF_IMPROVEMENT_LISTENER=false)
   */
  selfImprovementListener: boolean;

  /**
   * API Swarm Dispatch
   * When enabled, uses Anthropic SDK directly instead of spawning
   * Claude Code CLI for autonomous repairs. Bypasses CLI overhead
   * (MCP servers, session init) for faster execution.
   * @default true (disable with ATLAS_API_SWARM=false)
   */
  apiSwarmDispatch: boolean;

  /**
   * Health Alert Producer
   * When enabled, runs periodic health checks and emits Alert entries
   * to Feed 2.0. Zone 1/2 issues also get 'self-improvement' keyword
   * for autonomous repair pipeline. Zone 3 issues get Alert cards only.
   * @default true (disable with ATLAS_HEALTH_ALERT_PRODUCER=false)
   */
  healthAlertProducer: boolean;

  /**
   * Approval Producer (P2)
   * When enabled, Tier 2 skill execution requests create Approval cards
   * in Feed 2.0 instead of executing immediately. FAIL-CLOSED: if card
   * creation fails, the skill does NOT execute.
   * @default true (disable with ATLAS_APPROVAL_PRODUCER=false)
   */
  approvalProducer: boolean;

  /**
   * Review Producer (P3)
   * When enabled, completed research creates Review cards in Feed 2.0
   * for human Accept/Revise/Reject disposition. FAIL-OPEN: if card
   * creation fails, the research still delivers to Work Queue.
   * @default true (disable with ATLAS_REVIEW_PRODUCER=false)
   */
  reviewProducer: boolean;

  // === Triage Intelligence (Sprint: Triage Intelligence) ===

  /**
   * Triage Skill
   * When enabled, uses unified Haiku triage call for intent detection,
   * smart title generation, classification, and complexity tier routing.
   * Replaces multi-step capture pipeline with single API call.
   * @default true (core feature - disable with ATLAS_TRIAGE_SKILL=false)
   * @deprecated Always-on since handler.ts TECH DEBT refactor (2026-02-09).
   * Inline classification code removed — triage is the only classification path.
   * Flag retained temporarily; remove in future cleanup pass.
   */
  triageSkill: boolean;

  /**
   * Low Confidence Fallback to Capture (Bug #3 Fix)
   * When enabled, ambiguous intents with confidence < 50% are captured
   * with reclassify option instead of asking for clarification.
   * Philosophy: "capture is always safe, asking always adds friction"
   * @default true (core feature - disable with ATLAS_LOW_CONFIDENCE_CAPTURE=false)
   */
  lowConfidenceFallbackToCapture: boolean;

  /**
   * Multi-Intent Parsing (Bug #6 Fix)
   * When enabled, triage detects compound messages with multiple intents
   * (e.g., "Save this article and remind me tomorrow") and processes each.
   * @default true (core feature - disable with ATLAS_MULTI_INTENT=false)
   */
  multiIntentParsing: boolean;

  // === Bug Fixes ===

  /**
   * Pending Selection Context (Bug #2 Fix)
   * When enabled, detects follow-up context messages when a user has a
   * pending content selection. Prevents "I don't see content" false negatives
   * when user sends URL then context in separate messages.
   * @default true (safe - only adds graceful acknowledgment)
   */
  pendingSelectionContext: boolean;

  /**
   * Duplicate Confirmation Guard (Bug #1 Fix)
   * When enabled, tracks sent confirmations by message ID to prevent
   * duplicate confirmation keyboards from being sent for the same message.
   * Race conditions in URL/media detection can trigger multiple paths.
   * @default true (core fix - disable with ATLAS_DUPLICATE_CONFIRMATION_GUARD=false)
   */
  duplicateConfirmationGuard: boolean;

  /**
   * Vehicle Pillar Routing (Bug #4 Fix)
   * When enabled, vehicle-related content (cars, auctions, Bring a Trailer)
   * is explicitly routed to Home/Garage pillar instead of Personal.
   * Applied via enhanced triage system prompt with pillar classification rules.
   * @default true (core fix - disable with ATLAS_VEHICLE_PILLAR_ROUTING=false)
   */
  vehiclePillarRouting: boolean;

  /**
   * Research Error Sanitization (Bug #5 Fix)
   * When enabled, raw API errors from research/grounding calls are
   * sanitized before being returned to the user. Replaces technical
   * error messages with user-friendly fallback text.
   * @default true (core fix - disable with ATLAS_RESEARCH_ERROR_SANITIZATION=false)
   */
  researchErrorSanitization: boolean;

  // === ADR-001 Compliance ===

  /**
   * Content Sources from Notion (ADR-001 Compliance)
   * When enabled, reads content source detection rules (domain patterns,
   * extraction methods, browser requirements, Jina defaults) from the
   * Content Sources Notion database instead of hardcoded constants.
   * Falls back to hardcoded FALLBACK constants when Notion is unreachable.
   * @default false (opt-in - enable with ATLAS_CONTENT_SOURCES_NOTION=true)
   */
  contentSourcesNotion: boolean;
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
    skillLogging: process.env.ATLAS_SKILL_LOGGING !== 'false',
    skillExecution: process.env.ATLAS_SKILL_EXECUTION !== 'false',
    skillHotReload: process.env.ATLAS_SKILL_HOT_RELOAD === 'true',
    patternDetection: process.env.ATLAS_PATTERN_DETECTION === 'true',
    autoDeployTier0: process.env.ATLAS_AUTO_DEPLOY_TIER0 === 'true',
    skillComposition: process.env.ATLAS_SKILL_COMPOSITION === 'true',
    // Autonomous Repair (Sprint: Pit Stop) - Default ON, env vars are kill switches
    zoneClassifier: process.env.ATLAS_ZONE_CLASSIFIER !== 'false',
    swarmDispatch: process.env.ATLAS_SWARM_DISPATCH !== 'false',
    selfImprovementListener: process.env.ATLAS_SELF_IMPROVEMENT_LISTENER !== 'false',
    apiSwarmDispatch: process.env.ATLAS_API_SWARM !== 'false',
    healthAlertProducer: process.env.ATLAS_HEALTH_ALERT_PRODUCER !== 'false',
    approvalProducer: process.env.ATLAS_APPROVAL_PRODUCER !== 'false',
    reviewProducer: process.env.ATLAS_REVIEW_PRODUCER !== 'false',
    // Triage Intelligence (Sprint: Triage Intelligence) - Core features, default ON
    triageSkill: process.env.ATLAS_TRIAGE_SKILL !== 'false', // Default ON
    lowConfidenceFallbackToCapture: process.env.ATLAS_LOW_CONFIDENCE_CAPTURE !== 'false', // Default ON
    multiIntentParsing: process.env.ATLAS_MULTI_INTENT !== 'false', // Default ON
    // Bug Fixes - Core fixes, default ON
    pendingSelectionContext: process.env.ATLAS_PENDING_SELECTION_CONTEXT !== 'false', // Default ON
    duplicateConfirmationGuard: process.env.ATLAS_DUPLICATE_CONFIRMATION_GUARD !== 'false', // Default ON
    vehiclePillarRouting: process.env.ATLAS_VEHICLE_PILLAR_ROUTING !== 'false', // Default ON
    researchErrorSanitization: process.env.ATLAS_RESEARCH_ERROR_SANITIZATION !== 'false', // Default ON
    // ADR-001 Compliance — opt-in (requires explicit enable)
    contentSourcesNotion: process.env.ATLAS_CONTENT_SOURCES_NOTION === 'true', // Default OFF
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
    maxSwarmDispatchesPerHour: parseInt(process.env.ATLAS_SWARM_MAX_PER_HOUR || '5', 10),
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
