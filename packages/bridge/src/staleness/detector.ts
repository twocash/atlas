/**
 * Staleness Detector — evaluates goal freshness at session hydration.
 *
 * Checks GOALS.md project list against Feed 2.0 recent entries to determine
 * which projects have gone cold. Produces natural-language nudge proposals
 * for Bridge Claude to surface conversationally.
 *
 * Thresholds:
 *   >14 days no activity → "still active?" nudge
 *   >30 days no activity → "consider archiving" nudge
 *
 * Nudges are advisory — Bridge uses judgment about when to surface them.
 * No auto-archiving. Jim confirms all changes (ADR-006 pattern-based approval).
 */

import { Client } from '@notionhq/client';

/** Days of inactivity before triggering nudge levels */
const NUDGE_THRESHOLD_DAYS = 14;
const ARCHIVE_THRESHOLD_DAYS = 30;

/** Feed 2.0 database ID (SDK format) */
const FEED_DB_ID = '90b2b33f-4b44-4b42-870f-8d62fb8cbf18';

/** Pillar display names to Feed 2.0 pillar values */
const PILLAR_FEED_VALUES: Record<string, string[]> = {
  'The Grove': ['The Grove', 'the-grove'],
  'Consulting': ['Consulting', 'consulting'],
  'Personal': ['Personal', 'personal'],
  'Home/Garage': ['Home/Garage', 'home-garage'],
};

export interface ProjectStaleness {
  /** Project name from GOALS.md */
  project: string;
  /** Pillar this project belongs to */
  pillar: string;
  /** Days since last activity in Feed 2.0 */
  daysSinceActivity: number;
  /** Type of last activity (if found) */
  lastActivityType?: string;
  /** Natural language nudge text */
  nudgeText: string;
  /** Nudge severity: 'check_in' (>14d) or 'consider_archive' (>30d) */
  severity: 'check_in' | 'consider_archive';
}

export interface StalenessReport {
  /** Projects that are stale */
  staleProjects: ProjectStaleness[];
  /** Total projects checked */
  totalChecked: number;
  /** Whether any stale projects were found */
  hasStaleProjects: boolean;
  /** Timestamp of this check */
  checkedAt: string;
}

/**
 * Parse project names and pillar associations from GOALS.md content.
 *
 * Expects markdown structure with ## Pillar headers and ### Project subheaders.
 * Stops at "## Archived Projects" section.
 */
