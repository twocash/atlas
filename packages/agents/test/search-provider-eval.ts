/**
 * Search Provider Evaluation — ClaudeSearchProvider Retrieval Quality
 *
 * ADR-010: Decoupled Search. Validates that ClaudeSearchProvider returns
 * quality citations when used as the Phase 1 retrieval engine.
 *
 * Tests:
 * - Citation count (expect 5+)
 * - URL validity (real domains, no placeholders)
 * - Text content quality (sufficient for synthesis input)
 * - Response time (expect <15s for Haiku)
 *
 * Run: bun run packages/agents/test/search-provider-eval.ts
 */

import { ClaudeSearchProvider } from "../src/search/claude-search-provider";
import "dotenv/config";

const TEST_QUERIES = [
  "Latest Anthropic product announcements March 2026",
  "OpenAI vs Anthropic government AI policy positions 2026",
  "Gemini 2.0 Flash grounding limitations and workarounds",
];

interface EvalResult {
  query: string;
  success: boolean;
  citationCount: number;
  textLength: number;
  latencyMs: number;
  realUrls: number;
  placeholderUrls: number;
  sampleCitations: { url: string; title: string }[];
  error?: string;
}

const PLACEHOLDER_PATTERNS = [
  /example\.com/i,
  /placeholder/i,
  /url\d+\.com/i,
  /source-url/i,
  /test\.com/i,
  /localhost/i,
];

function isPlaceholderUrl(url: string): boolean {
  return PLACEHOLDER_PATTERNS.some((p) => p.test(url));
}

async function evalQuery(
  provider: ClaudeSearchProvider,
  query: string
): Promise<EvalResult> {
  const start = Date.now();

  try {
    const result = await provider.generate({
      query,
      systemInstruction:
        "Search the web and provide comprehensive, factual results with source URLs. Focus on finding current, authoritative information.",
      maxOutputTokens: 4096,
    });

    const latencyMs = Date.now() - start;
    const realUrls = result.citations.filter((c) => !isPlaceholderUrl(c.url));
    const placeholderUrls = result.citations.filter((c) =>
      isPlaceholderUrl(c.url)
    );

    return {
      query,
      success: true,
      citationCount: result.citations.length,
      textLength: result.text.length,
      latencyMs,
      realUrls: realUrls.length,
      placeholderUrls: placeholderUrls.length,
      sampleCitations: result.citations.slice(0, 5),
    };
  } catch (error: any) {
    return {
      query,
      success: false,
      citationCount: 0,
      textLength: 0,
      latencyMs: Date.now() - start,
      realUrls: 0,
      placeholderUrls: 0,
      sampleCitations: [],
      error: error.message,
    };
  }
}

async function main() {
  console.log("=".repeat(70));
  console.log("SEARCH PROVIDER EVAL: ClaudeSearchProvider Retrieval Quality");
  console.log("ADR-010: Decoupled Search — Phase 1 Retrieval Validation");
  console.log("=".repeat(70));
  console.log("");

  const provider = new ClaudeSearchProvider();
  const results: EvalResult[] = [];

  for (const query of TEST_QUERIES) {
    console.log(`\nEvaluating: "${query}"`);
    const result = await evalQuery(provider, query);
    results.push(result);

    // Print inline result
    if (result.success) {
      console.log(
        `  Citations: ${result.citationCount} (${result.realUrls} real, ${result.placeholderUrls} placeholder)`
      );
      console.log(`  Text: ${result.textLength} chars`);
      console.log(`  Latency: ${result.latencyMs}ms`);
    } else {
      console.log(`  FAILED: ${result.error}`);
    }
  }

  // Summary
  console.log("\n" + "=".repeat(70));
  console.log("SUMMARY");
  console.log("=".repeat(70));

  const successful = results.filter((r) => r.success);
  const avgCitations =
    successful.reduce((s, r) => s + r.citationCount, 0) / successful.length;
  const avgLatency =
    successful.reduce((s, r) => s + r.latencyMs, 0) / successful.length;
  const avgTextLen =
    successful.reduce((s, r) => s + r.textLength, 0) / successful.length;
  const totalPlaceholders = successful.reduce(
    (s, r) => s + r.placeholderUrls,
    0
  );

  console.log(`\nQueries tested: ${results.length}`);
  console.log(`Successful: ${successful.length}/${results.length}`);
  console.log(`Avg citations: ${avgCitations.toFixed(1)}`);
  console.log(`Avg text length: ${avgTextLen.toFixed(0)} chars`);
  console.log(`Avg latency: ${avgLatency.toFixed(0)}ms`);
  console.log(`Placeholder URLs found: ${totalPlaceholders}`);

  // Pass/fail assertions
  console.log("\n" + "=".repeat(70));
  console.log("ASSERTIONS");
  console.log("=".repeat(70));

  let passed = 0;
  let failed = 0;

  function assert(name: string, condition: boolean) {
    if (condition) {
      console.log(`  PASS: ${name}`);
      passed++;
    } else {
      console.log(`  FAIL: ${name}`);
      failed++;
    }
  }

  assert(
    "All queries succeeded",
    successful.length === results.length
  );
  assert(
    "Average citations >= 3",
    avgCitations >= 3
  );
  assert(
    "Zero placeholder URLs",
    totalPlaceholders === 0
  );
  assert(
    "Average text length > 500 chars",
    avgTextLen > 500
  );
  assert(
    "Average latency < 15000ms",
    avgLatency < 15000
  );

  // Print sample citations for manual review
  console.log("\n" + "=".repeat(70));
  console.log("SAMPLE CITATIONS (manual review)");
  console.log("=".repeat(70));

  for (const result of successful) {
    console.log(`\n  Query: "${result.query}"`);
    for (const cite of result.sampleCitations) {
      console.log(`    - [${cite.title}] ${cite.url}`);
    }
  }

  console.log(
    `\n${passed}/${passed + failed} assertions passed.`
  );

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch(console.error);
