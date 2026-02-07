/**
 * CANARY TESTS - Silent Failure Detection
 *
 * These tests detect "works but wrong" scenarios:
 * - System prompts that load but are missing critical content
 * - Tools that return success:true but with empty/default data
 * - Fallbacks that silently replace real data with placeholders
 * - Configurations that appear valid but reference wrong IDs
 *
 * The name comes from "canary in a coal mine" - these are early warning tests.
 *
 * Usage: bun run scripts/canary-tests.ts
 */

import { config } from 'dotenv';
import { join } from 'path';

// Load environment variables
config({ path: join(import.meta.dir, '..', '.env'), override: true });

// Disable verbose logging
process.env.LOG_LEVEL = 'warn';

// Strict mode: ENABLE_FALLBACKS=false means fallbacks are hard failures
const STRICT_MODE = process.env.ENABLE_FALLBACKS !== 'true';

// =============================================================================
// TYPES
// =============================================================================

interface CanaryResult {
  name: string;
  passed: boolean;
  error?: string;
  warning?: string;
  evidence?: string;
}

interface CanarySuite {
  name: string;
  results: CanaryResult[];
}

// =============================================================================
// CANARY ASSERTIONS
// =============================================================================

/**
 * Verify content contains ALL expected phrases (not just one)
 */
function assertContainsAll(content: string, phrases: string[], context: string): CanaryResult {
  const missing: string[] = [];
  for (const phrase of phrases) {
    if (!content.includes(phrase)) {
      missing.push(phrase);
    }
  }

  if (missing.length > 0) {
    return {
      name: context,
      passed: false,
      error: `Missing ${missing.length}/${phrases.length} required phrases`,
      evidence: `Missing: ${missing.slice(0, 3).map(p => `"${p.substring(0, 30)}..."`).join(', ')}`,
    };
  }

  return { name: context, passed: true };
}

/**
 * Verify content has minimum length (catches empty fallbacks)
 */
function assertMinLength(content: string, minLength: number, context: string): CanaryResult {
  if (content.length < minLength) {
    return {
      name: context,
      passed: false,
      error: `Content too short (${content.length} < ${minLength} chars)`,
      warning: 'Possible silent load failure or empty fallback',
    };
  }
  return { name: context, passed: true };
}

/**
 * Verify array has items (catches empty results)
 */
function assertNotEmpty(arr: unknown[], context: string): CanaryResult {
  if (!arr || arr.length === 0) {
    return {
      name: context,
      passed: false,
      error: 'Array is empty',
      warning: 'Possible silent query failure or missing data',
    };
  }
  return { name: context, passed: true, evidence: `Found ${arr.length} items` };
}

/**
 * Verify object has required fields with non-null values
 */
function assertFieldsPresent(obj: Record<string, unknown>, fields: string[], context: string): CanaryResult {
  const missing: string[] = [];
  const nullish: string[] = [];

  for (const field of fields) {
    if (!(field in obj)) {
      missing.push(field);
    } else if (obj[field] === null || obj[field] === undefined || obj[field] === '') {
      nullish.push(field);
    }
  }

  if (missing.length > 0 || nullish.length > 0) {
    return {
      name: context,
      passed: false,
      error: `Field issues: ${missing.length} missing, ${nullish.length} null/empty`,
      evidence: `Missing: [${missing.join(', ')}], Null: [${nullish.join(', ')}]`,
    };
  }

  return { name: context, passed: true };
}

// =============================================================================
// CANARY SUITES
// =============================================================================

/**
 * System Prompt Canaries - Verify critical content is present
 */
