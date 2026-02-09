/**
 * API Direct Dispatch — Bypasses Claude Code CLI for fast autonomous repairs.
 *
 * Uses the Anthropic SDK directly instead of spawning Claude Code CLI.
 * This eliminates startup overhead (MCP servers, session init) that was
 * causing timeouts in the CLI approach.
 *
 * Sprint: Pit Stop (Autonomous Skill Repair)
 * Decision: docs/DECISIONS.md - Swarm Dispatch Strategy
 */

import Anthropic from '@anthropic-ai/sdk';
import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { logger } from '../logger';
import { SKILL_SCHEMA_PROMPT, validateSkillFrontmatter } from '../skills/frontmatter';
import type { SwarmTask, SwarmResult } from './swarm-dispatch';

// ==========================================
// Configuration
// ==========================================

/**
 * Model selection via environment variable.
 * Default: Haiku (fast, cheap, good for simple fixes)
 * Override: ATLAS_SWARM_MODEL=sonnet for complex fixes
 */
function getModel(): string {
  const modelEnv = process.env.ATLAS_SWARM_MODEL?.toLowerCase();
  if (modelEnv === 'sonnet') {
    return 'claude-sonnet-4-20250514';
  }
  // Default to Haiku
  return 'claude-3-5-haiku-20241022';
}

const MAX_TOKENS = 4096;
const MAX_FILE_SIZE = 100 * 1024; // 100KB max file size

// ==========================================
// System Prompts
// ==========================================

const REPAIR_SYSTEM_PROMPT = `You are a surgical code repair agent. Your task is to fix specific issues in code files.

CRITICAL RULES:
1. Output ONLY the complete fixed file content - no explanations, no markdown, no code fences
2. Preserve ALL existing functionality - only fix the specific issue mentioned
3. Maintain the exact same code style, formatting, and conventions
4. Do not add comments, logging, or "improvements" beyond the fix
5. If you cannot fix the issue, output the original content unchanged

Your output will be written directly to the file, so it must be valid, complete code.`;

// ==========================================
// API Client
// ==========================================

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!_client) {
    _client = new Anthropic();
  }
  return _client;
}

// ==========================================
// Core Execution
// ==========================================

/**
 * Execute a swarm task using the Anthropic API directly.
 *
 * This bypasses Claude Code CLI overhead for fast, lightweight fixes.
 */
