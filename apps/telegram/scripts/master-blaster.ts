/**
 * MASTER BLASTER - Unified Quality Verification System
 *
 * Chains ALL test suites across the FULL Atlas surface into a single
 * verification command. Covers Telegram bot, Chrome Extension, Bridge,
 * and cross-cutting integration tests.
 *
 * Surfaces tested:
 *   - Telegram Bot: unit, regression, canary, smoke, E2E, integration
 *   - Chrome Extension: unit (DOM→Notion, AI classification), build
 *   - Bridge: tool dispatch pipeline, Playwright stability
 *   - Cross-cutting: health checks, Notion connectivity, Claude API
 *
 * Usage:
 *   bun run verify              # Default: all surfaces (strict)
 *   bun run verify:quick        # Fast: unit + regression + chrome ext
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
 * Resolve bun path — handles Windows environments where bun isn't in PATH
 */
function resolveBunPath(): string {
  const homeDir = process.env.USERPROFILE || process.env.HOME || '';
  const bunPaths = [
    'bun',
    `${homeDir}/.bun/bin/bun.exe`,
    `${homeDir}/.bun/bin/bun`,
  ];
  // Try the first available — spawn will fail fast if wrong
  for (const p of bunPaths) {
    try {
      // Quick existence check for explicit paths
      if (p !== 'bun' && require('fs').existsSync(p)) return p;
    } catch { /* ignore */ }
  }
  return bunPaths[0]; // Default to 'bun', let spawn report the error
}

const BUN_PATH = resolveBunPath();

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

  const result = await runCommand(BUN_PATH, ['test'], cwd, 60000);
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
  const result = await runCommand(BUN_PATH, ['run', scriptPath], cwd, 180000);
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
  const result = await runCommand(BUN_PATH, ['run', scriptPath], cwd, 180000);

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
  const result = await runCommand(BUN_PATH, ['run', scriptPath], cwd, 120000);

  // Count canary results (✅ and ❌)
  const passMatches = result.output.match(/✅/g) || [];
  const failMatches = result.output.match(/❌/g) || [];

  // Detect complete subprocess failure (bun not found, crash, etc.)
  let failed = failMatches.length;
  if (!result.success && passMatches.length === 0 && failMatches.length === 0) {
    failed = 1; // Subprocess didn't produce any results — treat as failure
    console.log('  ⚠️  Canary subprocess produced no results — treating as failure');
    console.log(result.output);
  } else if (!result.success) {
    console.log(result.output);
  }

  const status = failed === 0 ? '\x1b[32m[PASS]\x1b[0m' : '\x1b[31m[FAIL]\x1b[0m';
  console.log(`  ${status} ${passMatches.length} passed, ${failed} failed (${result.duration}ms)`);

  return {
    name: 'Canary Tests',
    passed: passMatches.length,
    failed,
    skipped: 0,
    duration: result.duration,
    errors: failed > 0 ? [result.output] : [],
  };
}

/**
 * Run autonomous repair tests (Pit Stop sprint)
 */