async function runSystemPromptCanaries(): Promise<CanarySuite> {
  const results: CanaryResult[] = [];

  console.log('\n🐤 SYSTEM PROMPT CANARIES');
  console.log('─'.repeat(50));

  try {
    const { buildSystemPrompt } = await import('../src/conversation/prompt.js');
    const prompt = await buildSystemPrompt();

    // Canary 1: Prompt has minimum viable length
    results.push(assertMinLength(prompt, 5000, 'Prompt minimum length'));

    // Canary 2: SOUL critical phrases (not just "SOUL" but actual content)
    results.push(assertContainsAll(prompt, [
      'Core Truths',
      'Jim Calhoun',
      'chief of staff',  // From SOUL.md actual phrasing
    ], 'SOUL identity phrases'));

    // Canary 3: Memory critical phrases
    results.push(assertContainsAll(prompt, [
      'Classification Rules',
      'Anti-Hallucination',
      'MEMORY.md',
    ], 'MEMORY content loaded'));

    // Canary 4: Pillars must all be present
    results.push(assertContainsAll(prompt, [
      'Personal',
      'The Grove',
      'Consulting',
      'Home/Garage',
    ], 'All four pillars'));

    // Canary 5: Canonical databases present
    results.push(assertContainsAll(prompt, [
      'ce6fbf1b-ee30-433d-a9e6-b338552de7c9', // Dev Pipeline
      '3d679030-b76b-43bd-92d8-1ac51abb4a28', // Work Queue
      '90b2b33f-4b44-4b42-870f-8d62fb8cbf18', // Feed
    ], 'Canonical database IDs'));

    // Canary 6: Tool documentation present
    results.push(assertContainsAll(prompt, [
      'work_queue_create',
      'submit_ticket',
      'notion_search',
      'dispatch_research',
    ], 'Core tool documentation'));

    // Canary 7: Anti-hallucination rules present
    results.push(assertContainsAll(prompt, [
      'NEVER fabricate',
      'MUST use the EXACT',
      'HALLUCINATION',
    ], 'Anti-hallucination rules'));

  } catch (err: any) {
    results.push({
      name: 'Prompt build',
      passed: false,
      error: `Failed to build prompt: ${err.message}`,
    });
  }

  // Report
  for (const r of results) {
    const icon = r.passed ? '✅' : '❌';
    console.log(`  ${icon} ${r.name}`);
    if (r.error) console.log(`     └─ ${r.error}`);
    if (r.evidence) console.log(`     └─ ${r.evidence}`);
  }

  return { name: 'System Prompt', results };
}

/**
 * Data File Canaries - Verify required files load with content
 */
async function runDataFileCanaries(): Promise<CanarySuite> {
  const results: CanaryResult[] = [];

  console.log('\n🐤 DATA FILE CANARIES');
  console.log('─'.repeat(50));

  const fs = await import('fs/promises');
  const dataDir = join(import.meta.dir, '..', 'data');

  const criticalFiles = [
    { path: 'SOUL.md', minLength: 1000, mustContain: ['Core Truths', 'Atlas'] },
    { path: 'MEMORY.md', minLength: 500, mustContain: ['Classification', 'Patterns'] },
    { path: 'USER.md', minLength: 100, mustContain: ['Jim'] },
  ];

  for (const file of criticalFiles) {
    const fullPath = join(dataDir, file.path);
    try {
      const content = await fs.readFile(fullPath, 'utf-8');

      // Check length
      const lenResult = assertMinLength(content, file.minLength, `${file.path} length`);
      results.push(lenResult);

      // Check required content
      const contentResult = assertContainsAll(content, file.mustContain, `${file.path} content`);
      results.push(contentResult);

    } catch (err: any) {
      results.push({
        name: `${file.path} exists`,
        passed: false,
        error: `File not found or unreadable: ${err.message}`,
      });
    }
  }

  // Report
  for (const r of results) {
    const icon = r.passed ? '✅' : '❌';
    console.log(`  ${icon} ${r.name}`);
    if (r.error) console.log(`     └─ ${r.error}`);
  }

  return { name: 'Data Files', results };
}

/**
 * Tool Response Canaries - Verify tools return real data
 */
