/**
 * Capability Assembler — Builds the runtime self-model from live system state.
 *
 * Indexes 6 capability layers:
 *   1. Skills — from SkillRegistry (apps/telegram/src/skills/registry.ts)
 *   2. MCP Tools — from connected MCP servers (apps/telegram/src/mcp/index.ts)
 *   3. Knowledge — from AnythingLLM + Notion workspace state
 *   4. Execution — from agent registry + feature flags
 *   5. Integrations — from health check subsystem
 *   6. Surfaces — from active connections
 *
 * Architecture constraint: Observational, not prescriptive.
 * Reports what IS available. If a source is unreachable, the layer
 * degrades gracefully — never invents capabilities (ADR-008).
 *
 * Sprint: CONV-ARCH-001 (Self-Model — What Can Atlas Do?)
 */

import type {
  CapabilityModel,
  CapabilityHealth,
  SkillCapability,
  MCPToolCapability,
  KnowledgeCapability,
  ExecutionCapability,
  IntegrationCapability,
  SurfaceCapability,
  SELF_MODEL_DEFAULTS,
} from "./types"
import { SELF_MODEL_DEFAULTS as DEFAULTS } from "./types"

// ─── Provider Interfaces ──────────────────────────────────
//
// These interfaces decouple the assembler from concrete implementations.
// At wiring time, the bridge passes in adapters that satisfy these contracts.
// This prevents the agents package from importing telegram internals.

/**
 * Skill data as seen by the assembler.
 * Mapped from SkillDefinition by the adapter at wiring time.
 */
export interface SkillInfo {
  name: string
  description: string
  triggers: Array<{ type: string; value: string; pillar?: string }>
  enabled: boolean
  metrics?: {
    executionCount: number
    successCount: number
    avgExecutionTime: number
    lastExecuted?: string
  }
}

/** MCP server status as seen by the assembler */
export interface MCPServerInfo {
  serverId: string
  status: string
  toolCount: number
  toolNames: string[]
  error?: string
}

/** AnythingLLM workspace info */
export interface KnowledgeSourceInfo {
  source: "anythingllm" | "notion" | "pinecone" | "local"
  workspace: string
  documentCount: number
  domains: string[]
  available: boolean
  lastSynced?: string
}

/** Health check result for an integration */
export interface IntegrationHealthInfo {
  service: string
  capabilities: string[]
  status: "ok" | "warn" | "error"
  message: string
}

/** Surface connection info */
export interface SurfaceInfo {
  surface: "telegram" | "chrome_extension" | "bridge" | "cli"
  available: boolean
  features: string[]
  activeConnections?: number
}

/**
 * Data provider — the bridge passes this in at wiring time.
 * Each method returns available data or empty arrays on failure.
 */
export interface CapabilityDataProvider {
  getSkills(): Promise<SkillInfo[]>
  getMCPServers(): Promise<MCPServerInfo[]>
  getKnowledgeSources(): Promise<KnowledgeSourceInfo[]>
  getIntegrationHealth(): Promise<IntegrationHealthInfo[]>
  getSurfaces(): Promise<SurfaceInfo[]>
  getFeatureFlags(): Record<string, boolean>
}

// ─── Cache ────────────────────────────────────────────────

let cachedModel: CapabilityModel | null = null
let cacheTimestamp = 0

/** Check if the cached model is still valid */
function isCacheValid(): boolean {
  if (!cachedModel) return false
  return Date.now() - cacheTimestamp < DEFAULTS.cacheTtlMs
}

/** Invalidate the cache (call on health state changes) */
export function invalidateCache(): void {
  cachedModel = null
  cacheTimestamp = 0
}

// ─── Layer Assemblers ─────────────────────────────────────

function assembleSkills(infos: SkillInfo[]): SkillCapability[] {
  return infos.map((info) => ({
    id: info.name,
    name: info.name,
    description: info.description,
    pillars: extractPillars(info.triggers),
    triggers: info.triggers.map((t) => ({
      type: mapTriggerType(t.type),
      pattern: t.value,
    })),
    available: info.enabled,
    successRate: info.metrics
      ? info.metrics.executionCount > 0
        ? info.metrics.successCount / info.metrics.executionCount
        : undefined
      : undefined,
    usageCount: info.metrics?.executionCount,
    lastUsed: info.metrics?.lastExecuted,
    averageExecutionMs: info.metrics?.avgExecutionTime,
  }))
}

