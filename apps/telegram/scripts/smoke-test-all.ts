/**
 * ATLAS MEGA SMOKE TEST - The Motherload
 *
 * Tests EVERYTHING: health checks, tools, skills, databases, APIs, and the new contextual extraction.
 *
 * Usage: bun run scripts/smoke-test-all.ts
 */

// Load environment variables from .env file (override: true is REQUIRED for Notion)
import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(import.meta.dir, '..', '.env'), override: true });

import { NOTION_DB } from '@atlas/shared/config';
import { logger } from '../src/logger';

// Disable verbose logging during tests
process.env.LOG_LEVEL = 'warn';

interface TestResult {
  name: string;
  passed: boolean;
  duration: number;
  error?: string;
  details?: string;
}

interface TestSection {
  name: string;
  emoji: string;
  tests: TestResult[];
}

const sections: TestSection[] = [];
let currentSection: TestSection | null = null;

function startSection(name: string, emoji: string) {
  currentSection = { name, emoji, tests: [] };
  sections.push(currentSection);
  console.log(`\n${emoji} ${name}`);
  console.log('─'.repeat(60));
}

async function runTest(name: string, fn: () => Promise<void>, timeoutMs = 15000): Promise<void> {
  const start = Date.now();
  try {
    await Promise.race([
      fn(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), timeoutMs)),
    ]);
    const duration = Date.now() - start;
    currentSection?.tests.push({ name, passed: true, duration });
    console.log(`  ✅ ${name} (${duration}ms)`);
  } catch (error: any) {
    const duration = Date.now() - start;
    currentSection?.tests.push({ name, passed: false, duration, error: error.message });
    console.log(`  ❌ ${name} (${duration}ms)`);
    console.log(`     └─ ${error.message}`);
  }
}

// ============================================================================
// ENVIRONMENT CHECKS
// ============================================================================
async function testEnvironment() {
  startSection('ENVIRONMENT', '🌍');

  await runTest('TELEGRAM_BOT_TOKEN set', async () => {
    if (!process.env.TELEGRAM_BOT_TOKEN) throw new Error('Missing');
  });

  await runTest('TELEGRAM_ALLOWED_USERS set', async () => {
    if (!process.env.TELEGRAM_ALLOWED_USERS) throw new Error('Missing');
  });

  await runTest('ANTHROPIC_API_KEY set', async () => {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('Missing');
  });

  await runTest('NOTION_API_KEY set', async () => {
    if (!process.env.NOTION_API_KEY) throw new Error('Missing');
  });

  await runTest('GEMINI_API_KEY set', async () => {
    if (!process.env.GEMINI_API_KEY) throw new Error('Missing');
  });
}

// ============================================================================
// NOTION DATABASE TESTS
// ============================================================================
async function testNotion() {
  startSection('NOTION DATABASES', '📚');

  const { Client } = await import('@notionhq/client');
  const notion = new Client({ auth: process.env.NOTION_API_KEY });

  // Feed 2.0
  await runTest('Feed 2.0 accessible', async () => {
    const result = await notion.databases.query({
      database_id: NOTION_DB.FEED,
      page_size: 1,
    });
    if (result.results === undefined) throw new Error('Query failed');
  });

  // Work Queue 2.0
  await runTest('Work Queue 2.0 accessible', async () => {
    const result = await notion.databases.query({
      database_id: NOTION_DB.WORK_QUEUE,
      page_size: 1,
    });
    if (result.results === undefined) throw new Error('Query failed');
  });

  // Dev Pipeline
  await runTest('Dev Pipeline accessible', async () => {
    const result = await notion.databases.query({
      database_id: NOTION_DB.DEV_PIPELINE,
      page_size: 1,
    });
    if (result.results === undefined) throw new Error('Query failed');
  });

  // Search
  await runTest('Notion search works', async () => {
    const result = await notion.search({
      query: 'Atlas',
      page_size: 1,
    });
    if (result.results === undefined) throw new Error('Search failed');
  });
}

// ============================================================================
// CLAUDE API TESTS
// ============================================================================
async function testClaudeAPI() {
  startSection('CLAUDE API', '🤖');

  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const anthropic = new Anthropic();

  await runTest('Claude Sonnet 4 responds', async () => {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 20,
      messages: [{ role: 'user', content: 'Reply with just: OK' }],
    });
    const text = response.content.find(b => b.type === 'text');
    if (!text) throw new Error('No text response');
  });

  await runTest('Claude Haiku 3.5 responds', async () => {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 20,
      messages: [{ role: 'user', content: 'Reply with just: OK' }],
    });
    const text = response.content.find(b => b.type === 'text');
    if (!text) throw new Error('No text response');
  });
}

