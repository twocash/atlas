/**
 * Self-Model Types — Runtime capability awareness for Atlas.
 *
 * The self-model is Atlas's understanding of what it can do RIGHT NOW.
 * It indexes 6 capability layers assembled at runtime from registries,
 * MCP servers, knowledge sources, and system state.
 *
 * Architecture constraint: Self-model is observational, not prescriptive.
 * It reports what IS available, never invents capabilities that don't exist.
 *
 * Sprint: CONV-ARCH-001 (Self-Model — What Can Atlas Do?)
 * EPIC: Conversational Architecture
 */

import type { Pillar } from "../types"

// ─── Capability Layers ─────────────────────────────────────

/**
 * The 6 capability layers that compose Atlas's self-model.
 *
 * Layer 1: Skills — registered skills with trigger patterns
 * Layer 2: MCP Tools — connected MCP servers and their tools
 * Layer 3: Knowledge — RAG sources, workspaces, document corpora
 * Layer 4: Execution — agent types, dispatch modes, processing pipelines
 * Layer 5: Integrations — external services (Notion, Telegram, etc.)
 * Layer 6: Surfaces — input/output surfaces (chat, extension, bridge)
 */
export type CapabilityLayer =
  | "skills"
  | "mcp_tools"
  | "knowledge"
  | "execution"
  | "integrations"
  | "surfaces"

// ─── Skill Capabilities ───────────────────────────────────

/** How a skill can be triggered */
export interface SkillTrigger {
  /** Trigger type: command, keyword match, or intent-based */
  type: "command" | "keyword" | "intent"
  /** The pattern (command name, keyword, or intent label) */
  pattern: string
}

/**
 * A registered skill capability.
 *
 * Skills are the primary action surface — things Atlas can DO.
 * Telemetry fields are populated from Feed 2.0 usage data when available.
 */
export interface SkillCapability {
  /** Unique skill identifier (e.g. "health-check", "agent-dispatch") */
  id: string
  /** Human-readable name */
  name: string
  /** What this skill does (1-2 sentences) */
  description: string
  /** Which pillar(s) this skill serves (empty = universal) */
  pillars: Pillar[]
  /** How this skill can be invoked */
  triggers: SkillTrigger[]
  /** Whether the skill is currently available */
  available: boolean
  /** Why unavailable (if available === false) */
  unavailableReason?: string

  // ── Telemetry (populated from Feed when available) ──
  /** Success rate from recent executions (0-1) */
  successRate?: number
  /** Total invocation count */
  usageCount?: number
  /** Last successful invocation timestamp */
  lastUsed?: string
  /** Average execution time in ms */
  averageExecutionMs?: number
}

// ─── MCP Tool Capabilities ────────────────────────────────

/**
 * An MCP server and its available tools.
 *
 * Indexed from connected MCP servers at runtime.
 * Health reflects actual connectivity, not configuration.
 */
export interface MCPToolCapability {
  /** MCP server name (e.g. "notion", "supabase", "anythingllm") */
  server: string
  /** Tools exposed by this server */
  tools: string[]
  /** Whether the server is currently connected */
  connected: boolean
  /** Last observed response latency in ms */
  latencyMs?: number
  /** Rate limit info if applicable */
  rateLimit?: RateLimitInfo
}

/** Rate limit state for an external service */
export interface RateLimitInfo {
  /** Requests remaining in current window */
  remaining: number
  /** Window reset timestamp (ISO 8601) */
  resetsAt: string
  /** Total requests allowed per window */
  limit: number
}

// ─── Knowledge Capabilities ───────────────────────────────

/**
 * A knowledge source available for RAG or reference.
 *
 * Sources include AnythingLLM workspaces, Notion databases,
 * and any other indexed corpora.
 */
export interface KnowledgeCapability {
  /** Knowledge source type */
  source: "anythingllm" | "notion" | "pinecone" | "local"
  /** Workspace or database name */
  workspace: string
  /** Number of indexed documents (approximate) */
  documentCount: number
  /** Domain topics covered */
  domains: string[]
  /** Whether this source is currently queryable */
  available: boolean
  /** Last sync/index timestamp */
  lastSynced?: string
}

// ─── Execution Capabilities ───────────────────────────────

/**
 * An execution mode or processing capability.
 *
 * Covers agent types, dispatch modes, and pipeline stages.
 */
export interface ExecutionCapability {
  /** Execution type identifier */
  type: "agent_spawn" | "bridge_dispatch" | "research_pipeline" | "socratic_engine" | "prompt_composition"
  /** Human-readable name */
  name: string
  /** Whether this execution mode is currently available */
  available: boolean
  /** Constraints or prerequisites */
  constraints: string[]
  /** Required feature flags (if any) */
  requiredFlags?: string[]
}

// ─── Integration Capabilities ─────────────────────────────

/**
 * An external service integration.
 *
 * Integrations are services Atlas connects to for read/write operations.
 */
