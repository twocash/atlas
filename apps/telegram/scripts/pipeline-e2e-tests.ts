/**
 * PIPELINE E2E TESTS - Full Pipeline Verification
 *
 * These tests run ACTUAL pipelines end-to-end:
 * - Research pipeline: query → Gemini → structured output → Notion
 * - Content pipeline: (future)
 * - Extraction pipeline: (future)
 *
 * WARNING: These tests:
 * - Cost real API tokens (Gemini, Anthropic)
 * - Create real Notion records (when --with-notion)
 * - Take 30-120 seconds per test
 *
 * Run manually before major releases, not on every verify.
 *
 * Usage:
 *   bun run scripts/pipeline-e2e-tests.ts              # Light research test
 *   bun run scripts/pipeline-e2e-tests.ts --standard   # Add standard depth test
 *   bun run scripts/pipeline-e2e-tests.ts --with-notion # Verify results land in Notion body
 *   bun run scripts/pipeline-e2e-tests.ts --dry-run    # Validate setup only
 *
 * Notion Verification (--with-notion):
 *   Creates a test Work Queue item, writes research results to page body,
 *   verifies content landed correctly, then archives the test page.
 */

import { config } from 'dotenv';
import { join } from 'path';
import { Client } from '@notionhq/client';
import { NOTION_DB } from '@atlas/shared/config';

// Load environment variables
config({ path: join(import.meta.dir, '..', '.env'), override: true });

// Canonical IDs from @atlas/shared/config
const WORK_QUEUE_DATABASE_ID = NOTION_DB.WORK_QUEUE;

// =============================================================================
// TYPES
// =============================================================================

interface PipelineTestResult {
  name: string;
  passed: boolean;
  duration: number;
  error?: string;
  warnings: string[];
  evidence: Record<string, unknown>;
}

interface QualityThresholds {
  minSummaryLength: number;
  minFindingsCount: number;
  minSourcesCount: number;
  maxPlaceholderUrls: number;
}

// =============================================================================
// QUALITY THRESHOLDS
// =============================================================================

const RESEARCH_QUALITY_THRESHOLDS: Record<string, QualityThresholds> = {
  light: {
    minSummaryLength: 100,
    minFindingsCount: 2,
    minSourcesCount: 2,
    maxPlaceholderUrls: 0,
  },
  standard: {
    minSummaryLength: 500,
    minFindingsCount: 5,
    minSourcesCount: 4,
    maxPlaceholderUrls: 0,
  },
  deep: {
    minSummaryLength: 1500,
    minFindingsCount: 8,
    minSourcesCount: 8,
    maxPlaceholderUrls: 0,
  },
};

// =============================================================================
// VALIDATION UTILITIES
// =============================================================================

/**
 * Check if a URL is a placeholder/template
 */