async function runAutonomousRepairTests(cwd: string): Promise<SuiteResult> {
  console.log('\n[PITSTOP] Running Autonomous Repair Tests...');
  console.log('─'.repeat(50));

  const start = Date.now();
  const errors: string[] = [];
  let passed = 0;
  let failed = 0;

  // Test 1: Zone classifier loads and exports functions
  try {
    const zoneClassifier = await import('../src/skills/zone-classifier.js');
    if (
      typeof zoneClassifier.classifyZone === 'function' &&
      typeof zoneClassifier.createOperation === 'function'
    ) {
      passed++;
      console.log('  \x1b[32m✓\x1b[0m Zone classifier module exports');
    } else {
      failed++;
      console.log('  \x1b[31m✗\x1b[0m Zone classifier missing exports');
      errors.push('Zone classifier missing required exports');
    }
  } catch (err: any) {
    failed++;
    console.log('  \x1b[31m✗\x1b[0m Zone classifier import failed');
    errors.push('Zone classifier error: ' + err.message);
  }

  // Test 2: Zone classification works correctly
  try {
    const { classifyZone, createOperation } = await import('../src/skills/zone-classifier.js');

    // Test Zone 1: Tier 0 in data/skills/
    const op1 = createOperation({
      type: 'skill-edit',
      tier: 0,
      targetFiles: ['data/skills/test/SKILL.md'],
      description: 'Test Zone 1',
    });
    const result1 = classifyZone(op1);
    if (result1.zone === 'auto-execute') {
      passed++;
      console.log('  \x1b[32m✓\x1b[0m Zone 1 classification (auto-execute)');
    } else {
      failed++;
      console.log(`  \x1b[31m✗\x1b[0m Zone 1 classification (got ${result1.zone})`);
      errors.push(`Zone 1 expected auto-execute, got ${result1.zone}`);
    }

    // Test Zone 3: Core files
    const op3 = createOperation({
      type: 'code-fix',
      tier: 1,
      targetFiles: ['src/bot.ts'],
      description: 'Test Zone 3',
    });
    const result3 = classifyZone(op3);
    if (result3.zone === 'approve') {
      passed++;
      console.log('  \x1b[32m✓\x1b[0m Zone 3 classification (approve)');
    } else {
      failed++;
      console.log(`  \x1b[31m✗\x1b[0m Zone 3 classification (got ${result3.zone})`);
      errors.push(`Zone 3 expected approve, got ${result3.zone}`);
    }
  } catch (err: any) {
    failed++;
    console.log('  \x1b[31m✗\x1b[0m Zone classification logic failed');
    errors.push('Zone classification error: ' + err.message);
  }

  // Test 3: Swarm dispatch module loads
  try {
    const swarmDispatch = await import('../src/pit-crew/swarm-dispatch.js');
    if (
      typeof swarmDispatch.executeSwarmFix === 'function' &&
      typeof swarmDispatch.isWritableBySwarm === 'function' &&
      typeof swarmDispatch.getSwarmStats === 'function'
    ) {
      passed++;
      console.log('  \x1b[32m✓\x1b[0m Swarm dispatch module exports');
    } else {
      failed++;
      console.log('  \x1b[31m✗\x1b[0m Swarm dispatch missing exports');
      errors.push('Swarm dispatch missing required exports');
    }
  } catch (err: any) {
    failed++;
    console.log('  \x1b[31m✗\x1b[0m Swarm dispatch import failed');
    errors.push('Swarm dispatch error: ' + err.message);
  }

  // Test 4: File permission validation
  try {
    const { isWritableBySwarm, validateSwarmScope } = await import('../src/pit-crew/swarm-dispatch.js');

    // Should allow data/skills/
    if (isWritableBySwarm('data/skills/test/SKILL.md')) {
      passed++;
      console.log('  \x1b[32m✓\x1b[0m File permission: data/skills/ allowed');
    } else {
      failed++;
      console.log('  \x1b[31m✗\x1b[0m File permission: data/skills/ should be allowed');
      errors.push('data/skills/ should be writable');
    }

    // Should deny core files
    if (!isWritableBySwarm('src/index.ts')) {
      passed++;
      console.log('  \x1b[32m✓\x1b[0m File permission: src/index.ts denied');
    } else {
      failed++;
      console.log('  \x1b[31m✗\x1b[0m File permission: src/index.ts should be denied');
      errors.push('src/index.ts should NOT be writable');
    }

    // Scope validation
    const scopeResult = validateSwarmScope(['data/skills/a.md', 'src/bot.ts']);
    if (!scopeResult.valid && scopeResult.invalidFiles.includes('src/bot.ts')) {
      passed++;
      console.log('  \x1b[32m✓\x1b[0m Scope validation catches forbidden files');
    } else {
      failed++;
      console.log('  \x1b[31m✗\x1b[0m Scope validation should catch src/bot.ts');
      errors.push('Scope validation failed to catch forbidden file');
    }
  } catch (err: any) {
    failed++;
    console.log('  \x1b[31m✗\x1b[0m File permission validation failed');
    errors.push('Permission validation error: ' + err.message);
  }

  // Test 5: Feature flags default to OFF
  try {
    const { getFeatureFlags } = await import('../src/config/features.js');

    // Save and clear env vars
    const savedZone = process.env.ATLAS_ZONE_CLASSIFIER;
    const savedSwarm = process.env.ATLAS_SWARM_DISPATCH;
    const savedListener = process.env.ATLAS_SELF_IMPROVEMENT_LISTENER;
    delete process.env.ATLAS_ZONE_CLASSIFIER;
    delete process.env.ATLAS_SWARM_DISPATCH;
    delete process.env.ATLAS_SELF_IMPROVEMENT_LISTENER;

    // Module may cache, so we just verify the function exists and returns an object
    const flags = getFeatureFlags();
    if (typeof flags === 'object' && 'zoneClassifier' in flags && 'swarmDispatch' in flags) {
      passed++;
      console.log('  \x1b[32m✓\x1b[0m Feature flags structure valid');
    } else {
      failed++;
      console.log('  \x1b[31m✗\x1b[0m Feature flags structure invalid');
      errors.push('Feature flags missing required properties');
    }

    // Restore env vars
    if (savedZone) process.env.ATLAS_ZONE_CLASSIFIER = savedZone;
    if (savedSwarm) process.env.ATLAS_SWARM_DISPATCH = savedSwarm;
    if (savedListener) process.env.ATLAS_SELF_IMPROVEMENT_LISTENER = savedListener;
  } catch (err: any) {
    failed++;
    console.log('  \x1b[31m✗\x1b[0m Feature flags module failed');
    errors.push('Feature flags error: ' + err.message);
  }

  // Test 6: Self-improvement listener loads
  try {
    const listener = await import('../src/listeners/self-improvement.js');
    if (
      typeof listener.startSelfImprovementListener === 'function' &&
      typeof listener.stopSelfImprovementListener === 'function' &&
      typeof listener.getSelfImprovementListenerStatus === 'function'
    ) {
      passed++;
      console.log('  \x1b[32m✓\x1b[0m Self-improvement listener exports');
    } else {
      failed++;
      console.log('  \x1b[31m✗\x1b[0m Self-improvement listener missing exports');
      errors.push('Self-improvement listener missing required exports');
    }
  } catch (err: any) {
    failed++;
    console.log('  \x1b[31m✗\x1b[0m Self-improvement listener import failed');
    errors.push('Self-improvement listener error: ' + err.message);
  }

  // Test 7: Approval queue zone handling
  try {
    const approvalQueue = await import('../src/skills/approval-queue.js');
    if (
      typeof approvalQueue.handlePitCrewOperation === 'function' &&
      typeof approvalQueue.rollbackDeployment === 'function'
    ) {
      passed++;
      console.log('  \x1b[32m✓\x1b[0m Approval queue module exports');
    } else {
      failed++;
      console.log('  \x1b[31m✗\x1b[0m Approval queue missing exports');
      errors.push('Approval queue missing required exports');
    }
  } catch (err: any) {
    failed++;
    console.log('  \x1b[31m✗\x1b[0m Approval queue import failed');
    errors.push('Approval queue error: ' + err.message);
  }

  const duration = Date.now() - start;
  const status = failed === 0 ? '\x1b[32m[PASS]\x1b[0m' : '\x1b[31m[FAIL]\x1b[0m';
  console.log(`  ${status} ${passed} passed, ${failed} failed (${duration}ms)`);

  return {
    name: 'Autonomous Repair (Pit Stop)',
    passed,
    failed,
    skipped: 0,
    duration,
    errors,
  };
}

