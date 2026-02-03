/**
 * CONTEXTUAL EXTRACTION - FULL DIAGNOSTIC
 *
 * Traces every step from URL input to skill execution
 */

import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(import.meta.dir, '..', '.env'), override: true });

console.log('\n' + '='.repeat(70));
console.log('🔬 CONTEXTUAL EXTRACTION - FULL DIAGNOSTIC');
console.log('='.repeat(70) + '\n');

// Step 1: Environment
console.log('STEP 1: ENVIRONMENT VARIABLES');
console.log('-'.repeat(50));
console.log('ATLAS_SKILL_EXECUTION:', process.env.ATLAS_SKILL_EXECUTION);
console.log('ATLAS_SKILL_LOGGING:', process.env.ATLAS_SKILL_LOGGING);
console.log('NOTION_API_KEY:', process.env.NOTION_API_KEY ? `✅ Set (${process.env.NOTION_API_KEY.substring(0,10)}...)` : '❌ MISSING');
console.log('ANTHROPIC_API_KEY:', process.env.ANTHROPIC_API_KEY ? '✅ Set' : '❌ MISSING');
console.log();

// Step 2: Feature Flags
console.log('STEP 2: FEATURE FLAGS (from config)');
console.log('-'.repeat(50));
import { isFeatureEnabled, getFeatureFlags } from '../src/skills';
const flags = getFeatureFlags();
console.log('skillExecution enabled:', isFeatureEnabled('skillExecution'));
console.log('skillLogging enabled:', isFeatureEnabled('skillLogging'));
console.log('All flags:', JSON.stringify(flags, null, 2));
console.log();

// Step 3: Skill Registry
console.log('STEP 3: SKILL REGISTRY');
console.log('-'.repeat(50));
import { getSkillRegistry, initializeSkillRegistry } from '../src/skills';

try {
  await initializeSkillRegistry();
  const registry = getSkillRegistry();
  const allSkills = registry.getAll();
  console.log('Total skills loaded:', allSkills.length);

  const threadsSkill = registry.get('threads-lookup');
  if (threadsSkill) {
    console.log('✅ threads-lookup skill found');
    console.log('   Version:', threadsSkill.version);
    console.log('   Enabled:', threadsSkill.enabled);
    console.log('   Tier:', threadsSkill.tier);
    console.log('   Triggers:', JSON.stringify(threadsSkill.triggers, null, 2));
  } else {
    console.log('❌ threads-lookup skill NOT FOUND');
    console.log('   Available skills:', allSkills.map(s => s.name).join(', '));
  }
} catch (error) {
  console.log('❌ Registry initialization failed:', error);
}
console.log();

// Step 4: Pattern Matching
console.log('STEP 4: PATTERN MATCHING');
console.log('-'.repeat(50));

const testUrls = [
  'https://www.threads.net/@yannlecun/post/DCz2_mZuc4m',
  'https://www.threads.com/@saboo_shubham_/post/DUR92MflHcg',
  'https://threads.net/post/abc123',
  'https://threads.com/post/abc123',
  'https://example.com/not-threads',
];

const registry = getSkillRegistry();
for (const url of testUrls) {
  const match = registry.findBestMatch(url, { pillar: 'The Grove' });
  const status = match && match.score >= 0.7 ? '✅' : '❌';
  console.log(`${status} ${url.substring(0, 50)}...`);
  if (match) {
    console.log(`   Skill: ${match.skill.name}, Score: ${match.score}`);
  } else {
    console.log(`   No match found`);
  }
}
console.log();

// Step 5: Trigger Function
console.log('STEP 5: triggerContextualExtraction FUNCTION');
console.log('-'.repeat(50));
import { triggerContextualExtraction } from '../src/skills';

const testParams = {
  url: 'https://www.threads.com/@test/post/ABC123',
  pillar: 'The Grove',
  feedId: 'test-feed-id',
  workQueueId: 'test-wq-id',
  userId: 12345,
  chatId: 67890,
  requestType: 'Research',
};

console.log('Test parameters:', JSON.stringify(testParams, null, 2));
console.log();

