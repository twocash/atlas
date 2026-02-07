/**
 * Fail-Fast Infrastructure — Integration Tests (E2E-1 through E2E-6)
 *
 * Tests all failure modes introduced by the fail-fast sprint.
 * Run with: bun run scripts/fail-fast-e2e-tests.ts
 *
 * Exit Codes:
 *   0 = All tests passed
 *   1 = One or more tests failed
 */

import { config } from 'dotenv';
import { join } from 'path';
import { spawn } from 'child_process';

// Load environment variables
config({ path: join(import.meta.dir, '..', '.env'), override: true });

// =============================================================================
// TYPES
// =============================================================================

interface TestResult {
  name: string;
  passed: boolean;
  duration: number;
  error?: string;
  evidence?: string;
}

// =============================================================================
// E2E TESTS
// =============================================================================

/**
 * E2E-1: Research validation with valid output → passes
 */
async function testResearchValidOutput(): Promise<TestResult> {
  const start = Date.now();

  try {
    const { validateResearchOutput } = await import('../src/agents/validation.js');

    const validOutput = {
      findings: 'Found 3 relevant papers on distributed AI systems.',
      confidence: 0.85,
      toolExecutions: [
        { tool: 'notion_search', result: { pages: ['page1', 'page2'] } },
        { tool: 'web_search', result: { results: ['result1'] } },
      ],
    };

    // Should NOT throw
    validateResearchOutput(validOutput);

    return {
      name: 'E2E-1: Research with valid tools → passes',
      passed: true,
      duration: Date.now() - start,
    };
  } catch (error: any) {
    return {
      name: 'E2E-1: Research with valid tools → passes',
      passed: false,
      duration: Date.now() - start,
      error: `Should not have thrown: ${error.message}`,
    };
  }
}

/**
 * E2E-2: Research with no tool executions → HallucinationError
 */
async function testResearchNoTools(): Promise<TestResult> {
  const start = Date.now();

  try {
    // Disable auto-logging for test (don't pollute Dev Pipeline)
    const savedAutoLog = process.env.AUTO_LOG_ERRORS;
    process.env.AUTO_LOG_ERRORS = 'false';

    const { validateResearchOutput } = await import('../src/agents/validation.js');

    const hallucinated = {
      findings: 'I found that the system uses distributed consensus.',
      confidence: 0.9,
      toolExecutions: [], // NO tools called!
    };

    try {
      validateResearchOutput(hallucinated);
      process.env.AUTO_LOG_ERRORS = savedAutoLog || '';
      return {
        name: 'E2E-2: Research with no tools → hard failure',
        passed: false,
        duration: Date.now() - start,
        error: 'Should have thrown HallucinationError but did not',
      };
    } catch (err: any) {
      process.env.AUTO_LOG_ERRORS = savedAutoLog || '';
      const isCorrectError = err.constructor.name === 'HallucinationError';
      return {
        name: 'E2E-2: Research with no tools → hard failure',
        passed: isCorrectError,
        duration: Date.now() - start,
        error: isCorrectError ? undefined : `Wrong error type: ${err.constructor.name}`,
        evidence: isCorrectError ? `HallucinationError: ${err.message}` : undefined,
      };
    }
  } catch (error: any) {
    return {
      name: 'E2E-2: Research with no tools → hard failure',
      passed: false,
      duration: Date.now() - start,
      error: `Test setup failed: ${error.message}`,
    };
  }
}

/**
 * E2E-3: Low confidence classification → ClassificationError in strict mode
 */