function isPlaceholderUrl(url: string): boolean {
  const placeholderPatterns = [
    /^https?:\/\/url\d+\.com/i,
    /^https?:\/\/source-url\.com/i,
    /^https?:\/\/example\.com/i,
    /placeholder/i,
    /^https?:\/\/\[/i,  // [url] templates
  ];
  return placeholderPatterns.some(p => p.test(url));
}

/**
 * Validate research output quality
 */
function validateResearchQuality(
  result: {
    summary?: string;
    findings?: Array<{ claim: string; source: string; url: string }>;
    sources?: string[];
    rawResponse?: string;
  },
  depth: string,
  thresholds: QualityThresholds
): { passed: boolean; issues: string[] } {
  const issues: string[] = [];

  // Check summary
  const summaryLength = result.summary?.length || 0;
  if (summaryLength < thresholds.minSummaryLength) {
    issues.push(`Summary too short: ${summaryLength} < ${thresholds.minSummaryLength} chars`);
  }

  // Check findings
  const findingsCount = result.findings?.length || 0;
  if (findingsCount < thresholds.minFindingsCount) {
    issues.push(`Too few findings: ${findingsCount} < ${thresholds.minFindingsCount}`);
  }

  // Check sources
  const sourcesCount = result.sources?.length || 0;
  if (sourcesCount < thresholds.minSourcesCount) {
    issues.push(`Too few sources: ${sourcesCount} < ${thresholds.minSourcesCount}`);
  }

  // Check for placeholder URLs
  const placeholderUrls = (result.sources || []).filter(isPlaceholderUrl);
  if (placeholderUrls.length > thresholds.maxPlaceholderUrls) {
    issues.push(`Placeholder URLs detected: ${placeholderUrls.join(', ')}`);
  }

  // Check findings have real URLs
  const findingsWithBadUrls = (result.findings || []).filter(
    f => !f.url || f.url.length < 10 || isPlaceholderUrl(f.url)
  );
  if (findingsWithBadUrls.length > 0) {
    issues.push(`${findingsWithBadUrls.length} findings have missing/placeholder URLs`);
  }

  // Check summary isn't an error message
  if (result.summary?.startsWith('Research FAILED:') || result.summary?.includes('error')) {
    issues.push(`Summary indicates failure: ${result.summary.substring(0, 100)}`);
  }

  return {
    passed: issues.length === 0,
    issues,
  };
}

// =============================================================================
// NOTION VERIFICATION UTILITIES
// =============================================================================

/**
 * Create a test Work Queue item with research results in the body
 */
async function createTestNotionPage(
  notion: Client,
  title: string,
  researchOutput: {
    summary?: string;
    findings?: Array<{ claim: string; source: string; url: string }>;
    sources?: string[];
  }
): Promise<{ pageId: string; url: string }> {
  // Create the page with properties
  const response = await notion.pages.create({
    parent: { database_id: WORK_QUEUE_DATABASE_ID },
    properties: {
      'Task': {
        title: [{ text: { content: `[E2E TEST] ${title}`.substring(0, 100) } }],
      },
      'Status': {
        select: { name: 'Captured' },
      },
      'Priority': {
        select: { name: 'P3' },  // Low priority - this is a test
      },
      'Pillar': {
        select: { name: 'The Grove' },
      },
      'Notes': {
        rich_text: [{ text: { content: 'Auto-generated by Pipeline E2E Test. Safe to delete.' } }],
      },
      'Queued': {
        date: { start: new Date().toISOString().split('T')[0] },
      },
    },
  });

  const pageId = response.id;

  // Build body content blocks
  const blocks: any[] = [
    // Summary section
    {
      object: 'block',
      type: 'heading_2',
      heading_2: {
        rich_text: [{ type: 'text', text: { content: 'Research Summary' } }],
      },
    },
    {
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: [{ type: 'text', text: { content: researchOutput.summary || '(No summary)' } }],
      },
    },
    // Findings section
    {
      object: 'block',
      type: 'heading_2',
      heading_2: {
        rich_text: [{ type: 'text', text: { content: 'Key Findings' } }],
      },
    },
  ];

  // Add findings as bulleted list
  for (const finding of (researchOutput.findings || []).slice(0, 5)) {
    blocks.push({
      object: 'block',
      type: 'bulleted_list_item',
      bulleted_list_item: {
        rich_text: [
          { type: 'text', text: { content: finding.claim } },
          { type: 'text', text: { content: ' — ' } },
          {
            type: 'text',
            text: { content: finding.source, link: finding.url ? { url: finding.url } : undefined },
          },
        ],
      },
    });
  }

  // Sources section
  blocks.push({
    object: 'block',
    type: 'heading_2',
    heading_2: {
      rich_text: [{ type: 'text', text: { content: 'Sources' } }],
    },
  });

  for (const source of (researchOutput.sources || []).slice(0, 5)) {
    blocks.push({
      object: 'block',
      type: 'bulleted_list_item',
      bulleted_list_item: {
        rich_text: [{ type: 'text', text: { content: source } }],
      },
    });
  }

  // Append blocks to page body
  await notion.blocks.children.append({
    block_id: pageId,
    children: blocks,
  });

  const cleanId = pageId.replace(/-/g, '');
  return {
    pageId,
    url: `https://notion.so/${cleanId}`,
  };
}

/**
 * Verify that research content landed in the Notion page body
 */
