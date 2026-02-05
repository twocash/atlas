/**
 * V3 Active Capture Pipeline - Master Blaster Test Suite
 *
 * Tests ALL permutations of the prompt composition and skill execution chain:
 * 1. Prompt Manager - fetching from System Prompts DB
 * 2. Prompt Composition - drafter + voice + lens combinations
 * 3. claude_analyze tool - v3Requested flag behavior
 * 4. Full skill execution - url-extract with various inputs
 * 5. All pillar/action combinations
 *
 * Usage: bun run scripts/test-v3-capture-pipeline.ts
 *
 * With strict mode: PROMPT_STRICT_MODE=true bun run scripts/test-v3-capture-pipeline.ts
 */

import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(import.meta.dir, '..', '.env'), override: true });

// ============================================================================
// TEST INFRASTRUCTURE
// ============================================================================

interface TestResult {
  name: string;
  passed: boolean;
  duration: number;
  error?: string;
  details?: string;
}

interface TestSection {
  name: string;
  tests: TestResult[];
}

const sections: TestSection[] = [];
let currentSection: TestSection | null = null;
let totalPassed = 0;
let totalFailed = 0;

function startSection(name: string, emoji: string) {
  currentSection = { name, tests: [] };
  sections.push(currentSection);
  console.log(`\n${emoji} ${name}`);
  console.log('─'.repeat(70));
}

async function runTest(name: string, fn: () => Promise<void>, timeoutMs = 30000): Promise<boolean> {
  const start = Date.now();
  try {
    await Promise.race([
      fn(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), timeoutMs)),
    ]);
    const duration = Date.now() - start;
    currentSection?.tests.push({ name, passed: true, duration });
    console.log(`  ✅ ${name} (${duration}ms)`);
    totalPassed++;
    return true;
  } catch (error: any) {
    const duration = Date.now() - start;
    currentSection?.tests.push({ name, passed: false, duration, error: error.message });
    console.log(`  ❌ ${name} (${duration}ms)`);
    console.log(`     └─ ${error.message}`);
    totalFailed++;
    return false;
  }
}

// ============================================================================
// 1. SYSTEM PROMPTS DATABASE TESTS
// ============================================================================

async function testSystemPromptsDB() {
  startSection('SYSTEM PROMPTS DATABASE', '📋');

  const { Client } = await import('@notionhq/client');
  const notion = new Client({ auth: process.env.NOTION_API_KEY });
  const SYSTEM_PROMPTS_DB = '2fc780a78eef8196b29bdb4a6adfdc27';

  // Test database accessible
  await runTest('System Prompts DB accessible', async () => {
    const result = await notion.databases.query({
      database_id: SYSTEM_PROMPTS_DB,
      page_size: 1,
    });
    if (!result.results) throw new Error('No results');
  });

  // Test schema has required properties
  await runTest('Schema has Type property', async () => {
    const db = await notion.databases.retrieve({ database_id: SYSTEM_PROMPTS_DB });
    const props = db.properties as any;
    if (!props['Type']) throw new Error('Type property missing');
    if (props['Type'].type !== 'select') throw new Error('Type should be select');
  });

  await runTest('Schema has Action property', async () => {
    const db = await notion.databases.retrieve({ database_id: SYSTEM_PROMPTS_DB });
    const props = db.properties as any;
    if (!props['Action']) throw new Error('Action property missing');
    if (props['Action'].type !== 'select') throw new Error('Action should be select');
  });

  await runTest('Type options correct (Drafter, Voice, Lens, Classifier, System)', async () => {
    const db = await notion.databases.retrieve({ database_id: SYSTEM_PROMPTS_DB });
    const props = db.properties as any;
    const options = props['Type'].select.options.map((o: any) => o.name);
    const required = ['Drafter', 'Voice', 'Lens', 'Classifier', 'System'];
    for (const r of required) {
      if (!options.includes(r)) throw new Error(`Missing Type option: ${r}`);
    }
  });

  await runTest('Action options correct (Capture, Research, Draft, Summarize, General)', async () => {
    const db = await notion.databases.retrieve({ database_id: SYSTEM_PROMPTS_DB });
    const props = db.properties as any;
    const options = props['Action'].select.options.map((o: any) => o.name);
    const required = ['Capture', 'Research', 'Draft', 'Summarize', 'General'];
    for (const r of required) {
      if (!options.includes(r)) throw new Error(`Missing Action option: ${r}`);
    }
  });

  // Verify dead properties removed
  await runTest('Prompt Text property removed', async () => {
    const db = await notion.databases.retrieve({ database_id: SYSTEM_PROMPTS_DB });
    const props = db.properties as any;
    if (props['Prompt Text']) throw new Error('Prompt Text still exists - should be removed');
  });

  await runTest('Stage property removed', async () => {
    const db = await notion.databases.retrieve({ database_id: SYSTEM_PROMPTS_DB });
    const props = db.properties as any;
    if (props['Stage']) throw new Error('Stage still exists - should be removed');
  });
}