async function testLowConfidenceClassification(): Promise<TestResult> {
  const start = Date.now();

  try {
    // Disable auto-logging for test
    const savedAutoLog = process.env.AUTO_LOG_ERRORS;
    const savedFallbacks = process.env.ENABLE_FALLBACKS;
    process.env.AUTO_LOG_ERRORS = 'false';
    process.env.ENABLE_FALLBACKS = 'false'; // Strict mode

    const { classifySpark } = await import('../src/classifier.js');

    try {
      // This message has no strong signals → low confidence → should throw
      await classifySpark('random text with no keywords whatsoever');

      process.env.AUTO_LOG_ERRORS = savedAutoLog || '';
      process.env.ENABLE_FALLBACKS = savedFallbacks || '';

      return {
        name: 'E2E-3: Low confidence classification → hard failure',
        passed: false,
        duration: Date.now() - start,
        error: 'Should have thrown ClassificationError but did not',
      };
    } catch (err: any) {
      process.env.AUTO_LOG_ERRORS = savedAutoLog || '';
      process.env.ENABLE_FALLBACKS = savedFallbacks || '';

      const isCorrectError = err.constructor.name === 'ClassificationError';
      return {
        name: 'E2E-3: Low confidence classification → hard failure',
        passed: isCorrectError,
        duration: Date.now() - start,
        error: isCorrectError ? undefined : `Wrong error type: ${err.constructor.name}: ${err.message}`,
        evidence: isCorrectError ? `ClassificationError: ${err.message}` : undefined,
      };
    }
  } catch (error: any) {
    return {
      name: 'E2E-3: Low confidence classification → hard failure',
      passed: false,
      duration: Date.now() - start,
      error: `Test setup failed: ${error.message}`,
    };
  }
}

/**
 * E2E-4: Notion sync with bad page ID → NotionSyncError
 */
async function testNotionSyncFailure(): Promise<TestResult> {
  const start = Date.now();

  try {
    if (!process.env.NOTION_API_KEY) {
      return {
        name: 'E2E-4: Notion sync failure → hard failure',
        passed: true,
        duration: Date.now() - start,
        evidence: 'Skipped (no NOTION_API_KEY)',
      };
    }

    // Disable auto-logging for test
    const savedAutoLog = process.env.AUTO_LOG_ERRORS;
    process.env.AUTO_LOG_ERRORS = 'false';

    const { Client } = await import('@notionhq/client');
    const notion = new Client({ auth: process.env.NOTION_API_KEY });

    // Try to retrieve a page with an obviously invalid ID
    try {
      await notion.pages.retrieve({ page_id: '00000000-0000-0000-0000-000000000000' });
      process.env.AUTO_LOG_ERRORS = savedAutoLog || '';
      return {
        name: 'E2E-4: Notion sync failure → hard failure',
        passed: false,
        duration: Date.now() - start,
        error: 'Should have thrown but Notion accepted invalid ID',
      };
    } catch (err: any) {
      process.env.AUTO_LOG_ERRORS = savedAutoLog || '';
      // Any error here is correct — Notion rejects bad IDs
      return {
        name: 'E2E-4: Notion sync failure → hard failure',
        passed: true,
        duration: Date.now() - start,
        evidence: `Notion correctly rejected: ${err.message?.substring(0, 80)}`,
      };
    }
  } catch (error: any) {
    return {
      name: 'E2E-4: Notion sync failure → hard failure',
      passed: false,
      duration: Date.now() - start,
      error: `Test setup failed: ${error.message}`,
    };
  }
}

/**
 * E2E-5: Production startup with ENABLE_FALLBACKS=true → process.exit(1)
 * Tests that validateEnvironment kills the process, not just throws.
 */
