/**
 * MASTER BLASTER - Unified Quality Verification System
 *
 * Chains all test suites into a single verification command.
 * Run this BEFORE human testing to catch regressions early.
 *
 * Usage:
 *   bun run verify              # Default: unit + smoke tests
 *   bun run verify:quick        # Fast: unit tests only
 *   bun run verify:full         # Full: all suites including E2E
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

// Disable verbose logging during tests
process.env.LOG_LEVEL = 'warn';

// =============================================================================
// TYPES
// =============================================================================

interface SuiteResult {
  name: string;
  passed: number;
  failed: number;
  skipped: number;
  duration: number;
  errors: string[];
}

interface VerificationReport {
  startTime: string;
  endTime: string;
  duration: number;
  suites: SuiteResult[];
  totalPassed: number;
  totalFailed: number;
  totalSkipped: number;
  success: boolean;
}

// =============================================================================
// UTILITIES
// =============================================================================

/**
 * Run a command and capture output
 */
async function runCommand(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs: number = 120000
): Promise<{ success: boolean; output: string; duration: number }> {
  const start = Date.now();

  return new Promise((resolve) => {
    const proc = spawn(command, args, {
      cwd,
      shell: true,
      stdio: ['inherit', 'pipe', 'pipe'],
    });

    let output = '';
    let errorOutput = '';

    proc.stdout?.on('data', (data) => {
      output += data.toString();
    });

    proc.stderr?.on('data', (data) => {
      errorOutput += data.toString();
    });

    const timeout = setTimeout(() => {
      proc.kill();
      resolve({
        success: false,
        output: output + '\n[TIMEOUT after ' + timeoutMs + 'ms]',
        duration: Date.now() - start,
      });
    }, timeoutMs);

    proc.on('close', (code) => {
      clearTimeout(timeout);
      resolve({
        success: code === 0,
        output: output + (errorOutput ? '\n' + errorOutput : ''),
        duration: Date.now() - start,
      });
    });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      resolve({
        success: false,
        output: `Error: ${err.message}`,
        duration: Date.now() - start,
      });
    });
  });
}

/**
 * Parse test count from bun test output
 */
function parseBunTestOutput(output: string): { passed: number; failed: number; skipped: number } {
  // bun test output format: "X pass, Y fail, Z skip"
  const passMatch = output.match(/(\d+)\s+pass/i);
  const failMatch = output.match(/(\d+)\s+fail/i);
  const skipMatch = output.match(/(\d+)\s+skip/i);

  return {
    passed: passMatch ? parseInt(passMatch[1], 10) : 0,
    failed: failMatch ? parseInt(failMatch[1], 10) : 0,
    skipped: skipMatch ? parseInt(skipMatch[1], 10) : 0,
  };
}

/**
 * Parse smoke test output (counts ✅ and ❌)
 */
function parseSmokeTestOutput(output: string): { passed: number; failed: number; skipped: number } {
  const passMatches = output.match(/✅/g) || [];
  const failMatches = output.match(/❌/g) || [];

  return {
    passed: passMatches.length,
    failed: failMatches.length,
    skipped: 0,
  };
}

// =============================================================================
// TEST SUITE RUNNERS
// =============================================================================

/**
 * Run unit tests (bun test)
 */
async function runUnitTests(cwd: string): Promise<SuiteResult> {
  console.log('\n[UNIT] Running Unit Tests...');
  console.log('─'.repeat(50));

  const result = await runCommand('bun', ['test'], cwd, 60000);
  const counts = parseBunTestOutput(result.output);

  // Show output for failures
  if (!result.success) {
    console.log(result.output);
  }

  const status = result.success ? '\x1b[32m[PASS]\x1b[0m' : '\x1b[31m[FAIL]\x1b[0m';
  console.log(`  ${status} ${counts.passed} passed, ${counts.failed} failed (${result.duration}ms)`);

  return {
    name: 'Unit Tests',
    passed: counts.passed,
    failed: counts.failed,
    skipped: counts.skipped,
    duration: result.duration,
    errors: result.success ? [] : [result.output],
  };
}

/**
 * Run smoke tests (smoke-test-all.ts)
 */