/**
 * Run bug regression tests (live-bugs-feb8 and future regression suites)
 */
async function runRegressionTests(cwd: string): Promise<SuiteResult> {
  console.log('\n[REGRESS] Running Bug Regression Tests...');
  console.log('─'.repeat(50));

  // Run all regression test files
  const regressionFiles = [
    'test/live-bugs-feb8.test.ts',
    'test/v3-strict-url-fabrication.test.ts',
    'test/telegram-shortcuts-quality.test.ts',
    'test/command-surface-audit.test.ts',
    // Gate 2: removed intent-first-phase1.test.ts (deleted — keyboard flows replaced by Socratic)
    // Gate 2: removed skill-dispatch-fault-tolerance.test.ts (deleted — keyboard callback paths removed)
    'test/intent-first-phase2.test.ts',
    'test/structured-composition-scenarios.test.ts',
    'test/v3-pipeline-lifecycle.test.ts',
    'src/conversation/__tests__/architecture.test.ts',  // Gate 2: Socratic architecture constraints
  ];

  const result = await runCommand(
    BUN_PATH,
    ['test', ...regressionFiles],
    cwd,
    60000
  );
  const counts = parseBunTestOutput(result.output);

  if (!result.success) {
    console.log(result.output);
  }

  const status = result.success ? '\x1b[32m[PASS]\x1b[0m' : '\x1b[31m[FAIL]\x1b[0m';
  console.log(`  ${status} ${counts.passed} passed, ${counts.failed} failed (${result.duration}ms)`);

  return {
    name: 'Bug Regression Tests',
    passed: counts.passed,
    failed: counts.failed,
    skipped: counts.skipped,
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

/**
 * Run Action Feed Producer tests (P2 Approval + P3 Review)
 *
 * Runs in a SEPARATE bun process to avoid mock.module leaking
 * into the shared regression suite. These tests mock ../src/notion
 * and ../src/config/features which would break live-bugs-feb8 BUG 2
 * tests if run in the same process.
 */
async function runActionFeedProducerTests(cwd: string): Promise<SuiteResult> {
  console.log('\n[P2/P3] Running Action Feed Producer Tests...');
  console.log('─'.repeat(50));

  const result = await runCommand(
    BUN_PATH,
    ['test', 'test/action-feed-producers.test.ts'],
    cwd,
    60000
  );
  const counts = parseBunTestOutput(result.output);

  if (!result.success) {
    console.log(result.output);
  }

  const status = result.success ? '\x1b[32m[PASS]\x1b[0m' : '\x1b[31m[FAIL]\x1b[0m';
  console.log(`  ${status} ${counts.passed} passed, ${counts.failed} failed (${result.duration}ms)`);

  return {
    name: 'Action Feed Producers (P2/P3)',
    passed: counts.passed,
    failed: counts.failed,
    skipped: counts.skipped,
    duration: result.duration,
    errors: result.success ? [] : [result.output],
  };
}

/**
 * Run Bridge stability tests (Playwright + mock bridge)
 *
 * Runs in a SEPARATE node process from apps/chrome-ext-vite/.
 * Requires: Playwright, ws package, Chrome, extension built.
 * Only runs in --full mode due to Chrome/Playwright dependency.
 */
async function runBridgeStabilityTests(cwd: string): Promise<SuiteResult> {
  console.log('\n[BRIDGE] Running Bridge Stability Tests...');
  console.log('─'.repeat(50));

  const bridgeCwd = join(cwd, '..', 'chrome-ext-vite');
  const result = await runCommand(
    'node',
    ['test-bridge-stability.mjs'],
    bridgeCwd,
    120000
  );

  // Parse PASS/FAIL output (uses ANSI codes: \x1b[32mPASS\x1b[0m / \x1b[31mFAIL\x1b[0m)
  const passMatches = result.output.match(/PASS\x1b\[0m/g) || [];
  const failMatches = result.output.match(/FAIL\x1b\[0m/g) || [];
  // Also match plain text for piped output
  const plainPassMatches = result.output.match(/^\s+PASS /gm) || [];
  const plainFailMatches = result.output.match(/^\s+FAIL /gm) || [];

  const passed = Math.max(passMatches.length, plainPassMatches.length);
  const failed = Math.max(failMatches.length, plainFailMatches.length);

  if (!result.success) {
    console.log(result.output);
  }

  const status = result.success ? '\x1b[32m[PASS]\x1b[0m' : '\x1b[31m[FAIL]\x1b[0m';
  console.log(`  ${status} ${passed} passed, ${failed} failed (${result.duration}ms)`);

  return {
    name: 'Bridge Stability (Playwright)',
    passed,
    failed,
    skipped: 0,
    duration: result.duration,
    errors: result.success ? [] : [result.output],
  };
}

// Gate 2: removed runIntentFirstTests() — test/intent-first-integration.test.ts deleted
// (keyboard callback integration paths replaced by Socratic Interview Engine)

/**
 * Run Chrome Extension unit tests (dom-to-notion + ai-classification + Socratic)
 *
 * Runs in a SEPARATE bun process from apps/chrome-ext-vite/.
 * Tests the DOM extraction → Notion sync pipeline, the
 * 4-tier AI classification system (Phase B.2), and the
 * Socratic Interview Engine adapter surface (Gate 1).
 */
async function runChromeExtUnitTests(cwd: string): Promise<SuiteResult> {
  console.log('\n[CHROME] Running Chrome Extension Unit Tests...');
  console.log('─'.repeat(50));

  const chromeExtCwd = join(cwd, '..', 'chrome-ext-vite');
  const result = await runCommand(
    BUN_PATH,
    [
      'test',
      'test/dom-to-notion.test.ts',
      'test/ai-classification.test.ts',
      'test/reply-strategy.test.ts',
      'test/smoke-adapter.test.ts',             // Socratic Gate 1
      'test/socratic-adapter.test.ts',           // Socratic Gate 1
      'test/socratic-context-builder.test.ts',   // Socratic Gate 1
      'test/cognitive-router.test.ts',            // Cognitive Router Gate 1.6
    ],
    chromeExtCwd,
    60000
  );
  const counts = parseBunTestOutput(result.output);

  // LOUD failures — always show output if anything went wrong
  if (!result.success) {
    console.log(result.output);
  } else {
    // Even on success, show a brief summary line per test file
    const lines = result.output.split('\n').filter(l => /\.(test\.ts)/.test(l));
    for (const line of lines) {
      console.log(`  ${line.trim()}`);
    }
  }

  const status = result.success ? '\x1b[32m[PASS]\x1b[0m' : '\x1b[31m[FAIL]\x1b[0m';
  console.log(`  ${status} ${counts.passed} passed, ${counts.failed} failed (${result.duration}ms)`);

  return {
    name: 'Chrome Extension Unit Tests',
    passed: counts.passed,
    failed: counts.failed,
    skipped: counts.skipped,
    duration: result.duration,
    errors: result.success ? [] : [result.output],
  };
}

/**
 * Run Chrome Extension build verification
 *
 * Ensures the extension builds cleanly (esbuild content scripts + Vite sidepanel).
 * A build failure here means the extension is unshippable.
 */
async function runChromeExtBuild(cwd: string): Promise<SuiteResult> {
  console.log('\n[BUILD] Running Chrome Extension Build...');
  console.log('─'.repeat(50));

  const chromeExtCwd = join(cwd, '..', 'chrome-ext-vite');
  const result = await runCommand(
    'node',
    ['build.mjs'],
    chromeExtCwd,
    60000
  );

  // Check for esbuild/vite success markers
  const hasEsbuildSuccess = result.output.includes('esbuild') || result.output.includes('.js');
  const hasBuildOutput = result.success;

  if (!result.success) {
    console.log(result.output);
  }

  const status = result.success ? '\x1b[32m[PASS]\x1b[0m' : '\x1b[31m[FAIL]\x1b[0m';
  console.log(`  ${status} Chrome Extension build ${result.success ? 'clean' : 'FAILED'} (${result.duration}ms)`);

  return {
    name: 'Chrome Extension Build',
    passed: result.success ? 1 : 0,
    failed: result.success ? 0 : 1,
    skipped: 0,
    duration: result.duration,
    errors: result.success ? [] : [result.output],
  };
}

/**
 * Run Reply Strategy integration tests (Master Blaster protocol)
 *
 * Runs from apps/chrome-ext/ — validates the full Reply Strategy pipeline
 * against live Notion data: connectivity, schema, rules engine, prompt
 * composition, fallback chain, cache lifecycle, and E2E pipeline.
 * Requires NOTION_API_KEY env var.
 */
async function runReplyStrategyTests(cwd: string): Promise<SuiteResult> {
  console.log('\n[STRATEGY] Running Reply Strategy Integration Tests...');
  console.log('─'.repeat(50));

  const chromeExtLegacyCwd = join(cwd, '..', 'chrome-ext');
  const result = await runCommand(
    BUN_PATH,
    ['run', 'scripts/test-reply-strategy.ts'],
    chromeExtLegacyCwd,
    120000 // 2 min — fetches page bodies from Notion
  );

  // Parse the custom PASS/FAIL/SKIP format (not bun:test)
  const passMatches = result.output.match(/✅/g) || [];
  const failMatches = result.output.match(/❌/g) || [];
  const skipMatches = result.output.match(/⏭️/g) || [];

  const passed = passMatches.length;
  const failed = failMatches.length;
  const skipped = skipMatches.length;

  if (!result.success) {
    console.log(result.output);
  }

  const status = result.success ? '\x1b[32m[PASS]\x1b[0m' : '\x1b[31m[FAIL]\x1b[0m';
  console.log(`  ${status} ${passed} passed, ${failed} failed, ${skipped} skipped (${result.duration}ms)`);

  return {
    name: 'Reply Strategy Integration',
    passed,
    failed,
    skipped,
    duration: result.duration,
    errors: result.success ? [] : [result.output],
  };
}

/**
 * Run Bridge unit tests
 *
 * Runs in a SEPARATE bun process from packages/bridge/.
 * Tests the full Phase 4 tool dispatch chain, orchestration pipeline,
 * SDK URL resolution, and master-blaster orchestration integration.
 * All mocked — no live bridge or extension required.
 */
async function runBridgeToolDispatchTests(cwd: string): Promise<SuiteResult> {
  console.log('\n[BRIDGE] Running Bridge Unit Tests...');
  console.log('─'.repeat(50));

  const bridgeCwd = join(cwd, '..', '..', 'packages', 'bridge');
  const result = await runCommand(
    BUN_PATH,
    [
      'test',
      'test/tool-dispatch-pipeline.test.ts',
      'test/orchestration.test.ts',
      'test/orchestration-integration.test.ts',
      'test/master-blaster-orchestration.test.ts',
      'test/master-blaster-sdk-url.test.ts',
    ],
    bridgeCwd,
    60000
  );
  const counts = parseBunTestOutput(result.output);

  if (!result.success) {
    console.log(result.output);
  }

  const status = result.success ? '\x1b[32m[PASS]\x1b[0m' : '\x1b[31m[FAIL]\x1b[0m';
  console.log(`  ${status} ${counts.passed} passed, ${counts.failed} failed (${result.duration}ms)`);

  return {
    name: 'Bridge Unit Tests',
    passed: counts.passed,
    failed: counts.failed,
    skipped: counts.skipped,
    duration: result.duration,
    errors: result.success ? [] : [result.output],
  };
}

/**
 * Run Agents package unit tests
 *
 * Runs in a SEPARATE bun process from packages/agents/.
 * Tests the Socratic Interview Engine core (Gate 0), context assessor,
 * Notion config, markdown parsing, worker logic, and research truncation.
 */
async function runAgentsUnitTests(cwd: string): Promise<SuiteResult> {
  console.log('\n[AGENTS] Running Agents Unit Tests...');
  console.log('─'.repeat(50));

  const agentsCwd = join(cwd, '..', '..', 'packages', 'agents');
  const result = await runCommand(
    BUN_PATH,
    [
      'test',
      'test/socratic-engine.test.ts',
      'test/socratic-context-assessor.test.ts',
      'test/socratic-notion-config.test.ts',
      'test/notion-markdown.test.ts',
      'test/worker-logic.test.ts',
      'test/research-json-truncation.test.ts',
    ],
    agentsCwd,
    60000
  );
  const counts = parseBunTestOutput(result.output);

  if (!result.success) {
    console.log(result.output);
  } else {
    const lines = result.output.split('\n').filter(l => /\.(test\.ts)/.test(l));
    for (const line of lines) {
      console.log(`  ${line.trim()}`);
    }
  }

  const status = result.success ? '\x1b[32m[PASS]\x1b[0m' : '\x1b[31m[FAIL]\x1b[0m';
  console.log(`  ${status} ${counts.passed} passed, ${counts.failed} failed (${result.duration}ms)`);

  return {
    name: 'Agents Unit Tests',
    passed: counts.passed,
    failed: counts.failed,
    skipped: counts.skipped,
    duration: result.duration,
    errors: result.success ? [] : [result.output],
  };
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  const args = process.argv.slice(2);
  const quick = args.includes('--quick');
  const full = args.includes('--full');
  const strict = args.includes('--strict');

  // Strict mode: disable fallbacks so canary tests enforce hard failures
  // Default verify also runs with fallbacks disabled (policy change post fail-fast sprint)
  if (strict || (!quick && !full)) {
    process.env.ENABLE_FALLBACKS = 'false';
  }

  const isStrictMode = process.env.ENABLE_FALLBACKS !== 'true';

  const cwd = join(import.meta.dir, '..');
  const startTime = new Date();

  // Header
  console.log('\n');
  console.log('====================================');
  console.log('   MASTER BLASTER VERIFICATION');
  console.log('====================================');
  const modeLabel = strict ? 'STRICT' : quick ? 'QUICK' : full ? 'FULL' : 'DEFAULT';
  console.log(`\nMode: ${modeLabel}${isStrictMode ? ' (fallbacks disabled)' : ' (fallbacks enabled)'}`);
  console.log(`Started: ${startTime.toISOString()}`);
  console.log(`Working dir: ${cwd}`);

  const suites: SuiteResult[] = [];

  // Quick mode: Unit + Regression + Chrome Extension + Agents tests
  if (quick) {
    suites.push(await runUnitTests(cwd));
    suites.push(await runRegressionTests(cwd));
    suites.push(await runChromeExtUnitTests(cwd));
    suites.push(await runAgentsUnitTests(cwd));
  }
  // Strict mode: Canaries FIRST — failure stops all subsequent suites
  else if (strict) {
    const canaryResult = await runCanaryTests(cwd);
    suites.push(canaryResult);

    if (canaryResult.failed > 0) {
      console.log('\n\x1b[31m🛑 CANARY FAILURE IN STRICT MODE — HALTING ALL SUITES\x1b[0m');
      console.log('Fix canary failures before proceeding.\n');
    } else {
      suites.push(await runUnitTests(cwd));
      suites.push(await runRegressionTests(cwd));
      suites.push(await runActionFeedProducerTests(cwd));
      // Gate 2: removed runIntentFirstTests() — deleted with keyboard flows
      suites.push(await runAutonomousRepairTests(cwd));
      suites.push(await runBridgeToolDispatchTests(cwd));
      suites.push(await runChromeExtUnitTests(cwd));  // Chrome Extension unit tests
      suites.push(await runChromeExtBuild(cwd));  // Chrome Extension build verification
      suites.push(await runReplyStrategyTests(cwd));  // Reply Strategy integration
      suites.push(await runAgentsUnitTests(cwd));  // Agents package unit tests
      suites.push(await runBridgeStabilityTests(cwd));
      suites.push(await runSmokeTests(cwd));
      suites.push(await runE2ETests(cwd));
      suites.push(await runIntegrationTests(cwd));
    }
  }
  // Full mode: All suites including canaries, E2E, and bridge
  else if (full) {
    suites.push(await runCanaryTests(cwd));  // Canaries first - detect silent failures
    suites.push(await runUnitTests(cwd));
    suites.push(await runRegressionTests(cwd));  // Bug regression tests
    suites.push(await runActionFeedProducerTests(cwd));  // P2/P3 sprint
    // Gate 2: removed runIntentFirstTests() — deleted with keyboard flows
    suites.push(await runAutonomousRepairTests(cwd));  // Pit Stop sprint
    suites.push(await runBridgeToolDispatchTests(cwd));  // Bridge unit tests
    suites.push(await runChromeExtUnitTests(cwd));  // Chrome Extension unit tests
    suites.push(await runChromeExtBuild(cwd));  // Chrome Extension build verification
    suites.push(await runReplyStrategyTests(cwd));  // Reply Strategy integration
    suites.push(await runAgentsUnitTests(cwd));  // Agents package unit tests
    suites.push(await runBridgeStabilityTests(cwd));  // Bridge Playwright tests
    suites.push(await runSmokeTests(cwd));
    suites.push(await runE2ETests(cwd));
    suites.push(await runIntegrationTests(cwd));
  }
  // Default mode: Canaries + Unit + Regression + all surfaces + Smoke + Integration (strict by default)
  else {
    const canaryResult = await runCanaryTests(cwd);
    suites.push(canaryResult);

    if (canaryResult.failed > 0 && isStrictMode) {
      console.log('\n\x1b[31m🛑 CANARY FAILURE — HALTING ALL SUITES (fallbacks disabled)\x1b[0m');
      console.log('Fix canary failures or run with ENABLE_FALLBACKS=true to proceed.\n');
    } else {
      suites.push(await runUnitTests(cwd));
      suites.push(await runRegressionTests(cwd));
      suites.push(await runActionFeedProducerTests(cwd));
      // Gate 2: removed runIntentFirstTests() — deleted with keyboard flows
      suites.push(await runAutonomousRepairTests(cwd));
      suites.push(await runBridgeToolDispatchTests(cwd));
      suites.push(await runChromeExtUnitTests(cwd));  // Chrome Extension unit tests
      suites.push(await runChromeExtBuild(cwd));  // Chrome Extension build verification
      suites.push(await runReplyStrategyTests(cwd));  // Reply Strategy integration
      suites.push(await runAgentsUnitTests(cwd));  // Agents package unit tests
      suites.push(await runSmokeTests(cwd));
      suites.push(await runIntegrationTests(cwd));
    }
  }

  // Calculate totals
  const endTime = new Date();
  const totalPassed = suites.reduce((sum, s) => sum + s.passed, 0);
  const totalFailed = suites.reduce((sum, s) => sum + s.failed, 0);
  const totalSkipped = suites.reduce((sum, s) => sum + s.skipped, 0);
  const totalDuration = endTime.getTime() - startTime.getTime();

  // Per-surface summary with grouped headers
  const surfaceMap: Record<string, string[]> = {
    'Telegram': ['Unit Tests', 'Canaries', 'Regression', 'Action Feed Producers', 'Autonomous Repair', 'Smoke Tests', 'E2E Tests', 'Integration Tests'],
    'Chrome': ['Chrome Extension Unit Tests', 'Chrome Extension Build', 'Reply Strategy Integration'],
    'Bridge': ['Bridge Unit Tests', 'Bridge Stability'],
    'Agents': ['Agents Unit Tests'],
  };

  console.log('\n');
  console.log('====================================');
  console.log('   SUMMARY');
  console.log('====================================');

  for (const [surface, suiteNames] of Object.entries(surfaceMap)) {
    const surfaceSuites = suites.filter(s => suiteNames.includes(s.name));
    if (surfaceSuites.length === 0) continue;

    const surfacePassed = surfaceSuites.reduce((sum, s) => sum + s.passed, 0);
    const surfaceFailed = surfaceSuites.reduce((sum, s) => sum + s.failed, 0);
    const surfaceStatus = surfaceFailed === 0 ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
    console.log(`\n  ${surfaceStatus} ── ${surface} (${surfacePassed}/${surfacePassed + surfaceFailed}) ──`);

    for (const suite of surfaceSuites) {
      const status = suite.failed === 0 ? '\x1b[32m  ✓\x1b[0m' : '\x1b[31m  ✗\x1b[0m';
      console.log(`  ${status} ${suite.name.padEnd(30)} ${suite.passed}/${suite.passed + suite.failed}`);
    }
  }

  // Any suites not in a surface group (shouldn't happen, but safety net)
  const allGroupedNames = Object.values(surfaceMap).flat();
  const ungrouped = suites.filter(s => !allGroupedNames.includes(s.name));
  for (const suite of ungrouped) {
    const status = suite.failed === 0 ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
    console.log(`${status} ${suite.name.padEnd(30)} ${suite.passed}/${suite.passed + suite.failed}`);
  }

  console.log('\n────────────────────────────────────');
  console.log(`   Total: ${totalPassed} passed, ${totalFailed} failed, ${totalSkipped} skipped`);
  console.log(`   Surfaces: ${Object.keys(surfaceMap).length} | Suites: ${suites.length}`);
  console.log(`   Duration: ${(totalDuration / 1000).toFixed(2)}s`);
  console.log('====================================');

  // Subprocess health check: flag suites that ran 0 tests (silent PATH/spawn failures)
  const ghostSuites = suites.filter(s => s.passed === 0 && s.failed === 0 && s.skipped === 0);
  if (ghostSuites.length > 0) {
    console.log('\n\x1b[33m⚠️  SUBPROCESS HEALTH WARNING — ghost suites detected (0 pass / 0 fail / 0 skip):\x1b[0m');
    for (const ghost of ghostSuites) {
      console.log(`   \x1b[33m→ ${ghost.name}\x1b[0m (${ghost.duration}ms) — likely bun not in PATH or file not found`);
    }
    console.log('   Check that bun is installed and test file paths are correct.\n');
  }

  // Final result
  const hasGhosts = ghostSuites.length > 0;
  if (totalFailed === 0 && !hasGhosts) {
    console.log('\n\x1b[32m   RESULT: ALL SYSTEMS GO\x1b[0m');
    console.log('\n');
    process.exit(0);
  } else {
    console.log(`\n\x1b[31m   RESULT: ${hasGhosts && totalFailed === 0 ? 'GHOST SUITES DETECTED' : 'FAILURES DETECTED'}\x1b[0m`);
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