async function runToolResponseCanaries(): Promise<CanarySuite> {
  const results: CanaryResult[] = [];

  console.log('\n🐤 TOOL RESPONSE CANARIES');
  console.log('─'.repeat(50));

  // Only run if we have API keys
  if (!process.env.NOTION_API_KEY) {
    results.push({
      name: 'Notion tools',
      passed: false,
      warning: 'NOTION_API_KEY not set - skipping Notion canaries',
      error: 'Missing API key',
    });
    console.log('  ⏭️  Skipping (no NOTION_API_KEY)');
    return { name: 'Tool Responses', results };
  }

  try {
    const { executeCoreTools } = await import('../src/conversation/tools/core.js');

    // Canary 1: work_queue_list returns structured data (not empty)
    const wqResult = await executeCoreTools('work_queue_list', { limit: 5 });
    if (wqResult?.success) {
      const items = (wqResult.result as { items?: unknown[] })?.items;
      if (items && items.length > 0) {
        // Verify items have expected structure
        const firstItem = items[0] as Record<string, unknown>;
        results.push(assertFieldsPresent(firstItem, ['id', 'title', 'status'], 'WQ item structure'));
      } else if (STRICT_MODE) {
        results.push({
          name: 'WQ list returns items',
          passed: false,
          error: 'FALLBACK DETECTED: Work Queue returned empty. Strict mode = hard failure.',
        });
      } else {
        results.push({
          name: 'WQ list returns items',
          passed: true,
          warning: 'Work Queue is empty (accepted — fallbacks enabled)',
        });
      }
    } else {
      results.push({
        name: 'WQ list succeeds',
        passed: false,
        error: wqResult?.error || 'Unknown error',
      });
    }

    // Canary 2: get_status_summary returns structured data
    const statusResult = await executeCoreTools('get_status_summary', {});
    if (statusResult?.success) {
      const summary = statusResult.result as Record<string, unknown>;
      results.push(assertFieldsPresent(summary, ['workQueue', 'summary'], 'Status summary structure'));
    } else {
      results.push({
        name: 'Status summary succeeds',
        passed: false,
        error: statusResult?.error || 'Unknown error',
      });
    }

    // Canary 3: read_soul returns actual SOUL content
    const { executeSelfModTools } = await import('../src/conversation/tools/self-mod.js');
    const soulResult = await executeSelfModTools('read_soul', {});
    if (soulResult?.success) {
      const content = (soulResult.result as { content?: string })?.content || '';
      results.push(assertMinLength(content, 500, 'SOUL content via tool'));
      results.push(assertContainsAll(content, ['Core Truths'], 'SOUL identity via tool'));
    } else {
      results.push({
        name: 'read_soul succeeds',
        passed: false,
        error: soulResult?.error || 'Unknown error',
      });
    }

  } catch (err: any) {
    results.push({
      name: 'Tool execution',
      passed: false,
      error: `Tool execution failed: ${err.message}`,
    });
  }

  // Report
  for (const r of results) {
    const icon = r.passed ? '✅' : r.warning ? '⚠️' : '❌';
    console.log(`  ${icon} ${r.name}`);
    if (r.error) console.log(`     └─ ${r.error}`);
    if (r.warning) console.log(`     └─ ⚠️ ${r.warning}`);
  }

  return { name: 'Tool Responses', results };
}

/**
 * Skill Registry Canaries - Verify skills load with proper definitions
 */
async function runSkillRegistryCanaries(): Promise<CanarySuite> {
  const results: CanaryResult[] = [];

  console.log('\n🐤 SKILL REGISTRY CANARIES');
  console.log('─'.repeat(50));

  try {
    const { initializeSkillRegistry, getSkillRegistry } = await import('../src/skills/registry.js');
    await initializeSkillRegistry();
    const registry = getSkillRegistry();

    // Canary 1: Registry has skills
    const allSkills = registry.getAll();
    results.push(assertNotEmpty(allSkills, 'Skills loaded'));

    // Canary 2: Critical skills exist
    const criticalSkills = ['threads-lookup', 'verify'];
    for (const skillName of criticalSkills) {
      const skill = registry.get(skillName);
      if (skill) {
        // Verify skill has proper structure
        results.push(assertFieldsPresent(
          skill as unknown as Record<string, unknown>,
          ['name', 'triggers', 'process'],
          `${skillName} structure`
        ));
      } else {
        results.push({
          name: `${skillName} exists`,
          passed: false,
          error: 'Skill not found in registry',
        });
      }
    }

    // Canary 3: Skills have valid triggers (not empty)
    const skillsWithEmptyTriggers = allSkills.filter(s => !s.triggers || s.triggers.length === 0);
    if (skillsWithEmptyTriggers.length > 0) {
      results.push({
        name: 'All skills have triggers',
        passed: false,
        error: `${skillsWithEmptyTriggers.length} skills have no triggers`,
        evidence: skillsWithEmptyTriggers.map(s => s.name).join(', '),
      });
    } else {
      results.push({ name: 'All skills have triggers', passed: true });
    }

  } catch (err: any) {
    results.push({
      name: 'Skill registry load',
      passed: false,
      error: `Failed to load registry: ${err.message}`,
    });
  }

  // Report
  for (const r of results) {
    const icon = r.passed ? '✅' : '❌';
    console.log(`  ${icon} ${r.name}`);
    if (r.error) console.log(`     └─ ${r.error}`);
    if (r.evidence) console.log(`     └─ ${r.evidence}`);
  }

  return { name: 'Skill Registry', results };
}