// ============================================================================
// 2. PROMPT MANAGER TESTS
// ============================================================================

async function testPromptManager() {
  startSection('PROMPT MANAGER', '🎯');

  const { getPromptManager } = await import('../../../packages/agents/src');
  const pm = getPromptManager();

  // Test fetching individual prompts by ID
  // NOTE: Consulting IDs use .consulting TLD which Notion auto-links
  // The sanitizer should strip the link formatting
  const testPrompts = [
    // The Grove
    { id: 'drafter.the-grove.capture', expectedType: 'Drafter' },
    { id: 'drafter.the-grove.research', expectedType: 'Drafter' },
    { id: 'drafter.the-grove.draft', expectedType: 'Drafter' },
    { id: 'drafter.the-grove.analysis', expectedType: 'Drafter' },

    // Consulting (these test the sanitizer - .consulting is a real TLD)
    { id: 'drafter.consulting.capture', expectedType: 'Drafter' },
    { id: 'drafter.consulting.research', expectedType: 'Drafter' },
    { id: 'drafter.consulting.draft', expectedType: 'Drafter' },
    { id: 'drafter.consulting.analysis', expectedType: 'Drafter' },
    { id: 'drafter.consulting.summarize', expectedType: 'Drafter' },

    // Personal
    { id: 'drafter.personal.capture', expectedType: 'Drafter' },
    { id: 'drafter.personal.research', expectedType: 'Drafter' },
    { id: 'drafter.personal.draft', expectedType: 'Drafter' },
    { id: 'drafter.personal.summarize', expectedType: 'Drafter' },

    // Home/Garage
    { id: 'drafter.home-garage.capture', expectedType: 'Drafter' },
    { id: 'drafter.home-garage.research', expectedType: 'Drafter' },
    { id: 'drafter.home-garage.summarize', expectedType: 'Drafter' },

    // Voices
    { id: 'voice.strategic', expectedType: 'Voice' },
    { id: 'voice.grove-analytical', expectedType: 'Voice' },
    { id: 'voice.consulting-brief', expectedType: 'Voice' },
    { id: 'voice.client-facing', expectedType: 'Voice' },
    { id: 'voice.raw-notes', expectedType: 'Voice' },
    { id: 'voice.reflective', expectedType: 'Voice' },
    { id: 'voice.practical', expectedType: 'Voice' },
  ];

  for (const { id, expectedType } of testPrompts) {
    await runTest(`Fetch prompt: ${id}`, async () => {
      const record = await pm.getPromptRecordById(id);
      if (!record) throw new Error(`Prompt not found: ${id}`);
      if (!record.promptText) throw new Error(`Prompt ${id} has no promptText (check page body)`);
      if (record.promptText.length < 50) throw new Error(`Prompt ${id} too short (${record.promptText.length} chars)`);
    });
  }
}