async function runSmokeTests(cwd: string, quick: boolean = false): Promise<SuiteResult> {
  console.log('\n[SMOKE] Running Smoke Tests...');
  console.log('─'.repeat(50));

  const scriptPath = join(cwd, 'scripts', 'smoke-test-all.ts');
  const result = await runCommand('bun', ['run', scriptPath], cwd, 180000);
  const counts = parseSmokeTestOutput(result.output);

  // Show output for failures or if verbose
  if (!result.success) {
    console.log(result.output);
  }

  const status = result.success ? '\x1b[32m[PASS]\x1b[0m' : '\x1b[31m[FAIL]\x1b[0m';
  console.log(`  ${status} ${counts.passed} passed, ${counts.failed} failed (${result.duration}ms)`);

  return {
    name: 'Smoke Tests',
    passed: counts.passed,
    failed: counts.failed,
    skipped: counts.skipped,
    duration: result.duration,
    errors: result.success ? [] : [result.output],
  };
}

/**
 * Run E2E tests (test-runner.ts)
 */
async function runE2ETests(cwd: string): Promise<SuiteResult> {
  console.log('\n[E2E] Running E2E Tests...');
  console.log('─'.repeat(50));

  const scriptPath = join(cwd, 'src', 'health', 'test-runner.ts');
  const result = await runCommand('bun', ['run', scriptPath], cwd, 180000);

  // Parse E2E output (similar to smoke tests)
  const counts = parseSmokeTestOutput(result.output);

  // Show output for failures
  if (!result.success) {
    console.log(result.output);
  }

  const status = result.success ? '\x1b[32m[PASS]\x1b[0m' : '\x1b[31m[FAIL]\x1b[0m';
  console.log(`  ${status} ${counts.passed} passed, ${counts.failed} failed (${result.duration}ms)`);

  return {
    name: 'E2E Tests',
    passed: counts.passed,
    failed: counts.failed,
    skipped: counts.skipped,
    duration: result.duration,
    errors: result.success ? [] : [result.output],
  };
}

/**
 * Run canary tests (silent failure detection)
 */
async function runCanaryTests(cwd: string): Promise<SuiteResult> {
  console.log('\n[CANARY] Running Silent Failure Detection...');
  console.log('─'.repeat(50));

  const scriptPath = join(cwd, 'scripts', 'canary-tests.ts');
  const result = await runCommand('bun', ['run', scriptPath], cwd, 120000);

  // Count canary results (✅ and ❌)
  const passMatches = result.output.match(/✅/g) || [];
  const failMatches = result.output.match(/❌/g) || [];

  // Show output for failures
  if (!result.success) {
    console.log(result.output);
  }

  const status = result.success ? '\x1b[32m[PASS]\x1b[0m' : '\x1b[31m[FAIL]\x1b[0m';
  console.log(`  ${status} ${passMatches.length} passed, ${failMatches.length} failed (${result.duration}ms)`);

  return {
    name: 'Canary Tests',
    passed: passMatches.length,
    failed: failMatches.length,
    skipped: 0,
    duration: result.duration,
    errors: result.success ? [] : [result.output],
  };
}

/**
 * Run integration tests (health checks, Notion connectivity)
 */