/**
 * Environment Canaries - Verify critical env vars have valid values
 */
async function runEnvironmentCanaries(): Promise<CanarySuite> {
  const results: CanaryResult[] = [];

  console.log('\n🐤 ENVIRONMENT CANARIES');
  console.log('─'.repeat(50));

  // Canary 1: Critical env vars exist and have content
  const requiredEnvVars = [
    'TELEGRAM_BOT_TOKEN',
    'TELEGRAM_ALLOWED_USERS',
    'ANTHROPIC_API_KEY',
    'NOTION_API_KEY',
  ];

  for (const varName of requiredEnvVars) {
    const value = process.env[varName];
    if (!value) {
      results.push({
        name: `${varName} set`,
        passed: false,
        error: 'Environment variable not set',
      });
    } else if (value.length < 10) {
      results.push({
        name: `${varName} valid`,
        passed: false,
        error: `Value too short (${value.length} chars) - possible placeholder`,
      });
    } else if (value.includes('your_') || value.includes('xxx') || value.includes('placeholder')) {
      results.push({
        name: `${varName} not placeholder`,
        passed: false,
        error: 'Value appears to be a placeholder',
      });
    } else {
      results.push({ name: `${varName} valid`, passed: true });
    }
  }

  // Canary 2: Notion API key format validation
  const notionKey = process.env.NOTION_API_KEY;
  if (notionKey) {
    if (!notionKey.startsWith('secret_') && !notionKey.startsWith('ntn_')) {
      results.push({
        name: 'NOTION_API_KEY format',
        passed: false,
        error: 'Key does not start with "secret_" or "ntn_" - may be invalid',
      });
    } else {
      results.push({ name: 'NOTION_API_KEY format', passed: true });
    }
  }

  // Report
  for (const r of results) {
    const icon = r.passed ? '✅' : '❌';
    console.log(`  ${icon} ${r.name}`);
    if (r.error) console.log(`     └─ ${r.error}`);
  }

  return { name: 'Environment', results };
}

/**
 * Fallback Detection Canaries - Look for known fallback patterns
 */