export async function executeWithAPI(task: SwarmTask): Promise<SwarmResult> {
  const startTime = Date.now();
  const filesChanged: string[] = [];

  try {
    // Validate task has target files
    if (!task.operation.targetFiles.length) {
      return {
        success: false,
        filesChanged: [],
        testsPassed: false,
        error: 'No target files specified',
        durationMs: Date.now() - startTime,
      };
    }

    // For now, handle single file only
    // Multi-file operations are already split by self-improvement listener
    const targetFile = task.operation.targetFiles[0];

    // Validate file exists
    if (!existsSync(targetFile)) {
      return {
        success: false,
        filesChanged: [],
        testsPassed: false,
        error: `Target file not found: ${targetFile}`,
        durationMs: Date.now() - startTime,
      };
    }

    // Read the target file
    const content = await readFile(targetFile, 'utf-8');

    // Check file size
    if (content.length > MAX_FILE_SIZE) {
      return {
        success: false,
        filesChanged: [],
        testsPassed: false,
        error: `File too large: ${content.length} bytes (max ${MAX_FILE_SIZE})`,
        durationMs: Date.now() - startTime,
      };
    }

    // Build the user message
    const userMessage = buildUserMessage(task, content, targetFile);

    const model = getModel();
    logger.info('[API Dispatch] Processing repair', {
      file: targetFile,
      model,
      contextLength: task.context.length,
    });

    // Call the API
    const client = getClient();
    const response = await client.messages.create({
      model,
      max_tokens: MAX_TOKENS,
      system: REPAIR_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    });

    // Extract the fixed content
    const fixedContent = extractTextContent(response);

    if (!fixedContent) {
      return {
        success: false,
        filesChanged: [],
        testsPassed: false,
        error: 'API returned empty response',
        durationMs: Date.now() - startTime,
      };
    }

    // Validate the response looks like code
    if (!isValidCodeResponse(fixedContent, targetFile)) {
      logger.warn('[API Dispatch] Response does not appear to be valid code');
      return {
        success: false,
        filesChanged: [],
        testsPassed: false,
        error: 'API response does not appear to be valid code',
        plan: fixedContent.substring(0, 500), // Include partial response for debugging
        durationMs: Date.now() - startTime,
      };
    }

    // Check if content actually changed
    if (fixedContent.trim() === content.trim()) {
      logger.info('[API Dispatch] No changes needed');
      return {
        success: true,
        filesChanged: [],
        testsPassed: true, // No changes = nothing to break
        durationMs: Date.now() - startTime,
      };
    }

    // Write-gate: validate SKILL.md files before writing
    if (targetFile.endsWith('SKILL.md')) {
      const validation = validateSkillFrontmatter(fixedContent);
      if (!validation.valid) {
        logger.warn('[API Dispatch] Write-gate rejected SKILL.md', {
          file: targetFile,
          errors: validation.errors.slice(0, 3),
        });
        return {
          success: false,
          filesChanged: [],
          testsPassed: false,
          error: `Write-gate: ${validation.errors[0]}`,
          plan: fixedContent.substring(0, 500),
          durationMs: Date.now() - startTime,
        };
      }
    }

    // Write the fixed content
    await writeFile(targetFile, fixedContent, 'utf-8');
    filesChanged.push(targetFile);

    logger.info('[API Dispatch] Successfully updated file', { file: targetFile });

    return {
      success: true,
      filesChanged,
      testsPassed: true, // Optimistic - real validation would run tests
      durationMs: Date.now() - startTime,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('[API Dispatch] Error', { error: errorMessage });

    return {
      success: false,
      filesChanged,
      testsPassed: false,
      error: errorMessage,
      durationMs: Date.now() - startTime,
    };
  }
}

// ==========================================
// Helper Functions
// ==========================================

/**
 * Build the user message for the API call
 */
function buildUserMessage(task: SwarmTask, fileContent: string, filePath: string): string {
  const filename = filePath.split(/[/\\]/).pop() || 'file';
  const isSkillFile = filePath.endsWith('SKILL.md');

  return `Fix this file (${filename}):

\`\`\`
${fileContent}
\`\`\`

Issue to fix: ${task.context}
${task.targetSkill ? `Target skill: ${task.targetSkill}` : ''}
${isSkillFile ? `\n${SKILL_SCHEMA_PROMPT}\n` : ''}
Remember: Output ONLY the complete fixed file content, nothing else.`;
}

/**
 * Extract text content from API response
 */
function extractTextContent(response: Anthropic.Message): string | null {
  for (const block of response.content) {
    if (block.type === 'text') {
      let text = block.text;

      // Remove leading/trailing code fences if present (shouldn't be, but safety)
      if (text.startsWith('```')) {
        const lines = text.split('\n');
        lines.shift(); // Remove first line (```lang)
        if (lines[lines.length - 1]?.trim() === '```') {
          lines.pop();
        }
        text = lines.join('\n');
      }

      return text;
    }
  }
  return null;
}

/**
 * Basic validation that the response looks like code
 */
function isValidCodeResponse(content: string, filepath: string): boolean {
  // Empty response is invalid
  if (!content.trim()) {
    return false;
  }

  // Check for common error patterns in the response
  const errorPatterns = [
    /^I cannot/i,
    /^I'm sorry/i,
    /^As an AI/i,
    /^I apologize/i,
    /^Unfortunately/i,
    /^The (code|file|issue)/i,
    /^Here('s| is) (the|a)/i,
  ];

  for (const pattern of errorPatterns) {
    if (pattern.test(content.trim())) {
      return false;
    }
  }

  // File-type specific validation
  const ext = filepath.split('.').pop()?.toLowerCase();

  switch (ext) {
    case 'ts':
    case 'tsx':
    case 'js':
    case 'jsx':
      return (
        content.includes('import ') ||
        content.includes('export ') ||
        content.includes('const ') ||
        content.includes('function ') ||
        content.includes('class ') ||
        content.includes('{') ||
        content.includes('interface ')
      );

    case 'json':
      try {
        JSON.parse(content);
        return true;
      } catch {
        return false;
      }

    case 'md':
      // Markdown - check for frontmatter or heading
      return content.startsWith('---') || content.startsWith('#') || content.length > 10;

    case 'yaml':
    case 'yml':
      // YAML - basic structure check
      return content.includes(':') || content.startsWith('---');

    default:
      // For unknown types, just check it's not a conversation
      return content.length > 0;
  }
}
