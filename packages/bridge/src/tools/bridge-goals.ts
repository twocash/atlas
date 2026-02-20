/**
 * bridge_update_goals — Goal state management tool for Bridge Claude.
 *
 * Writes structured goal updates to the GOALS.md Notion page
 * (bridge.goals in System Prompts DB).
 *
 * Operations:
 *   - add_project: Add a new project under a pillar
 *   - update_project: Update phase, focus, status, or constraints
 *   - archive_project: Move a project to the Archived section
 *   - update_phase: Shorthand for updating phase + focus together
 *
 * All writes are fire-and-forget from Bridge Claude's perspective.
 * Failure triggers a console error and surfaces on next read (ADR-008).
 *
 * IMPORTANT: All goal updates require Jim's conversational confirmation
 * BEFORE calling this tool. Bridge proposes, Jim confirms, then Bridge writes.
 */

import { Client } from '@notionhq/client';

/** The Notion page ID for bridge.goals — set after first resolution */
let goalsPageId: string | null = null;

/** Goal update operation types */
export type GoalOperation = 'add_project' | 'update_project' | 'archive_project' | 'update_phase';

export interface GoalUpdateParams {
  operation: GoalOperation;
  pillar: string;         // the-grove | consulting | personal | home-garage
  project: string;        // Project name
  phase?: string;         // e.g., "Active Build", "Planning/Research"
  status?: string;        // e.g., "In Progress", "Active", "Maintaining"
  focus?: string;         // Current focus text
  done_looks_like?: string; // What done looks like
  actions?: string;       // Comma-separated action verbs
  constraints?: string;   // Constraints text
}

export interface GoalUpdateResult {
  success: boolean;
  error?: string;
}

/**
 * Resolve the GOALS page ID from the System Prompts DB.
 * Caches the result for the session lifetime.
 */
async function resolveGoalsPageId(notion: Client): Promise<string | null> {
  if (goalsPageId) return goalsPageId;

  const dbId = process.env.NOTION_PROMPTS_DB_ID || '2fc780a78eef8196b29bdb4a6adfdc27';

  try {
    const response = await notion.databases.query({
      database_id: dbId,
      filter: {
        property: 'ID',
        rich_text: { equals: 'bridge.goals' },
      },
      page_size: 1,
    });

    if (response.results.length > 0) {
      goalsPageId = response.results[0].id;
      return goalsPageId;
    }

    console.error('[bridge-goals] bridge.goals entry not found in System Prompts DB');
    return null;
  } catch (error) {
    console.error('[bridge-goals] Failed to resolve GOALS page ID:', error);
    return null;
  }
}

/** Format pillar slug to display name for the GOALS.md section header */
function pillarDisplayName(slug: string): string {
  const map: Record<string, string> = {
    'the-grove': 'The Grove',
    'consulting': 'Consulting',
    'personal': 'Personal',
    'home-garage': 'Home/Garage',
  };
  return map[slug] || slug;
}

/**
 * Write a goal update to the GOALS.md Notion page.
 *
 * Appends structured content as block children. The update includes
 * an ISO timestamp for audit trail.
 */
