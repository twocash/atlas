/**
 * Awakening Manifest — Declarative path expectations
 *
 * Lists every data path the cognitive layer depends on.
 * To add a new check, add an entry here. No validator logic changes needed.
 *
 * @module @atlas/shared/awakening
 */

import { resolve } from 'path';
import type { DataPathExpectation, CrossBoundaryExemption } from './types';

/**
 * Resolve the agents package root from shared's perspective.
 * shared/src/awakening/ → shared/ → agents/
 */
const AGENTS_ROOT = resolve(__dirname, '..', '..', '..', 'agents');

/** Resolve the skills superpower root */
const SKILLS_ROOT = resolve(__dirname, '..', '..', '..', 'skills', 'superpowers');

/**
 * All data paths the cognitive layer expects to exist at boot time.
 *
 * Criticality:
 *   - 'critical': startup MUST abort if missing (core operational data)
 *   - 'advisory': warn but continue (nice-to-have dirs)
 */
export function getDataPathExpectations(): DataPathExpectation[] {
  return [
    {
      path: resolve(AGENTS_ROOT, 'data', 'skills'),
      label: 'skills directory',
      referencedBy: 'packages/agents/src/conversation/tools/workspace.ts',
      criticality: 'advisory',
    },
    {
      path: resolve(AGENTS_ROOT, 'data', 'memory'),
      label: 'memory directory',
      referencedBy: 'packages/agents/src/conversation/tools/workspace.ts',
      criticality: 'advisory',
    },
    {
      path: resolve(AGENTS_ROOT, 'data', 'exports'),
      label: 'exports directory',
      referencedBy: 'packages/agents/src/conversation/tools/workspace.ts',
      criticality: 'advisory',
    },
    {
      path: resolve(AGENTS_ROOT, 'data', 'workspace'),
      label: 'workspace directory',
      referencedBy: 'packages/agents/src/conversation/tools/workspace.ts',
      criticality: 'advisory',
    },
    {
      path: resolve(AGENTS_ROOT, 'data', 'conversations'),
      label: 'conversations directory',
      referencedBy: 'packages/agents/src/conversation/tools/workspace.ts',
      criticality: 'advisory',
    },
    {
      path: resolve(AGENTS_ROOT, 'data', 'temp'),
      label: 'temp directory',
      referencedBy: 'packages/agents/src/conversation/tools/workspace.ts',
      criticality: 'advisory',
    },
    {
      path: resolve(AGENTS_ROOT, 'data', 'schedules'),
      label: 'schedules directory',
      referencedBy: 'packages/agents/src/services/schedule-store.ts',
      criticality: 'advisory',
    },
    {
      path: resolve(AGENTS_ROOT, 'data', 'migrations', 'prompts-v1.json'),
      label: 'fallback prompts seed data',
      referencedBy: 'packages/agents/src/services/prompt-manager.ts',
      criticality: 'advisory',
    },
    {
      path: SKILLS_ROOT,
      label: 'skills superpowers directory',
      referencedBy: 'packages/skills/superpowers/',
      criticality: 'advisory',
    },
  ];
}

/**
 * Cross-boundary paths that are intentionally allowed.
 * The drift scanner uses these to whitelist known exemptions.
 */
export const CROSS_BOUNDARY_EXEMPTIONS: CrossBoundaryExemption[] = [
  {
    file: 'packages/bridge/src/server.ts',
    line: 668,
    targetPath: 'apps/telegram/data/cookies',
    rationale: 'Cookies are shared with Telegram surface for authenticated web scraping',
  },
  {
    file: 'packages/bridge/src/tools/mcp-server.ts',
    line: 197,
    targetPath: 'apps/telegram/data/cookies',
    rationale: 'MCP server writes cookies consumed by Telegram bot for web scraping',
  },
];