function assembleMCPTools(servers: MCPServerInfo[]): MCPToolCapability[] {
  return servers.map((s) => ({
    server: s.serverId,
    tools: s.toolNames,
    connected: s.status === "connected",
  }))
}

function assembleKnowledge(sources: KnowledgeSourceInfo[]): KnowledgeCapability[] {
  return sources.map((s) => ({
    source: s.source,
    workspace: s.workspace,
    documentCount: s.documentCount,
    domains: s.domains,
    available: s.available,
    lastSynced: s.lastSynced,
  }))
}

function assembleExecution(flags: Record<string, boolean>): ExecutionCapability[] {
  return [
    {
      type: "agent_spawn",
      name: "Agent Dispatch",
      available: true,
      constraints: ["Requires agent type config", "Max 5 minute timeout default"],
    },
    {
      type: "bridge_dispatch",
      name: "Bridge Autonomous Dispatch",
      available: flags["BRIDGE_DISPATCH"] ?? false,
      constraints: ["Opt-in via BRIDGE_DISPATCH=true"],
      requiredFlags: ["BRIDGE_DISPATCH"],
    },
    {
      type: "research_pipeline",
      name: "Research Intelligence Pipeline",
      available: true,
      constraints: ["Requires Gemini API key for grounded search"],
    },
    {
      type: "socratic_engine",
      name: "Socratic Capture Engine",
      available: true,
      constraints: ["Requires Claude API for intent resolution"],
    },
    {
      type: "prompt_composition",
      name: "Structured Prompt Composition",
      available: true,
      constraints: ["Requires Notion system prompts to be hydrated"],
    },
    {
      type: "headed_browser",
      name: "Headed Browser Automation",
      available: flags["BRIDGE_RELAY"] ?? false,
      constraints: [
        "Launches visible Chromium on grove-node-1 — Jim authenticates manually, Atlas takes programmatic control",
        "Use for: Gmail, LinkedIn, Calendar, client portals, any authenticated web service",
        "Session cookies persist to disk — auth is one-time per service, future requests reuse saved sessions",
        "Tools: atlas_headed_launch → atlas_headed_auth_wait → atlas_headed_interact / atlas_headed_content / atlas_headed_screenshot",
      ],
      requiredFlags: ["BRIDGE_RELAY"],
    },
  ]
}

function assembleIntegrations(healthInfos: IntegrationHealthInfo[]): IntegrationCapability[] {
  return healthInfos.map((h) => ({
    service: h.service,
    capabilities: h.capabilities,
    authenticated: h.status !== "error",
    health: h.status === "ok" ? "healthy" : h.status === "warn" ? "degraded" : "offline",
    healthDetail: h.status !== "ok" ? h.message : undefined,
  }))
}

function assembleSurfaces(surfaceInfos: SurfaceInfo[]): SurfaceCapability[] {
  return surfaceInfos.map((s) => ({
    surface: s.surface,
    available: s.available,
    features: s.features,
    activeConnections: s.activeConnections,
  }))
}

// ─── Health Aggregation ───────────────────────────────────

