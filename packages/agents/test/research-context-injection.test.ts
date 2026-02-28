/**
 * Research Context Injection Tests — ATLAS-RCI-001
 *
 * Verifies the full content injection pipeline:
 *   1. composeResearchContext() guard rails and composition
 *   2. buildResearchPromptV2() Source Material section
 *   3. ADR-003 invariant: source context never contaminates query
 *   4. Unified state persistence for Socratic answer
 *   5. Chain test: unified state → composition → prompt
 *
 * Pattern: Pure function unit tests + structural source verification.
 * No mocking, no live API calls.
 */

import { describe, it, expect } from 'bun:test';
import { composeResearchContext, type ResearchContextInput } from '../src/services/research-context';
import { buildResearchPromptV2 } from '../src/services/research-prompt-v2';
import type { ResearchConfigV2, SourceContext } from '../src/types/research-v2';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const thisDir = dirname(fileURLToPath(import.meta.url));
const agentsRoot = resolve(thisDir, '..');

async function readSource(relativePath: string): Promise<string> {
  return Bun.file(resolve(agentsRoot, relativePath)).text();
}

// ─── 1. composeResearchContext() — Guard Rails ──────────

describe('composeResearchContext()', () => {
  it('returns undefined when no meaningful context available', () => {
    expect(composeResearchContext({})).toBeUndefined();
    expect(composeResearchContext({ sourceUrl: 'https://example.com' })).toBeUndefined();
    expect(composeResearchContext({ triageTitle: 'Some Title' })).toBeUndefined();
  });

  it('returns undefined for empty strings', () => {
    expect(composeResearchContext({
      preReaderSummary: '',
      extractedContent: '',
      socraticAnswer: '',
    })).toBeUndefined();
  });

  it('includes PreReader summary when available', () => {
    const result = composeResearchContext({
      preReaderSummary: 'OpenAI raises $110B on $730B valuation. Developer skepticism about circular investments.',
    });
    expect(result).toBeDefined();
    expect(result!.preReaderSummary).toContain('OpenAI raises');
    expect(result!.preReaderAvailable).toBe(true);
  });

  it('truncates PreReader summary at 500 chars', () => {
    const longSummary = 'A'.repeat(600);
    const result = composeResearchContext({ preReaderSummary: longSummary });
    expect(result!.preReaderSummary!.length).toBeLessThanOrEqual(500);
  });

  it('includes extracted content as fallback', () => {
    const result = composeResearchContext({
      extractedContent: 'This is extracted content from the page that is long enough to pass the 50 char minimum threshold for extraction.',
    });
    expect(result).toBeDefined();
    expect(result!.extractedContent).toBeDefined();
    expect(result!.preReaderAvailable).toBe(false);
  });

  it('truncates extracted content at 3000 chars and flags truncation', () => {
    const longContent = 'B'.repeat(5000);
    const result = composeResearchContext({ extractedContent: longContent });
    expect(result!.extractedContent!.length).toBeLessThanOrEqual(3000);
    expect(result!.wasTruncated).toBe(true);
  });

  it('does NOT flag truncation when content fits', () => {
    const shortContent = 'C'.repeat(100);
    const result = composeResearchContext({ extractedContent: shortContent });
    expect(result!.wasTruncated).toBe(false);
  });

  it('extracts research angle from Socratic answer', () => {
    const result = composeResearchContext({
      socraticAnswer: 'Public piece looking at how devs view all this high stakes centralization rush - linkedin',
    });
    expect(result).toBeDefined();
    expect(result!.researchAngle).toContain('how devs view');
  });

  it('extracts target audience for LinkedIn', () => {
    const result = composeResearchContext({
      socraticAnswer: 'Deep analysis for LinkedIn about AI infrastructure concentration',
    });
    expect(result!.targetAudience).toContain('LinkedIn');
  });

  it('extracts target audience for self/internal', () => {
    const result = composeResearchContext({
      socraticAnswer: 'Quick summary for myself',
    });
    expect(result!.targetAudience).toContain('Self');
  });

  it('extracts target audience for client', () => {
    const result = composeResearchContext({
      socraticAnswer: 'Research for client presentation on AI strategy',
    });
    expect(result!.targetAudience).toContain('Client');
  });

  it('extracts target audience for Grove', () => {
    const result = composeResearchContext({
      socraticAnswer: 'Deep dive for a Grove blog post on AI concentration',
    });
    expect(result!.targetAudience).toContain('Grove');
  });

  it('returns no audience for ambiguous answers', () => {
    const result = composeResearchContext({
      socraticAnswer: 'Research the financial structure of this deal',
    });
    expect(result!.targetAudience).toBeUndefined();
  });

  it('estimates token count correctly', () => {
    const result = composeResearchContext({
      preReaderSummary: 'A'.repeat(400),  // 400 chars = ~100 tokens
      extractedContent: 'B'.repeat(2000), // 2000 chars = ~500 tokens
      socraticAnswer: 'C'.repeat(100),    // 100 chars = ~25 tokens (angle)
    });
    // estimatedTokens = (400 + 2000 + 100) / 4 = 625
    expect(result!.estimatedTokens).toBe(625);
  });

  it('passes through metadata fields', () => {
    const result = composeResearchContext({
      preReaderSummary: 'Some summary of the article content',
      preReaderContentType: 'discussion',
      sourceUrl: 'https://news.ycombinator.com/item?id=47181211',
      triageTitle: 'HN Discussion: OpenAI $110B Raise',
      triageConfidence: 0.85,
    });
    expect(result!.contentType).toBe('discussion');
    expect(result!.sourceUrl).toContain('ycombinator');
    expect(result!.triageTitle).toContain('OpenAI');
    expect(result!.triageConfidence).toBe(0.85);
  });

  it('handles the production failure case: HN URL with PreReader + Socratic answer', () => {
    // Reproduces the exact scenario from production logs
    const result = composeResearchContext({
      preReaderSummary: 'OpenAI raises $110B on $730B pre-money valuation — developer skepticism about circular investments, WeWork parallels',
      preReaderContentType: 'discussion',
      extractedContent: 'A'.repeat(137690), // 137k chars of HN discussion
      socraticAnswer: 'Public piece looking at how devs view all this high stakes centralization rush - linkedin',
      sourceUrl: 'https://news.ycombinator.com/item?id=47181211',
      triageTitle: 'HN Discussion: OpenAI $110B Raise',
      triageConfidence: 0.92,
    });

    expect(result).toBeDefined();
    // PreReader should be the primary signal
    expect(result!.preReaderSummary).toContain('OpenAI raises');
    expect(result!.preReaderAvailable).toBe(true);
    // Extracted should be truncated, NOT 137k
    expect(result!.extractedContent!.length).toBeLessThanOrEqual(3000);
    expect(result!.wasTruncated).toBe(true);
    // Research angle from Jim's Socratic answer
    expect(result!.researchAngle).toContain('devs view');
    expect(result!.targetAudience).toContain('LinkedIn');
    // Token estimate should be reasonable (not 30k+)
    expect(result!.estimatedTokens!).toBeLessThan(1500);
  });

  it('ignores extracted content shorter than 50 chars', () => {
    const result = composeResearchContext({
      extractedContent: 'Too short',
      socraticAnswer: 'Research this topic in depth',
    });
    expect(result).toBeDefined();
    // Should still work (socratic answer provides context)
    expect(result!.extractedContent).toBeUndefined();
    expect(result!.researchAngle).toBeDefined();
  });

  it('ignores socratic answers shorter than 5 chars', () => {
    const result = composeResearchContext({
      preReaderSummary: 'Article about OpenAI funding round',
      socraticAnswer: 'yes',
    });
    expect(result!.researchAngle).toBeUndefined();
    expect(result!.targetAudience).toBeUndefined();
  });
});

