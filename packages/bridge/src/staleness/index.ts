/**
 * Staleness Detection Module
 *
 * Evaluates goal freshness at session hydration and produces
 * natural-language nudge proposals for Bridge Claude.
 */

export {
  detectStaleness,
  parseGoalsProjects,
  type ProjectStaleness,
  type StalenessReport,
} from './detector';