export function parseGoalsProjects(goalsContent: string): Array<{ project: string; pillar: string }> {
  const projects: Array<{ project: string; pillar: string }> = [];
  let currentPillar = '';

  for (const line of goalsContent.split('\n')) {
    const trimmed = line.trim();

    // Stop at archived section
    if (trimmed.startsWith('## Archived')) break;

    // Detect pillar headers (## The Grove, ## Consulting, etc.)
    const h2Match = trimmed.match(/^## (.+)/);
    if (h2Match) {
      const pillarName = h2Match[1].trim();
      // Skip non-pillar H2s (like "Active Goals & Projects", "Canonical Database IDs")
      if (Object.keys(PILLAR_FEED_VALUES).includes(pillarName)) {
        currentPillar = pillarName;
      }
      continue;
    }

    // Detect project headers (### Project Name)
    const h3Match = trimmed.match(/^### (.+)/);
    if (h3Match && currentPillar) {
      projects.push({
        project: h3Match[1].trim(),
        pillar: currentPillar,
      });
    }
  }

  return projects;
}

/**
 * Query Feed 2.0 for recent activity related to a pillar.
 *
 * Returns the most recent entry date for the given pillar,
 * looking back up to archive threshold + buffer days.
 */
async function getLastPillarActivity(
  notion: Client,
  pillar: string,
): Promise<{ date: Date | null; type?: string }> {
  const lookbackDays = ARCHIVE_THRESHOLD_DAYS + 7; // Buffer for edge cases
  const since = new Date();
  since.setDate(since.getDate() - lookbackDays);
  const sinceIso = since.toISOString().split('T')[0];

  try {
    const response = await notion.databases.query({
      database_id: FEED_DB_ID,
      filter: {
        and: [
          {
            property: 'Pillar',
            select: { equals: pillar },
          },
          {
            property: 'Created',
            date: { on_or_after: sinceIso },
          },
        ],
      },
      sorts: [{ property: 'Created', direction: 'descending' }],
      page_size: 1,
    });

    if (response.results.length === 0) {
      return { date: null };
    }

    const page = response.results[0] as any;
    const created = page.properties?.Created?.date?.start
      || page.created_time;

    // Try to get the entry type
    const type = page.properties?.Type?.select?.name;

    return {
      date: created ? new Date(created) : null,
      type,
    };
  } catch (error) {
    console.warn(`[staleness] Failed to query Feed 2.0 for ${pillar}:`, error);
    return { date: null };
  }
}

/**
 * Generate natural language nudge text based on staleness.
 */
function generateNudge(project: string, pillar: string, days: number): string {
  if (days >= ARCHIVE_THRESHOLD_DAYS) {
    return `Your "${project}" project under ${pillar} hasn't had any activity in ${days} days. Want to archive it, or is it still on the radar?`;
  }
  return `It's been ${days} days since any activity on "${project}" (${pillar}). Still active?`;
}

/**
 * Run staleness detection against GOALS.md projects and Feed 2.0 activity.
 *
 * Call this at session hydration. Returns a report with stale projects
 * and natural-language nudge proposals for Bridge to surface conversationally.
 */
export async function detectStaleness(goalsContent: string): Promise<StalenessReport> {
  const apiKey = process.env.NOTION_API_KEY;
  if (!apiKey) {
    console.warn('[staleness] NOTION_API_KEY not set — skipping staleness check');
    return {
      staleProjects: [],
      totalChecked: 0,
      hasStaleProjects: false,
      checkedAt: new Date().toISOString(),
    };
  }

  const notion = new Client({ auth: apiKey });
  const projects = parseGoalsProjects(goalsContent);

  if (projects.length === 0) {
    return {
      staleProjects: [],
      totalChecked: 0,
      hasStaleProjects: false,
      checkedAt: new Date().toISOString(),
    };
  }

  // Check each unique pillar (not each project — Feed 2.0 is per-pillar)
  const pillarActivity = new Map<string, { date: Date | null; type?: string }>();
  const uniquePillars = [...new Set(projects.map(p => p.pillar))];

  await Promise.all(
    uniquePillars.map(async (pillar) => {
      const activity = await getLastPillarActivity(notion, pillar);
      pillarActivity.set(pillar, activity);
    })
  );

  const now = new Date();
  const staleProjects: ProjectStaleness[] = [];

  for (const { project, pillar } of projects) {
    const activity = pillarActivity.get(pillar);
    if (!activity || !activity.date) {
      // No activity found at all — definitely stale
      staleProjects.push({
        project,
        pillar,
        daysSinceActivity: ARCHIVE_THRESHOLD_DAYS + 1, // Beyond archive threshold
        nudgeText: generateNudge(project, pillar, ARCHIVE_THRESHOLD_DAYS + 1),
        severity: 'consider_archive',
      });
      continue;
    }

    const daysSince = Math.floor((now.getTime() - activity.date.getTime()) / (1000 * 60 * 60 * 24));

    if (daysSince >= ARCHIVE_THRESHOLD_DAYS) {
      staleProjects.push({
        project,
        pillar,
        daysSinceActivity: daysSince,
        lastActivityType: activity.type,
        nudgeText: generateNudge(project, pillar, daysSince),
        severity: 'consider_archive',
      });
    } else if (daysSince >= NUDGE_THRESHOLD_DAYS) {
      staleProjects.push({
        project,
        pillar,
        daysSinceActivity: daysSince,
        lastActivityType: activity.type,
        nudgeText: generateNudge(project, pillar, daysSince),
        severity: 'check_in',
      });
    }
  }

  return {
    staleProjects,
    totalChecked: projects.length,
    hasStaleProjects: staleProjects.length > 0,
    checkedAt: new Date().toISOString(),
  };
}
