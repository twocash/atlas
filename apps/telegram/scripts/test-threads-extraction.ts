/**
 * Threads Extraction End-to-End Test
 *
 * Tests the full pipeline:
 * 1. Browser opens Threads URL
 * 2. Text content extracted
 * 3. Claude analyzes content
 * 4. Validates output is rich enough for human consumption
 *
 * Run: bun run scripts/test-threads-extraction.ts
 */

import { config } from 'dotenv';
config({ override: true });

// Test URLs from user's failed tests
const TEST_URLS = [
  'https://www.threads.com/@aimasteryhub__/post/DUS6iKpjbzL?xmt=AQF0X2IE0xeBvjUJ7gEsSnpzscGqPsfb2hjq921KaWqJUCwR4gVLkhwsibKxg7SdtgxEB0MS',
  'https://www.threads.com/@ai.theshift/post/DUR3eWQEZ-n?xmt=AQF0GOkvI8X_YGkGjMg3sGQJVYp2y7NsFvnfsTPoBQKu1XRv0DBGv39bhOyPKkCoF8LDzO8P',
];

// Quality thresholds
const MIN_EXTRACTED_CHARS = 200;
const MIN_ANALYSIS_CHARS = 300;

async function testExtraction(url: string): Promise<{
  success: boolean;
  extractedText: string;
  analysis: string;
  errors: string[];
}> {
  const errors: string[] = [];
  let extractedText = '';
  let analysis = '';

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Testing: ${url.substring(0, 70)}...`);
  console.log('='.repeat(60));

  try {
    const { executeTool } = await import('../src/conversation/tools');

    // Step 1: Open page with browser
    console.log('\n📋 Step 1: Opening page with Puppeteer...');
    const openResult = await executeTool('browser_open_page', {
      url,
      timeout: 45000,
    });

    if (!openResult.success) {
      errors.push(`Browser open failed: ${openResult.error}`);
      console.log(`   ❌ Failed: ${openResult.error}`);
      return { success: false, extractedText, analysis, errors };
    }

    const pageId = (openResult.result as any)?.pageId;
    const title = (openResult.result as any)?.title;
    console.log(`   ✅ Page opened`);
    console.log(`   Title: ${title}`);
    console.log(`   PageId: ${pageId}`);

    // Step 2: Extract text content
    console.log('\n📋 Step 2: Extracting text content...');
    const textResult = await executeTool('browser_get_text', { pageId });

    if (!textResult.success) {
      errors.push(`Text extraction failed: ${textResult.error}`);
      console.log(`   ❌ Failed: ${textResult.error}`);
      await executeTool('browser_close_page', { pageId });
      return { success: false, extractedText, analysis, errors };
    }

    extractedText = textResult.result as string;
    console.log(`   ✅ Extracted ${extractedText.length} characters`);

    // Quality check on extracted text
    if (extractedText.length < MIN_EXTRACTED_CHARS) {
      errors.push(`Extracted text too short: ${extractedText.length} chars (min: ${MIN_EXTRACTED_CHARS})`);
      console.log(`   ⚠️ WARNING: Content may be insufficient`);
    }

    // Show extracted content
    console.log(`\n   --- EXTRACTED CONTENT (first 1000 chars) ---`);
    console.log(`   ${extractedText.substring(0, 1000).replace(/\n/g, '\n   ')}`);
    console.log(`   --- END EXTRACTED CONTENT ---`);

    // Step 3: Claude Analysis
    console.log('\n📋 Step 3: Claude analysis...');
    const analysisPrompt = `Analyze this Threads post content. Extract:

1. **Author**: Username/handle if visible
2. **Main Message**: Core point or argument (2-3 sentences)
3. **Key Insights**: Notable quotes, claims, or data points
4. **Relevance to AI/Tech Research**: How this relates to AI, technology, or business
5. **Suggested Actions**: 2-3 specific next steps

Format with clear headers. Be concise but actionable.`;

    const analysisResult = await executeTool('claude_analyze', {
      content: extractedText.substring(0, 8000),
      systemPrompt: analysisPrompt,
    });

    if (!analysisResult.success) {
      errors.push(`Claude analysis failed: ${analysisResult.error}`);
      console.log(`   ❌ Failed: ${analysisResult.error}`);
      await executeTool('browser_close_page', { pageId });
      return { success: false, extractedText, analysis, errors };
    }

    analysis = analysisResult.result as string;
    console.log(`   ✅ Analysis complete (${analysis.length} chars)`);

    // Quality check on analysis
    if (analysis.length < MIN_ANALYSIS_CHARS) {
      errors.push(`Analysis too short: ${analysis.length} chars (min: ${MIN_ANALYSIS_CHARS})`);
      console.log(`   ⚠️ WARNING: Analysis may be insufficient`);
    }

    // Show analysis
    console.log(`\n   --- CLAUDE ANALYSIS ---`);
    console.log(`   ${analysis.replace(/\n/g, '\n   ')}`);
    console.log(`   --- END ANALYSIS ---`);

    // Step 4: Validate content quality
    console.log('\n📋 Step 4: Content Quality Validation...');

    const hasAuthor = /author|@\w+/i.test(analysis);
    const hasMainMessage = /main message|core point/i.test(analysis);
    const hasInsights = /key insight|notable/i.test(analysis);
    const hasActions = /suggest|action|next step/i.test(analysis);

    console.log(`   Author mentioned: ${hasAuthor ? '✅' : '❌'}`);
    console.log(`   Main message: ${hasMainMessage ? '✅' : '❌'}`);
    console.log(`   Key insights: ${hasInsights ? '✅' : '❌'}`);
    console.log(`   Actions suggested: ${hasActions ? '✅' : '❌'}`);

    if (!hasAuthor || !hasMainMessage) {
      errors.push('Analysis missing critical sections (author or main message)');
    }

    // Cleanup
    await executeTool('browser_close_page', { pageId });
    console.log('\n   ✅ Browser page closed');

    const success = errors.length === 0;
    return { success, extractedText, analysis, errors };

  } catch (err) {
    errors.push(`Exception: ${err instanceof Error ? err.message : String(err)}`);
    return { success: false, extractedText, analysis, errors };
  }
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║     THREADS EXTRACTION END-TO-END TEST                       ║');
  console.log('║     Validates browser → extract → analyze → quality          ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');

  const results: Array<{
    url: string;
    success: boolean;
    extractedChars: number;
    analysisChars: number;
    errors: string[];
  }> = [];

  for (const url of TEST_URLS) {
    const result = await testExtraction(url);
    results.push({
      url: url.substring(0, 50) + '...',
      success: result.success,
      extractedChars: result.extractedText.length,
      analysisChars: result.analysis.length,
      errors: result.errors,
    });
  }

  // Summary
  console.log('\n\n' + '═'.repeat(60));
  console.log('SUMMARY');
  console.log('═'.repeat(60));

  for (const r of results) {
    const status = r.success ? '✅ PASS' : '❌ FAIL';
    console.log(`\n${status}: ${r.url}`);
    console.log(`   Extracted: ${r.extractedChars} chars`);
    console.log(`   Analysis: ${r.analysisChars} chars`);
    if (r.errors.length > 0) {
      console.log(`   Errors:`);
      for (const e of r.errors) {
        console.log(`     - ${e}`);
      }
    }
  }

  const passed = results.filter(r => r.success).length;
  const total = results.length;
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`RESULT: ${passed}/${total} tests passed`);
  console.log('═'.repeat(60));

  // Cleanup browser
  const { closeBrowser } = await import('../src/conversation/tools/browser');
  await closeBrowser();

  process.exit(passed === total ? 0 : 1);
}

main().catch(console.error);
