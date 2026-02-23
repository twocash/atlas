/**
 * Self-Model Module — Runtime capability awareness for Atlas.
 *
 * Public API:
 *   - assembleCapabilityModel() — build/refresh the capability index
 *   - matchCapabilities() — find relevant capabilities for a request
 *   - buildSelfModelSlotContent() — format for prompt injection
 *   - invalidateCache() — force refresh on next assembly
 *
 * Sprint: CONV-ARCH-001 (Self-Model — What Can Atlas Do?)
 */

// Types
export type {
  CapabilityModel,
  CapabilityHealth,
  CapabilityLayer,
  SkillCapability,
  SkillTrigger,
  MCPToolCapability,
  KnowledgeCapability,
  ExecutionCapability,
  IntegrationCapability,
  SurfaceCapability,
  CapabilityMatch,
  CapabilityAlternative,
  SelfModelSlotContent,
  RateLimitInfo,
  SelfModelCacheConfig,
} from "./types"

export { SELF_MODEL_DEFAULTS, MATCH_THRESHOLDS } from "./types"

// Assembler
export {
  assembleCapabilityModel,
  getCachedModel,
  invalidateCache,
} from "./assembler"
export type { CapabilityDataProvider, SkillInfo, MCPServerInfo, KnowledgeSourceInfo, IntegrationHealthInfo, SurfaceInfo } from "./assembler"

// Matcher
export { matchCapabilities } from "./matcher"
export type { TriageLike, MatchResult } from "./matcher"

// Slot builder
export { buildSelfModelSlotContent, buildEmptySelfModelSlot } from "./slot"