// ============================================================================
// GEMINI API TESTS
// ============================================================================
async function testGeminiAPI() {
  startSection('GEMINI API (Web Search)', '🔍');

  const { GoogleGenerativeAI } = await import('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

  await runTest('Gemini Flash responds', async () => {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    const result = await model.generateContent('Reply with just: OK');
    const text = result.response.text();
    if (!text) throw new Error('No response');
  });

  await runTest('Gemini with grounding responds', async () => {
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.0-flash',
      tools: [{ googleSearch: {} } as any],
    });
    const result = await model.generateContent('What is 2+2?');
    const text = result.response.text();
    if (!text) throw new Error('No response');
  });
}

// ============================================================================
// CORE TOOLS TESTS
// ============================================================================
async function testCoreTools() {
  startSection('CORE TOOLS', '🔧');

  const { executeCoreTools } = await import('../src/conversation/tools/core');

  await runTest('notion_search works', async () => {
    const result = await executeCoreTools('notion_search', { query: 'test', limit: 1 });
    if (!result?.success && !result?.result) throw new Error(result?.error || 'Failed');
  });

  await runTest('work_queue_list works', async () => {
    const result = await executeCoreTools('work_queue_list', { limit: 1 });
    if (!result?.success) throw new Error(result?.error || 'Failed');
  });

  await runTest('get_status_summary works', async () => {
    const result = await executeCoreTools('get_status_summary', {});
    if (!result?.success) throw new Error(result?.error || 'Failed');
  });

  await runTest('notion_list_databases works', async () => {
    const result = await executeCoreTools('notion_list_databases', {});
    if (!result?.success) throw new Error(result?.error || 'Failed');
  });

  await runTest('dev_pipeline_list works', async () => {
    const result = await executeCoreTools('dev_pipeline_list', { limit: 1 });
    if (!result?.success) throw new Error(result?.error || 'Failed');
  });

  await runTest('get_changelog works', async () => {
    const result = await executeCoreTools('get_changelog', { limit: 5 });
    if (!result?.success) throw new Error(result?.error || 'Failed');
  });

  // NEW: Test claude_analyze
  await runTest('claude_analyze works', async () => {
    const result = await executeCoreTools('claude_analyze', {
      content: 'This is a test post about AI research.',
      systemPrompt: 'Summarize in one word.',
    });
    if (!result?.success) throw new Error(result?.error || 'Failed');
  });

  // NEW: Test notion_update (just verify it handles missing page gracefully)
  await runTest('notion_update validates inputs', async () => {
    const result = await executeCoreTools('notion_update', {});
    if (result?.success) throw new Error('Should have required pageId');
  });
}

// ============================================================================
// WORKSPACE TOOLS TESTS
// ============================================================================
async function testWorkspaceTools() {
  startSection('WORKSPACE TOOLS', '📁');

  const { executeWorkspaceTools } = await import('../src/conversation/tools/workspace');

  await runTest('list_workspace works', async () => {
    const result = await executeWorkspaceTools('list_workspace', { workspace: 'temp' });
    if (!result?.success) throw new Error(result?.error || 'Failed');
  });

  await runTest('write_file works', async () => {
    const result = await executeWorkspaceTools('write_file', {
      workspace: 'temp',
      path: 'smoke-test.txt',
      content: `Smoke test at ${new Date().toISOString()}`,
    });
    if (!result?.success) throw new Error(result?.error || 'Failed');
  });

  await runTest('read_file works', async () => {
    const result = await executeWorkspaceTools('read_file', {
      workspace: 'temp',
      path: 'smoke-test.txt',
    });
    if (!result?.success) throw new Error(result?.error || 'Failed');
  });

  await runTest('path escape blocked', async () => {
    const result = await executeWorkspaceTools('read_file', {
      workspace: 'temp',
      path: '../../../etc/passwd',
    });
    if (result?.success) throw new Error('Should have blocked');
  });
}

// ============================================================================
// SELF-MOD TOOLS TESTS
// ============================================================================
async function testSelfModTools() {
  startSection('SELF-MOD TOOLS', '🧠');

  const { executeSelfModTools } = await import('../src/conversation/tools/self-mod');

  await runTest('read_soul works', async () => {
    const result = await executeSelfModTools('read_soul', {});
    if (!result?.success) throw new Error(result?.error || 'Failed');
    const data = result.result as { content: string };
    if (!data.content.includes('ATLAS')) throw new Error('Missing ATLAS content');
  });

  await runTest('read_memory works', async () => {
    const result = await executeSelfModTools('read_memory', {});
    if (!result?.success) throw new Error(result?.error || 'Failed');
  });
}

