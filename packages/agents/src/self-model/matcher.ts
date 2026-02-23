/**
 * Capability Matcher — Maps requests to relevant capabilities.
 *
 * Given a triage result and the capability model, the matcher determines
 * which capabilities are relevant for handling the request. Results are
 * scored by confidence and used to populate the self-model slot.
 *
 * Matching strategies (applied in order):
 *   1. Skill trigger matching — exact command/keyword/intent matches
 *   2. Intent-layer mapping — triage intent → execution capabilities
 *   3. Pillar affinity — pillar-tagged skills get a boost
 *   4. Integration requirements — what services the request needs
 *
 * Sprint: CONV-ARCH-001 (Self-Model — What Can Atlas Do?)
 */

import type {
  CapabilityModel,
  CapabilityMatch,
  CapabilityAlternative,
  CapabilityLayer,
  SkillCapability,
} from "./types"
import { MATCH_THRESHOLDS } from "./types"

// ─── Triage Interface ─────────────────────────────────────

/** Minimal triage shape the matcher needs */
export interface TriageLike {
  intent: string
  pillar: string
  keywords: string[]
  complexityTier: number
  requestType?: string
  command?: { name: string; args?: string }
}

// ─── Match Result ─────────────────────────────────────────

export interface MatchResult {
  /** Primary match (highest confidence) — may be null if nothing matches */
  primary: CapabilityMatch | null
  /** All relevant matches above the relevance threshold */
  relevant: CapabilityMatch[]
  /** Summary strings for slot injection */
  relevantCapabilityNames: string[]
  /** Suggested strengths for this request context */
  strengths: string[]
  /** Known limitations for this request context */
  limitations: string[]
}

// ─── Matcher ──────────────────────────────────────────────

/**
 * Match a request against the capability model.
 *
 * @param triage - The triage result from intent classification
 * @param messageText - The original user message
 * @param model - The assembled capability model
 */
export function matchCapabilities(
  triage: TriageLike,
  messageText: string,
  model: CapabilityModel,
): MatchResult {
  const candidates: CapabilityMatch[] = []

  // Strategy 1: Skill trigger matching
  candidates.push(...matchSkills(triage, messageText, model.skills))

  // Strategy 2: Intent-layer mapping → execution capabilities
  candidates.push(...matchExecution(triage, model))

  // Strategy 3: Integration requirements
  candidates.push(...matchIntegrations(triage, model))

  // Strategy 4: Knowledge source relevance
  candidates.push(...matchKnowledge(triage, model))

  // Sort by confidence descending
  candidates.sort((a, b) => b.confidence - a.confidence)

  // Deduplicate (same capabilityId, keep highest confidence)
  const seen = new Set<string>()
  const deduped: CapabilityMatch[] = []
  for (const c of candidates) {
    if (!seen.has(c.capabilityId)) {
      seen.add(c.capabilityId)
      deduped.push(c)
    }
  }

  // Filter to relevant threshold
  const relevant = deduped.filter((c) => c.confidence >= MATCH_THRESHOLDS.relevant)
  const primary = relevant.length > 0 ? relevant[0] : null

  // Wire alternatives into each match
  for (const match of relevant) {
    match.alternatives = relevant
      .filter((a) => a.capabilityId !== match.capabilityId && a.confidence >= MATCH_THRESHOLDS.alternative)
      .slice(0, 3)
      .map((a) => ({
        capabilityId: a.capabilityId,
        layer: a.layer,
        confidence: a.confidence,
        reason: a.matchReason,
      }))
  }

  return {
    primary,
    relevant,
    relevantCapabilityNames: relevant.map((r) => r.capabilityId),
    strengths: deriveStrengths(triage, model, relevant),
    limitations: deriveLimitations(model),
  }
}

// ─── Strategy 1: Skill Matching ───────────────────────────

function matchSkills(
  triage: TriageLike,
  messageText: string,
  skills: SkillCapability[],
): CapabilityMatch[] {
  const matches: CapabilityMatch[] = []
  const textLower = messageText.toLowerCase()
  const keywordsLower = triage.keywords.map((k) => k.toLowerCase())

  for (const skill of skills) {
    if (!skill.available) continue

    let bestScore = 0
    let matchReason = ""

    // Check command name match
    if (triage.command?.name) {
      const cmdLower = triage.command.name.toLowerCase()
      if (skill.id.toLowerCase() === cmdLower || skill.triggers.some((t) => t.pattern.toLowerCase() === cmdLower)) {
        bestScore = 0.95
        matchReason = `Command match: ${triage.command.name}`
      }
    }

    // Check trigger pattern matches
    for (const trigger of skill.triggers) {
      const patternLower = trigger.pattern.toLowerCase()

      if (trigger.type === "command" && textLower.includes(patternLower)) {
        const score = 0.85
        if (score > bestScore) {
          bestScore = score
          matchReason = `Trigger phrase: "${trigger.pattern}"`
        }
      }

      if (trigger.type === "keyword") {
        if (keywordsLower.includes(patternLower) || textLower.includes(patternLower)) {
          const score = 0.7
          if (score > bestScore) {
            bestScore = score
            matchReason = `Keyword match: "${trigger.pattern}"`
          }
        }
      }
    }

    // Pillar affinity boost
    if (bestScore > 0 && skill.pillars.length > 0 && skill.pillars.includes(triage.pillar as any)) {
      bestScore = Math.min(bestScore + 0.05, 1.0)
      matchReason += ` [pillar: ${triage.pillar}]`
    }

    if (bestScore >= MATCH_THRESHOLDS.alternative) {
      matches.push({
        capabilityId: skill.id,
        layer: "skills",
        confidence: bestScore,
        matchReason,
        alternatives: [],
      })
    }
  }

  return matches
}