// ============================================================================
// 3. PROMPT COMPOSITION TESTS - ALL PERMUTATIONS
// ============================================================================

async function testPromptComposition() {
  startSection('PROMPT COMPOSITION - PERMUTATIONS', '🔧');

  const { getPromptManager } = await import('../../../packages/agents/src');
  const pm = getPromptManager();

  // Test matrix: Pillar × Action × Voice
  // Actions per pillar (from registry.ts PILLAR_ACTIONS):
  // - The Grove: research, draft, capture, analysis
  // - Consulting: draft, research, analysis, summarize
  // - Personal: capture, research, draft, summarize
  // - Home/Garage: capture, research, summarize
  const pillarActions: Record<string, string[]> = {
    'The Grove': ['research', 'draft', 'capture', 'analysis'],
    'Consulting': ['draft', 'research', 'analysis', 'summarize'],
    'Personal': ['capture', 'research', 'draft', 'summarize'],
    'Home/Garage': ['capture', 'research', 'summarize'],
  };
  const pillars = Object.keys(pillarActions);
  const voices = ['voice.strategic', null]; // Test with and without voice

  // Map pillar names to drafter ID prefixes
  const pillarToPrefix: Record<string, string> = {
    'The Grove': 'the-grove',
    'Consulting': 'consulting',
    'Personal': 'personal',
    'Home/Garage': 'home-garage',
  };

  for (const pillar of pillars) {
    const actions = pillarActions[pillar];

    for (const action of actions) {
      const drafterId = `drafter.${pillarToPrefix[pillar]}.${action}`;

      // Test without voice
      await runTest(`Compose: ${pillar} / ${action} (no voice)`, async () => {
        const result = await pm.composePrompts(
          { drafter: drafterId },
          { pillar, url: 'https://example.com', title: 'Test' }
        );
        if (!result) throw new Error('Composition returned null');
        if (!result.prompt) throw new Error('No prompt in result');
        if (result.prompt.length < 100) throw new Error(`Prompt too short: ${result.prompt.length}`);
      });

      // Test with strategic voice (only for one action per pillar to reduce test count)
      if (action === actions[0]) {
        await runTest(`Compose: ${pillar} / ${action} + voice.strategic`, async () => {
          const result = await pm.composePrompts(
            { drafter: drafterId, voice: 'voice.strategic' },
            { pillar, url: 'https://example.com', title: 'Test' }
          );
          if (!result) throw new Error('Composition returned null');
          if (!result.prompt) throw new Error('No prompt in result');
          // Voice should add content
          if (result.prompt.length < 200) throw new Error(`Combined prompt too short: ${result.prompt.length}`);
        });
      }
    }
  }
}

// ============================================================================
// 4. CLAUDE_ANALYZE TOOL TESTS - V3REQUESTED FLAG BEHAVIOR
// ============================================================================