async function runFallbackDetectionCanaries(): Promise<CanarySuite> {
  const results: CanaryResult[] = [];

  console.log('\n🐤 FALLBACK DETECTION CANARIES');
  console.log('─'.repeat(50));

  // Canary 1: Check if MCP tools are actually connected
  // Note: MCP is optional - not connected during tests is expected
  try {
    const { getMcpTools } = await import('../src/mcp/index.js');
    const mcpTools = getMcpTools();

    if (mcpTools.length === 0 && STRICT_MODE) {
      results.push({
        name: 'MCP tools connected',
        passed: false,
        error: 'FALLBACK DETECTED: No MCP tools loaded. Strict mode = hard failure.',
      });
    } else if (mcpTools.length === 0) {
      results.push({
        name: 'MCP tools connected',
        passed: true,
        warning: 'No MCP tools loaded - direct API fallback (accepted — fallbacks enabled)',
      });
    } else {
      results.push({
        name: 'MCP tools connected',
        passed: true,
        evidence: `${mcpTools.length} MCP tools available`,
      });
    }
  } catch (err: any) {
    if (STRICT_MODE) {
      results.push({
        name: 'MCP tools check',
        passed: false,
        error: `FALLBACK DETECTED: MCP check failed: ${err.message}. Strict mode = hard failure.`,
      });
    } else {
      results.push({
        name: 'MCP tools check',
        passed: true,
        warning: `MCP check failed: ${err.message} (accepted — fallbacks enabled)`,
      });
    }
  }

  // Canary 2: Verify feature flags are loaded (not using defaults)
  try {
    const { getFeatureFlags } = await import('../src/config/features.js');
    const flags = getFeatureFlags();

    // Check that flags is an object with expected keys
    if (!flags || typeof flags !== 'object') {
      results.push({
        name: 'Feature flags loaded',
        passed: false,
        error: 'Feature flags returned invalid data',
      });
    } else {
      const flagCount = Object.keys(flags).length;
      if (flagCount < 3) {
        results.push({
          name: 'Feature flags populated',
          passed: false,
          warning: 'Very few feature flags - may be using defaults',
          evidence: `Only ${flagCount} flags found`,
        });
      } else {
        results.push({ name: 'Feature flags loaded', passed: true, evidence: `${flagCount} flags` });
      }
    }
  } catch (err: any) {
    results.push({
      name: 'Feature flags check',
      passed: false,
      error: `Feature flags failed: ${err.message}`,
    });
  }

  // Report
  for (const r of results) {
    const icon = r.passed ? '✅' : r.warning ? '⚠️' : '❌';
    console.log(`  ${icon} ${r.name}`);
    if (r.error) console.log(`     └─ ${r.error}`);
    if (r.warning) console.log(`     └─ ⚠️ ${r.warning}`);
    if (r.evidence) console.log(`     └─ ${r.evidence}`);
  }

  return { name: 'Fallback Detection', results };
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  console.log('\n');
  console.log('====================================');
  console.log('   CANARY TESTS');
  console.log('   Silent Failure Detection');
  console.log(`   Mode: ${STRICT_MODE ? '🔴 STRICT (no fallbacks)' : '🟢 LENIENT (fallbacks OK)'}`);
  console.log('====================================');
  console.log(`\nStarted: ${new Date().toISOString()}`);

  const startTime = Date.now();
  const suites: CanarySuite[] = [];

  // Run all canary suites
  suites.push(await runEnvironmentCanaries());
  suites.push(await runDataFileCanaries());
  suites.push(await runSystemPromptCanaries());
  suites.push(await runSkillRegistryCanaries());
  suites.push(await runToolResponseCanaries());
  suites.push(await runFallbackDetectionCanaries());

  // Summary
  const totalPassed = suites.reduce((sum, s) => sum + s.results.filter(r => r.passed).length, 0);
  const totalFailed = suites.reduce((sum, s) => sum + s.results.filter(r => !r.passed).length, 0);
  const totalWarnings = suites.reduce((sum, s) => sum + s.results.filter(r => r.warning && r.passed).length, 0);
  const duration = Date.now() - startTime;

  console.log('\n');
  console.log('====================================');
  console.log('   CANARY SUMMARY');
  console.log('====================================');

  for (const suite of suites) {
    const passed = suite.results.filter(r => r.passed).length;
    const failed = suite.results.filter(r => !r.passed).length;
    const icon = failed === 0 ? '✅' : '❌';
    console.log(`${icon} ${suite.name.padEnd(25)} ${passed}/${passed + failed}`);
  }

  console.log('────────────────────────────────────');
  console.log(`   Passed:   ${totalPassed}`);
  console.log(`   Failed:   ${totalFailed}`);
  console.log(`   Warnings: ${totalWarnings}`);
  console.log(`   Duration: ${(duration / 1000).toFixed(2)}s`);
  console.log('====================================');

  if (totalFailed > 0) {
    console.log('\n❌ CANARY ALERTS: Silent failures detected!');
    console.log('   The system may appear to work but is producing degraded output.\n');
    process.exit(1);
  } else if (totalWarnings > 0) {
    console.log('\n⚠️  CANARY WARNINGS: Possible degradation detected.');
    console.log('   Review warnings above for potential issues.\n');
    process.exit(0);
  } else {
    console.log('\n✅ ALL CANARIES HEALTHY');
    console.log('   No silent failures detected.\n');
    process.exit(0);
  }
}

main().catch((error) => {
  console.error('\n❌ Canary test runner failed:', error);
  process.exit(1);
});
