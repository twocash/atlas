/**
 * Atlas Telegram Bot - E2E Test Runner
 *
 * Run this before deploying to verify all functionality works.
 * Usage: bun run src/health/test-runner.ts
 */

import { runHealthChecks, formatHealthReport } from './index';

interface TestResult {
  name: string;
  passed: boolean;
  duration: number;
  error?: string;
}

interface TestSuite {
  name: string;
  tests: TestResult[];
  passed: number;
  failed: number;
  duration: number;
}

/**
 * Run a single test with timeout
 */
async function runTest(
  name: string,
  testFn: () => Promise<void>,
  timeoutMs: number = 10000
): Promise<TestResult> {
  const start = Date.now();

  try {
    await Promise.race([
      testFn(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Timeout')), timeoutMs)
      ),
    ]);

    return {
      name,
      passed: true,
      duration: Date.now() - start,
    };
  } catch (error: any) {
    return {
      name,
      passed: false,
      duration: Date.now() - start,
      error: error.message,
    };
  }
}

/**
 * Test conversation context management
 */
async function testConversationContext(): Promise<TestResult[]> {
  const results: TestResult[] = [];
  const { getConversation, updateConversation, clearConversation } = await import('../conversation/context');

  // Test get empty conversation
  results.push(await runTest('Get empty conversation', async () => {
    const conv = await getConversation(999999);
    if (conv.messages.length !== 0) {
      throw new Error('Expected empty messages array');
    }
  }));

  // Test update conversation
  results.push(await runTest('Update conversation', async () => {
    await updateConversation(999999, 'test message', 'test response');
    const conv = await getConversation(999999);
    if (conv.messages.length !== 2) {
      throw new Error(`Expected 2 messages, got ${conv.messages.length}`);
    }
  }));

  // Test clear conversation
  results.push(await runTest('Clear conversation', async () => {
    await clearConversation(999999);
    const conv = await getConversation(999999);
    if (conv.messages.length !== 0) {
      throw new Error('Expected empty after clear');
    }
  }));

  return results;
}

/**
 * Test system prompt builder
 */
async function testPromptBuilder(): Promise<TestResult[]> {
  const results: TestResult[] = [];
  const { buildSystemPrompt } = await import('../conversation/prompt');

  results.push(await runTest('Build system prompt', async () => {
    const prompt = await buildSystemPrompt();
    if (!prompt || prompt.length < 100) {
      throw new Error('Prompt too short or empty');
    }
    if (!prompt.includes('SOUL')) {
      throw new Error('Prompt missing SOUL content');
    }
  }));

  return results;
}

/**
 * Test workspace file operations
 */
async function testWorkspaceOperations(): Promise<TestResult[]> {
  const results: TestResult[] = [];
  const { executeWorkspaceTools } = await import('../conversation/tools/workspace');

  // Test write
  results.push(await runTest('Write temp file', async () => {
    const result = await executeWorkspaceTools('write_file', {
      workspace: 'temp',
      path: 'test-file.txt',
      content: 'test content',
    });
    if (!result?.success) {
      throw new Error(result?.error || 'Write failed');
    }
  }));

  // Test read
  results.push(await runTest('Read temp file', async () => {
    const result = await executeWorkspaceTools('read_file', {
      workspace: 'temp',
      path: 'test-file.txt',
    });
    if (!result?.success) {
      throw new Error(result?.error || 'Read failed');
    }
  }));

  // Test list
  results.push(await runTest('List workspace', async () => {
    const result = await executeWorkspaceTools('list_workspace', {
      workspace: 'temp',
    });
    if (!result?.success) {
      throw new Error(result?.error || 'List failed');
    }
  }));

  // Test path escape prevention
  results.push(await runTest('Block path escape', async () => {
    const result = await executeWorkspaceTools('read_file', {
      workspace: 'temp',
      path: '../../../etc/passwd',
    });
    if (result?.success) {
      throw new Error('Should have blocked path escape');
    }
  }));

  return results;
}

/**
 * Test self-modification tools
 */
async function testSelfModTools(): Promise<TestResult[]> {
  const results: TestResult[] = [];
  const { executeSelfModTools } = await import('../conversation/tools/self-mod');

  // Test read soul
  results.push(await runTest('Read SOUL.md', async () => {
    const result = await executeSelfModTools('read_soul', {});
    if (!result?.success) {
      throw new Error(result?.error || 'Read soul failed');
    }
    const data = result.result as { content: string };
    if (!data.content.includes('Core Truths')) {
      throw new Error('SOUL.md missing expected content');
    }
  }));

  return results;
}

/**
 * Test Notion integration (if available)
 */
async function testNotionIntegration(): Promise<TestResult[]> {
  const results: TestResult[] = [];

  if (!process.env.NOTION_API_KEY) {
    results.push({
      name: 'Notion integration',
      passed: false,
      duration: 0,
      error: 'NOTION_API_KEY not set - skipping',
    });
    return results;
  }

  const { executeCoreTools } = await import('../conversation/tools/core');

  // Test status summary
  results.push(await runTest('Get status summary', async () => {
    const result = await executeCoreTools('get_status_summary', {});
    if (!result?.success) {
      throw new Error(result?.error || 'Status summary failed');
    }
  }));

  // Test work queue list
  results.push(await runTest('List work queue', async () => {
    const result = await executeCoreTools('work_queue_list', { limit: 1 });
    if (!result?.success) {
      throw new Error(result?.error || 'Work queue list failed');
    }
  }));

  return results;
}

