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

  // 3. Verify config shape matches compiled defaults (seeded with same values)
  console.log('\n[Test 2] Config parity with compiled defaults...');
  const cfg = resolved.config;

  const checks = [
    ['depths.light.maxTokens', cfg.depths.light.maxTokens, COMPILED_DEFAULTS.depths.light.maxTokens],
    ['depths.standard.maxTokens', cfg.depths.standard.maxTokens, COMPILED_DEFAULTS.depths.standard.maxTokens],
    ['depths.deep.maxTokens', cfg.depths.deep.maxTokens, COMPILED_DEFAULTS.depths.deep.maxTokens],
    ['andonThresholds.groundedMinSources', cfg.andonThresholds.groundedMinSources, COMPILED_DEFAULTS.andonThresholds.groundedMinSources],
    ['andonThresholds.noveltyFloor', cfg.andonThresholds.noveltyFloor, COMPILED_DEFAULTS.andonThresholds.noveltyFloor],
    ['andonThresholds.minSummaryLength', cfg.andonThresholds.minSummaryLength, COMPILED_DEFAULTS.andonThresholds.minSummaryLength],
    ['searchProviders.gemini.model', cfg.searchProviders.gemini.model, COMPILED_DEFAULTS.searchProviders.gemini.model],
    ['searchProviders.gemini.groundingRetryMax', cfg.searchProviders.gemini.groundingRetryMax, COMPILED_DEFAULTS.searchProviders.gemini.groundingRetryMax],
  ] as const;

  let allMatch = true;
  for (const [field, actual, expected] of checks) {
    if (actual === expected) {
      console.log(`  ✓ ${field}: ${actual}`);
    } else {
      console.error(`  ✗ ${field}: expected ${expected}, got ${actual}`);
      allMatch = false;
    }
  }

  if (allMatch) {
    console.log('  ✓ PASS: All values match compiled defaults');
  } else {
    console.error('  ✗ FAIL: Value mismatch — database may have different config');
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