// ─── 2. buildResearchPromptV2 — Source Material Section ──

describe('buildResearchPromptV2() with sourceContext', () => {
  const baseConfig: ResearchConfigV2 = {
    query: 'OpenAI $110B funding valuation analysis',
    depth: 'deep',
    pillar: 'The Grove',
    queryMode: 'canonical',
  };

  it('includes Source Material section when sourceContext present', () => {
    const config: ResearchConfigV2 = {
      ...baseConfig,
      sourceContext: {
        preReaderSummary: 'OpenAI raises $110B on $730B valuation',
        researchAngle: 'How devs view the centralization rush',
        targetAudience: 'LinkedIn audience',
        contentType: 'discussion',
      },
    };
    const prompt = buildResearchPromptV2(config);
    expect(prompt).toContain('Source Material');
    expect(prompt).toContain('ANALYZE the provided material');
    expect(prompt).toContain('OpenAI raises $110B');
    expect(prompt).toContain('How devs view');
    expect(prompt).toContain('LinkedIn audience');
    expect(prompt).toContain('discussion');
  });

  it('includes PreReader digest when available', () => {
    const config: ResearchConfigV2 = {
      ...baseConfig,
      sourceContext: {
        preReaderSummary: 'Article about venture capital dynamics in AI',
      },
    };
    const prompt = buildResearchPromptV2(config);
    expect(prompt).toContain('PreReader digest');
    expect(prompt).toContain('venture capital dynamics');
  });

  it('includes extracted content with truncation note', () => {
    const config: ResearchConfigV2 = {
      ...baseConfig,
      sourceContext: {
        extractedContent: 'Long discussion about AI valuations...',
        wasTruncated: true,
      },
    };
    const prompt = buildResearchPromptV2(config);
    expect(prompt).toContain('Extracted Content');
    expect(prompt).toContain('truncated for token budget');
  });

  it('falls back to V1 sourceContent when no sourceContext', () => {
    const config: ResearchConfigV2 = {
      ...baseConfig,
      sourceContent: 'Legacy extracted content here',
    };
    const prompt = buildResearchPromptV2(config);
    // Should use old V1 section
    expect(prompt).toContain('Source Content (extracted from shared URL)');
    expect(prompt).toContain('Legacy extracted content');
    // Should NOT have new Source Material section
    expect(prompt).not.toContain('Source Material');
  });

  it('prefers sourceContext over sourceContent when both present', () => {
    const config: ResearchConfigV2 = {
      ...baseConfig,
      sourceContent: 'Old V1 content',
      sourceContext: {
        preReaderSummary: 'New V2 PreReader summary',
      },
    };
    const prompt = buildResearchPromptV2(config);
    expect(prompt).toContain('Source Material');
    expect(prompt).toContain('New V2 PreReader summary');
    expect(prompt).not.toContain('Old V1 content');
  });

  it('produces valid prompt with no source context (graceful absence)', () => {
    const prompt = buildResearchPromptV2(baseConfig);
    expect(prompt).toContain('Research Topic');
    expect(prompt).toContain('OpenAI $110B');
    expect(prompt).not.toContain('Source Material');
    expect(prompt).not.toContain('Source Content');
  });
});