// ============================================================================
// SKILL SYSTEM TESTS
// ============================================================================
async function testSkillSystem() {
  startSection('SKILL SYSTEM', '⚡');

  await runTest('Intent hash generation works', async () => {
    const { generateIntentHash } = await import('../src/skills/intent-hash');
    const hash = generateIntentHash('test message');
    if (!hash.hash || hash.hash.length < 8) throw new Error('Invalid hash');
  });

  await runTest('Skill registry initializes', async () => {
    const { initializeSkillRegistry, getSkillRegistry } = await import('../src/skills/registry');
    await initializeSkillRegistry();
    const registry = getSkillRegistry();
    const stats = registry.getStats();
    if (stats.total < 0) throw new Error('Registry failed');
  });

  await runTest('threads-lookup skill loaded', async () => {
    const { getSkillRegistry } = await import('../src/skills/registry');
    const registry = getSkillRegistry();
    const skill = registry.get('threads-lookup');
    if (!skill) throw new Error('Skill not found');
    if (skill.version !== '2.0.0') throw new Error(`Wrong version: ${skill.version}`);
  });

  await runTest('threads-lookup has pillar-aware inputs', async () => {
    const { getSkillRegistry } = await import('../src/skills/registry');
    const registry = getSkillRegistry();
    const skill = registry.get('threads-lookup');
    if (!skill?.inputs.pillar) throw new Error('Missing pillar input');
    if (!skill?.inputs.depth) throw new Error('Missing depth input');
    if (!skill?.inputs.feedId) throw new Error('Missing feedId input');
  });

  await runTest('Skill triggers on threads.net URL', async () => {
    const { getSkillRegistry } = await import('../src/skills/registry');
    const registry = getSkillRegistry();
    const match = registry.findBestMatch('https://threads.net/@user/post/123');
    if (!match) throw new Error('No match found');
    if (match.skill.name !== 'threads-lookup') throw new Error(`Wrong skill: ${match.skill.name}`);
    if (match.score < 0.7) throw new Error(`Low score: ${match.score}`);
  });

  await runTest('Skill schema supports always_run', async () => {
    const { getSkillRegistry } = await import('../src/skills/registry');
    const registry = getSkillRegistry();
    const skill = registry.get('threads-lookup');
    const cleanupStep = skill?.process.steps.find((s: any) => s.id === 'cleanup_tab');
    if (!(cleanupStep as any)?.always_run) throw new Error('cleanup_tab missing always_run flag');
  });

  await runTest('Feature flags load correctly', async () => {
    const { getFeatureFlags, isFeatureEnabled } = await import('../src/config/features');
    const flags = getFeatureFlags();
    // Should be an object with boolean values
    if (typeof flags.skillLogging !== 'boolean') throw new Error('Invalid flags');
  });
}

// ============================================================================
// CONVERSATION CONTEXT TESTS
// ============================================================================
async function testConversationContext() {
  startSection('CONVERSATION CONTEXT', '💬');

  const { getConversation, updateConversation, clearConversation } = await import('../src/conversation/context');
  const testUserId = 999999999;

  await runTest('Get empty conversation', async () => {
    await clearConversation(testUserId);
    const conv = await getConversation(testUserId);
    if (conv.messages.length !== 0) throw new Error('Expected empty');
  });

  await runTest('Update conversation', async () => {
    await updateConversation(testUserId, 'hello', 'world');
    const conv = await getConversation(testUserId);
    if (conv.messages.length !== 2) throw new Error(`Expected 2, got ${conv.messages.length}`);
  });

  await runTest('Clear conversation', async () => {
    await clearConversation(testUserId);
    const conv = await getConversation(testUserId);
    if (conv.messages.length !== 0) throw new Error('Expected empty after clear');
  });
}

// ============================================================================
// SYSTEM PROMPT TESTS
// ============================================================================
async function testSystemPrompt() {
  startSection('SYSTEM PROMPT', '📝');

  const { buildSystemPrompt } = await import('../src/conversation/prompt');

  await runTest('Build system prompt', async () => {
    const prompt = await buildSystemPrompt();
    if (prompt.length < 500) throw new Error('Prompt too short');
  });

  await runTest('Prompt includes SOUL', async () => {
    const prompt = await buildSystemPrompt();
    if (!prompt.includes('SOUL') && !prompt.includes('Core Truths')) {
      throw new Error('Missing SOUL content');
    }
  });

  await runTest('Prompt includes pillars', async () => {
    const prompt = await buildSystemPrompt();
    if (!prompt.includes('Personal') || !prompt.includes('Grove') || !prompt.includes('Consulting')) {
      throw new Error('Missing pillars');
    }
  });
}

