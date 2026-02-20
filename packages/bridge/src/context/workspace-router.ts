/**
 * Workspace Router — Slot 2 Wiring
 *
 * Maps triage pillars to AnythingLLM workspace slugs.
 * Registry-based, configurable. Returns null for unmapped pillars.
 */

// ─── Types ───────────────────────────────────────────────

export interface WorkspaceMapping {
  /** Primary workspace slug for queries */
  primary: string
  /** Secondary workspace slug (future: multi-workspace merge) */
  secondary?: string
}

// ─── Pillar → Workspace Registry ─────────────────────────

/**
 * Map pillar values (from triage) to AnythingLLM workspace slugs.
 *
 * Pillar values from triage: "The Grove", "Consulting", "Personal", "Home/Garage"
 * Workspace slugs: grove-research, take-flight, etc.
 */
const PILLAR_WORKSPACE_MAP: Record<string, WorkspaceMapping> = {
  "the-grove": { primary: "grove-technical", secondary: "grove-vision" },
  consulting: { primary: "monarch", secondary: "take-flight" },
  // personal and home-garage have no workspace mapping
}

// ─── Slug Normalization ──────────────────────────────────

/**
 * Normalize a triage pillar value to a registry key.
 * Handles "The Grove" → "the-grove", "Home/Garage" → "home-garage", etc.
 */
export function normalizePillar(pillar: string): string {
  return pillar.toLowerCase().replace(/[\s\/]+/g, "-")
}

// ─── Router ──────────────────────────────────────────────

/**
 * Resolve a triage pillar to its primary workspace slug.
 * Returns null if the pillar has no workspace mapping.
 *
 * @param pillar - Pillar string from TriageResult (e.g. "The Grove", "Consulting")
 */
export function resolveWorkspace(pillar: string): string | null {
  const key = normalizePillar(pillar)
  const mapping = PILLAR_WORKSPACE_MAP[key]
  return mapping?.primary ?? null
}

/**
 * Get the full workspace mapping for a pillar (primary + secondary).
 * Returns null if the pillar has no workspace mapping.
 */
export function getWorkspaceMapping(pillar: string): WorkspaceMapping | null {
  const key = normalizePillar(pillar)
  return PILLAR_WORKSPACE_MAP[key] ?? null
}

/**
 * Get all configured workspace slugs (for startup logging).
 */
export function getConfiguredWorkspaces(): string[] {
  const slugs: string[] = []
  for (const mapping of Object.values(PILLAR_WORKSPACE_MAP)) {
    slugs.push(mapping.primary)
    if (mapping.secondary) slugs.push(mapping.secondary)
  }
  return slugs
}
