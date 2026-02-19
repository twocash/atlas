/**
 * Atlas Prompt Manager Service
 *
 * Manages dynamic prompt retrieval from Notion database with:
 * - 5-minute TTL cache for performance
 * - Fallback chain: Cache → Notion → Local JSON → Error string
 * - Variable hydration with {{handlebars}} syntax
 * - Auto-inject system vars: {{current_date}}, {{current_time}}, {{pillar}}, {{iso_date}}
 * - Safe Mode: Falls back to local prompts-v1.json if Notion is down
 *
 * @see docs/guides/PROMPT_MIGRATION_GUIDE.md for migration patterns
 */

import { Client } from '@notionhq/client';
import * as fs from 'fs';
import * as path from 'path';

// ==========================================
// Types
// ==========================================

/**
 * Capability types that can have prompts
 */
export type PromptCapability =
  | 'System'
  | 'Research Agent'
  | 'Voice'
  | 'Classifier'
  | 'Drafter'
  | 'Refinery';

/**
 * Pipeline stages
 */
export type PromptStage =
  | '1-Spark'
  | '2-Research'
  | '3-Refine'
  | '4-Execute';

/**
 * Pillar values for routing
 */
export type PromptPillar =
  | 'The Grove'
  | 'Consulting'
  | 'Personal'
  | 'Home/Garage'
  | 'All';

/**
 * A prompt record from the database
 */
export interface PromptRecord {
  /** Immutable key: "research.grove.sprout" */
  id: string;

  /** System, Research Agent, Classifier, Voice, Drafter, Refinery */
  capability: PromptCapability;

  /** The Grove, Consulting, Personal, Home/Garage, All */
  pillars: PromptPillar[];

  /** General, Sprout Generation, Market Analysis, etc. */
  useCase: string;

  /** 1-Spark, 2-Research, 3-Refine, 4-Execute */
  stage?: PromptStage;

  /** The template with {{variables}} */
  promptText: string;

  /** JSON: {"temperature": 0.2} */
  modelConfig?: Record<string, unknown>;

  /** Kill switch */
  active: boolean;

  /** For tracking */
  version: number;
}

/**
 * Cache entry with TTL
 */
interface CacheEntry {
  record: PromptRecord;
  expiresAt: number;
}

/**
 * Lookup parameters
 */
export interface PromptLookup {
  capability: PromptCapability;
  pillar?: PromptPillar;
  useCase?: string;
  stage?: PromptStage;
}

/**
 * Variables for template hydration
 */
export interface PromptVariables {
  [key: string]: string | number | boolean | undefined;
}

/**
 * Prompt composition for V3 Active Capture
 * Composes prompts from Drafter + Voice + Lens pattern
 */
export interface PromptComposition {
  drafter?: string;  // e.g. "drafter.capture", "drafter.research"
  voice?: string;    // e.g. "voice.grove-analytical", "voice.linkedin-punchy"
  lens?: string;     // e.g. "lens.strategic", "lens.tactical" (future)
}

/**
 * Result from prompt composition
 */
export interface ComposedPrompt {
  prompt: string;
  temperature: number;
  maxTokens: number;
}

// ==========================================
// Constants
// ==========================================

/** Cache TTL in milliseconds (5 minutes) */
const CACHE_TTL_MS = 5 * 60 * 1000;

/** Path to local fallback prompts */
const FALLBACK_PROMPTS_PATH = path.join(
  __dirname,
  '../../../../apps/telegram/data/migrations/prompts-v1.json'
);

// ==========================================
// Notion ID Sanitizer
// ==========================================

/**
 * Strip Notion auto-link formatting from rich_text ID values.
 *
 * Notion auto-links strings that look like valid TLDs (e.g., .consulting, .dev, .studio).
 * This converts "[drafter.consulting](http://drafter.consulting).capture"
 * back to "drafter.consulting.capture"
 *
 * Affected TLDs include: .consulting, .dev, .studio, .agency, .app, .design, .systems
 */
export function sanitizeNotionId(raw: string): string {
  return raw.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
}

// ==========================================
// PromptManager Class
// ==========================================

/**
 * Manages prompt retrieval with caching and fallback
 */
export class PromptManager {
  private static instance: PromptManager | null = null;

  private notion: Client | null = null;
  private databaseId: string | null = null;

  /** In-memory cache keyed by prompt ID */
  private cache: Map<string, CacheEntry> = new Map();

  /** Local fallback data (loaded once) */
  private localFallback: Map<string, PromptRecord> | null = null;