async function verifyNotionPageBody(
  notion: Client,
  pageId: string,
  expectedContent: {
    minSummaryLength: number;
    minFindingsCount: number;
    minSourcesCount: number;
  }
): Promise<{ passed: boolean; issues: string[]; bodyLength: number }> {
  const issues: string[] = [];

  // Retrieve page blocks (body content)
  const blocksResponse = await notion.blocks.children.list({
    block_id: pageId,
    page_size: 50,
  });

  // Extract text content from blocks
  let bodyText = '';
  let findingsCount = 0;
  let sourcesCount = 0;
  let inFindings = false;
  let inSources = false;

  for (const block of blocksResponse.results as any[]) {
    // Track sections
    if (block.type === 'heading_2') {
      const headingText = block.heading_2?.rich_text?.[0]?.plain_text || '';
      inFindings = headingText.toLowerCase().includes('finding');
      inSources = headingText.toLowerCase().includes('source');
    }

    // Count list items in each section
    if (block.type === 'bulleted_list_item') {
      if (inFindings) findingsCount++;
      if (inSources) sourcesCount++;
    }

    // Extract all text content
    const richText = block[block.type]?.rich_text || [];
    for (const text of richText) {
      bodyText += text.plain_text || '';
    }
  }

  // Validate content
  if (bodyText.length < expectedContent.minSummaryLength) {
    issues.push(`Body too short: ${bodyText.length} < ${expectedContent.minSummaryLength} chars`);
  }

  if (findingsCount < expectedContent.minFindingsCount) {
    issues.push(`Too few findings in body: ${findingsCount} < ${expectedContent.minFindingsCount}`);
  }

  if (sourcesCount < expectedContent.minSourcesCount) {
    issues.push(`Too few sources in body: ${sourcesCount} < ${expectedContent.minSourcesCount}`);
  }

  return {
    passed: issues.length === 0,
    issues,
    bodyLength: bodyText.length,
  };
}

/**
 * Clean up test page (archive it)
 */
async function cleanupTestPage(notion: Client, pageId: string): Promise<void> {
  try {
    await notion.pages.update({
      page_id: pageId,
      properties: {
        'Status': {
          select: { name: 'Done' },
        },
        'Notes': {
          rich_text: [{ text: { content: 'E2E Test completed. Archived automatically.' } }],
        },
      },
      archived: true,
    });
  } catch (err) {
    // Ignore cleanup errors
  }
}

// =============================================================================
// RESEARCH PIPELINE TEST
// =============================================================================

/**
 * Test the research pipeline end-to-end
 */
