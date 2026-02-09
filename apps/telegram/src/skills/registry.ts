/**
 * Atlas Skill System - Registry
 *
 * Phase 2: Loads skills from YAML/Markdown, provides trigger matching.
 * Supports hot-reload when ATLAS_SKILL_HOT_RELOAD=true.
 */

import { readdir, readFile } from 'fs/promises';
import { watch } from 'fs';
import { join, basename, extname } from 'path';
import { parse as parseYaml } from 'yaml';
import { logger } from '../logger';
import { isFeatureEnabled } from '../config/features';
import { generateIntentHash, type IntentHashResult } from './intent-hash';
import {
  type SkillDefinition,
  type SkillTrigger,
  type SkillProcess,
  type SkillTier,
  classifySkillTier,
  createDefaultMetrics,
  SkillDefinitionSchema,
} from './schema';
import { parseSkillFrontmatter, extractSkillBody } from './frontmatter';
import type { Pillar } from '../conversation/types';

// =============================================================================
// TRIGGER MATCHING
// =============================================================================

/**
 * Result of a trigger match
 */
export interface TriggerMatchResult {
  skill: SkillDefinition;
  trigger: SkillTrigger;
  score: number; // 0-1, higher is better match
  matchedValue?: string;
}

/**
 * Score a trigger match
 */
function scoreTriggerMatch(
  trigger: SkillTrigger,
  text: string,
  intentHash: IntentHashResult,
  context: MatchContext
): number {
  switch (trigger.type) {
    case 'phrase': {
      // Exact phrase match = highest score
      if (text.toLowerCase().includes(trigger.value.toLowerCase())) {
        return 1.0;
      }
      return 0;
    }

    case 'pattern': {
      // Regex match
      try {
        const regex = new RegExp(trigger.value, 'i');
        if (regex.test(text)) {
          return 0.9;
        }
      } catch {
        logger.warn('Invalid regex in skill trigger', { pattern: trigger.value });
      }
      return 0;
    }

    case 'keyword': {
      // Keyword presence - score based on how many keywords match
      const keywords = trigger.value.toLowerCase().split(/[|,\s]+/);
      const textLower = text.toLowerCase();
      const matchCount = keywords.filter(kw => textLower.includes(kw)).length;
      if (matchCount === 0) return 0;
      return 0.7 + (0.1 * Math.min(matchCount, 3) / 3);
    }

    case 'pillar': {
      // Pillar-based routing
      if (context.pillar === trigger.value) {
        return 0.8;
      }
      return 0;
    }

    case 'intentHash': {
      // Match by intent hash
      if (intentHash.hash === trigger.value) {
        return 1.0;
      }
      // Partial match on hash prefix
      if (trigger.value.startsWith(intentHash.hash.substring(0, 4))) {
        return 0.7;
      }
      return 0;
    }

    case 'contentType': {
      // Match by content type
      if (context.contentType === trigger.value) {
        return 0.85;
      }
      return 0;
    }

    default:
      return 0;
  }
}

/**
 * Context for trigger matching
 */
export interface MatchContext {
  pillar?: Pillar;
  contentType?: string;
  confidence?: number;
}

// =============================================================================
// SKILL LOADING
// =============================================================================

/**
 * Parse YAML skill file
 */
function parseYamlSkill(content: string, filePath: string): SkillDefinition | null {
  try {
    const data = parseYaml(content);

    // Validate required fields
    if (!data.name || !data.triggers || !data.process) {
      logger.warn('YAML skill missing required fields', { filePath });
      return null;
    }

    // Build skill definition
    const skill: SkillDefinition = {
      name: data.name,
      version: data.version || '1.0.0',
      description: data.description || '',
      triggers: Array.isArray(data.triggers) ? data.triggers : [data.triggers],
      inputs: data.inputs || {},
      outputs: data.outputs || [],
      process: data.process,
      tier: data.tier ?? classifySkillTier(data.process),
      enabled: data.enabled !== false,
      createdAt: data.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      source: 'yaml',
      filePath,
      metrics: createDefaultMetrics(),
      tags: data.tags,
      author: data.author,
      priority: data.priority,
    };

    return skill;
  } catch (error) {
    logger.error('Failed to parse YAML skill', { filePath, error });
    return null;
  }
}