  /** Whether Notion is available */
  private notionAvailable: boolean = true;

  /** Last Notion check timestamp */
  private lastNotionCheck: number = 0;

  /** Notion retry interval (5 minutes) */
  private notionRetryInterval: number = 5 * 60 * 1000;

  /** Strict mode - throw errors instead of falling back (for development/testing) */
  private strictMode: boolean = process.env.PROMPT_STRICT_MODE === 'true';

  private constructor() {
    if (this.strictMode) {
      console.log('[PromptManager] 🚨 STRICT MODE ENABLED - will throw errors instead of falling back');
    }
  }

  /**
   * Get singleton instance
   */
  static getInstance(): PromptManager {
    if (!PromptManager.instance) {
      PromptManager.instance = new PromptManager();
    }
    return PromptManager.instance;
  }

  /**
   * Initialize Notion client lazily
   */
  private ensureNotion(): Client | null {
    if (this.notion) return this.notion;

    const apiKey = process.env.NOTION_API_KEY;
    const dbId = process.env.NOTION_PROMPTS_DB_ID;

    if (!apiKey) {
      console.warn('[PromptManager] NOTION_API_KEY not set, using local fallback');
      this.notionAvailable = false;
      return null;
    }

    if (!dbId) {
      console.warn('[PromptManager] NOTION_PROMPTS_DB_ID not set, using local fallback');
      this.notionAvailable = false;
      return null;
    }

    this.notion = new Client({ auth: apiKey });
    this.databaseId = dbId;
    return this.notion;
  }

  /**
   * Load local fallback prompts from JSON file
   */
  private loadLocalFallback(): Map<string, PromptRecord> {
    if (this.localFallback) return this.localFallback;

    this.localFallback = new Map();

    try {
      if (fs.existsSync(FALLBACK_PROMPTS_PATH)) {
        const data = fs.readFileSync(FALLBACK_PROMPTS_PATH, 'utf-8');
        const prompts: PromptRecord[] = JSON.parse(data);

        for (const prompt of prompts) {
          this.localFallback.set(prompt.id, prompt);
        }

        console.log(`[PromptManager] Loaded ${prompts.length} fallback prompts from local JSON`);
      } else {
        console.warn(`[PromptManager] Fallback file not found: ${FALLBACK_PROMPTS_PATH}`);
      }
    } catch (error) {
      console.error('[PromptManager] Failed to load fallback prompts:', error);
    }

    return this.localFallback;
  }

  /**
   * Build prompt ID from lookup parameters
   */
  private buildPromptId(lookup: PromptLookup): string {
    const parts: string[] = [];

    // Capability slug
    const capabilitySlug = lookup.capability.toLowerCase().replace(/\s+/g, '-');
    parts.push(capabilitySlug);

    // Pillar slug (optional)
    if (lookup.pillar && lookup.pillar !== 'All') {
      const pillarSlug = lookup.pillar.toLowerCase().replace(/\s+/g, '-');
      parts.push(pillarSlug);
    }

    // Use case slug (optional)
    if (lookup.useCase) {
      const useCaseSlug = lookup.useCase.toLowerCase().replace(/\s+/g, '-');
      parts.push(useCaseSlug);
    }

    return parts.join('.');
  }

