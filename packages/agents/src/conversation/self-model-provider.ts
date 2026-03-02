/**
 * Self-Model Data Provider — Telegram surface adapter for CapabilityDataProvider.
 *
 * Bridges Telegram bot internals (skills, MCP, health, etc.) to the
 * self-model assembler in packages/agents/. Each method wraps its body
 * in try/catch and returns a degraded-but-valid response on failure —
 * never throws (ADR-008).
 *
 * Sprint: STAB-001 (Wire The Stack)
 */

import type {
  CapabilityDataProvider,
  SkillInfo,
  MCPServerInfo,
  KnowledgeSourceInfo,
  IntegrationHealthInfo,
  SurfaceInfo,
} from "../self-model"

import { getSkillRegistry } from "../skills/registry"

// ─── Injectable Hooks (surface-specific runtime queries) ────

export interface SelfModelProviderHooks {
  getMcpStatus: () => Record<string, { status: string; toolCount: number; error?: string }>
  listMcpTools: () => Array<{ server: string; tool: string; description?: string }>
  anythingLlmHealthCheck: () => Promise<{ ok: boolean; error?: string }>
}

let _smHooks: SelfModelProviderHooks = {
  getMcpStatus: () => ({}),
  listMcpTools: () => [],
  anythingLlmHealthCheck: async () => ({ ok: false, error: "not wired" }),
}

export function setSelfModelProviderHooks(hooks: Partial<SelfModelProviderHooks>): void {
  _smHooks = { ..._smHooks, ...hooks }
}

// ─── Feature Flag Enumeration ───────────────────────────

/** Known feature flags that affect Atlas capabilities */
const KNOWN_FLAGS = [
  "ATLAS_SELF_MODEL",
  "ATLAS_CONTEXT_ENRICHMENT",
  "ATLAS_CONTENT_CONFIRM",
  "ATLAS_REQUEST_ASSESSMENT",
  "BRIDGE_DISPATCH",
] as const

// ─── Provider Implementation ────────────────────────────

class TelegramSelfModelProvider implements CapabilityDataProvider {
  async getSkills(): Promise<SkillInfo[]> {
    try {
      const registry = getSkillRegistry()
      const skills = registry.getAll()
      return skills.map((skill) => ({
        name: skill.name,
        description: skill.description,
        triggers: skill.triggers.map((t) => ({
          type: t.type,
          value: t.value,
          pillar: t.pillar,
        })),
        enabled: skill.enabled,
        metrics: skill.metrics
          ? {
              executionCount: skill.metrics.executionCount ?? 0,
              successCount: skill.metrics.successCount ?? 0,
              avgExecutionTime: skill.metrics.avgExecutionTime ?? 0,
              lastExecuted: skill.metrics.lastExecuted,
            }
          : undefined,
      }))
    } catch (err) {
      console.warn("[self-model-provider] getSkills failed:", (err as Error).message)
      return []
    }
  }

  async getMCPServers(): Promise<MCPServerInfo[]> {
    try {
      const status = _smHooks.getMcpStatus()
      const toolList = _smHooks.listMcpTools()

      return Object.entries(status).map(([serverId, info]) => ({
        serverId,
        status: info.status,
        toolCount: info.toolCount,
        toolNames: toolList
          .filter((t) => t.server === serverId)
          .map((t) => t.tool),
        error: info.error,
      }))
    } catch (err) {
      console.warn("[self-model-provider] getMCPServers failed:", (err as Error).message)
      return []
    }
  }

  async getKnowledgeSources(): Promise<KnowledgeSourceInfo[]> {
    try {
      const health = await _smHooks.anythingLlmHealthCheck()
      if (!health.ok) {
        return [
          {
            source: "anythingllm",
            workspace: "(offline)",
            documentCount: 0,
            domains: [],
            available: false,
          },
        ]
      }

      // AnythingLLM is reachable — report known workspaces
      // (Full enumeration via API could be added later; static list for now)
      const knownWorkspaces = ["grove-vision", "grove-technical", "monarch", "take-flight"]
      return knownWorkspaces.map((ws) => ({
        source: "anythingllm" as const,
        workspace: ws,
        documentCount: 0, // Not enumerated yet
        domains: [ws],
        available: true,
      }))
    } catch (err) {
      console.warn("[self-model-provider] getKnowledgeSources failed:", (err as Error).message)
      return []
    }
  }

  async getIntegrationHealth(): Promise<IntegrationHealthInfo[]> {
    try {
      // Report integration status based on environment configuration
      const integrations: IntegrationHealthInfo[] = []

      if (process.env.NOTION_API_KEY) {
        integrations.push({
          service: "notion",
          capabilities: ["feed", "work-queue", "prompts", "worldview"],
          status: "ok",
          message: "API key configured",
        })
      }

      if (process.env.ANTHROPIC_API_KEY) {
        integrations.push({
          service: "claude",
          capabilities: ["conversation", "triage", "classification"],
          status: "ok",
          message: "API key configured",
        })
      }

      if (process.env.GEMINI_API_KEY) {
        integrations.push({
          service: "gemini",
          capabilities: ["research", "media-analysis", "grounding"],
          status: "ok",
          message: "API key configured",
        })
      }

      if (process.env.ANYTHINGLLM_API_KEY) {
        integrations.push({
          service: "anythingllm",
          capabilities: ["domain-rag", "workspace-query"],
          status: "ok",
          message: "API key configured",
        })
      }

      return integrations
    } catch (err) {
      console.warn("[self-model-provider] getIntegrationHealth failed:", (err as Error).message)
      return []
    }
  }

  async getSurfaces(): Promise<SurfaceInfo[]> {
    try {
      return [
        {
          surface: "telegram",
          available: true,
          features: ["conversation", "media", "commands", "socratic", "content-confirm"],
        },
        {
          surface: "chrome_extension",
          available: true,
          features: ["linkedin-nav", "ai-classification", "reply-strategy"],
        },
        {
          surface: "bridge",
          available: process.env.BRIDGE_DISPATCH === "true",
          features: ["tool-dispatch", "context-assembly", "constitution"],
        },
      ]
    } catch (err) {
      console.warn("[self-model-provider] getSurfaces failed:", (err as Error).message)
      return []
    }
  }

  getFeatureFlags(): Record<string, boolean> {
    const flags: Record<string, boolean> = {}
    for (const flag of KNOWN_FLAGS) {
      const val = process.env[flag]
      // Feature flags: "true" → enabled, anything else → disabled
      flags[flag] = val === "true"
    }
    return flags
  }
}

// ─── Factory ────────────────────────────────────────────

/**
 * Create a self-model provider for the Telegram surface.
 * Called once at startup; the result is passed to registerSelfModelProvider().
 */
export function createSelfModelProvider(): CapabilityDataProvider {
  return new TelegramSelfModelProvider()
}