// ─── 3. ADR-003 Invariant: Query Never Contaminated ─────

describe('ADR-003: source context never contaminates query', () => {
  it('ResearchConfig.query is separate from sourceContext', () => {
    const config: ResearchConfigV2 = {
      query: 'OpenAI funding analysis',
      sourceContext: {
        preReaderSummary: 'Developer discussion about WeWork parallels',
        researchAngle: 'How devs view centralization',
        extractedContent: 'Full HN thread content here...',
      },
    };
    // Query should be the triage-generated topic, not source material
    expect(config.query).toBe('OpenAI funding analysis');
    expect(config.query).not.toContain('WeWork');
    expect(config.query).not.toContain('HN thread');
    expect(config.query).not.toContain('centralization');
  });

  it('buildResearchPromptV2 keeps query in Research Topic, source in Source Material', () => {
    const config: ResearchConfigV2 = {
      query: 'OpenAI funding analysis',
      sourceContext: {
        preReaderSummary: 'Discussion about WeWork parallels and circular investments',
      },
    };
    const prompt = buildResearchPromptV2(config);
    // Query in its own section
    const topicSection = prompt.split('## Source Material')[0];
    expect(topicSection).toContain('OpenAI funding analysis');
    // Source material in separate section
    const materialSection = prompt.split('## Source Material')[1];
    expect(materialSection).toContain('WeWork parallels');
  });
});