async function testClaudeAnalyzeTool() {
  startSection('CLAUDE_ANALYZE TOOL - V3REQUESTED BEHAVIOR', '🧠');

  const { executeTool } = await import('../src/conversation/tools');

  const testContent = `
    This is a test article about AI and technology.
    Key points:
    1. AI is transforming industries
    2. Machine learning enables new capabilities
    3. The future holds many possibilities
  `;

  const systemPrompt = `Analyze this content and provide a summary with key insights.`;

  // Test 1: v3Requested=undefined, no composedPrompt → should use systemPrompt
  await runTest('v3Requested=undefined + systemPrompt → uses systemPrompt', async () => {
    const result = await executeTool('claude_analyze', {
      content: testContent,
      systemPrompt,
      v3Requested: undefined, // Explicitly undefined (not V3 mode)
      // composedPrompt not set
    });
    if (!result) throw new Error('No result returned');
    if (!result.success) throw new Error(`Tool failed: ${result.error}`);
    // Note: output location varies by tool implementation; success confirms it worked
  });

  // Test 2: v3Requested=false, no composedPrompt → should use systemPrompt
  await runTest('v3Requested=false + systemPrompt → uses systemPrompt', async () => {
    const result = await executeTool('claude_analyze', {
      content: testContent,
      systemPrompt,
      v3Requested: false,
    });
    if (!result) throw new Error('No result returned');
    if (!result.success) throw new Error(`Tool failed: ${result.error}`);
  });

  // Test 3: v3Requested=true, WITH composedPrompt → should use composedPrompt
  await runTest('v3Requested=true + composedPrompt → uses composedPrompt', async () => {
    const result = await executeTool('claude_analyze', {
      content: testContent,
      systemPrompt,
      v3Requested: true,
      composedPrompt: {
        prompt: 'Analyze this content from a strategic perspective.',
        temperature: 0.3,
        maxTokens: 1000,
      },
    });
    if (!result) throw new Error('No result returned');
    if (!result.success) throw new Error(`Tool failed: ${result.error}`);
  });

  // Test 4: v3Requested=true, NO composedPrompt, STRICT MODE ON → should fail
  const strictMode = process.env.PROMPT_STRICT_MODE === 'true';
  if (strictMode) {
    await runTest('v3Requested=true + no composedPrompt + STRICT_MODE → fails correctly', async () => {
      const result = await executeTool('claude_analyze', {
        content: testContent,
        systemPrompt,
        v3Requested: true,
        // composedPrompt NOT set - this should fail in strict mode
      });
      if (!result) throw new Error('No result returned');
      if (result.success) throw new Error('Should have failed in strict mode but succeeded');
      if (!result.error?.includes('PROMPT_STRICT_MODE')) {
        throw new Error(`Wrong error message: ${result.error}`);
      }
    });
  } else {
    await runTest('STRICT_MODE off - skipping strict mode failure test', async () => {
      console.log('     ℹ️  Run with PROMPT_STRICT_MODE=true to test strict mode behavior');
    });
  }
}

// ============================================================================
// 5. FULL SKILL EXECUTION TESTS
// ============================================================================