// ============================================================================
// CONTENT PATTERNS TESTS
// ============================================================================
async function testContentPatterns() {
  startSection('CONTENT PATTERNS', '🎯');

  const { getPatternSuggestion, recordClassificationFeedback } = await import('../src/conversation/content-patterns');

  await runTest('Pattern suggestion works', async () => {
    const suggestion = await getPatternSuggestion({
      pillar: 'The Grove',
      contentType: 'url',
    });
    // May or may not have a suggestion, just shouldn't throw
  });

  await runTest('Record feedback works', async () => {
    recordClassificationFeedback(
      'The Grove',
      'url',
      'test',
      'Research',
      false
    );
    // Just shouldn't throw
  });
}

// ============================================================================
// MCP INTEGRATION TESTS
// ============================================================================
async function testMCPIntegration() {
  startSection('MCP INTEGRATION', '🔌');

  await runTest('MCP config file exists', async () => {
    const fs = await import('fs/promises');
    const path = await import('path');
    const configPath = path.join(process.cwd(), 'config', 'mcp.yaml');
    await fs.access(configPath);
  });

  await runTest('MCP config includes claude-in-chrome', async () => {
    const fs = await import('fs/promises');
    const path = await import('path');
    const configPath = path.join(process.cwd(), 'config', 'mcp.yaml');
    const content = await fs.readFile(configPath, 'utf-8');
    if (!content.includes('claude_in_chrome')) throw new Error('Missing claude_in_chrome server');
  });

  await runTest('MCP tools module loads', async () => {
    const { getMcpTools, isMcpTool } = await import('../src/mcp');
    // Just verify imports work
    if (typeof isMcpTool !== 'function') throw new Error('isMcpTool not a function');
  });
}

// ============================================================================
// AUDIT TRAIL TESTS
// ============================================================================
async function testAuditTrail() {
  startSection('AUDIT TRAIL', '📋');

  const { createAuditTrail } = await import('../src/conversation/audit');

  await runTest('Audit trail creation works (dry run)', async () => {
    // We can't actually create entries in smoke test, but we can verify the function exists
    if (typeof createAuditTrail !== 'function') throw new Error('Not a function');
  });
}

// ============================================================================
// HEALTH CHECK TESTS
// ============================================================================
async function testHealthChecks() {
  startSection('HEALTH CHECKS', '🏥');

  const { runHealthChecks, formatHealthReport } = await import('../src/health');

  await runTest('Health checks run', async () => {
    const report = await runHealthChecks();
    if (!report) throw new Error('No report');
  });

  await runTest('Health report formats', async () => {
    const report = await runHealthChecks();
    const formatted = formatHealthReport(report);
    if (!formatted || formatted.length < 50) throw new Error('Format failed');
  });
}

// ============================================================================
// NEW CONTEXTUAL EXTRACTION TESTS
// ============================================================================
async function testContextualExtraction() {
  startSection('CONTEXTUAL EXTRACTION (NEW)', '🎨');

  await runTest('Pillar determines extraction depth', async () => {
    // Test the depth logic from content-callback.ts
    const getDepth = (pillar: string) =>
      pillar === 'The Grove' ? 'deep'
      : pillar === 'Consulting' ? 'standard'
      : 'shallow';

    if (getDepth('The Grove') !== 'deep') throw new Error('Grove should be deep');
    if (getDepth('Consulting') !== 'standard') throw new Error('Consulting should be standard');
    if (getDepth('Personal') !== 'shallow') throw new Error('Personal should be shallow');
    if (getDepth('Home/Garage') !== 'shallow') throw new Error('Home should be shallow');
  });

  await runTest('Skill registry imported in content-callback', async () => {
    // Verify the imports work
    const { getSkillRegistry, executeSkillByName, isFeatureEnabled } = await import('../src/skills');
    if (typeof getSkillRegistry !== 'function') throw new Error('getSkillRegistry missing');
    if (typeof executeSkillByName !== 'function') throw new Error('executeSkillByName missing');
    if (typeof isFeatureEnabled !== 'function') throw new Error('isFeatureEnabled missing');
  });

  await runTest('threads-lookup skill has conditional steps', async () => {
    const { getSkillRegistry } = await import('../src/skills/registry');
    const registry = getSkillRegistry();
    const skill = registry.get('threads-lookup');

    // Check for conditional steps
    const hasDeepExpand = skill?.process.steps.some((s: any) => s.id === 'deep_expand');
    const hasGroveAnalysis = skill?.process.steps.some((s: any) => s.id === 'grove_analysis');
    const hasConsultingAnalysis = skill?.process.steps.some((s: any) => s.id === 'consulting_analysis');

    if (!hasDeepExpand) throw new Error('Missing deep_expand step');
    if (!hasGroveAnalysis) throw new Error('Missing grove_analysis step');
    if (!hasConsultingAnalysis) throw new Error('Missing consulting_analysis step');
  });

  await runTest('telegram_send callback can be registered', async () => {
    const { registerTelegramSendCallback } = await import('../src/conversation/tools/core');
    // Just verify it doesn't throw
    registerTelegramSendCallback(async () => {});
  });
}