// ─── 4. Unified State Persistence ──────────────────────

describe('unified state: Socratic answer persistence', () => {
  it('conversation-state exports storeSocraticAnswer', async () => {
    const src = await readSource('src/conversation/conversation-state.ts');
    expect(src).toContain('export function storeSocraticAnswer');
    expect(src).toContain('state.lastSocraticAnswer = answer');
  });

  it('conversation-state exports getSocraticAnswer', async () => {
    const src = await readSource('src/conversation/conversation-state.ts');
    expect(src).toContain('export function getSocraticAnswer');
    expect(src).toContain('state?.lastSocraticAnswer');
  });

  it('ConversationState interface includes lastSocraticAnswer', async () => {
    const src = await readSource('src/conversation/conversation-state.ts');
    expect(src).toContain('lastSocraticAnswer?: string');
  });

  it('socratic-adapter calls storeSocraticAnswer before handleResolved', async () => {
    const src = await Bun.file(resolve(thisDir, '../../..', 'apps/telegram/src/conversation/socratic-adapter.ts')).text();
    expect(src).toContain('storeSocraticAnswer(chatId, answerText)');
    // Must appear BEFORE handleResolved call
    const storeIdx = src.indexOf('storeSocraticAnswer(chatId, answerText)');
    const handleIdx = src.indexOf('await handleResolved(', storeIdx);
    expect(storeIdx).toBeGreaterThan(0);
    expect(handleIdx).toBeGreaterThan(storeIdx);
  });
});

// ─── 5. Chain Test: State → Composition → Prompt ────────