// ─── Strategy 2: Execution Mapping ────────────────────────

function matchExecution(triage: TriageLike, model: CapabilityModel): CapabilityMatch[] {
  const matches: CapabilityMatch[] = []

  // Map triage intent to execution capabilities
  const intentMap: Record<string, Array<{ type: string; confidence: number; reason: string }>> = {
    command: [
      { type: "agent_spawn", confidence: 0.6, reason: "Commands can dispatch agents" },
    ],
    query: [
      { type: "research_pipeline", confidence: 0.8, reason: "Queries route to research" },
      { type: "prompt_composition", confidence: 0.6, reason: "Queries use composed prompts" },
    ],
    capture: [
      { type: "prompt_composition", confidence: 0.7, reason: "Captures compose structured prompts" },
    ],
    clarify: [
      { type: "socratic_engine", confidence: 0.9, reason: "Clarification triggers Socratic flow" },
    ],
    chat: [
      { type: "prompt_composition", confidence: 0.5, reason: "Chat uses basic composition" },
    ],
  }

  const mappings = intentMap[triage.intent] ?? []

  for (const mapping of mappings) {
    const exec = model.execution.find((e) => e.type === mapping.type)
    if (exec && exec.available) {
      matches.push({
        capabilityId: exec.type,
        layer: "execution",
        confidence: mapping.confidence,
        matchReason: mapping.reason,
        alternatives: [],
      })
    }
  }

  // Tier 2-3 → bridge dispatch if available
  if (triage.complexityTier >= 2) {
    const dispatch = model.execution.find((e) => e.type === "bridge_dispatch")
    if (dispatch?.available) {
      matches.push({
        capabilityId: "bridge_dispatch",
        layer: "execution",
        confidence: 0.6,
        matchReason: `Tier ${triage.complexityTier} routes to Bridge dispatch`,
        alternatives: [],
      })
    }
  }

  return matches
}

// ─── Strategy 3: Integration Matching ─────────────────────

function matchIntegrations(triage: TriageLike, model: CapabilityModel): CapabilityMatch[] {
  const matches: CapabilityMatch[] = []

  // Capture intent always needs Notion
  if (triage.intent === "capture") {
    const notion = model.integrations.find((i) => i.service === "notion")
    if (notion?.authenticated) {
      matches.push({
        capabilityId: "notion",
        layer: "integrations",
        confidence: 0.8,
        matchReason: "Capture requires Notion for Feed/WQ entries",
        alternatives: [],
      })
    }
  }

  // Query intent benefits from RAG
  if (triage.intent === "query" && triage.complexityTier >= 2) {
    const rag = model.integrations.find((i) => i.service === "anythingllm")
    if (rag?.authenticated) {
      matches.push({
        capabilityId: "anythingllm",
        layer: "integrations",
        confidence: 0.6,
        matchReason: "Deep queries benefit from AnythingLLM RAG",
        alternatives: [],
      })
    }
  }

  return matches
}

// ─── Strategy 4: Knowledge Matching ───────────────────────

function matchKnowledge(triage: TriageLike, model: CapabilityModel): CapabilityMatch[] {
  const matches: CapabilityMatch[] = []
  const keywordsLower = triage.keywords.map((k) => k.toLowerCase())

  for (const source of model.knowledge) {
    if (!source.available) continue

    // Check domain overlap with keywords
    const domainOverlap = source.domains.some((d) =>
      keywordsLower.some((k) => d.toLowerCase().includes(k) || k.includes(d.toLowerCase())),
    )

    if (domainOverlap) {
      matches.push({
        capabilityId: `knowledge:${source.workspace}`,
        layer: "knowledge",
        confidence: 0.55,
        matchReason: `Domain overlap with ${source.workspace} workspace`,
        alternatives: [],
      })
    }
  }

  return matches
}

// ─── Strengths & Limitations ──────────────────────────────

function deriveStrengths(
  triage: TriageLike,
  model: CapabilityModel,
  relevant: CapabilityMatch[],
): string[] {
  const strengths: string[] = []

  // If we have relevant skills, that's a strength
  const skillMatches = relevant.filter((r) => r.layer === "skills")
  if (skillMatches.length > 0) {
    strengths.push(`${skillMatches.length} skill(s) directly match this request`)
  }

  // Research pipeline available for queries
  if (triage.intent === "query" && model.execution.some((e) => e.type === "research_pipeline" && e.available)) {
    strengths.push("Research pipeline with Gemini grounding available")
  }

  // RAG available
  if (model.knowledge.some((k) => k.available)) {
    strengths.push("Knowledge base indexed for domain-specific context")
  }

  // Multi-surface
  const activeSurfaces = model.surfaces.filter((s) => s.available).length
  if (activeSurfaces > 1) {
    strengths.push(`${activeSurfaces} active surfaces for input/output`)
  }

  return strengths
}

function deriveLimitations(model: CapabilityModel): string[] {
  const limitations: string[] = []

  // Degraded integrations
  const degradedIntegrations = model.integrations.filter((i) => i.health !== "healthy")
  for (const i of degradedIntegrations) {
    limitations.push(`${i.service}: ${i.healthDetail ?? i.health}`)
  }

  // Unavailable execution modes
  const unavailableExec = model.execution.filter((e) => !e.available)
  for (const e of unavailableExec) {
    limitations.push(`${e.name} not available (${e.constraints.join(", ")})`)
  }

  // Knowledge sources offline
  const offlineKnowledge = model.knowledge.filter((k) => !k.available)
  for (const k of offlineKnowledge) {
    limitations.push(`${k.workspace} knowledge offline`)
  }

  return limitations
}
