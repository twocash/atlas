/**
 * Atlas Telegram Bot - Workspace Tools
 *
 * Read/write files within allowed workspace paths.
 */

import type Anthropic from '@anthropic-ai/sdk';
import { readFile, writeFile, mkdir, readdir } from 'fs/promises';
import { join, resolve, dirname } from 'path';
import { logger } from '../../logger';

// Allowed workspace paths (relative to apps/telegram/)
const WORKSPACE_ROOT = resolve(__dirname, '../../..');
const ALLOWED_PATHS = {
  skills: join(WORKSPACE_ROOT, 'data/skills'),
  memory: join(WORKSPACE_ROOT, 'data/memory'),
  temp: join(WORKSPACE_ROOT, 'data/temp'),
  exports: join(WORKSPACE_ROOT, 'data/exports'),
  conversations: join(WORKSPACE_ROOT, 'data/conversations'),
};

export const WORKSPACE_TOOLS: Anthropic.Tool[] = [
  {
    name: 'read_file',
    description: 'Read a file from the workspace. Only allowed in: skills/, memory/, temp/, exports/, conversations/.',
    input_schema: {
      type: 'object' as const,
      properties: {
        workspace: {
          type: 'string',
          enum: ['skills', 'memory', 'temp', 'exports', 'conversations'],
          description: 'Which workspace folder',
        },
        path: {
          type: 'string',
          description: 'Relative path within the workspace (e.g., "daily/2024-01-30.md")',
        },
      },
      required: ['workspace', 'path'],
    },
  },
  {
    name: 'write_file',
    description: 'Write a file to the workspace. Creates directories as needed. Only allowed in: skills/, memory/, temp/, exports/.',
    input_schema: {
      type: 'object' as const,
      properties: {
        workspace: {
          type: 'string',
          enum: ['skills', 'memory', 'temp', 'exports'],
          description: 'Which workspace folder (not conversations - that is managed automatically)',
        },
        path: {
          type: 'string',
          description: 'Relative path within the workspace',
        },
        content: {
          type: 'string',
          description: 'File content to write',
        },
      },
      required: ['workspace', 'path', 'content'],
    },
  },
  {
    name: 'list_workspace',
    description: 'List files in a workspace directory.',
    input_schema: {
      type: 'object' as const,
      properties: {
        workspace: {
          type: 'string',
          enum: ['skills', 'memory', 'temp', 'exports', 'conversations'],
          description: 'Which workspace folder',
        },
        path: {
          type: 'string',
          description: 'Relative path within the workspace (optional, defaults to root)',
        },
      },
      required: ['workspace'],
    },
  },
];

/**
 * Validate that a path is within allowed workspace
 */
function validatePath(workspace: string, relativePath: string): { valid: boolean; fullPath?: string; error?: string } {
  const baseDir = ALLOWED_PATHS[workspace as keyof typeof ALLOWED_PATHS];
  if (!baseDir) {
    return { valid: false, error: `Unknown workspace: ${workspace}` };
  }

  const fullPath = resolve(baseDir, relativePath);

  // Ensure the resolved path is still within the workspace (prevent ../ attacks)
  if (!fullPath.startsWith(baseDir)) {
    return { valid: false, error: 'Path escapes workspace directory' };
  }

  return { valid: true, fullPath };
}

/**
 * Execute workspace tools
 */
export async function executeWorkspaceTools(
  toolName: string,
  input: Record<string, unknown>
): Promise<{ success: boolean; result: unknown; error?: string } | null> {
  switch (toolName) {
    case 'read_file':
      return await executeReadFile(input);
    case 'write_file':
      return await executeWriteFile(input);
    case 'list_workspace':
      return await executeListWorkspace(input);
    default:
      return null;
  }
}

async function executeReadFile(
  input: Record<string, unknown>
): Promise<{ success: boolean; result: unknown; error?: string }> {
  const workspace = input.workspace as string;
  const path = input.path as string;

  const validation = validatePath(workspace, path);
  if (!validation.valid) {
    return { success: false, result: null, error: validation.error };
  }

  try {
    const content = await readFile(validation.fullPath!, 'utf-8');
    return {
      success: true,
      result: {
        path: `${workspace}/${path}`,
        content,
        size: content.length,
      },
    };
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return { success: false, result: null, error: `File not found: ${workspace}/${path}` };
    }
    logger.error('Read file failed', { error, workspace, path });
    return { success: false, result: null, error: String(error) };
  }
}

async function executeWriteFile(
  input: Record<string, unknown>
): Promise<{ success: boolean; result: unknown; error?: string }> {
  const workspace = input.workspace as string;
  const path = input.path as string;
  const content = input.content as string;

  // Don't allow writing to conversations (managed automatically)
  if (workspace === 'conversations') {
    return { success: false, result: null, error: 'Conversations workspace is read-only (managed automatically)' };
  }

  const validation = validatePath(workspace, path);
  if (!validation.valid) {
    return { success: false, result: null, error: validation.error };
  }

  try {
    // Create directory if needed
    await mkdir(dirname(validation.fullPath!), { recursive: true });

    // Write file
    await writeFile(validation.fullPath!, content, 'utf-8');

    logger.info('File written', { workspace, path, size: content.length });

    return {
      success: true,
      result: {
        path: `${workspace}/${path}`,
        size: content.length,
        message: 'File written successfully',
      },
    };
  } catch (error) {
    logger.error('Write file failed', { error, workspace, path });
    return { success: false, result: null, error: String(error) };
  }
}

async function executeListWorkspace(
  input: Record<string, unknown>
): Promise<{ success: boolean; result: unknown; error?: string }> {
  const workspace = input.workspace as string;
  const relativePath = (input.path as string) || '';

  const validation = validatePath(workspace, relativePath);
  if (!validation.valid) {
    return { success: false, result: null, error: validation.error };
  }

  try {
    const entries = await readdir(validation.fullPath!, { withFileTypes: true });

    const files = entries.map(entry => ({
      name: entry.name,
      type: entry.isDirectory() ? 'directory' : 'file',
    }));

    return {
      success: true,
      result: {
        path: relativePath ? `${workspace}/${relativePath}` : workspace,
        entries: files,
        count: files.length,
      },
    };
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return { success: true, result: { path: workspace, entries: [], count: 0 } };
    }
    logger.error('List workspace failed', { error, workspace });
    return { success: false, result: null, error: String(error) };
  }
}