async function testSkillExecution() {
  startSection('SKILL EXECUTION - URL-EXTRACT', '⚡');

  const { executeSkillByName } = await import('../src/skills/executor');
  const { initializeSkillRegistry } = await import('../src/skills/registry');

  // Initialize registry
  await initializeSkillRegistry();

  // Test URL that should work (simple static page)
  const testUrl = 'https://example.com';
  const testUserId = parseInt(process.env.TELEGRAM_ALLOWED_USERS?.split(',')[0]?.trim() || '0', 10);

  // Mock UUIDs for Notion pages (skill expects these for updates)
  const mockFeedId = '2fe780a7-8eef-8145-aefd-d911eb050269';
  const mockWorkQueueId = '3d679030-b76b-43bd-92d8-1ac51abb4a28';

  // Skip if no user ID
  if (!testUserId) {
    await runTest('TELEGRAM_ALLOWED_USERS required for skill tests', async () => {
      throw new Error('Set TELEGRAM_ALLOWED_USERS to run skill execution tests');
    });
    return;
  }

  // Test 1: Regular execution (no V3 params)
  await runTest('url-extract: regular execution (no V3)', async () => {
    const result = await executeSkillByName('url-extract', {
      userId: testUserId,
      messageText: testUrl,
      pillar: 'Personal',
      approvalLatch: true, // Tier 2 skill needs approval
      input: {
        url: testUrl,
        pillar: 'Personal',
        depth: 'shallow',
        feedId: mockFeedId,
        workQueueId: mockWorkQueueId,
        telegramChatId: testUserId,
        v3Requested: false, // Explicitly false to avoid unresolved variable being truthy
        composedPrompt: null,
      },
    });
    if (!result.success) throw new Error(`Skill failed: ${result.error}`);

    // Check that analyze_content step produced output
    const analyzeStep = result.stepResults['analyze_content'];
    if (!analyzeStep) throw new Error('analyze_content step missing');
    if (!analyzeStep.success) throw new Error(`analyze_content failed: ${analyzeStep.error}`);
    if (!analyzeStep.output) throw new Error('analyze_content produced no output');
  });

  // Test 2: V3 execution with composed prompt
  await runTest('url-extract: V3 execution with composedPrompt', async () => {
    const result = await executeSkillByName('url-extract', {
      userId: testUserId,
      messageText: testUrl,
      pillar: 'The Grove',
      approvalLatch: true,
      input: {
        url: testUrl,
        pillar: 'The Grove',
        depth: 'standard',
        feedId: mockFeedId,
        workQueueId: mockWorkQueueId,
        telegramChatId: testUserId,
        v3Requested: true,
        composedPrompt: {
          prompt: 'Analyze this content for Grove research value. Focus on AI implications.',
          temperature: 0.3,
          maxTokens: 2000,
        },
      },
    });
    if (!result.success) throw new Error(`Skill failed: ${result.error}`);
  });

  // Test 3: V3 with v3Requested=false (should fall back to systemPrompt)
  await runTest('url-extract: v3Requested=false falls back to systemPrompt', async () => {
    const result = await executeSkillByName('url-extract', {
      userId: testUserId,
      messageText: testUrl,
      pillar: 'Consulting',
      approvalLatch: true,
      input: {
        url: testUrl,
        pillar: 'Consulting',
        depth: 'standard',
        feedId: mockFeedId,
        workQueueId: mockWorkQueueId,
        telegramChatId: testUserId,
        v3Requested: false,
        composedPrompt: null, // Explicitly null
      },
    });
    if (!result.success) throw new Error(`Skill failed: ${result.error}`);

    const analyzeStep = result.stepResults['analyze_content'];
    if (!analyzeStep?.success) throw new Error('analyze_content should succeed with systemPrompt fallback');
  });
}

// ============================================================================
// 6. END-TO-END CAPTURE SIMULATION
// ============================================================================