/**
 * Test Claude API (if available)
 */
async function testClaudeAPI(): Promise<TestResult[]> {
  const results: TestResult[] = [];

  if (!process.env.ANTHROPIC_API_KEY) {
    results.push({
      name: 'Claude API',
      passed: false,
      duration: 0,
      error: 'ANTHROPIC_API_KEY not set - skipping',
    });
    return results;
  }

  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // Test Sonnet
  results.push(await runTest('Claude Sonnet 4', async () => {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 10,
      messages: [{ role: 'user', content: 'Say "test passed"' }],
    });
    const text = response.content.find(b => b.type === 'text');
    if (!text) throw new Error('No response');
  }));

  // Test Haiku (correct model ID)
  results.push(await runTest('Claude Haiku 3.5', async () => {
    const response = await anthropic.messages.create({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 10,
      messages: [{ role: 'user', content: 'Say "test passed"' }],
    });
    const text = response.content.find(b => b.type === 'text');
    if (!text) throw new Error('No response');
  }));

  return results;
}

/**
 * Format test suite results
 */
function formatTestSuite(suite: TestSuite): string {
  const lines: string[] = [];

  lines.push(`\n  ${suite.name}`);
  lines.push(`  ${'─'.repeat(50)}`);

  for (const test of suite.tests) {
    const icon = test.passed ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
    const duration = `${test.duration}ms`;
    lines.push(`  ${icon} ${test.name.padEnd(35)} ${duration.padStart(8)}`);
    if (test.error) {
      lines.push(`    \x1b[31m└─ ${test.error}\x1b[0m`);
    }
  }

  return lines.join('\n');
}

/**
 * Main test runner
 */
async function main() {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('                    ATLAS E2E TESTS                         ');
  console.log('═══════════════════════════════════════════════════════════');

  // Run health checks first
  console.log('\n📋 Running health checks...\n');
  const healthReport = await runHealthChecks();
  console.log(formatHealthReport(healthReport));

  if (!healthReport.canStart) {
    console.log('\n❌ Health checks failed. Fix issues before running tests.\n');
    process.exit(1);
  }

  // Run test suites
  const suites: TestSuite[] = [];
  const startTime = Date.now();

  // Conversation context tests
  console.log('\n🧪 Running test suites...');

  const contextTests = await testConversationContext();
  suites.push({
    name: 'Conversation Context',
    tests: contextTests,
    passed: contextTests.filter(t => t.passed).length,
    failed: contextTests.filter(t => !t.passed).length,
    duration: contextTests.reduce((sum, t) => sum + t.duration, 0),
  });

  const promptTests = await testPromptBuilder();
  suites.push({
    name: 'System Prompt',
    tests: promptTests,
    passed: promptTests.filter(t => t.passed).length,
    failed: promptTests.filter(t => !t.passed).length,
    duration: promptTests.reduce((sum, t) => sum + t.duration, 0),
  });

  const workspaceTests = await testWorkspaceOperations();
  suites.push({
    name: 'Workspace Operations',
    tests: workspaceTests,
    passed: workspaceTests.filter(t => t.passed).length,
    failed: workspaceTests.filter(t => !t.passed).length,
    duration: workspaceTests.reduce((sum, t) => sum + t.duration, 0),
  });

  const selfModTests = await testSelfModTools();
  suites.push({
    name: 'Self-Modification',
    tests: selfModTests,
    passed: selfModTests.filter(t => t.passed).length,
    failed: selfModTests.filter(t => !t.passed).length,
    duration: selfModTests.reduce((sum, t) => sum + t.duration, 0),
  });

  const notionTests = await testNotionIntegration();
  suites.push({
    name: 'Notion Integration',
    tests: notionTests,
    passed: notionTests.filter(t => t.passed).length,
    failed: notionTests.filter(t => !t.passed).length,
    duration: notionTests.reduce((sum, t) => sum + t.duration, 0),
  });

  const claudeTests = await testClaudeAPI();
  suites.push({
    name: 'Claude API',
    tests: claudeTests,
    passed: claudeTests.filter(t => t.passed).length,
    failed: claudeTests.filter(t => !t.passed).length,
    duration: claudeTests.reduce((sum, t) => sum + t.duration, 0),
  });

  // Print results
  for (const suite of suites) {
    console.log(formatTestSuite(suite));
  }

  // Summary
  const totalPassed = suites.reduce((sum, s) => sum + s.passed, 0);
  const totalFailed = suites.reduce((sum, s) => sum + s.failed, 0);
  const totalDuration = Date.now() - startTime;

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log(`  SUMMARY`);
  console.log(`  ${'─'.repeat(50)}`);
  console.log(`  Total: ${totalPassed + totalFailed} tests`);
  console.log(`  Passed: \x1b[32m${totalPassed}\x1b[0m`);
  console.log(`  Failed: \x1b[31m${totalFailed}\x1b[0m`);
  console.log(`  Duration: ${totalDuration}ms`);
  console.log('═══════════════════════════════════════════════════════════\n');

  if (totalFailed > 0) {
    console.log('❌ Some tests failed. Review output above.\n');
    process.exit(1);
  }

  console.log('✅ All tests passed!\n');
  process.exit(0);
}

// Run if called directly
main().catch(error => {
  console.error('Test runner error:', error);
  process.exit(1);
});