/**
 * Parse legacy SKILL.md file
 */
function parseMarkdownSkill(content: string, filePath: string): SkillDefinition | null {
  try {
    // Use shared parser (handles Windows \r\n, normalizes drift patterns)
    const frontmatter = parseSkillFrontmatter(content);
    if (!frontmatter) {
      logger.warn('SKILL.md missing or malformed frontmatter', { filePath });
      return null;
    }

    const body = extractSkillBody(content);

    // Fall back to directory name if frontmatter name is empty
    const name = frontmatter.name || basename(join(filePath, '..'));

    // Parse trigger from frontmatter
    const triggerText = frontmatter.trigger || '';
    const triggers: SkillTrigger[] = [];

    if (triggerText) {
      triggers.push({
        type: 'pattern',
        value: triggerText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
      });
    }

    // Extract keywords from description
    const description = frontmatter.description || '';
    if (description) {
      const keywords = description
        .toLowerCase()
        .split(/\s+/)
        .filter((w: string) => w.length > 4)
        .slice(0, 5)
        .join('|');
      if (keywords) {
        triggers.push({ type: 'keyword', value: keywords });
      }
    }

    const process: SkillProcess = {
      type: 'agent_dispatch',
      steps: [{
        id: 'execute',
        agent: 'claude',
        task: body,
      }],
    };

    const skill: SkillDefinition = {
      name,
      version: frontmatter.version || '1.0.0',
      description,
      triggers: triggers.length > 0 ? triggers : [{ type: 'keyword', value: name }],
      inputs: {},
      outputs: [],
      process,
      tier: 1,
      enabled: true,
      createdAt: frontmatter.created || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      source: 'markdown',
      filePath,
      metrics: createDefaultMetrics(),
    };

    return skill;
  } catch (error) {
    logger.error('Failed to parse SKILL.md', { filePath, error });
    return null;
  }
}

// =============================================================================
// SKILL REGISTRY CLASS
// =============================================================================

/**
 * Skill Registry - manages skill loading, matching, and hot-reload
 */
export class SkillRegistry {
  private skills: Map<string, SkillDefinition> = new Map();
  private skillsDir: string;
  private watcher: ReturnType<typeof watch> | null = null;
  private reloadTimer: ReturnType<typeof setTimeout> | null = null;
  private initialized: boolean = false;

  constructor(skillsDir?: string) {
    // Default to data/skills relative to telegram app
    this.skillsDir = skillsDir || join(process.cwd(), 'data', 'skills');
  }