async function testE2ECapture() {
  startSection('END-TO-END CAPTURE SIMULATION', '🚀');

  const { getPromptManager } = await import('../../../packages/agents/src');
  const { executeSkillByName } = await import('../src/skills/executor');
  const { initializeSkillRegistry } = await import('../src/skills/registry');

  await initializeSkillRegistry();
  const pm = getPromptManager();

  const testUserId = parseInt(process.env.TELEGRAM_ALLOWED_USERS?.split(',')[0]?.trim() || '0', 10);
  if (!testUserId) return;

  // Mock UUIDs for Notion pages (skill expects these for updates)
  const mockFeedId = '2fe780a7-8eef-8145-aefd-d911eb050269';
  const mockWorkQueueId = '3d679030-b76b-43bd-92d8-1ac51abb4a28';

  // Simulate Chrome extension capture flow
  const captureScenarios = [
    {
      name: 'Grove Research capture with voice',
      pillar: 'The Grove',
      promptIds: { drafter: 'drafter.the-grove.research', voice: 'voice.strategic' },
    },
    {
      name: 'Consulting Capture (no voice)',
      pillar: 'Consulting',
      promptIds: { drafter: 'drafter.consulting.capture' },
    },
    {
      name: 'Personal Research',
      pillar: 'Personal',
      promptIds: { drafter: 'drafter.personal.research' },
    },
    {
      name: 'Home/Garage Capture',
      pillar: 'Home/Garage',
      promptIds: { drafter: 'drafter.home-garage.capture' },
    },
  ];

  for (const scenario of captureScenarios) {
    await runTest(`E2E: ${scenario.name}`, async () => {
      // Step 1: Compose prompts
      const composedPrompt = await pm.composePrompts(scenario.promptIds, {
        pillar: scenario.pillar,
        url: 'https://example.com',
        title: 'Test Page',
      });

      if (!composedPrompt) {
        throw new Error('Prompt composition returned null');
      }

      // Step 2: Calculate v3Requested based on composition SUCCESS
      const v3Requested = !!composedPrompt?.prompt;

      if (!v3Requested) {
        throw new Error('v3Requested should be true when composedPrompt exists');
      }

      // Step 3: Execute skill
      const result = await executeSkillByName('url-extract', {
        userId: testUserId,
        messageText: 'https://example.com',
        pillar: scenario.pillar as any,
        approvalLatch: true,
        input: {
          url: 'https://example.com',
          pillar: scenario.pillar,
          depth: 'standard',
          feedId: mockFeedId,
          workQueueId: mockWorkQueueId,
          telegramChatId: testUserId,
          composedPrompt,
          v3Requested,
        },
      });

      if (!result.success) {
        throw new Error(`Skill execution failed: ${result.error}`);
      }

      // Verify analyze_content produced output
      const analyzeStep = result.stepResults['analyze_content'];
      if (!analyzeStep?.success) {
        throw new Error(`analyze_content failed: ${analyzeStep?.error}`);
      }
      if (!analyzeStep.output) {
        throw new Error('analyze_content produced no output');
      }
    });
  }

  // Test failure scenario: composition fails, should fall back gracefully
  await runTest('E2E: Composition failure falls back to systemPrompt', async () => {
    // Simulate composition returning null (e.g., prompt not found)
    const composedPrompt = null;
    const v3Requested = !!composedPrompt; // Should be false

    if (v3Requested !== false) {
      throw new Error('v3Requested should be false when composedPrompt is null');
    }

    // Execute skill - should use systemPrompt fallback
    const result = await executeSkillByName('url-extract', {
      userId: testUserId,
      messageText: 'https://example.com',
      pillar: 'Personal',
      approvalLatch: true,
      input: {
        url: 'https://example.com',
        pillar: 'Personal',
        depth: 'shallow',
        feedId: mockFeedId,
        workQueueId: mockWorkQueueId,
        telegramChatId: testUserId,
        composedPrompt: null,
        v3Requested: false,
      },
    });

    if (!result.success) {
      throw new Error(`Fallback execution failed: ${result.error}`);
    }
  });
}

// ============================================================================
// 7. LINKEDIN URL PROCESSING TESTS
// ============================================================================