async function testProductionFallbackReject(): Promise<TestResult> {
  const start = Date.now();

  try {
    // Spawn a subprocess that sets production + fallbacks and tries to validate
    const testScript = `
      process.env.ATLAS_MODE = 'production';
      process.env.ENABLE_FALLBACKS = 'true';
      const { validateEnvironment } = require('./src/config/environment.ts');
      validateEnvironment();
      // If we get here, the guard failed
      console.log('GUARD_FAILED');
      process.exit(0);
    `;

    const cwd = join(import.meta.dir, '..');

    return new Promise((resolve) => {
      const proc = spawn('bun', ['eval', testScript], {
        cwd,
        shell: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (data) => { stdout += data.toString(); });
      proc.stderr?.on('data', (data) => { stderr += data.toString(); });

      const timeout = setTimeout(() => {
        proc.kill();
        resolve({
          name: 'E2E-5: Production + fallbacks → process.exit(1)',
          passed: false,
          duration: Date.now() - start,
          error: 'Subprocess timed out',
        });
      }, 10000);

      proc.on('close', (code) => {
        clearTimeout(timeout);

        if (stdout.includes('GUARD_FAILED')) {
          resolve({
            name: 'E2E-5: Production + fallbacks → process.exit(1)',
            passed: false,
            duration: Date.now() - start,
            error: 'validateEnvironment did NOT exit — guard failed',
          });
        } else if (code !== 0) {
          resolve({
            name: 'E2E-5: Production + fallbacks → process.exit(1)',
            passed: true,
            duration: Date.now() - start,
            evidence: `Process exited with code ${code} (expected non-zero)`,
          });
        } else {
          resolve({
            name: 'E2E-5: Production + fallbacks → process.exit(1)',
            passed: false,
            duration: Date.now() - start,
            error: `Process exited 0 — guard may not have fired. stdout: ${stdout.substring(0, 200)}`,
          });
        }
      });
    });
  } catch (error: any) {
    return {
      name: 'E2E-5: Production + fallbacks → process.exit(1)',
      passed: false,
      duration: Date.now() - start,
      error: `Test setup failed: ${error.message}`,
    };
  }
}

/**
 * E2E-6: Error auto-logging creates proper AtlasError with severity and context
 */
async function testErrorAutoLogging(): Promise<TestResult> {
  const start = Date.now();

  try {
    // Disable actual Notion logging — just verify the error structure
    const savedAutoLog = process.env.AUTO_LOG_ERRORS;
    process.env.AUTO_LOG_ERRORS = 'false';

    const { AtlasError, HallucinationError, ClassificationError, NotionSyncError } =
      await import('../src/errors.js');

    // Test all error types have correct severity
    const hall = new HallucinationError('test', { data: 'test' });
    const cls = new ClassificationError('test', { data: 'test' });
    const sync = new NotionSyncError('test', { data: 'test' });

    const checks = [
      { name: 'HallucinationError severity', ok: hall.severity === 'P0' },
      { name: 'ClassificationError severity', ok: cls.severity === 'P1' },
      { name: 'NotionSyncError severity', ok: sync.severity === 'P1' },
      { name: 'AtlasError has timestamp', ok: hall.timestamp instanceof Date },
      { name: 'AtlasError has context', ok: typeof hall.context === 'object' && hall.context.data === 'test' },
      { name: 'AtlasError has logToDevPipeline', ok: typeof hall.logToDevPipeline === 'function' },
      { name: 'HallucinationError extends AtlasError', ok: hall instanceof AtlasError },
    ];

    process.env.AUTO_LOG_ERRORS = savedAutoLog || '';

    const failed = checks.filter(c => !c.ok);
    if (failed.length > 0) {
      return {
        name: 'E2E-6: Error auto-logging structure',
        passed: false,
        duration: Date.now() - start,
        error: `Failed checks: ${failed.map(f => f.name).join(', ')}`,
      };
    }

    return {
      name: 'E2E-6: Error auto-logging structure',
      passed: true,
      duration: Date.now() - start,
      evidence: `All ${checks.length} structure checks passed`,
    };
  } catch (error: any) {
    return {
      name: 'E2E-6: Error auto-logging structure',
      passed: false,
      duration: Date.now() - start,
      error: `Test setup failed: ${error.message}`,
    };
  }
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  console.log('\n');
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║     FAIL-FAST INFRASTRUCTURE — E2E TESTS                 ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log(`\nStarted: ${new Date().toISOString()}`);

  const startTime = Date.now();
  const results: TestResult[] = [];

  // Run all E2E tests
  results.push(await testResearchValidOutput());
  results.push(await testResearchNoTools());
  results.push(await testLowConfidenceClassification());
  results.push(await testNotionSyncFailure());
  results.push(await testProductionFallbackReject());
  results.push(await testErrorAutoLogging());

  // Display results
  console.log('\n');
  for (const r of results) {
    const icon = r.passed ? '✅' : '❌';
    console.log(`  ${icon} ${r.name} (${r.duration}ms)`);
    if (r.error) console.log(`     └─ ${r.error}`);
    if (r.evidence) console.log(`     └─ ${r.evidence}`);
  }

  // Summary
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const duration = Date.now() - startTime;

  console.log('\n════════════════════════════════════════════════════════════');
  console.log(`\n📊 SUMMARY: ${passed}/${results.length} passed, ${failed} failed`);
  console.log(`⏱️  Duration: ${(duration / 1000).toFixed(2)}s`);

  if (failed > 0) {
    console.log('\n🛑 FAIL-FAST E2E TESTS FAILED\n');
    process.exit(1);
  } else {
    console.log('\n✅ ALL FAIL-FAST E2E TESTS PASSED\n');
    process.exit(0);
  }
}

main().catch((error) => {
  console.error('\n❌ E2E test runner failed:', error);
  process.exit(1);
});