  /**
   * Initialize the registry - load all skills
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      logger.debug('SkillRegistry already initialized');
      return;
    }

    logger.info('Initializing SkillRegistry', { skillsDir: this.skillsDir });

    try {
      await this.loadSkillsFromDirectory(this.skillsDir);
      this.initialized = true;

      // Enable hot-reload if configured
      if (isFeatureEnabled('skillHotReload')) {
        await this.enableHotReload();
      }

      logger.info('SkillRegistry initialized', {
        skillCount: this.skills.size,
        hotReload: isFeatureEnabled('skillHotReload'),
      });
    } catch (error) {
      logger.error('Failed to initialize SkillRegistry', { error });
      // Don't throw - registry can work without pre-loaded skills
      this.initialized = true;
    }
  }

  /**
   * Load all skills from a directory (recursive)
   */
  private async loadSkillsFromDirectory(dir: string): Promise<void> {
    try {
      const entries = await readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = join(dir, entry.name);

        if (entry.isDirectory()) {
          // Check for SKILL.md or skill.yaml in subdirectory
          await this.loadSkillFromSubdir(fullPath);
          // Also recurse into subdirectories
          await this.loadSkillsFromDirectory(fullPath);
        } else if (entry.name === 'skill.yaml' || entry.name === 'skill.yml') {
          await this.loadSkillFile(fullPath);
        } else if (entry.name === 'SKILL.md') {
          await this.loadSkillFile(fullPath);
        }
      }
    } catch (error) {
      // Directory may not exist
      logger.debug('Skills directory not found or inaccessible', { dir });
    }
  }

  /**
   * Load skill from a subdirectory (looks for skill.yaml or SKILL.md)
   */
  private async loadSkillFromSubdir(dir: string): Promise<void> {
    // Prefer YAML over Markdown
    const yamlPath = join(dir, 'skill.yaml');
    const ymlPath = join(dir, 'skill.yml');
    const mdPath = join(dir, 'SKILL.md');

    try {
      // Try YAML first
      try {
        await readFile(yamlPath);
        await this.loadSkillFile(yamlPath);
        return;
      } catch { /* not found */ }

      try {
        await readFile(ymlPath);
        await this.loadSkillFile(ymlPath);
        return;
      } catch { /* not found */ }

      // Fall back to Markdown
      try {
        await readFile(mdPath);
        await this.loadSkillFile(mdPath);
      } catch { /* not found */ }
    } catch (error) {
      logger.debug('No skill file found in directory', { dir });
    }
  }

  /**
   * Load a single skill file
   */
  private async loadSkillFile(filePath: string): Promise<SkillDefinition | null> {
    try {
      const content = await readFile(filePath, 'utf-8');
      const ext = extname(filePath).toLowerCase();

      let skill: SkillDefinition | null = null;

      if (ext === '.yaml' || ext === '.yml') {
        skill = parseYamlSkill(content, filePath);
      } else if (ext === '.md') {
        skill = parseMarkdownSkill(content, filePath);
      }

      if (skill) {
        // Warn about legacy format
        if (skill.source === 'markdown') {
          logger.debug('Loaded legacy SKILL.md (consider migrating to YAML)', {
            skill: skill.name,
            path: filePath,
          });
        }

        this.skills.set(skill.name, skill);
        logger.debug('Skill loaded', { name: skill.name, tier: skill.tier, source: skill.source });
        return skill;
      }
    } catch (error) {
      logger.error('Failed to load skill file', { filePath, error });
    }

    return null;
  }

  /**
   * Enable hot-reload watching
   */
  private async enableHotReload(): Promise<void> {
    try {
      // Note: fs.watch is not fully reliable on all platforms
      // This is a best-effort implementation
      this.watcher = watch(this.skillsDir, { recursive: true }, (eventType, filename) => {
        if (filename &&
            (filename.endsWith('.yaml') ||
             filename.endsWith('.yml') ||
             filename.endsWith('.md'))) {
          // Trailing-edge debounce: reset timer on each event
          if (this.reloadTimer) clearTimeout(this.reloadTimer);
          this.reloadTimer = setTimeout(async () => {
            this.reloadTimer = null;
            try {
              this.skills.clear();
              await this.loadSkillsFromDirectory(this.skillsDir);
              logger.info('Skills reloaded', { count: this.skills.size });
            } catch (error) {
              logger.error('Failed to reload skills', { error });
            }
          }, 300);
        }
      });

      this.watcher.on('error', (error) => {
        logger.warn('Skill watcher error', { error });
      });

      logger.info('Hot-reload enabled for skills directory');
    } catch (error) {
      logger.warn('Failed to enable hot-reload', { error });
    }
  }

  /**
   * Get all loaded skills
   */
  getAll(): SkillDefinition[] {
    return Array.from(this.skills.values());
  }

  /**
   * Get skill by name
   */
  get(name: string): SkillDefinition | undefined {
    return this.skills.get(name);
  }

  /**
   * Check if skill exists
   */
  has(name: string): boolean {
    return this.skills.has(name);
  }

  /**
   * Get enabled skills only
   */
  getEnabled(): SkillDefinition[] {
    return this.getAll().filter(s => s.enabled);
  }

  /**
   * Get skills by tier
   */
  getByTier(tier: SkillTier): SkillDefinition[] {
    return this.getAll().filter(s => s.tier === tier);
  }

  /**
   * Find matching skills for a message
   */
  findMatches(
    text: string,
    context: MatchContext = {}
  ): TriggerMatchResult[] {
    const intentHash = generateIntentHash(text);
    const matches: TriggerMatchResult[] = [];

    for (const skill of this.getEnabled()) {
      for (const trigger of skill.triggers) {
        // Check pillar filter
        if (trigger.pillar && context.pillar && trigger.pillar !== context.pillar) {
          continue;
        }

        // Check confidence threshold
        if (trigger.minConfidence && context.confidence !== undefined) {
          if (context.confidence < trigger.minConfidence) {
            continue;
          }
        }

        const score = scoreTriggerMatch(trigger, text, intentHash, context);

        if (score > 0) {
          matches.push({
            skill,
            trigger,
            score,
            matchedValue: trigger.value,
          });
        }
      }
    }

    // Sort by score (highest first), then by priority (higher priority wins ties)
    matches.sort((a, b) => {
      const scoreDiff = b.score - a.score;
      if (scoreDiff !== 0) return scoreDiff;
      // On tie, higher priority wins (default 50)
      const priorityA = a.skill.priority ?? 50;
      const priorityB = b.skill.priority ?? 50;
      return priorityB - priorityA;
    });

    return matches;
  }

  /**
   * Find best matching skill (or null if no match)
   */
  findBestMatch(
    text: string,
    context: MatchContext = {},
    minScore: number = 0.5
  ): TriggerMatchResult | null {
    const matches = this.findMatches(text, context);

    if (matches.length > 0 && matches[0].score >= minScore) {
      return matches[0];
    }

    return null;
  }

  /**
   * Register a new skill (for generated skills)
   */
  register(skill: SkillDefinition): void {
    // Validate
    const result = SkillDefinitionSchema.safeParse(skill);
    if (!result.success) {
      logger.error('Invalid skill definition', { name: skill.name, errors: result.error });
      throw new Error(`Invalid skill definition: ${result.error.message}`);
    }

    this.skills.set(skill.name, skill);
    logger.info('Skill registered', { name: skill.name, tier: skill.tier });
  }

  /**
   * Unregister a skill
   */
  unregister(name: string): boolean {
    const removed = this.skills.delete(name);
    if (removed) {
      logger.info('Skill unregistered', { name });
    }
    return removed;
  }

  /**
   * Update skill metrics after execution
   */
  updateMetrics(
    name: string,
    success: boolean,
    executionTimeMs: number
  ): void {
    const skill = this.skills.get(name);
    if (!skill) return;

    const metrics = skill.metrics;
    metrics.executionCount++;

    if (success) {
      metrics.successCount++;
      metrics.consecutiveFailures = 0;
      metrics.lastExecuted = new Date().toISOString();
    } else {
      metrics.failureCount++;
      metrics.consecutiveFailures++;
      metrics.lastFailed = new Date().toISOString();
    }

    // Update average execution time
    const totalTime = metrics.avgExecutionTime * (metrics.executionCount - 1) + executionTimeMs;
    metrics.avgExecutionTime = totalTime / metrics.executionCount;
  }

  /**
   * Get registry stats
   */
  getStats(): {
    total: number;
    enabled: number;
    byTier: Record<SkillTier, number>;
    bySource: Record<string, number>;
  } {
    const skills = this.getAll();

    return {
      total: skills.length,
      enabled: skills.filter(s => s.enabled).length,
      byTier: {
        0: skills.filter(s => s.tier === 0).length,
        1: skills.filter(s => s.tier === 1).length,
        2: skills.filter(s => s.tier === 2).length,
      },
      bySource: {
        yaml: skills.filter(s => s.source === 'yaml').length,
        markdown: skills.filter(s => s.source === 'markdown').length,
        generated: skills.filter(s => s.source === 'generated').length,
      },
    };
  }

  /**
   * Shutdown registry (close watchers)
   */
  async shutdown(): Promise<void> {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    logger.info('SkillRegistry shutdown');
  }
}

// =============================================================================
// SINGLETON INSTANCE
// =============================================================================

let _registry: SkillRegistry | null = null;

/**
 * Get the global skill registry instance
 */
export function getSkillRegistry(): SkillRegistry {
  if (!_registry) {
    _registry = new SkillRegistry();
  }
  return _registry;
}

/**
 * Initialize the global skill registry
 */
export async function initializeSkillRegistry(): Promise<SkillRegistry> {
  const registry = getSkillRegistry();
  await registry.initialize();
  return registry;
}