// Check if function exists
if (typeof triggerContextualExtraction === 'function') {
  console.log('✅ triggerContextualExtraction function exists');

  // Dry run - check conditions without actually executing
  console.log('\nCondition checks:');
  console.log('  1. isFeatureEnabled("skillExecution"):', isFeatureEnabled('skillExecution'));

  const match = registry.findBestMatch(testParams.url, { pillar: testParams.pillar });
  console.log('  2. Skill match found:', match ? `Yes (${match.skill.name}, score: ${match.score})` : 'No');
  console.log('  3. Score >= 0.7:', match ? match.score >= 0.7 : 'N/A');

  if (isFeatureEnabled('skillExecution') && match && match.score >= 0.7) {
    console.log('\n✅ ALL CONDITIONS PASS - Extraction SHOULD trigger');
  } else {
    console.log('\n❌ CONDITIONS FAIL - Extraction will NOT trigger');
    if (!isFeatureEnabled('skillExecution')) {
      console.log('   → ATLAS_SKILL_EXECUTION must be "true"');
    }
    if (!match || match.score < 0.7) {
      console.log('   → No matching skill with score >= 0.7');
    }
  }
} else {
  console.log('❌ triggerContextualExtraction function NOT FOUND');
}
console.log();

// Step 6: Content Callback Import Check
console.log('STEP 6: CONTENT-CALLBACK IMPORTS');
console.log('-'.repeat(50));
try {
  const contentCallback = await import('../src/handlers/content-callback');
  console.log('✅ content-callback.ts loads successfully');

  // Check if the right imports are there
  const sourceCode = await Bun.file(join(import.meta.dir, '../src/handlers/content-callback.ts')).text();

  if (sourceCode.includes('triggerContextualExtraction')) {
    console.log('✅ triggerContextualExtraction is imported');

    // Find the line where it's called
    const lines = sourceCode.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('triggerContextualExtraction(')) {
        console.log(`✅ triggerContextualExtraction called at line ${i + 1}`);
        console.log(`   Context: ${lines[i].trim()}`);
      }
    }
  } else {
    console.log('❌ triggerContextualExtraction NOT imported in content-callback.ts');
  }

  // Check the condition
  if (sourceCode.includes('if (result && pending.url)')) {
    console.log('✅ Trigger condition found: if (result && pending.url)');
  } else {
    console.log('⚠️ Could not find trigger condition');
  }
} catch (error) {
  console.log('❌ Failed to load content-callback.ts:', error);
}
console.log();

// Step 7: Executor Check
console.log('STEP 7: SKILL EXECUTOR');
console.log('-'.repeat(50));
import { executeSkillByName } from '../src/skills';

if (typeof executeSkillByName === 'function') {
  console.log('✅ executeSkillByName function exists');
} else {
  console.log('❌ executeSkillByName NOT found');
}

// Check if threads-lookup skill would execute
const threadsSkill = registry.get('threads-lookup');
if (threadsSkill) {
  console.log('threads-lookup skill details:');
  console.log('  - enabled:', threadsSkill.enabled);
  console.log('  - process type:', threadsSkill.process?.type);
  console.log('  - steps count:', threadsSkill.process?.steps?.length);
  console.log('  - first step:', threadsSkill.process?.steps?.[0]?.id);
  console.log('  - has always_run steps:', threadsSkill.process?.steps?.some((s: any) => s.always_run));
}
console.log();

// Step 8: MCP Chrome Extension
console.log('STEP 8: MCP CHROME EXTENSION');
console.log('-'.repeat(50));
import { readFileSync } from 'fs';
try {
  const mcpConfig = readFileSync(join(import.meta.dir, '../config/mcp.yaml'), 'utf-8');
  if (mcpConfig.includes('claude_in_chrome') || mcpConfig.includes('claude-in-chrome')) {
    console.log('✅ claude-in-chrome configured in mcp.yaml');
  } else {
    console.log('❌ claude-in-chrome NOT in mcp.yaml');
  }
} catch (error) {
  console.log('❌ Could not read mcp.yaml:', error);
}
console.log();

// Step 9: Live Test (DRY RUN)
console.log('STEP 9: LIVE TRIGGER TEST (dry run)');
console.log('-'.repeat(50));
console.log('Calling triggerContextualExtraction with test params...');
console.log('(This will attempt to find and execute the skill)\n');

try {
  const result = await triggerContextualExtraction({
    url: 'https://www.threads.com/@test/post/DRY_RUN_TEST',
    pillar: 'The Grove',
    feedId: 'dry-run-feed',
    workQueueId: 'dry-run-wq',
    userId: 99999,
    chatId: 99999,
    requestType: 'Research',
  });

  if (result === null) {
    console.log('Result: null (extraction skipped or no match)');
  } else if (result.success) {
    console.log('✅ Extraction succeeded!');
    console.log('   Skill:', result.skillName);
    console.log('   Time:', result.executionTimeMs, 'ms');
  } else {
    console.log('❌ Extraction failed:');
    console.log('   Error:', result.error);
  }
} catch (error) {
  console.log('❌ Exception during extraction:', error);
}
console.log();

// Summary
console.log('='.repeat(70));
console.log('DIAGNOSTIC COMPLETE');
console.log('='.repeat(70));