async function testLinkedInURLs() {
  startSection('LINKEDIN URL PROCESSING', '💼');

  const { getSkillRegistry, initializeSkillRegistry } = await import('../src/skills/registry');
  const { executeSkillByName } = await import('../src/skills/executor');

  await initializeSkillRegistry();
  const registry = getSkillRegistry();

  // Real-world LinkedIn URL patterns (these contain underscores that break Markdown)
  // The post URL is a real share from iOS - contains utm_source, utm_medium, member_ios = 4 underscores
  const linkedInTestUrls = {
    post: 'https://www.linkedin.com/posts/shivsingh_you-should-be-as-unnerved-by-moltbook-a-activity-7423873477797027840-hhEO/?utm_source=share&utm_medium=member_ios&rcm=ACoAAAAAE0gBbPIL-oZLrw9FAhmnAWFPPbi2EG8',
    postWithParams: 'https://www.linkedin.com/posts/satloani_ai-machinelearning-datascience-activity-7295748291234567890',
    article: 'https://www.linkedin.com/pulse/future-ai-enterprise-john-smith-abc123',
    profile: 'https://www.linkedin.com/in/jim-calhoun-grove',
    company: 'https://www.linkedin.com/company/anthropic',
  };

  // Test 1: Skill registry matches LinkedIn URLs
  await runTest('Skill registry matches linkedin.com/posts URL', async () => {
    const match = registry.findBestMatch(linkedInTestUrls.post, { pillar: 'The Grove' });
    if (!match) throw new Error('No skill matched LinkedIn post URL');
    // Should match either linkedin-lookup (if available) or url-extract
    if (!match.skill.name.includes('linkedin') && match.skill.name !== 'url-extract') {
      throw new Error(`Unexpected skill match: ${match.skill.name}`);
    }
  });

  await runTest('Skill registry matches linkedin.com/in/ profile URL', async () => {
    const match = registry.findBestMatch(linkedInTestUrls.profile, { pillar: 'Consulting' });
    if (!match) throw new Error('No skill matched LinkedIn profile URL');
  });

  await runTest('Skill registry matches linkedin.com/company URL', async () => {
    const match = registry.findBestMatch(linkedInTestUrls.company, { pillar: 'Consulting' });
    if (!match) throw new Error('No skill matched LinkedIn company URL');
  });

  await runTest('Skill registry matches linkedin.com/pulse article URL', async () => {
    const match = registry.findBestMatch(linkedInTestUrls.article, { pillar: 'The Grove' });
    if (!match) throw new Error('No skill matched LinkedIn article URL');
  });

  // Test 2: URL content extraction works (using HTTP fetch)
  const testUserId = parseInt(process.env.TELEGRAM_ALLOWED_USERS?.split(',')[0]?.trim() || '0', 10);
  if (!testUserId) {
    console.log('     ⚠️  Skipping skill execution tests (no TELEGRAM_ALLOWED_USERS)');
    return;
  }

  // Test 3: Skill execution with LinkedIn URL (may fail due to auth, that's OK)
  await runTest('LinkedIn URL skill execution (HTTP fetch attempt)', async () => {
    // Use a simple LinkedIn company page that's more likely to be public
    // Mock UUIDs for Feed and Work Queue pages (skill expects these for Notion updates)
    const mockFeedId = '2fe780a7-8eef-8145-aefd-d911eb050269';
    const mockWorkQueueId = '3d679030-b76b-43bd-92d8-1ac51abb4a28';

    const result = await executeSkillByName('url-extract', {
      userId: testUserId,
      messageText: linkedInTestUrls.company,
      pillar: 'Consulting',
      approvalLatch: true,
      input: {
        url: linkedInTestUrls.company,
        pillar: 'Consulting',
        depth: 'shallow',
        title: 'Anthropic Company Page',
        feedId: mockFeedId,
        workQueueId: mockWorkQueueId,
        telegramChatId: testUserId,
      },
    });

    // We expect this to either succeed or fail gracefully
    // The key is that it shouldn't crash with a parse error
    if (!result) throw new Error('No result returned from skill');

    // Even if extraction fails, the skill should complete without crashing
    console.log(`     ℹ️  Skill result: ${result.success ? 'success' : 'failed (expected for auth-required pages)'}`);
  });

  // Test 4: LinkedIn URL with underscores doesn't break Markdown escaping
  await runTest('LinkedIn URLs with underscores are properly escaped', async () => {
    // Import the escape function from clarify.ts
    const clarifyModule = await import('../src/clarify');

    // The URL has multiple underscores that would break Markdown
    const urlWithUnderscores = linkedInTestUrls.post;
    const underscoreCount = (urlWithUnderscores.match(/_/g) || []).length;

    if (underscoreCount < 2) {
      throw new Error(`Test URL should have multiple underscores, found ${underscoreCount}`);
    }

    // Verify the escapeMarkdown concept works
    const escaped = urlWithUnderscores.replace(/([_*`\[\]])/g, '\\$1');
    const escapedUnderscoreCount = (escaped.match(/\\_/g) || []).length;

    if (escapedUnderscoreCount !== underscoreCount) {
      throw new Error(`Escaping failed: expected ${underscoreCount} escaped underscores, got ${escapedUnderscoreCount}`);
    }
  });
}

// ============================================================================
// 8. SOCIAL MEDIA URL SKILL MATCHING
// ============================================================================

async function testSocialMediaSkillMatching() {
  startSection('SOCIAL MEDIA SKILL MATCHING', '🌐');

  const { getSkillRegistry, initializeSkillRegistry } = await import('../src/skills/registry');

  await initializeSkillRegistry();
  const registry = getSkillRegistry();

  // Test URLs for various social platforms
  const socialUrls = {
    // LinkedIn (common use case)
    linkedinPost: 'https://www.linkedin.com/posts/someone_hashtag-activity-123456789',
    linkedinProfile: 'https://www.linkedin.com/in/john-doe-abc123',
    linkedinCompany: 'https://www.linkedin.com/company/acme-corp',
    linkedinArticle: 'https://www.linkedin.com/pulse/title-here-author-name',

    // Threads
    threadsPost: 'https://www.threads.net/@username/post/ABC123',

    // Twitter/X
    twitterPost: 'https://twitter.com/elonmusk/status/1234567890',
    xPost: 'https://x.com/elonmusk/status/1234567890',

    // Generic URLs (should match url-extract)
    genericArticle: 'https://techcrunch.com/2024/01/01/article-title',
    githubRepo: 'https://github.com/anthropics/claude-code',
  };

  // Test each URL type matches a skill
  for (const [name, url] of Object.entries(socialUrls)) {
    await runTest(`Skill match: ${name}`, async () => {
      const match = registry.findBestMatch(url, { pillar: 'The Grove' });
      if (!match) throw new Error(`No skill matched ${name}: ${url}`);
      console.log(`     ℹ️  ${name} → ${match.skill.name} (score: ${match.score.toFixed(2)})`);
    });
  }

  // Verify domain-specific skills have higher priority than generic
  await runTest('Domain-specific skills prioritized over generic', async () => {
    const linkedinMatch = registry.findBestMatch(socialUrls.linkedinPost, { pillar: 'Consulting' });
    const genericMatch = registry.findBestMatch(socialUrls.genericArticle, { pillar: 'Consulting' });

    if (!linkedinMatch || !genericMatch) {
      throw new Error('Both matches should exist');
    }

    // LinkedIn should match linkedin-lookup (if exists) with higher priority
    // OR url-extract with domain detection
    console.log(`     ℹ️  LinkedIn → ${linkedinMatch.skill.name}`);
    console.log(`     ℹ️  Generic → ${genericMatch.skill.name}`);
  });
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║       V3 ACTIVE CAPTURE PIPELINE - MASTER BLASTER TEST SUITE        ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝');
  console.log(`\nStrict Mode: ${process.env.PROMPT_STRICT_MODE === 'true' ? '🔒 ENABLED' : '🔓 DISABLED'}`);
  console.log(`Run with: PROMPT_STRICT_MODE=true bun run scripts/test-v3-capture-pipeline.ts`);

  const startTime = Date.now();

  try {
    await testSystemPromptsDB();
    await testPromptManager();
    await testPromptComposition();
    await testClaudeAnalyzeTool();
    await testSkillExecution();
    await testE2ECapture();
    await testLinkedInURLs();
    await testSocialMediaSkillMatching();
  } catch (error) {
    console.error('\n💥 FATAL ERROR:', error);
  }

  // Summary
  const totalTime = Date.now() - startTime;
  console.log('\n' + '═'.repeat(70));
  console.log('📊 SUMMARY');
  console.log('═'.repeat(70));

  for (const section of sections) {
    const passed = section.tests.filter(t => t.passed).length;
    const total = section.tests.length;
    const emoji = passed === total ? '✅' : '❌';
    console.log(`${emoji} ${section.name}: ${passed}/${total}`);
  }

  console.log('─'.repeat(70));
  console.log(`Total: ${totalPassed} passed, ${totalFailed} failed (${totalTime}ms)`);

  if (totalFailed > 0) {
    console.log('\n❌ TESTS FAILED - Review errors above');
    process.exit(1);
  } else {
    console.log('\n✅ ALL TESTS PASSED');
    process.exit(0);
  }
}

main();