  /**
   * Inject system variables into template
   */
  private injectSystemVariables(
    template: string,
    variables: PromptVariables = {}
  ): string {
    const now = new Date();

    // System variables (always available)
    const systemVars: PromptVariables = {
      current_date: now.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      }),
      current_time: now.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
      }),
      iso_date: now.toISOString().split('T')[0],
      iso_datetime: now.toISOString(),
      ...variables,
    };

    // Replace {{variable}} patterns
    return template.replace(/\{\{(\w+)\}\}/g, (match, varName) => {
      const value = systemVars[varName];
      if (value !== undefined) {
        return String(value);
      }
      // Leave unresolved variables as-is (may be resolved by caller)
      return match;
    });
  }

  /**
   * Fetch page content (blocks) and extract text
   */
  private async fetchPageContent(pageId: string): Promise<string> {
    const notion = this.notion;
    if (!notion) return '';

    try {
      const response = await notion.blocks.children.list({
        block_id: pageId,
        page_size: 100,
      });

      const textParts: string[] = [];

      for (const block of response.results) {
        const b = block as any;
        let text = '';

        // Extract text from different block types
        switch (b.type) {
          case 'paragraph':
            text = b.paragraph?.rich_text?.map((t: any) => t.plain_text).join('') || '';
            break;
          case 'heading_1':
            text = '# ' + (b.heading_1?.rich_text?.map((t: any) => t.plain_text).join('') || '');
            break;
          case 'heading_2':
            text = '## ' + (b.heading_2?.rich_text?.map((t: any) => t.plain_text).join('') || '');
            break;
          case 'heading_3':
            text = '### ' + (b.heading_3?.rich_text?.map((t: any) => t.plain_text).join('') || '');
            break;
          case 'bulleted_list_item':
            text = '- ' + (b.bulleted_list_item?.rich_text?.map((t: any) => t.plain_text).join('') || '');
            break;
          case 'numbered_list_item':
            text = '1. ' + (b.numbered_list_item?.rich_text?.map((t: any) => t.plain_text).join('') || '');
            break;
          case 'quote':
            text = '> ' + (b.quote?.rich_text?.map((t: any) => t.plain_text).join('') || '');
            break;
          case 'code':
            const code = b.code?.rich_text?.map((t: any) => t.plain_text).join('') || '';
            text = '```\n' + code + '\n```';
            break;
          case 'callout':
            text = b.callout?.rich_text?.map((t: any) => t.plain_text).join('') || '';
            break;
          default:
            // Skip unsupported block types
            break;
        }

        if (text) {
          textParts.push(text);
        }
      }

      return textParts.join('\n');
    } catch (error) {
      console.error('[PromptManager] Failed to fetch page content:', error);
      return '';
    }
  }

  /**
   * Convert Notion page to PromptRecord (without prompt text - fetched separately)
   */
  private pageToPromptRecord(page: any, promptText?: string): PromptRecord | null {
    try {
      const props = page.properties;

      // Sanitize ID to strip Notion auto-link formatting (e.g., .consulting TLD)
      const rawId = props.ID?.rich_text?.[0]?.plain_text || '';
      const id = sanitizeNotionId(rawId);
      const capability = props.Type?.select?.name || '';
      const pillars = (props.Pillar?.multi_select || []).map((s: any) => s.name);
      const useCase = props['Action']?.select?.name || 'General';
      const stage = props.Stage?.select?.name;
      // Prompt text comes from page body now, but fallback to property if present
      const propPromptText = props['Prompt Text']?.rich_text
        ?.map((t: any) => t.plain_text)
        .join('') || '';
      const finalPromptText = promptText || propPromptText;
      const modelConfigStr = props['Model Config']?.rich_text?.[0]?.plain_text;
      const active = props.Active?.checkbox ?? true;
      const version = props.Version?.number ?? 1;

      if (!id || !capability) {
        return null;
      }

      let modelConfig: Record<string, unknown> | undefined;
      if (modelConfigStr) {
        try {
          modelConfig = JSON.parse(modelConfigStr);
        } catch {
          // Ignore parse errors
        }
      }

      return {
        id,
        capability: capability as PromptCapability,
        pillars: pillars as PromptPillar[],
        useCase,
        stage: stage as PromptStage | undefined,
        promptText: finalPromptText,
        modelConfig,
        active,
        version,
      };
    } catch (error) {
      console.error('[PromptManager] Failed to parse Notion page:', error);
      return null;
    }
  }

  /**
   * Check if we should retry Notion
   */
  private shouldRetryNotion(): boolean {
    if (this.notionAvailable) return true;

    const now = Date.now();
    if (now - this.lastNotionCheck > this.notionRetryInterval) {
      this.lastNotionCheck = now;
      this.notionAvailable = true; // Optimistically try again
      return true;
    }

    return false;
  }

  /**
   * Fetch prompt from Notion by ID
   */
  private async fetchFromNotion(promptId: string): Promise<PromptRecord | null> {
    if (!this.shouldRetryNotion()) {
      return null;
    }

    const notion = this.ensureNotion();
    if (!notion || !this.databaseId) {
      return null;
    }

    try {
      const response = await notion.databases.query({
        database_id: this.databaseId,
        filter: {
          and: [
            {
              property: 'ID',
              rich_text: { equals: promptId },
            },
            {
              property: 'Active',
              checkbox: { equals: true },
            },
          ],
        },
        page_size: 1,
      });

      if (response.results.length === 0) {
        return null;
      }

      const page = response.results[0];
      // Fetch page body content
      const promptText = await this.fetchPageContent(page.id);
      return this.pageToPromptRecord(page, promptText);
    } catch (error) {
      console.error('[PromptManager] Notion fetch failed:', error);
      this.notionAvailable = false;
      this.lastNotionCheck = Date.now();
      return null;
    }
  }

  /**
   * Get prompt by exact ID
   */
  async getPromptById(
    promptId: string,
    variables?: PromptVariables
  ): Promise<string | null> {
    // Check cache first
    const cached = this.cache.get(promptId);
    if (cached && cached.expiresAt > Date.now()) {
      console.log(`[PromptManager] Cache hit: ${promptId}`);
      return this.injectSystemVariables(cached.record.promptText, variables);
    }

    // Try Notion
    const record = await this.fetchFromNotion(promptId);
    if (record) {
      // Update cache
      this.cache.set(promptId, {
        record,
        expiresAt: Date.now() + CACHE_TTL_MS,
      });
      console.log(`[PromptManager] Notion hit: ${promptId}`);
      return this.injectSystemVariables(record.promptText, variables);
    }

    // Fall back to local JSON
    const fallback = this.loadLocalFallback();
    const localRecord = fallback.get(promptId);
    if (localRecord) {
      console.log(`[PromptManager] Fallback hit: ${promptId}`);
      return this.injectSystemVariables(localRecord.promptText, variables);
    }

    console.warn(`[PromptManager] Prompt not found: ${promptId}`);
    return null;
  }

  /**
   * Fetch prompt from Notion by properties (capability, pillar, useCase)
   */
  private async fetchByProperties(lookup: PromptLookup): Promise<PromptRecord | null> {
    if (!this.shouldRetryNotion()) {
      return null;
    }

    const notion = this.ensureNotion();
    if (!notion || !this.databaseId) {
      return null;
    }

    try {
      // Guard against undefined capability
      if (!lookup.capability) {
        console.warn('[PromptManager] fetchByProperties called with undefined capability');
        return null;
      }

      const filters: any[] = [
        { property: 'Type', select: { equals: lookup.capability } },
        { property: 'Active', checkbox: { equals: true } },
      ];

      // Add pillar filter
      if (lookup.pillar && lookup.pillar !== 'All') {
        filters.push({
          or: [
            { property: 'Pillar', multi_select: { contains: lookup.pillar } },
            { property: 'Pillar', multi_select: { contains: 'All' } },
          ],
        });
      }

      // Add use case filter
      if (lookup.useCase) {
        filters.push({ property: 'Action', select: { equals: lookup.useCase } });
      }

      const response = await notion.databases.query({
        database_id: this.databaseId,
        filter: { and: filters },
        page_size: 1,
      });

      if (response.results.length === 0) {
        return null;
      }

      const page = response.results[0];
      // Fetch page body content
      const promptText = await this.fetchPageContent(page.id);
      return this.pageToPromptRecord(page, promptText);
    } catch (error) {
      console.error('[PromptManager] Notion property fetch failed:', error);
      this.notionAvailable = false;
      this.lastNotionCheck = Date.now();
      return null;
    }
  }

  /**
   * Find prompt in local fallback by properties
   */
  private findInFallback(lookup: PromptLookup): PromptRecord | null {
    const fallback = this.loadLocalFallback();

    for (const [_, record] of fallback) {
      if (record.capability !== lookup.capability) continue;
      if (!record.active) continue;

      // Check pillar match
      if (lookup.pillar && lookup.pillar !== 'All') {
        if (!record.pillars.includes(lookup.pillar) && !record.pillars.includes('All')) {
          continue;
        }
      }

      // Check use case match
      if (lookup.useCase && record.useCase !== lookup.useCase) {
        continue;
      }

      return record;
    }

    return null;
  }

  /**
   * Get prompt by lookup parameters
   *
   * @example
   * // Get Grove analytical voice
   * await getPrompt({ capability: 'Voice', pillar: 'The Grove' })
   *
   * // Get research prompt for sprout generation
   * await getPrompt({ capability: 'Research Agent', useCase: 'Sprout Generation' })
   */
  async getPrompt(
    lookup: PromptLookup,
    variables?: PromptVariables
  ): Promise<string | null> {
    // Build cache key from lookup
    const cacheKey = `lookup:${lookup.capability}:${lookup.pillar || 'any'}:${lookup.useCase || 'any'}`;

    // Check cache first
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      console.log(`[PromptManager] Cache hit: ${cacheKey}`);
      const enrichedVars: PromptVariables = {
        ...variables,
        pillar: lookup.pillar,
        capability: lookup.capability,
        use_case: lookup.useCase,
      };
      return this.injectSystemVariables(cached.record.promptText, enrichedVars);
    }

    // Try Notion by properties
    let record = await this.fetchByProperties(lookup);
    if (record) {
      this.cache.set(cacheKey, {
        record,
        expiresAt: Date.now() + CACHE_TTL_MS,
      });
      console.log(`[PromptManager] Notion property hit: ${record.id}`);
      const enrichedVars: PromptVariables = {
        ...variables,
        pillar: lookup.pillar,
        capability: lookup.capability,
        use_case: lookup.useCase,
      };
      return this.injectSystemVariables(record.promptText, enrichedVars);
    }

    // Fall back to local JSON by properties
    record = this.findInFallback(lookup);
    if (record) {
      console.log(`[PromptManager] Fallback property hit: ${record.id}`);
      const enrichedVars: PromptVariables = {
        ...variables,
        pillar: lookup.pillar,
        capability: lookup.capability,
        use_case: lookup.useCase,
      };
      return this.injectSystemVariables(record.promptText, enrichedVars);
    }

    const lookupDesc = `${lookup.capability}/${lookup.pillar || 'any'}/${lookup.useCase || 'any'}`;
    console.warn(`[PromptManager] Prompt not found: ${lookupDesc}`);
    return null;
  }

  /**
   * Get full prompt record (for model config access)
   */
  async getPromptRecord(lookup: PromptLookup): Promise<PromptRecord | null> {
    const promptId = this.buildPromptId(lookup);

    // Check cache
    const cached = this.cache.get(promptId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.record;
    }

    // Try Notion
    const record = await this.fetchFromNotion(promptId);
    if (record) {
      this.cache.set(promptId, {
        record,
        expiresAt: Date.now() + CACHE_TTL_MS,
      });
      return record;
    }

    // Fall back to local
    const fallback = this.loadLocalFallback();
    return fallback.get(promptId) || null;
  }

  /**
   * Get prompt record by direct ID lookup
   * Used by composePrompts for V3 Active Capture
   *
   * In STRICT MODE (PROMPT_STRICT_MODE=true):
   * - Throws error if Notion fetch fails
   * - Does NOT fall back to local JSON
   */
  async getPromptRecordById(promptId: string): Promise<PromptRecord | null> {
    // Check cache
    const cached = this.cache.get(promptId);
    if (cached && cached.expiresAt > Date.now()) {
      console.log(`[PromptManager] Cache hit: ${promptId}`);
      return cached.record;
    }

    // Try Notion
    const record = await this.fetchFromNotion(promptId);
    if (record) {
      this.cache.set(promptId, {
        record,
        expiresAt: Date.now() + CACHE_TTL_MS,
      });
      console.log(`[PromptManager] Notion hit: ${promptId}`);
      return record;
    }

    // STRICT MODE: Throw error, do NOT fall back
    if (this.strictMode) {
      const error = new Error(`[PromptManager] STRICT MODE: Prompt not found in Notion: "${promptId}". Check NOTION_PROMPTS_DB_ID env var and ensure prompt exists with matching ID property.`);
      console.error(error.message);
      throw error;
    }

    // Fall back to local (only in non-strict mode)
    const fallback = this.loadLocalFallback();
    const localRecord = fallback.get(promptId);
    if (localRecord) {
      console.log(`[PromptManager] ⚠️ Fallback hit: ${promptId} (set PROMPT_STRICT_MODE=true to disable fallback)`);
      return localRecord;
    }

    return null;
  }

  /**
   * Hydrate template with variables (exposed for composition)
   */
  hydrateTemplate(template: string, variables: PromptVariables): string {
    return this.injectSystemVariables(template, variables);
  }

  /**
   * Compose prompts from Drafter + Voice + Lens pattern
   * Order: Drafter → Voice → Lens (each optional)
   *
   * @example
   * ```typescript
   * const composed = await pm.composePrompts({
   *   drafter: 'drafter.research',
   *   voice: 'voice.grove-analytical',
   * }, { pillar: 'The Grove' });
   * ```
   */
  /**
   * Compose prompts from Drafter + Voice + Lens pattern
   * Order: Drafter → Voice → Lens (each optional)
   *
   * STRICT MODE: Throws if any prompt not found in Notion
   *
   * @example
   * ```typescript
   * const composed = await pm.composePrompts({
   *   drafter: 'drafter.research',
   *   voice: 'voice.grove-analytical',
   * }, { pillar: 'The Grove' });
   * ```
   */
  async composePrompts(
    composition: PromptComposition,
    variables?: PromptVariables
  ): Promise<ComposedPrompt | null> {
    const parts: string[] = [];
    let temperature = 0.7;
    let maxTokens = 4096;

    // Ordered composition: drafter, voice, lens
    const promptIds = [composition.drafter, composition.voice, composition.lens].filter(Boolean) as string[];

    if (promptIds.length === 0) {
      const msg = '[PromptManager] composePrompts called with no prompt IDs';
      console.warn(msg);
      if (this.strictMode) {
        throw new Error(msg);
      }
      return null;
    }

    console.log(`[PromptManager] Composing prompts: ${promptIds.join(' + ')}`);

    for (const promptId of promptIds) {
      // getPromptRecordById will throw in strict mode if not found
      const record = await this.getPromptRecordById(promptId);
      if (!record) {
        const msg = `[PromptManager] Composition failed: prompt not found: "${promptId}"`;
        console.error(msg);
        if (this.strictMode) {
          throw new Error(msg);
        }
        return null;
      }

      console.log(`[PromptManager] ✓ Loaded: ${promptId} (${record.promptText.length} chars)`);
      const hydrated = this.hydrateTemplate(record.promptText, variables || {});
      parts.push(hydrated);

      // Use first prompt's model config as base
      if (parts.length === 1 && record.modelConfig) {
        temperature = (record.modelConfig.temperature as number) ?? temperature;
        maxTokens = (record.modelConfig.maxTokens as number) ?? maxTokens;
      }
    }

    console.log(`[PromptManager] ✓ Composition complete: ${parts.length} prompts, ${parts.join('').length} total chars`);

    return {
      prompt: parts.join('\n\n---\n\n'),
      temperature,
      maxTokens,
    };
  }

  /**
   * List all use cases for a capability (for dynamic UI)
   */
  async listUseCases(capability: PromptCapability, pillar?: PromptPillar): Promise<string[]> {
    const useCases: Set<string> = new Set();

    // Check local fallback first (always available)
    const fallback = this.loadLocalFallback();
    for (const [_, record] of fallback) {
      if (record.capability === capability && record.active) {
        if (!pillar || record.pillars.includes(pillar) || record.pillars.includes('All')) {
          useCases.add(record.useCase);
        }
      }
    }

    // Try to get from Notion for most current list
    if (this.shouldRetryNotion()) {
      const notion = this.ensureNotion();
      if (notion && this.databaseId) {
        try {
          const filter: any = {
            and: [
              { property: 'Type', select: { equals: capability } },
              { property: 'Active', checkbox: { equals: true } },
            ],
          };

          if (pillar) {
            filter.and.push({
              or: [
                { property: 'Pillar', multi_select: { contains: pillar } },
                { property: 'Pillar', multi_select: { contains: 'All' } },
              ],
            });
          }

          const response = await notion.databases.query({
            database_id: this.databaseId,
            filter,
            page_size: 100,
          });

          for (const page of response.results) {
            const record = this.pageToPromptRecord(page);
            if (record) {
              useCases.add(record.useCase);
            }
          }
        } catch (error) {
          console.warn('[PromptManager] Failed to list use cases from Notion:', error);
        }
      }
    }

    return Array.from(useCases).sort();
  }

  /**
   * Invalidate cache entry (for testing or forced refresh)
   */
  invalidateCache(promptId?: string): void {
    if (promptId) {
      this.cache.delete(promptId);
    } else {
      this.cache.clear();
    }
  }

  /**
   * Get cache stats (for monitoring)
   */
  getCacheStats(): { size: number; hitRate: number } {
    return {
      size: this.cache.size,
      hitRate: 0, // Would need to track hits/misses for real hitRate
    };
  }
}

// ==========================================
// Convenience Exports
// ==========================================

/**
 * Get singleton PromptManager instance
 */
export function getPromptManager(): PromptManager {
  return PromptManager.getInstance();
}

/**
 * Quick access to get a prompt
 */
export async function getPrompt(
  lookup: PromptLookup,
  variables?: PromptVariables
): Promise<string | null> {
  return PromptManager.getInstance().getPrompt(lookup, variables);
}

/**
 * Quick access to get a prompt by ID
 */
export async function getPromptById(
  promptId: string,
  variables?: PromptVariables
): Promise<string | null> {
  return PromptManager.getInstance().getPromptById(promptId, variables);
}

/**
 * Quick access to list use cases
 */
export async function listUseCases(
  capability: PromptCapability,
  pillar?: PromptPillar
): Promise<string[]> {
  return PromptManager.getInstance().listUseCases(capability, pillar);
}
