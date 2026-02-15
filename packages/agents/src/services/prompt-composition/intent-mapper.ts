/**
 * Intent Mapper
 *
 * Maps IntentType (from UI flow) to ActionType (for prompt composition).
 * Also infers output format from intent + depth when not explicitly set.
 *
 * IntentType has 6 values: research, draft, save, analyze, capture, engage
 * ActionType has 5 values: research, draft, capture, analysis, summarize
 */

import type { IntentType, ActionType, DepthLevel, FormatType } from './types';

/**
 * Canonical mapping from intent → action.
 *
 * - research → research (direct)
 * - draft → draft (direct)
 * - save → capture (save is "quick capture" intent)
 * - analyze → analysis (noun form)
 * - capture → capture (direct)
 * - engage → draft (engagement content is drafted output)
 */
const INTENT_TO_ACTION: Record<IntentType, ActionType> = {
  research: 'research',
  draft: 'draft',
  save: 'capture',
  analyze: 'analysis',
  capture: 'capture',
  engage: 'draft',
};

/**
 * Map an IntentType to its corresponding ActionType
 */
export function mapIntentToAction(intent: IntentType): ActionType {
  return INTENT_TO_ACTION[intent];
}

/**
 * Infer output format from intent + depth when format is null.
 * Supersedes the inferFormat() in intent-callback.ts — the composition
 * package owns format inference.
 */
export function inferFormat(intent: IntentType, depth: DepthLevel): FormatType {
  switch (intent) {
    case 'draft':
      return depth === 'deep' ? 'report' : 'post';
    case 'research':
      return depth === 'deep' ? 'analysis' : 'brief';
    case 'engage':
      return 'thread';
    case 'capture':
    case 'save':
      return 'raw';
    case 'analyze':
      return depth === 'quick' ? 'brief' : 'analysis';
    default:
      return null;
  }
}
