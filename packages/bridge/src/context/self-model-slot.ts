/**
 * Self-Model Slot Assembly — Slot 9 Wiring
 *
 * Bridges the self-model module (packages/agents/src/self-model/) to the
 * Bridge context slot system. Feature-gated by ATLAS_SELF_MODEL env var.
 *
 * Graceful degradation: returns empty slot when disabled or on any failure.
 *
 * Sprint: CONV-ARCH-001 (Self-Model — What Can Atlas Do?)
 */

import type { ContextSlot } from "../types/orchestration"
import { createSlot, createEmptySlot } from "./slots"

// Import from self-model module
import {
  assembleCapabilityModel,
  matchCapabilities,
  buildSelfModelSlotContent,
  buildEmptySelfModelSlot,
  getCachedModel,
} from "../../../../packages/agents/src/self-model"
import type { CapabilityDataProvider, TriageLike } from "../../../../packages/agents/src/self-model"

// ─── Feature Gate ─────────────────────────────────────────

function isSelfModelEnabled(): boolean {
  return process.env.ATLAS_SELF_MODEL !== "false"
}

// ─── Data Provider ────────────────────────────────────────

/**
 * The capability data provider for the Bridge context.
 * Set via `registerSelfModelProvider()` at Bridge startup.
 */
let dataProvider: CapabilityDataProvider | null = null

/**
 * Provider interface for the self-model slot.
 * Re-exported so the Bridge startup can pass in an adapter.
 */
export type SelfModelProvider = CapabilityDataProvider

/**
 * Register the data provider at Bridge startup.
 * Must be called before self-model slot assembly will work.
 */
export function registerSelfModelProvider(provider: CapabilityDataProvider): void {
  dataProvider = provider
  console.log("[self-model-slot] Provider registered")
}

// ─── Slot Assembly ────────────────────────────────────────

/**
 * Assemble the self-model context slot (Slot 9).
 *
 * @param triage - The triage result (needs intent, pillar, keywords, complexityTier)
 * @param messageText - The original user message
 */
export async function assembleSelfModelSlot(
  triage: TriageLike,
  messageText: string,
): Promise<ContextSlot> {
  // Gate: feature flag must be enabled
  if (!isSelfModelEnabled()) {
    return createEmptySlot("self_model", "feature-disabled")
  }

  // Gate: provider must be registered
  if (!dataProvider) {
    return createEmptySlot("self_model", "no-provider")
  }

  try {
    // Step 1: Get or build the capability model
    const model = await assembleCapabilityModel(dataProvider)

    // Step 2: Match capabilities to this request
    const matchResult = matchCapabilities(triage, messageText, model)

    // Step 3: Build the slot content
    const slotContent = buildSelfModelSlotContent(model, matchResult)

    if (!slotContent.text) {
      return createEmptySlot("self_model", "no-relevant-capabilities")
    }

    return createSlot({
      id: "self_model",
      source: "self-model",
      content: slotContent.text,
    })
  } catch (err) {
    console.warn("[self-model-slot] Assembly failed:", (err as Error).message)
    return createEmptySlot("self_model", "assembly-error")
  }
}