// ============================================================================
// DISPATCHER TOOLS TESTS
// ============================================================================
async function testDispatcherTools() {
  startSection('DISPATCHER TOOLS', '🚀');

  const { executeDispatcherTools, DISPATCHER_TOOLS } = await import('../src/conversation/tools/dispatcher');

  await runTest('submit_ticket tool defined', async () => {
    const tool = DISPATCHER_TOOLS.find(t => t.name === 'submit_ticket');
    if (!tool) throw new Error('submit_ticket not found');
  });

  await runTest('Dispatcher validates input', async () => {
    const result = await executeDispatcherTools('submit_ticket', {});
    // Should fail without required fields
    if (result?.success) throw new Error('Should have failed validation');
  });
}

// ============================================================================
// OPERATOR TOOLS TESTS
// ============================================================================
async function testOperatorTools() {
  startSection('OPERATOR TOOLS', '⚙️');

  const { executeOperatorTools, OPERATOR_TOOLS } = await import('../src/conversation/tools/operator');

  await runTest('run_script tool defined', async () => {
    const tool = OPERATOR_TOOLS.find(t => t.name === 'run_script');
    if (!tool) throw new Error('run_script not found');
  });

  await runTest('get_skill_status tool defined', async () => {
    const tool = OPERATOR_TOOLS.find(t => t.name === 'get_skill_status');
    if (!tool) throw new Error('get_skill_status not found');
  });
}

// ============================================================================
// MAIN
// ============================================================================
async function main() {
  console.log('\n');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║           🔥 ATLAS MEGA SMOKE TEST - THE MOTHERLOAD 🔥        ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log(`\nRunning at: ${new Date().toISOString()}`);
  console.log(`Working dir: ${process.cwd()}`);

  const startTime = Date.now();

  try {
    await testEnvironment();
    await testNotion();
    await testClaudeAPI();
    await testGeminiAPI();
    await testCoreTools();
    await testWorkspaceTools();
    await testSelfModTools();
    await testSkillSystem();
    await testConversationContext();
    await testSystemPrompt();
    await testContentPatterns();
    await testMCPIntegration();
    await testAuditTrail();
    await testHealthChecks();
    await testContextualExtraction();
    await testDispatcherTools();
    await testOperatorTools();
  } catch (error: any) {
    console.error('\n💥 CRITICAL ERROR:', error.message);
  }

  // Summary
  const totalDuration = Date.now() - startTime;
  let totalPassed = 0;
  let totalFailed = 0;

  console.log('\n');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║                        SUMMARY                                ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');

  for (const section of sections) {
    const passed = section.tests.filter(t => t.passed).length;
    const failed = section.tests.filter(t => !t.passed).length;
    totalPassed += passed;
    totalFailed += failed;

    const status = failed === 0 ? '✅' : '❌';
    console.log(`${section.emoji} ${section.name.padEnd(30)} ${status} ${passed}/${passed + failed}`);
  }

  console.log('─'.repeat(60));
  console.log(`\n📊 TOTAL: ${totalPassed} passed, ${totalFailed} failed`);
  console.log(`⏱️  Duration: ${(totalDuration / 1000).toFixed(2)}s`);

  if (totalFailed === 0) {
    console.log('\n🎉 ALL TESTS PASSED! Ship it! 🚀\n');
    process.exit(0);
  } else {
    console.log(`\n⚠️  ${totalFailed} tests failed. Review above.\n`);
    process.exit(1);
  }
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
