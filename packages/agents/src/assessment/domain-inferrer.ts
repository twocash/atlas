/**
 * Domain + Audience Inference — STAB-002c
 *
 * Unbundles "pillar" into two independent dimensions:
 *   - Domain: what knowledge world (drives RAG, drafter selection)
 *   - Audience: who sees the output (drives voice, polish)
 *
 * ADR-009 constraint: No hardcoded patterns in production path.
 * Config lives in Notion System Prompts DB as JSON rules.
 * Sync fallbacks exist for tests only.
 *
 * Sprint: STAB-002c (Domain + Audience Unbundling)
 */

import type { DomainType, AudienceType } from "./types"
import type { Pillar } from "../services/prompt-composition/types"

// ─── Config Types ────────────────────────────────────────

export interface DomainRule {
  pattern: string
  domain: DomainType
}

export interface UrlDomainRule {
  domain_pattern: string
  domain: DomainType
}

export interface DomainRulesConfig {
  keyword_rules: DomainRule[]
  url_domain_rules: UrlDomainRule[]
  default: DomainType
}

export interface AudienceRule {
  pattern: string
  audience: AudienceType
}

export interface AudienceRulesConfig {
  keyword_rules: AudienceRule[]
  default: AudienceType
}

// ─── PromptManager interface (minimal) ───────────────────

/**
 * Minimal interface for PromptManager — avoids tight coupling.
 * The real PromptManager has getPrompt(slug) that returns { content }.
 */
export interface PromptManagerLike {
  getPrompt(slug: string): Promise<{ content: string } | null>
}

// ─── Default Rules (sync fallback for tests) ─────────────

const DEFAULT_DOMAIN_RULES: DomainRulesConfig = {
  keyword_rules: [
    { pattern: "grove|infrastructure|concentration|ai\\s+architecture|llm|agent\\s+swarm", domain: "grove" },
    { pattern: "client|chase|walmart|consulting|take.?flight|monarch", domain: "consulting" },
    { pattern: "drumwave|drum\\.wave", domain: "drumwave" },
    { pattern: "gym|health|family|personal|groceries|errand|fitness", domain: "personal" },
  ],
  url_domain_rules: [
    { domain_pattern: "openai\\.com|anthropic\\.com|github\\.com|arxiv\\.org|huggingface\\.co", domain: "grove" },
    { domain_pattern: "drumwave\\.com", domain: "drumwave" },
  ],
  default: "personal",
}

const DEFAULT_AUDIENCE_RULES: AudienceRulesConfig = {
  keyword_rules: [
    { pattern: "for\\s+(?:the|a)\\s+client|client\\s+brief|client\\s+deck|client\\s+facing", audience: "client" },
    { pattern: "for\\s+the\\s+team|internal\\s+doc|team\\s+update|standup", audience: "team" },
    { pattern: "publish|blog|linkedin|public|article|post|thinkpiece", audience: "public" },
  ],
  default: "self",
}

// ─── Config Loading ──────────────────────────────────────

/**
 * Load domain rules from Notion via PromptManager.
 * Falls back to defaults if config not found.
 */
async function loadDomainRules(pm: PromptManagerLike): Promise<DomainRulesConfig> {
  try {
    const entry = await pm.getPrompt("config.domain-inference-rules")
    if (entry?.content) {
      return JSON.parse(entry.content) as DomainRulesConfig
    }
  } catch {
    // Fall through to defaults — loud log handled by caller
  }
  return DEFAULT_DOMAIN_RULES
}

/**
 * Load audience rules from Notion via PromptManager.
 * Falls back to defaults if config not found.
 */
async function loadAudienceRules(pm: PromptManagerLike): Promise<AudienceRulesConfig> {
  try {
    const entry = await pm.getPrompt("config.audience-inference-rules")
    if (entry?.content) {
      return JSON.parse(entry.content) as AudienceRulesConfig
    }
  } catch {
    // Fall through to defaults
  }
  return DEFAULT_AUDIENCE_RULES
}