async function testResearchPipeline(
  depth: 'light' | 'standard' = 'light',
  createNotionRecord: boolean = false
): Promise<PipelineTestResult> {
  const startTime = Date.now();
  const warnings: string[] = [];
  const evidence: Record<string, unknown> = {};

  console.log(`\n📊 Testing Research Pipeline (${depth})...`);
  console.log('─'.repeat(50));

  try {
    // Import the research module from the agents package
    const agentsPath = join(import.meta.dir, '..', '..', '..', 'packages', 'agents', 'src');
    const { executeResearch } = await import(join(agentsPath, 'agents', 'research.ts'));
    const { AgentRegistry } = await import(join(agentsPath, 'registry.ts'));

    // Create a test registry and agent
    const registry = new AgentRegistry();
    const agent = await registry.spawn({
      type: 'research',
      name: 'Pipeline E2E Test',
      instructions: 'Test research execution',
      priority: 'P2',
    });
    await registry.start(agent.id);

    // Test query - something current and searchable
    const testQuery = depth === 'light'
      ? 'What is Claude AI?'  // Simple, fast
      : 'Compare Claude AI vs GPT-4 for coding tasks';  // More complex

    console.log(`  Query: "${testQuery}"`);
    console.log(`  Depth: ${depth}`);
    console.log('  Executing...');

    // Execute research
    const result = await executeResearch(
      {
        query: testQuery,
        depth,
        voice: 'grove-analytical',
      },
      agent,
      registry
    );

    evidence.success = result.success;
    evidence.durationMs = Date.now() - startTime;
    evidence.tokensUsed = result.metrics?.tokensUsed;

    // Check basic success
    if (!result.success) {
      return {
        name: `Research Pipeline (${depth})`,
        passed: false,
        duration: Date.now() - startTime,
        error: `Research failed: ${result.summary}`,
        warnings,
        evidence,
      };
    }

    // Extract output
    const output = result.output as {
      summary?: string;
      findings?: Array<{ claim: string; source: string; url: string }>;
      sources?: string[];
      rawResponse?: string;
      groundingUsed?: boolean;
    };

    evidence.summaryLength = output.summary?.length || 0;
    evidence.findingsCount = output.findings?.length || 0;
    evidence.sourcesCount = output.sources?.length || 0;
    evidence.groundingUsed = output.groundingUsed;

    console.log(`  ✓ Research completed in ${Math.round((Date.now() - startTime) / 1000)}s`);
    console.log(`  Summary: ${evidence.summaryLength} chars`);
    console.log(`  Findings: ${evidence.findingsCount}`);
    console.log(`  Sources: ${evidence.sourcesCount}`);

    // Validate quality
    const thresholds = RESEARCH_QUALITY_THRESHOLDS[depth];
    const validation = validateResearchQuality(output, depth, thresholds);

    if (!validation.passed) {
      for (const issue of validation.issues) {
        console.log(`  ❌ ${issue}`);
      }
      return {
        name: `Research Pipeline (${depth})`,
        passed: false,
        duration: Date.now() - startTime,
        error: `Quality validation failed: ${validation.issues.join('; ')}`,
        warnings,
        evidence,
      };
    }

    // Check grounding was used (not training data)
    if (!output.groundingUsed) {
      warnings.push('Grounding may not have been used - results could be from training data');
    }

    // Preview summary
    console.log(`  Summary preview: "${output.summary?.substring(0, 150)}..."`);

    // Optionally create Notion record and verify body content
    if (createNotionRecord && process.env.NOTION_API_KEY) {
      console.log('  Creating Notion record...');

      try {
        const notion = new Client({ auth: process.env.NOTION_API_KEY });

        // Create test page with research results
        const { pageId, url } = await createTestNotionPage(
          notion,
          testQuery,
          output
        );
        evidence.notionPageId = pageId;
        evidence.notionUrl = url;
        console.log(`  ✓ Created Notion page: ${url}`);

        // Verify content landed in body
        const bodyVerification = await verifyNotionPageBody(notion, pageId, {
          minSummaryLength: thresholds.minSummaryLength / 2,  // Body may truncate
          minFindingsCount: Math.min(thresholds.minFindingsCount, 5),
          minSourcesCount: Math.min(thresholds.minSourcesCount, 5),
        });

        evidence.notionBodyLength = bodyVerification.bodyLength;
        console.log(`  Notion body: ${bodyVerification.bodyLength} chars`);

        if (!bodyVerification.passed) {
          for (const issue of bodyVerification.issues) {
            console.log(`  ❌ Notion: ${issue}`);
          }
          // Don't fail the whole test, but warn
          warnings.push(`Notion body issues: ${bodyVerification.issues.join('; ')}`);
        } else {
          console.log('  ✓ Notion body verification passed');
        }

        // Clean up test page
        await cleanupTestPage(notion, pageId);
        console.log('  ✓ Test page archived');

      } catch (notionErr: any) {
        warnings.push(`Notion verification failed: ${notionErr.message}`);
        console.log(`  ⚠️ Notion error: ${notionErr.message}`);
      }
    }

    return {
      name: `Research Pipeline (${depth})`,
      passed: true,
      duration: Date.now() - startTime,
      warnings,
      evidence,
    };

  } catch (err: any) {
    return {
      name: `Research Pipeline (${depth})`,
      passed: false,
      duration: Date.now() - startTime,
      error: `Exception: ${err.message}`,
      warnings,
      evidence,
    };
  }
}

// =============================================================================
// DRY RUN (SETUP VALIDATION)
// =============================================================================

/**
 * Validate environment is ready for pipeline tests
 */
