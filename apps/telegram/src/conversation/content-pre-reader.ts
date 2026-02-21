/**
 * Content Pre-Reader — Haiku Summary Before Socratic Interview
 *
 * Calls Claude Haiku to produce a 2-3 sentence summary of extracted web content
 * so Jim sees what Atlas extracted before answering "What's the play?"
 *
 * Cost: ~$0.001/call. Latency: ~1-2s.
 * Graceful degradation: returns { success: false } on any failure — pipeline continues without summary.
 */

import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../logger';

export interface ContentPreRead {
  /** 2-3 sentence Haiku summary of extracted content */
  summary: string;
  /** article | social_post | discussion | profile | unknown */
  contentType: string;
  success: boolean;
  /** Why pre-read failed (empty content, API error, etc.) */
  failureReason?: string;
  latencyMs: number;
}

const ANTHROPIC_API_KEY = (process.env.ANTHROPIC_API_KEY || '').trim();

const PRE_READ_PROMPT = `You are a content analyst. Read this extracted web content and provide:
1. A 2-3 sentence summary of what this content is actually about (the topic, argument, or news)
2. The content type (article, social_post, discussion, profile, unknown)

URL: {url}
Page title: {title}
Content:
{content}

Respond as JSON: { "summary": "...", "contentType": "..." }`;

/**
 * Pre-read extracted content with Haiku to produce a summary.
 *
 * Non-blocking, non-fatal: if this fails the pipeline continues without a summary.
 * CONSTRAINT 4: failures are logged, never swallowed.
 */
export async function preReadContent(
  extractedContent: string,
  url: string,
  title: string,
): Promise<ContentPreRead> {
  const start = Date.now();

  if (!ANTHROPIC_API_KEY) {
    logger.warn('[PreReader] No ANTHROPIC_API_KEY — skipping pre-read');
    return { summary: '', contentType: 'unknown', success: false, failureReason: 'No API key', latencyMs: 0 };
  }

  if (!extractedContent || extractedContent.trim().length < 50) {
    logger.info('[PreReader] Content too short for pre-read', { length: extractedContent?.length ?? 0 });
    return { summary: '', contentType: 'unknown', success: false, failureReason: 'Content too short', latencyMs: Date.now() - start };
  }

  try {
    const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

    const prompt = PRE_READ_PROMPT
      .replace('{url}', url)
      .replace('{title}', title)
      .replace('{content}', extractedContent.slice(0, 2000));

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
    });

    const latencyMs = Date.now() - start;

    // Extract text from response
    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map(block => block.text)
      .join('');

    if (!text) {
      logger.warn('[PreReader] Haiku returned empty response', { url, latencyMs });
      return { summary: '', contentType: 'unknown', success: false, failureReason: 'Empty response', latencyMs };
    }

    // Parse JSON from response (handle markdown code fences)
    const jsonStr = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const parsed = JSON.parse(jsonStr) as { summary?: string; contentType?: string };

    if (!parsed.summary) {
      logger.warn('[PreReader] Haiku response missing summary field', { url, text: text.slice(0, 200), latencyMs });
      return { summary: '', contentType: 'unknown', success: false, failureReason: 'Missing summary in response', latencyMs };
    }

    logger.info('[PreReader] Pre-read successful', {
      url,
      contentType: parsed.contentType,
      summaryLen: parsed.summary.length,
      latencyMs,
    });

    return {
      summary: parsed.summary,
      contentType: parsed.contentType || 'unknown',
      success: true,
      latencyMs,
    };
  } catch (error) {
    const latencyMs = Date.now() - start;
    const message = error instanceof Error ? error.message : String(error);
    logger.warn('[PreReader] Haiku pre-read failed', { url, error: message, latencyMs });
    return { summary: '', contentType: 'unknown', success: false, failureReason: message, latencyMs };
  }
}
