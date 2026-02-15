/**
 * Depth Configuration
 *
 * Maps DepthLevel to temperature, maxTokens, and an instruction modifier.
 * These override the defaults from the prompt composition system.
 *
 * Coexists with the ResearchConfig depth mapping in intent-callback.ts
 * (quick→light, standard→standard, deep→deep) — that feeds the research
 * agent directly, this feeds the composition system. Different consumers.
 */

import type { DepthLevel } from './types';

export interface DepthConfig {
  /** Model temperature override */
  temperature: number;
  /** Max tokens override */
  maxTokens: number;
  /** Instruction modifier appended to the prompt */
  instructionModifier: string;
}

const DEPTH_CONFIGS: Record<DepthLevel, DepthConfig> = {
  quick: {
    temperature: 0.5,
    maxTokens: 2048,
    instructionModifier: 'Be concise. Focus on the most important points only. Keep the response brief and actionable.',
  },
  standard: {
    temperature: 0.7,
    maxTokens: 4096,
    instructionModifier: '',  // No modifier — standard is the baseline
  },
  deep: {
    temperature: 0.8,
    maxTokens: 8192,
    instructionModifier: 'Provide thorough, detailed analysis. Explore multiple perspectives. Include supporting evidence and citations where available.',
  },
};

/**
 * Get depth configuration for a given depth level
 */
export function getDepthConfig(depth: DepthLevel): DepthConfig {
  return DEPTH_CONFIGS[depth];
}