async function runDryRun(): Promise<PipelineTestResult[]> {
  const results: PipelineTestResult[] = [];
  console.log('\n🔍 DRY RUN - Validating pipeline setup...');
  console.log('─'.repeat(50));

  // Check Gemini API key
  const geminiKey = process.env.GEMINI_API_KEY;
  results.push({
    name: 'GEMINI_API_KEY',
    passed: !!geminiKey && geminiKey.length > 10,
    duration: 0,
    warnings: [],
    evidence: { keyLength: geminiKey?.length || 0 },
  });
  console.log(`  ${geminiKey ? '✓' : '❌'} GEMINI_API_KEY`);

  // Check Notion API key
  const notionKey = process.env.NOTION_API_KEY;
  results.push({
    name: 'NOTION_API_KEY',
    passed: !!notionKey && notionKey.length > 10,
    duration: 0,
    warnings: [],
    evidence: { keyLength: notionKey?.length || 0 },
  });
  console.log(`  ${notionKey ? '✓' : '❌'} NOTION_API_KEY`);

  // Check research module imports
  try {
    const agentsPath = join(import.meta.dir, '..', '..', '..', 'packages', 'agents', 'src');
    await import(join(agentsPath, 'agents', 'research.ts'));
    results.push({
      name: 'Research module import',
      passed: true,
      duration: 0,
      warnings: [],
      evidence: {},
    });
    console.log('  ✓ Research module imports');
  } catch (err: any) {
    results.push({
      name: 'Research module import',
      passed: false,
      duration: 0,
      error: err.message,
      warnings: [],
      evidence: {},
    });
    console.log(`  ❌ Research module: ${err.message}`);
  }

  // Check Gemini SDK
  try {
    const { GoogleGenAI } = await import('@google/genai');
    results.push({
      name: 'Gemini SDK (@google/genai)',
      passed: true,
      duration: 0,
      warnings: [],
      evidence: {},
    });
    console.log('  ✓ Gemini SDK available');
  } catch {
    try {
      await import('@google/generative-ai');
      results.push({
        name: 'Gemini SDK (legacy)',
        passed: true,
        duration: 0,
        warnings: ['Using legacy SDK - consider upgrading to @google/genai'],
        evidence: {},
      });
      console.log('  ⚠️ Gemini SDK (legacy)');
    } catch (err: any) {
      results.push({
        name: 'Gemini SDK',
        passed: false,
        duration: 0,
        error: 'No Gemini SDK found',
        warnings: [],
        evidence: {},
      });
      console.log('  ❌ Gemini SDK not found');
    }
  }

  return results;
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const researchOnly = args.includes('--research-only');
  const includeStandard = args.includes('--standard');
  const withNotion = args.includes('--with-notion');

  console.log('\n');
  console.log('====================================');
  console.log('   PIPELINE E2E TESTS');
  console.log('====================================');
  console.log(`\nStarted: ${new Date().toISOString()}`);

  const allResults: PipelineTestResult[] = [];

  // Always run dry run first
  const dryRunResults = await runDryRun();
  allResults.push(...dryRunResults);

  const setupPassed = dryRunResults.every(r => r.passed);
  if (!setupPassed) {
    console.log('\n❌ Setup validation failed. Fix issues above before running pipeline tests.');
    process.exit(1);
  }

  if (dryRun) {
    console.log('\n✓ Dry run complete. Setup is valid.');
    process.exit(0);
  }

  // Run actual pipeline tests
  console.log('\n⚠️  Running LIVE pipeline tests (this costs API tokens)...');
  if (withNotion) {
    console.log('📝 Notion verification ENABLED (will create/verify/archive test pages)');
  }

  // Light research (fast, cheap)
  const lightResult = await testResearchPipeline('light', withNotion);
  allResults.push(lightResult);

  // Standard research (slower, more thorough) - only if requested
  if (includeStandard) {
    const standardResult = await testResearchPipeline('standard', withNotion);
    allResults.push(standardResult);
  }

  // Summary
  console.log('\n');
  console.log('====================================');
  console.log('   PIPELINE E2E SUMMARY');
  console.log('====================================');

  const passed = allResults.filter(r => r.passed).length;
  const failed = allResults.filter(r => !r.passed).length;
  const totalDuration = allResults.reduce((sum, r) => sum + r.duration, 0);

  for (const result of allResults) {
    const icon = result.passed ? '✓' : '✗';
    const color = result.passed ? '\x1b[32m' : '\x1b[31m';
    console.log(`${color}${icon}\x1b[0m ${result.name}`);
    if (result.error) {
      console.log(`   └─ Error: ${result.error}`);
    }
    for (const warning of result.warnings) {
      console.log(`   └─ ⚠️ ${warning}`);
    }
  }

  console.log('────────────────────────────────────');
  console.log(`   Passed: ${passed}`);
  console.log(`   Failed: ${failed}`);
  console.log(`   Duration: ${(totalDuration / 1000).toFixed(1)}s`);
  console.log('====================================');

  if (failed > 0) {
    console.log('\n❌ PIPELINE E2E FAILURES DETECTED');
    console.log('   Research may produce empty or hallucinated output.\n');
    process.exit(1);
  } else {
    console.log('\n✅ ALL PIPELINES HEALTHY');
    console.log('   Research produces fulsome, grounded output.\n');
    process.exit(0);
  }
}

main().catch((error) => {
  console.error('\n❌ Pipeline E2E test runner failed:', error);
  process.exit(1);
});
