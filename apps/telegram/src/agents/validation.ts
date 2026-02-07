/**
 * Research Agent Anti-Hallucination Validation
 *
 * Validates research output before it reaches the user:
 * 1. Tool execution check — did the agent actually call tools?
 * 2. URL fabrication check — are Notion URLs in output backed by tool results?
 * 3. Confidence threshold — is the agent confident enough?
 *
 * All failures auto-log to Dev Pipeline via HallucinationError.
 */

import { HallucinationError, ResearchAgentError } from '../errors';
import { logger } from '../logger';

export interface ResearchOutput {
  findings: string;
  confidence: number;
  toolExecutions: Array<{ tool: string; result: any }>;
  sources?: Array<{ url: string; title?: string }>;
}

const CONFIDENCE_THRESHOLD = 0.7;

/**
 * Validate research output — throws on hallucination or low confidence.
 * Call this BEFORE returning results to the user.
 */
export function validateResearchOutput(output: ResearchOutput): void {
  // Check 1: Tool actually called
  if (!output.toolExecutions || output.toolExecutions.length === 0) {
    throw new HallucinationError(
      'Research claimed completion without executing any tools',
      {
        findings: output.findings?.substring(0, 200),
        confidence: output.confidence,
        toolCount: 0,
      }
    );
  }

  // Check 2: No fabricated Notion URLs
  const notionUrls = extractNotionUrls(output.findings);
  if (notionUrls.length > 0) {
    const toolResultsStr = JSON.stringify(output.toolExecutions);

    for (const url of notionUrls) {
      // Extract the page ID portion for matching (Notion URLs vary in format)
      const pageId = extractPageIdFromUrl(url);
      if (pageId && !toolResultsStr.includes(pageId)) {
        throw new HallucinationError(
          `Fabricated Notion URL detected: ${url}`,
          {
            fabricatedUrl: url,
            pageId,
            toolCount: output.toolExecutions.length,
          }
        );
      }
    }
  }

  // Check 3: Confidence threshold
  if (output.confidence < CONFIDENCE_THRESHOLD) {
    throw new HallucinationError(
      `Research confidence ${output.confidence} below threshold ${CONFIDENCE_THRESHOLD}`,
      {
        confidence: output.confidence,
        threshold: CONFIDENCE_THRESHOLD,
        toolCount: output.toolExecutions.length,
      }
    );
  }

  logger.debug('Research output validated', {
    toolCount: output.toolExecutions.length,
    confidence: output.confidence,
    notionUrlCount: notionUrls.length,
  });
}

/**
 * Extract Notion URLs from text
 */
function extractNotionUrls(text: string): string[] {
  if (!text) return [];
  const regex = /https:\/\/(?:www\.)?notion\.so\/[a-zA-Z0-9\-/]+/g;
  return text.match(regex) || [];
}

/**
 * Extract page ID from a Notion URL (last 32-char hex segment)
 */
function extractPageIdFromUrl(url: string): string | null {
  // Notion URLs end with a 32-char hex ID (with or without dashes)
  const match = url.match(/([a-f0-9]{32})$/i) || url.match(/([a-f0-9-]{36})$/i);
  return match ? match[1].replace(/-/g, '') : null;
}

/**
 * Wrap a research execution with validation.
 * Use this to guard any research agent call.
 */
export async function withResearchValidation<T extends ResearchOutput>(
  executor: () => Promise<T>
): Promise<T> {
  try {
    const output = await executor();
    validateResearchOutput(output);
    return output;
  } catch (error) {
    if (error instanceof HallucinationError) {
      throw error; // Already logged via constructor
    }
    throw new ResearchAgentError(
      `Research execution failed: ${(error as Error).message}`,
      { originalError: (error as Error).message }
    );
  }
}
