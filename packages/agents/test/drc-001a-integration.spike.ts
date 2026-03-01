/**
 * DRC-001a: Integration Spike — Live Notion Read
 *
 * Tests the full resolution chain against the real Research Pipeline Config database.
 * Requires NOTION_API_KEY and RESEARCH_PIPELINE_CONFIG_DB env vars.
 *
 * Run: RESEARCH_PIPELINE_CONFIG_DB=6a03c508-1577-40e4-8da4-d55a3264c915 bun run test/drc-001a-integration.spike.ts
 */

import {
  getResearchPipelineConfig,
  getResearchPipelineConfigSync,
  invalidateConfigCache,
  COMPILED_DEFAULTS,
} from '../src/config';

async function main() {
  const dbId = process.env.RESEARCH_PIPELINE_CONFIG_DB;
  const hasKey = !!process.env.NOTION_API_KEY;

  console.log('=== DRC-001a Integration Spike ===');
  console.log(`NOTION_API_KEY: ${hasKey ? 'present' : 'MISSING'}`);
  console.log(`RESEARCH_PIPELINE_CONFIG_DB: ${dbId || 'MISSING'}`);
  console.log('');

  if (!hasKey || !dbId) {
    console.error('Missing required env vars. Set NOTION_API_KEY and RESEARCH_PIPELINE_CONFIG_DB.');
    process.exit(1);
  }

  // 1. Clear cache to force Notion fetch
  invalidateConfigCache();

  // 2. Async resolve — should hit Notion
  console.log('[Test 1] Async resolve from Notion...');
  const resolved = await getResearchPipelineConfig();
  console.log(`  configSource: ${resolved.configSource}`);
  console.log(`  name: ${resolved.config.name}`);
  console.log(`  resolvedAt: ${resolved.resolvedAt}`);

  if (resolved.configSource === 'notion') {
    console.log('  ✓ PASS: Resolved from Notion');
  } else {
    console.error('  ✗ FAIL: Expected configSource=notion, got', resolved.configSource);
    process.exit(1);
  }

  // 3. Verify config shape — all required fields present and typed correctly
  // Values may differ from compiled defaults (Jim tunes them in Notion)
  console.log('\n[Test 2] Config shape validation...');
  const cfg = resolved.config;

  const shapeChecks: [string, unknown, string][] = [
    ['name', cfg.name, 'string'],
    ['depths.light.maxTokens', cfg.depths.light.maxTokens, 'number'],
    ['depths.standard.maxTokens', cfg.depths.standard.maxTokens, 'number'],
    ['depths.deep.maxTokens', cfg.depths.deep.maxTokens, 'number'],
    ['depths.deep.citationStyle', cfg.depths.deep.citationStyle, 'string'],
    ['andonThresholds.groundedMinSources', cfg.andonThresholds.groundedMinSources, 'number'],
    ['andonThresholds.noveltyFloor', cfg.andonThresholds.noveltyFloor, 'number'],
    ['andonThresholds.minSummaryLength', cfg.andonThresholds.minSummaryLength, 'number'],
    ['searchProviders.gemini.model', cfg.searchProviders.gemini.model, 'string'],
    ['searchProviders.gemini.groundingRetryMax', cfg.searchProviders.gemini.groundingRetryMax, 'number'],
    ['evidencePresets.standard', cfg.evidencePresets.standard, 'string'],
  ];

  let allValid = true;
  for (const [field, value, expectedType] of shapeChecks) {
    if (typeof value === expectedType && value !== null && value !== undefined) {
      console.log(`  ✓ ${field}: ${value} (${expectedType})`);
    } else {
      console.error(`  ✗ ${field}: expected ${expectedType}, got ${typeof value} (${value})`);
      allValid = false;
    }
  }

  if (allValid) {
    console.log('  ✓ PASS: Config shape valid — all fields present and correctly typed');
  } else {
    console.error('  ✗ FAIL: Config shape invalid');
    process.exit(1);
  }

  // 4. Sync read should now return cached
  console.log('\n[Test 3] Sync read from cache...');
  const cached = getResearchPipelineConfigSync();
  if (cached.configSource === 'cached') {
    console.log('  ✓ PASS: Sync read returns cached config');
  } else {
    console.error('  ✗ FAIL: Expected configSource=cached, got', cached.configSource);
    process.exit(1);
  }

  // 5. Cache invalidation + re-fetch
  console.log('\n[Test 4] Cache invalidation + re-fetch...');
  invalidateConfigCache();
  const syncAfterInvalidate = getResearchPipelineConfigSync();
  if (syncAfterInvalidate.configSource === 'compiled-default') {
    console.log('  ✓ PASS: Sync after invalidation returns compiled-default');
  } else {
    console.error('  ✗ FAIL: Expected compiled-default, got', syncAfterInvalidate.configSource);
    process.exit(1);
  }

  const refetched = await getResearchPipelineConfig();
  if (refetched.configSource === 'notion') {
    console.log('  ✓ PASS: Re-fetch from Notion succeeded');
  } else {
    console.error('  ✗ FAIL: Re-fetch failed, got', refetched.configSource);
    process.exit(1);
  }

  console.log('\n=== All integration tests passed ===');
}

main().catch((err) => {
  console.error('Integration spike failed:', err);
  process.exit(1);
});