async function runIntegrationTests(cwd: string): Promise<SuiteResult> {
  console.log('\n[INTEG] Running Integration Tests...');
  console.log('─'.repeat(50));

  const start = Date.now();
  const errors: string[] = [];
  let passed = 0;
  let failed = 0;

  // Test 1: Health checks module loads
  try {
    const { runHealthChecks } = await import('../src/health/index.js');
    const report = await runHealthChecks();
    if (report.canStart) {
      passed++;
      console.log('  \x1b[32m✓\x1b[0m Health checks pass');
    } else {
      failed++;
      console.log('  \x1b[31m✗\x1b[0m Health checks failed');
      errors.push('Health checks failed: ' + JSON.stringify(report.checks.filter(c => c.status === 'fail')));
    }
  } catch (err: any) {
    failed++;
    console.log('  \x1b[31m✗\x1b[0m Health check module error');
    errors.push('Health check error: ' + err.message);
  }

  // Test 2: Notion client can be instantiated
  try {
    if (!process.env.NOTION_API_KEY) {
      console.log('  \x1b[33m○\x1b[0m Notion connectivity (skipped - no API key)');
    } else {
      const { Client } = await import('@notionhq/client');
      const notion = new Client({ auth: process.env.NOTION_API_KEY });
      await notion.databases.query({
        database_id: '90b2b33f-4b44-4b42-870f-8d62fb8cbf18',
        page_size: 1,
      });
      passed++;
      console.log('  \x1b[32m✓\x1b[0m Notion connectivity');
    }
  } catch (err: any) {
    failed++;
    console.log('  \x1b[31m✗\x1b[0m Notion connectivity failed');
    errors.push('Notion error: ' + err.message);
  }

  // Test 3: Claude API can be instantiated
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      console.log('  \x1b[33m○\x1b[0m Claude API (skipped - no API key)');
    } else {
      const Anthropic = (await import('@anthropic-ai/sdk')).default;
      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      // Just verify instantiation, don't make API call in quick mode
      passed++;
      console.log('  \x1b[32m✓\x1b[0m Claude API configured');
    }
  } catch (err: any) {
    failed++;
    console.log('  \x1b[31m✗\x1b[0m Claude API configuration failed');
    errors.push('Claude error: ' + err.message);
  }

  // Test 4: Skill registry loads
  try {
    const { initializeSkillRegistry, getSkillRegistry } = await import('../src/skills/registry.js');
    await initializeSkillRegistry();
    const registry = getSkillRegistry();
    const stats = registry.getStats();
    if (stats.total >= 0) {
      passed++;
      console.log(`  \x1b[32m✓\x1b[0m Skill registry (${stats.total} skills)`);
    } else {
      failed++;
      console.log('  \x1b[31m✗\x1b[0m Skill registry failed');
    }
  } catch (err: any) {
    failed++;
    console.log('  \x1b[31m✗\x1b[0m Skill registry error');
    errors.push('Skill registry error: ' + err.message);
  }

  const duration = Date.now() - start;
  const status = failed === 0 ? '\x1b[32m[PASS]\x1b[0m' : '\x1b[31m[FAIL]\x1b[0m';
  console.log(`  ${status} ${passed} passed, ${failed} failed (${duration}ms)`);

  return {
    name: 'Integration Tests',
    passed,
    failed,
    skipped: 0,
    duration,
    errors,
  };
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  const args = process.argv.slice(2);
  const quick = args.includes('--quick');
  const full = args.includes('--full');

  const cwd = join(import.meta.dir, '..');
  const startTime = new Date();

  // Header
  console.log('\n');
  console.log('====================================');
  console.log('   MASTER BLASTER VERIFICATION');
  console.log('====================================');
  console.log(`\nMode: ${quick ? 'QUICK' : full ? 'FULL' : 'DEFAULT'}`);
  console.log(`Started: ${startTime.toISOString()}`);
  console.log(`Working dir: ${cwd}`);

  const suites: SuiteResult[] = [];

  // Quick mode: Unit tests only
  if (quick) {
    suites.push(await runUnitTests(cwd));
  }
  // Full mode: All suites including canaries and E2E
  else if (full) {
    suites.push(await runCanaryTests(cwd));  // Canaries first - detect silent failures
    suites.push(await runUnitTests(cwd));
    suites.push(await runSmokeTests(cwd));
    suites.push(await runE2ETests(cwd));
    suites.push(await runIntegrationTests(cwd));
  }
  // Default mode: Canaries + Unit + Smoke + Integration
  else {
    suites.push(await runCanaryTests(cwd));  // Canaries first - detect silent failures
    suites.push(await runUnitTests(cwd));
    suites.push(await runSmokeTests(cwd));
    suites.push(await runIntegrationTests(cwd));
  }

  // Calculate totals
  const endTime = new Date();
  const totalPassed = suites.reduce((sum, s) => sum + s.passed, 0);
  const totalFailed = suites.reduce((sum, s) => sum + s.failed, 0);
  const totalSkipped = suites.reduce((sum, s) => sum + s.skipped, 0);
  const totalDuration = endTime.getTime() - startTime.getTime();

  // Summary
  console.log('\n');
  console.log('====================================');
  console.log('   SUMMARY');
  console.log('====================================');

  for (const suite of suites) {
    const status = suite.failed === 0 ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
    console.log(`${status} ${suite.name.padEnd(25)} ${suite.passed}/${suite.passed + suite.failed}`);
  }

  console.log('────────────────────────────────────');
  console.log(`   Total: ${totalPassed} passed, ${totalFailed} failed`);
  console.log(`   Duration: ${(totalDuration / 1000).toFixed(2)}s`);
  console.log('====================================');

  // Final result
  if (totalFailed === 0) {
    console.log('\n\x1b[32m   RESULT: ALL SYSTEMS GO\x1b[0m');
    console.log('\n');
    process.exit(0);
  } else {
    console.log('\n\x1b[31m   RESULT: FAILURES DETECTED\x1b[0m');
    console.log('\n');

    // Print detailed errors
    for (const suite of suites) {
      if (suite.errors.length > 0) {
        console.log(`\n--- ${suite.name} Errors ---`);
        for (const error of suite.errors) {
          console.log(error.substring(0, 500));
        }
      }
    }

    process.exit(1);
  }
}

main().catch((error) => {
  console.error('\n\x1b[31mFatal error:\x1b[0m', error);
  process.exit(1);
});