export async function updateGoals(params: GoalUpdateParams): Promise<GoalUpdateResult> {
  const apiKey = process.env.NOTION_API_KEY;
  if (!apiKey) {
    const error = 'NOTION_API_KEY not set — cannot write to GOALS';
    console.error(`[bridge-goals] ${error}`);
    return { success: false, error };
  }

  const notion = new Client({ auth: apiKey });
  const pageId = await resolveGoalsPageId(notion);

  if (!pageId) {
    return { success: false, error: 'Could not resolve bridge.goals page ID' };
  }

  const timestamp = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

  try {
    switch (params.operation) {
      case 'add_project': {
        // Build the project entry as block children
        const children: any[] = [
          {
            type: 'heading_3',
            heading_3: {
              rich_text: [{ type: 'text', text: { content: params.project } }],
            },
          },
        ];

        const fields: string[] = [];
        if (params.phase) fields.push(`**Phase:** ${params.phase}`);
        if (params.status) fields.push(`**Status:** ${params.status || 'Active'}`);
        if (params.focus) fields.push(`**Current Focus:** ${params.focus}`);
        if (params.done_looks_like) fields.push(`**What Done Looks Like:** ${params.done_looks_like}`);
        if (params.actions) fields.push(`**Actions:** ${params.actions}`);
        if (params.constraints) fields.push(`**Constraints:** ${params.constraints}`);
        fields.push(`**Added:** ${timestamp}`);

        for (const field of fields) {
          children.push({
            type: 'bulleted_list_item',
            bulleted_list_item: {
              rich_text: [{ type: 'text', text: { content: field } }],
            },
          });
        }

        await notion.blocks.children.append({
          block_id: pageId,
          children,
        });

        console.log(`[bridge-goals] Added project "${params.project}" under ${pillarDisplayName(params.pillar)}`);
        return { success: true };
      }

      case 'update_project':
      case 'update_phase': {
        // For updates, append a timestamped update note
        const updateParts: string[] = [];
        if (params.phase) updateParts.push(`Phase → ${params.phase}`);
        if (params.focus) updateParts.push(`Focus → ${params.focus}`);
        if (params.status) updateParts.push(`Status → ${params.status}`);
        if (params.constraints) updateParts.push(`Constraints → ${params.constraints}`);

        const updateText = `[${timestamp}] ${params.project} update: ${updateParts.join('; ')}`;

        await notion.blocks.children.append({
          block_id: pageId,
          children: [
            {
              type: 'bulleted_list_item',
              bulleted_list_item: {
                rich_text: [{ type: 'text', text: { content: updateText } }],
              },
            },
          ],
        });

        console.log(`[bridge-goals] Updated "${params.project}": ${updateParts.join(', ')}`);
        return { success: true };
      }

      case 'archive_project': {
        const archiveText = `[${timestamp}] ARCHIVED: ${params.project} (${pillarDisplayName(params.pillar)})`;

        await notion.blocks.children.append({
          block_id: pageId,
          children: [
            {
              type: 'bulleted_list_item',
              bulleted_list_item: {
                rich_text: [{ type: 'text', text: { content: archiveText } }],
              },
            },
          ],
        });

        console.log(`[bridge-goals] Archived "${params.project}" from ${pillarDisplayName(params.pillar)}`);
        return { success: true };
      }

      default:
        return { success: false, error: `Unknown operation: ${params.operation}` };
    }
  } catch (error: any) {
    const errorMsg = `Failed to write to GOALS: ${error.message}`;
    console.error(`[bridge-goals] ${errorMsg}`);
    return { success: false, error: errorMsg };
  }
}

/**
 * MCP tool schema for bridge_update_goals.
 * Used by the MCP server to register this tool.
 */
export const BRIDGE_GOALS_TOOL_SCHEMA = {
  name: 'bridge_update_goals',
  description:
    'Update Bridge Claude\'s goal state — add new projects, update phase/focus, ' +
    'or archive completed projects. Use this AFTER Jim confirms the update ' +
    'conversationally. Goals persist across sessions via Notion and inform ' +
    'Bridge Claude\'s contextual awareness of Jim\'s priorities.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      operation: {
        type: 'string',
        enum: ['add_project', 'update_project', 'archive_project', 'update_phase'],
        description: 'The goal update operation to perform',
      },
      pillar: {
        type: 'string',
        enum: ['the-grove', 'consulting', 'personal', 'home-garage'],
        description: 'Which pillar this project belongs to',
      },
      project: {
        type: 'string',
        description: 'The project name (e.g., "Atlas Development", "Garage Renovation")',
      },
      phase: {
        type: 'string',
        description: 'Project phase (e.g., "Active Build", "Planning/Research", "Operational")',
      },
      status: {
        type: 'string',
        description: 'Project status (e.g., "In Progress", "Active", "Maintaining", "Paused")',
      },
      focus: {
        type: 'string',
        description: 'Current focus description',
      },
      done_looks_like: {
        type: 'string',
        description: 'What done looks like for this project (add_project only)',
      },
      actions: {
        type: 'string',
        description: 'Comma-separated action verbs (e.g., "research, draft, build")',
      },
      constraints: {
        type: 'string',
        description: 'Project constraints (e.g., "Budget-aware, permit requirements")',
      },
    },
    required: ['operation', 'pillar', 'project'],
  },
};

/**
 * Handle a bridge_update_goals tool call from Claude Code.
 */
export async function handleBridgeGoalsTool(
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const params: GoalUpdateParams = {
    operation: args.operation as GoalOperation,
    pillar: args.pillar as string,
    project: args.project as string,
    phase: args.phase as string | undefined,
    status: args.status as string | undefined,
    focus: args.focus as string | undefined,
    done_looks_like: args.done_looks_like as string | undefined,
    actions: args.actions as string | undefined,
    constraints: args.constraints as string | undefined,
  };

  const result = await updateGoals(params);

  if (result.success) {
    const opLabels: Record<GoalOperation, string> = {
      add_project: 'Added project',
      update_project: 'Updated project',
      archive_project: 'Archived project',
      update_phase: 'Updated phase for',
    };
    return {
      content: [{
        type: 'text',
        text: `${opLabels[params.operation]} "${params.project}" in ${pillarDisplayName(params.pillar)}`,
      }],
    };
  }

  return {
    content: [{
      type: 'text',
      text: `Failed to update goals: ${result.error}`,
    }],
  };
}
