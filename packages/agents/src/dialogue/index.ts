/**
 * Dialogue Module — Collaborative exploration for rough terrain.
 *
 * Sprint: CONV-ARCH-003 (Rough Terrain Dialogue)
 * EPIC: Conversational Architecture
 */

// Types
export type {
  Terrain,
  ThreadSource,
  Thread,
  DialogueState,
  DialogueResult,
} from "./types"

export { DIALOGUE_DEFAULTS } from "./types"

// Terrain Classifier
export { classifyTerrain, needsDialogue, assessmentNeedsDialogue } from "./terrain-classifier"

// Thread Surfacer
export { surfaceThreads, identifyAmbiguity, resetThreadCounter } from "./thread-surfacer"

// Dialogue Engine
export { enterDialogue, continueDialogue, isDialogueResolved } from "./engine"