function computeHealth(model: Omit<CapabilityModel, "health" | "assembledAt" | "assemblyDurationMs" | "version">): CapabilityHealth {
  const degraded: string[] = []

  // Check skills
  for (const s of model.skills) {
    if (!s.available) degraded.push(`skill:${s.id}`)
  }
  // Check MCP
  for (const m of model.mcpTools) {
    if (!m.connected) degraded.push(`mcp:${m.server}`)
  }
  // Check knowledge
  for (const k of model.knowledge) {
    if (!k.available) degraded.push(`knowledge:${k.workspace}`)
  }
  // Check execution
  for (const e of model.execution) {
    if (!e.available) degraded.push(`execution:${e.type}`)
  }
  // Check integrations
  for (const i of model.integrations) {
    if (i.health !== "healthy") degraded.push(`integration:${i.service}`)
  }
  // Check surfaces
  for (const s of model.surfaces) {
    if (!s.available) degraded.push(`surface:${s.surface}`)
  }

  const totalCount =
    model.skills.length +
    model.mcpTools.length +
    model.knowledge.length +
    model.execution.length +
    model.integrations.length +
    model.surfaces.length

  const availableCount = totalCount - degraded.length

  let status: CapabilityHealth["status"] = "healthy"
  if (degraded.length > 0) status = "degraded"
  if (degraded.length > totalCount / 2) status = "critical"

  return {
    status,
    availableCount,
    degradedCount: degraded.length,
    summary: `${availableCount}/${totalCount} capabilities healthy`,
    degradedCapabilities: degraded,
  }
}

// ─── Helpers ──────────────────────────────────────────────

function extractPillars(triggers: Array<{ type: string; pillar?: string }>): Array<"Personal" | "The Grove" | "Consulting" | "Home/Garage"> {
  const pillars = new Set<string>()
  for (const t of triggers) {
    if (t.pillar) pillars.add(t.pillar)
  }
  return Array.from(pillars) as Array<"Personal" | "The Grove" | "Consulting" | "Home/Garage">
}

function mapTriggerType(type: string): "command" | "keyword" | "intent" {
  switch (type) {
    case "phrase":
    case "pattern":
      return "command"
    case "keyword":
    case "contentType":
      return "keyword"
    case "intentHash":
    case "pillar":
      return "intent"
    default:
      return "keyword"
  }
}

// ─── Main Assembler ───────────────────────────────────────

/**
 * Assemble the full capability model from live system state.
 *
 * Uses cached result if within TTL. Each layer assembles independently
 * with graceful degradation — if one source fails, the others still populate.
 *
 * @param provider - Data provider with methods to query each source
 * @param forceRefresh - Skip cache and re-assemble
 */
export async function assembleCapabilityModel(
  provider: CapabilityDataProvider,
  forceRefresh = false,
): Promise<CapabilityModel> {
  // Return cached model if valid
  if (!forceRefresh && isCacheValid() && cachedModel) {
    return cachedModel
  }

  const start = Date.now()

  // Assemble all layers in parallel — each degrades independently
  const [skillInfos, mcpInfos, knowledgeInfos, integrationInfos, surfaceInfos] =
    await Promise.all([
      safeCall(provider.getSkills(), []),
      safeCall(provider.getMCPServers(), []),
      safeCall(provider.getKnowledgeSources(), []),
      safeCall(provider.getIntegrationHealth(), []),
      safeCall(provider.getSurfaces(), []),
    ])

  const flags = provider.getFeatureFlags()

  const skills = assembleSkills(skillInfos)
  const mcpTools = assembleMCPTools(mcpInfos)
  const knowledge = assembleKnowledge(knowledgeInfos)
  const execution = assembleExecution(flags)
  const integrations = assembleIntegrations(integrationInfos)
  const surfaces = assembleSurfaces(surfaceInfos)

  const partial = { skills, mcpTools, knowledge, execution, integrations, surfaces }
  const health = computeHealth(partial)

  const model: CapabilityModel = {
    ...partial,
    assembledAt: new Date().toISOString(),
    assemblyDurationMs: Date.now() - start,
    version: DEFAULTS.modelVersion,
    health,
  }

  // Cache the result
  cachedModel = model
  cacheTimestamp = Date.now()

  return model
}

/**
 * Get the current cached model without re-assembling.
 * Returns null if no model has been assembled yet.
 */
export function getCachedModel(): CapabilityModel | null {
  return isCacheValid() ? cachedModel : null
}

/** Safely call an async function, returning fallback on error */
async function safeCall<T>(promise: Promise<T>, fallback: T): Promise<T> {
  try {
    return await promise
  } catch (err) {
    console.warn("[self-model] Layer assembly failed:", (err as Error).message)
    return fallback
  }
}