// ─── Domain Inference ────────────────────────────────────

/**
 * Apply domain rules to a message.
 * Shared logic for both sync and async paths.
 */
function applyDomainRules(message: string, rules: DomainRulesConfig): DomainType {
  const lower = message.toLowerCase()

  // Check keyword rules (first match wins)
  for (const rule of rules.keyword_rules) {
    if (new RegExp(`\\b(?:${rule.pattern})\\b`, "i").test(lower)) {
      return rule.domain
    }
  }

  // Check URL domain rules
  const urlMatch = message.match(/https?:\/\/([^\s/]+)/i)
  if (urlMatch) {
    const hostname = urlMatch[1].toLowerCase()
    for (const rule of rules.url_domain_rules) {
      if (new RegExp(rule.domain_pattern, "i").test(hostname)) {
        return rule.domain
      }
    }
  }

  return rules.default
}

/**
 * Infer domain from message text. Async — reads config from Notion.
 *
 * @param message - User's message text
 * @param promptManager - Optional PromptManager for Notion config
 * @returns Inferred DomainType
 */
export async function inferDomain(
  message: string,
  promptManager?: PromptManagerLike,
): Promise<DomainType> {
  const rules = promptManager
    ? await loadDomainRules(promptManager)
    : DEFAULT_DOMAIN_RULES
  return applyDomainRules(message, rules)
}

/**
 * Infer domain synchronously. Test-only — uses hardcoded defaults.
 */
export function inferDomainSync(message: string): DomainType {
  return applyDomainRules(message, DEFAULT_DOMAIN_RULES)
}

// ─── Audience Inference ──────────────────────────────────

/**
 * Apply audience rules to a message.
 */
function applyAudienceRules(message: string, rules: AudienceRulesConfig): AudienceType {
  const lower = message.toLowerCase()

  for (const rule of rules.keyword_rules) {
    if (new RegExp(`\\b(?:${rule.pattern})\\b`, "i").test(lower)) {
      return rule.audience
    }
  }

  return rules.default
}

/**
 * Infer audience from message text. Async — reads config from Notion.
 */
export async function inferAudience(
  message: string,
  promptManager?: PromptManagerLike,
): Promise<AudienceType> {
  const rules = promptManager
    ? await loadAudienceRules(promptManager)
    : DEFAULT_AUDIENCE_RULES
  return applyAudienceRules(message, rules)
}

/**
 * Infer audience synchronously. Test-only — uses hardcoded defaults.
 */
export function inferAudienceSync(message: string): AudienceType {
  return applyAudienceRules(message, DEFAULT_AUDIENCE_RULES)
}

// ─── Pillar Derivation ───────────────────────────────────

/**
 * Map from domain to Notion pillar. Pure function, no Notion call.
 * Audience does NOT affect pillar — pillar is a domain concept.
 *
 * drumwave maps to Consulting (it's a client engagement).
 */
const DOMAIN_TO_PILLAR: Record<DomainType, Pillar> = {
  personal: "Personal",
  consulting: "Consulting",
  grove: "The Grove",
  drumwave: "Consulting",
}

/**
 * Derive a Notion-compatible Pillar from domain.
 * Pure function — backward compat bridge for Feed/WQ.
 */
export function derivePillar(domain: DomainType, _audience?: AudienceType): Pillar {
  return DOMAIN_TO_PILLAR[domain]
}

// ─── Domain Slug (for drafter resolution) ────────────────

const DOMAIN_TO_SLUG: Record<DomainType, string> = {
  grove: "the-grove",
  consulting: "consulting",
  drumwave: "consulting",
  personal: "personal",
}

/**
 * Get the drafter slug for a domain.
 * Used by resolveDrafterIdByDomain in composer.ts.
 */
export function getDomainSlug(domain: DomainType): string {
  return DOMAIN_TO_SLUG[domain]
}
