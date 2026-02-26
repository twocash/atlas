/**
 * Emergence Module — Barrel Export
 *
 * Sprint 4: CONV-ARCH-004 (Skill Emergence)
 */

// Types
export type {
  SessionAction,
  SessionGroup,
  IntentTransition,
  IntentSequence,
  SequencePattern,
  EmergenceSignal,
  EmergenceSource,
  DismissedPattern,
  EmergenceProposal,
  EmergenceConfig,
  EmergenceCheckResult,
  EmergenceEvent,
  EmergenceEventType,
} from './types';

export { DEFAULT_EMERGENCE_CONFIG } from './types';

// Session detection
export {
  querySessionActions,
  groupActionsBySession,
  extractIntentSequences,
  extractAllSequences,
  detectSequencePatterns,
} from './session-detector';

// Proposal generation
export {
  generateProposal,
  generateSkillName,
  formatProposalText,
} from './proposal-generator';

// Monitor (main entry point)
export {
  checkForEmergence,
  dismissProposal,
  approveProposal,
  onEmergenceEvent,
  offEmergenceEvent,
} from './monitor';

// Approval store (Telegram integration)
export {
  storeEmergenceProposal,
  hasPendingEmergenceProposal,
  getPendingEmergenceProposal,
  processEmergenceResponse,
} from './approval-store';
