/**
 * Research Pipeline Config — Public Exports
 *
 * ATLAS-DRC-001a: Declarative Research Config
 */

// Types
export type {
  ResearchPipelineConfig,
  ResolvedConfig,
  ConfigSource,
  DepthProfile,
  AndonThresholds,
  SearchProviderConfig,
  EvidencePresetAssignment,
} from './types';

// Compiled defaults
export { COMPILED_DEFAULTS } from './types';

// Resolver
export {
  getResearchPipelineConfig,
  getResearchPipelineConfigSync,
  invalidateConfigCache,
  injectConfig,
  resetNotionClient,
} from './research-config';