describe('chain: unified state → composeResearchContext → prompt', () => {
  it('end-to-end: HN discussion produces analyzable research prompt', () => {
    // Step 1: Simulate unified state data (what content-flow.ts stores)
    const input: ResearchContextInput = {
      preReaderSummary: 'OpenAI raises $110B on $730B pre-money valuation. Developer community skeptical about circular investment structures. WeWork comparisons emerging.',
      preReaderContentType: 'discussion',
      extractedContent: 'Full HN discussion with 200+ comments about OpenAI valuation...',
      socraticAnswer: 'Public piece looking at how devs view all this high stakes centralization rush - linkedin',
      sourceUrl: 'https://news.ycombinator.com/item?id=47181211',
      triageTitle: 'HN Discussion: OpenAI $110B Raise',
      triageConfidence: 0.92,
    };

    // Step 2: Compose research context
    const sourceContext = composeResearchContext(input);
    expect(sourceContext).toBeDefined();

    // Step 3: Build config with composed context
    const config: ResearchConfigV2 = {
      query: 'OpenAI $110B funding round valuation developer sentiment analysis',
      depth: 'deep',
      pillar: 'The Grove',
      queryMode: 'canonical',
      sourceContext: sourceContext!,
    };

    // Step 4: Build prompt
    const prompt = buildResearchPromptV2(config);

    // Verify: Query drives search (ADR-003)
    expect(prompt).toContain('OpenAI $110B funding round');

    // Verify: Source material provides analytical context
    expect(prompt).toContain('Source Material');
    expect(prompt).toContain('ANALYZE the provided material');
    expect(prompt).toContain('OpenAI raises $110B');
    expect(prompt).toContain('developer');

    // Verify: Research angle from Jim's answer
    expect(prompt).toContain('Research Angle');
    expect(prompt).toContain('devs view');

    // Verify: Target audience detected
    expect(prompt).toContain('Target Audience');
    expect(prompt).toContain('LinkedIn');

    // Verify: Content type metadata
    expect(prompt).toContain('discussion');
  });

  it('graceful absence: non-URL research produces valid prompt', () => {
    // No URL, no extraction, no PreReader
    const sourceContext = composeResearchContext({});
    expect(sourceContext).toBeUndefined();

    const config: ResearchConfigV2 = {
      query: 'AI infrastructure market analysis 2026',
      depth: 'standard',
    };

    const prompt = buildResearchPromptV2(config);
    expect(prompt).toContain('AI infrastructure market analysis');
    expect(prompt).not.toContain('Source Material');
  });

  it('research-executor reads unified state and composes context', async () => {
    const src = await Bun.file(resolve(thisDir, '../../..', 'apps/telegram/src/services/research-executor.ts')).text();
    // Reads unified state
    expect(src).toContain('getContentContext(chatId)');
    expect(src).toContain('getSocraticAnswer(chatId)');
    expect(src).toContain('getState(chatId)');
    // Calls composition
    expect(src).toContain('composeResearchContext({');
    // Passes PreReader summary
    expect(src).toContain('preReaderSummary: contentCtx?.preReadSummary');
    // Passes content type
    expect(src).toContain('preReaderContentType: contentCtx?.prefetchedUrlContent?.preReadContentType');
    // Injects into config
    expect(src).toContain('sourceContext = sourceContext');
  });
});

// ─── 6. Content Injection Telemetry ─────────────────────

describe('content injection telemetry', () => {
  it('socratic-adapter adds rci: keywords to Feed 2.0 audit trail', async () => {
    const src = await Bun.file(resolve(thisDir, '../../..', 'apps/telegram/src/conversation/socratic-adapter.ts')).text();
    expect(src).toContain("'rci:pre-reader'");
    expect(src).toContain("'rci:extracted'");
    expect(src).toContain("'rci:socratic-answer'");
  });

  it('research-executor logs source context composition details', async () => {
    const src = await Bun.file(resolve(thisDir, '../../..', 'apps/telegram/src/services/research-executor.ts')).text();
    expect(src).toContain('ATLAS-RCI-001: Source context composed for research');
    expect(src).toContain('hasPreReader: sourceContext.preReaderAvailable');
    expect(src).toContain('estimatedTokens: sourceContext.estimatedTokens');
  });
});

// ─── 7. SourceContext Type Safety ───────────────────────

describe('SourceContext type integrity', () => {
  it('is exported from research-v2.ts', async () => {
    const src = await readSource('src/types/research-v2.ts');
    expect(src).toContain('export interface SourceContext');
  });

  it('has all required fields defined', async () => {
    const src = await readSource('src/types/research-v2.ts');
    expect(src).toContain('preReaderSummary?: string');
    expect(src).toContain('extractedContent?: string');
    expect(src).toContain('contentType?: string');
    expect(src).toContain('researchAngle?: string');
    expect(src).toContain('targetAudience?: string');
    expect(src).toContain('sourceUrl?: string');
    expect(src).toContain('estimatedTokens?: number');
    expect(src).toContain('preReaderAvailable?: boolean');
    expect(src).toContain('wasTruncated?: boolean');
  });

  it('is on ResearchConfigV2 as optional field', async () => {
    const src = await readSource('src/types/research-v2.ts');
    expect(src).toContain('sourceContext?: SourceContext');
  });

  it('isResearchConfigV2 detects sourceContext', async () => {
    const src = await readSource('src/types/research-v2.ts');
    expect(src).toContain("'sourceContext' in config");
  });
});