export interface IntegrationCapability {
  /** Service name (e.g. "notion", "telegram", "gemini") */
  service: string
  /** What Atlas can do with this service */
  capabilities: string[]
  /** Whether currently authenticated and reachable */
  authenticated: boolean
  /** Current health status */
  health: "healthy" | "degraded" | "offline"
  /** Health detail (if degraded or offline) */
  healthDetail?: string
}

// ─── Surface Capabilities ─────────────────────────────────

/**
 * An input/output surface Atlas operates on.
 *
 * Surfaces are where Atlas receives input and delivers output.
 */
export interface SurfaceCapability {
  /** Surface identifier */
  surface: "telegram" | "chrome_extension" | "bridge" | "cli"
  /** Whether this surface is currently active */
  available: boolean
  /** Features available on this surface */
  features: string[]
  /** Active connection count (if applicable) */
  activeConnections?: number
}

// ─── Capability Model (The Full Self-Model) ───────────────

/**
 * Atlas's complete runtime capability model.
 *
 * Assembled by the CapabilityAssembler, this represents everything
 * Atlas knows it can do RIGHT NOW. Cached with a 15-minute TTL.
 *
 * The model is observational: it reflects actual system state,
 * not aspirational configuration. If a service is down, the
 * capability is marked unavailable with a reason (ADR-008).
 */
export interface CapabilityModel {
  /** Layer 1: Registered skills */
  skills: SkillCapability[]
  /** Layer 2: Connected MCP tools */
  mcpTools: MCPToolCapability[]
  /** Layer 3: Knowledge sources */
  knowledge: KnowledgeCapability[]
  /** Layer 4: Execution modes */
  execution: ExecutionCapability[]
  /** Layer 5: Service integrations */
  integrations: IntegrationCapability[]
  /** Layer 6: Active surfaces */
  surfaces: SurfaceCapability[]

  // ── Model Metadata ──
  /** When this model was assembled */
  assembledAt: string
  /** Assembly duration in ms */
  assemblyDurationMs: number
  /** Model version (increments on schema change) */
  version: number
  /** Overall system health summary */
  health: CapabilityHealth
}

/**
 * Aggregate health summary across all capability layers.
 */
export interface CapabilityHealth {
  /** Overall status */
  status: "healthy" | "degraded" | "critical"
  /** Count of available capabilities */
  availableCount: number
  /** Count of unavailable/degraded capabilities */
  degradedCount: number
  /** Human-readable summary (e.g. "14/16 capabilities healthy") */
  summary: string
  /** List of degraded capability names for prompt injection */
  degradedCapabilities: string[]
}

// ─── Capability Matching ──────────────────────────────────

/**
 * Result of matching a request to capabilities.
 *
 * The matcher examines the triage result and finds which capabilities
 * are relevant. High-confidence matches (>0.9) can auto-route.
 */
export interface CapabilityMatch {
  /** The best-matching capability identifier */
  capabilityId: string
  /** Which layer this capability belongs to */
  layer: CapabilityLayer
  /** Match confidence (0-1) */
  confidence: number
  /** Why this capability matched */
  matchReason: string
  /** Alternative capabilities that could also handle this */
  alternatives: CapabilityAlternative[]
}

/** An alternative capability that could handle the request */
export interface CapabilityAlternative {
  /** Capability identifier */
  capabilityId: string
  /** Which layer */
  layer: CapabilityLayer
  /** Match confidence (0-1) */
  confidence: number
  /** Brief reason */
  reason: string
}

// ─── Self-Model Slot Output ───────────────────────────────

/**
 * The content injected into the Bridge prompt as Slot 9.
 *
 * This is what Claude sees about Atlas's capabilities when
 * constructing a response. It's a curated summary, not a dump.
 */
export interface SelfModelSlotContent {
  /** Capabilities relevant to THIS request (from matcher) */
  relevantCapabilities: string[]
  /** Top strengths for this request context */
  strengths: string[]
  /** Known limitations or degraded services */
  limitations: string[]
  /** Health warnings (if any services are down) */
  healthWarnings: string[]
  /** The assembled text content for the slot */
  text: string
  /** Estimated token count */
  tokenEstimate: number
}

// ─── Assembler Configuration ──────────────────────────────

/** Cache configuration for the capability model */
export interface SelfModelCacheConfig {
  /** Time-to-live in milliseconds (default: 15 minutes) */
  ttlMs: number
  /** Whether to refresh on health state changes */
  refreshOnHealthChange: boolean
}

/** Default cache configuration */
export const SELF_MODEL_DEFAULTS = {
  cacheTtlMs: 15 * 60 * 1000, // 15 minutes
  refreshOnHealthChange: true,
  modelVersion: 1,
  slotTokenBudget: 500,
} as const

/** Confidence thresholds for capability matching */
export const MATCH_THRESHOLDS = {
  /** Above this: auto-route to the capability */
  autoRoute: 0.9,
  /** Above this: include in relevant capabilities */
  relevant: 0.5,
  /** Above this: include as alternative */
  alternative: 0.3,
} as const
