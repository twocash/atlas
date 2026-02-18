#!/usr/bin/env npx tsx
/**
 * Work Queue 2.0 → Dev Pipeline Migration
 *
 * CRITICAL: This script performs the comprehensive cleanup and migration
 * approved by Jim on 2026-02-01.
 *
 * Phases:
 * 1. Create Feed entry documenting garbage cleanup
 * 2. Archive garbage chat captures (35 items)
 * 3. Archive test/validation items (6 items)
 * 4. Archive duplicates (5 items)
 * 5. Migrate dev items to Dev Pipeline with intelligent context (14 items)
 * 6. Update URL items to proper Research (4 items)
 * 7. Fix metadata on remaining items
 */

import { Client } from '@notionhq/client';
import { config } from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { NOTION_DB } from '@atlas/shared/config';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env'), override: true });

const notion = new Client({ auth: process.env.NOTION_API_KEY });

// Canonical IDs from @atlas/shared/config
const WORK_QUEUE_ID = NOTION_DB.WORK_QUEUE;
const DEV_PIPELINE_ID = NOTION_DB.DEV_PIPELINE;
const FEED_ID = NOTION_DB.FEED;

// ============================================================================
// PHASE 1: GARBAGE ITEMS TO ARCHIVE (35 items)
// ============================================================================
const GARBAGE_ITEMS = [
  { id: '2f9780a7-8eef-8106-8fb8-e98a4b6011cc', title: 'That link is also incorrect. Log a bug...' },
  { id: '2f9780a7-8eef-8107-b394-e8b40d56ff22', title: 'what skills do you have installed?' },
  { id: '2f9780a7-8eef-810b-b73a-ef2087e04c70', title: 'How is research coming?' },
  { id: '2f9780a7-8eef-810d-8f5c-d2c7469b5df1', title: 'see if you can tackle this now, i made some updates...' },
  { id: '2f9780a7-8eef-810f-8e6a-cdd3afaa9fd5', title: 'do you want to update the Notion database table...' },
  { id: '2f9780a7-8eef-810f-93ca-d878b77a299a', title: 'try re-dispatching that research task...' },
  { id: '2f9780a7-8eef-810f-99fa-e1bb1ab46804', title: 'Log a bug' },
  { id: '2f9780a7-8eef-810f-bc97-ef387d243c39', title: 'any updates you can see on those bugs?' },
  { id: '2f9780a7-8eef-8117-99d2-eb398964c60b', title: 'I think i\'m going to reboot you with some new capabilities...' },
  { id: '2f9780a7-8eef-811c-ad0b-eab22927e814', title: 'yes!' },
  { id: '2f9780a7-8eef-811d-beba-d6a9b61e3821', title: 'Pit crew! And yes structure as sprints' },
  { id: '2f9780a7-8eef-8120-b666-dd09ffa8c626', title: 'can you check on the statu sof 2026-01-31-classification...' },
  { id: '2f9780a7-8eef-8121-b276-fddc159fe8b5', title: 'give me a link to what was completed...' },
  { id: '2f9780a7-8eef-8121-bb29-de279d34a36a', title: 'I want you to plan a feature for a dev queue...' },
  { id: '2f9780a7-8eef-8123-8189-d787ad9ba863', title: 'this is the linkedin header image from my first post...' },
  { id: '2f9780a7-8eef-8128-8240-d0c310a2cf89', title: 'so you were able to fix that yourself?' },
  { id: '2f9780a7-8eef-812a-941c-dc854e109dd6', title: 'https://www.notion.so/Research-Jottie-io... (duplicate URL)' },
  { id: '2f9780a7-8eef-812a-ba9c-ec0b959002ab', title: 'import { McpManager }... (code snippet)' },
  { id: '2f9780a7-8eef-812d-b536-fbcbec1da235', title: 'By the way, I created the Work Queue views...' },
  { id: '2f9780a7-8eef-8132-8b7e-caa7a95e9469', title: 'you\'ve already used playright, look at what we\'ve done...' },
  { id: '2f9780a7-8eef-8132-bafe-ca9fb4a93092', title: 'ok. I\'m going to reboot. Brace for a moment\'s break!' },
  { id: '2f9780a7-8eef-8135-bca2-cb6b49640ef9', title: 'feel free to try another method!' },
  { id: '2f9780a7-8eef-8136-a898-e8998ea9ddc3', title: 'give me the link to to the bug and i\'ll fix it' },
  { id: '2f9780a7-8eef-813d-8b0c-ef14efd37946', title: 'Mind if i do a quick system reboot...' },
  { id: '2f9780a7-8eef-813f-8ec0-ee6f49a27dcc', title: 'try agani' },
  { id: '2f9780a7-8eef-813f-b4a3-f34ea0730ce7', title: 'Excellent! update your memory here' },
  { id: '2f9780a7-8eef-8141-bd56-d29a1b7e70fd', title: 'see if tehre\'s an agent issue' },
  { id: '2f9780a7-8eef-8145-a513-e5f12adb018a', title: 'Delete the stretch reminder' },
  { id: '2f9780a7-8eef-810a-8c5b-cc2392636f62', title: 'Run the script at ../../../etc/passwd (security test)' },
];

// ============================================================================
// PHASE 2: TEST ITEMS TO ARCHIVE (6 items)
// ============================================================================
const TEST_ITEMS = [
  { id: '2f8780a7-8eef-8117-a0e7-d18d79531cbb', title: 'Schema Validation Test - DELETE ME' },
  { id: '2f7780a7-8eef-81e6-b197-cf9e75ad021a', title: 'Validate Atlas 2.0 Pipeline' },
  { id: '2f8780a7-8eef-81cb-9aeb-ec26c5e039bc', title: 'Test: Research Agent Integration' },
  { id: '2f9780a7-8eef-8120-91ed-fd9fe2c3d295', title: 'TEST TEST' },
  { id: '2f9780a7-8eef-813c-868d-f29b69815bdd', title: 'Let\'s test the workflow with this image...' },
  { id: '2f9780a7-8eef-8145-8f78-ccab92586087', title: 'Now log a test P0 bug to validate flows...' },
];

// ============================================================================
// PHASE 3: DUPLICATES TO ARCHIVE (5 items)
// ============================================================================
const DUPLICATE_ITEMS = [
  // Atlas Operator Sprint duplicate
  { id: '2f8780a7-8eef-813b-803c-e5b410f77c83', title: 'Sprint: Atlas Operator Upgrade (duplicate)' },
  // Token Usage Tracking duplicate
  { id: '2f8780a7-8eef-816d-b3ad-d8faee0c251b', title: 'Token Usage Tracking (duplicate)' },
  // Stretch reminders (delete both per Jim)
  { id: '2f9780a7-8eef-8135-be92-ece0c0774b32', title: 'Remind me to stretch every minute' },
  { id: '2f9780a7-8eef-8142-93de-e8b096d25b12', title: 'Remind me to stretch every minute (duplicate)' },
  // Anthropic research duplicates (keep merged one: 2f8780a7-8eef-813e-82e4-ff7325008ed2)
  { id: '2f8780a7-8eef-812c-8396-dfcd71f15179', title: 'Research: Anthropic study on AI impact (superseded by merge)' },
  { id: '2f8780a7-8eef-81d0-8e81-fa1786c45a2c', title: 'Research: Anthropic research study (superseded by merge)' },
];

// ============================================================================
// PHASE 4: DEV PIPELINE MIGRATIONS (14 items with intelligent context)
// ============================================================================
interface DevPipelineItem {
  wqId: string;
  title: string;
  type: 'Bug' | 'Feature' | 'Hotfix' | 'Question';
  priority: 'P0' | 'P1' | 'P2' | 'P3';
  status: 'Dispatched' | 'In Progress' | 'Needs Review' | 'Shipped' | 'Closed';
  thread: string;
  skipIfExists?: string; // Skip if similar item exists with this pattern
}

const DEV_PIPELINE_MIGRATIONS: DevPipelineItem[] = [
  {
    wqId: '2f7780a7-8eef-81ed-b86c-ddde583df73f',
    title: 'SPRINT: Cognitive Router v1.0',
    type: 'Feature',
    priority: 'P1',
    status: 'Shipped',
    thread: `**What it unlocked:**
- Multi-model orchestration: Route tasks to optimal model (Haiku/Sonnet/GPT-4o-mini) based on complexity
- Cost optimization: Simple tasks use cheaper/faster models, complex tasks get full capability
- Quality optimization: Model selection based on task requirements, not one-size-fits-all
- Foundation for Agent SDK: Cognitive routing enables specialist agent spawning

**Related work:**
- Agent SDK Integration Sprint (shipped) builds on this router
- MCP Client Infrastructure uses router for tool orchestration

**Architecture:**
Two-layer routing: (1) complexity assessment → model selection, (2) provider abstraction for multi-vendor support.`,
  },
  {
    wqId: '2f8780a7-8eef-8153-ab37-c1dac5a05563',
    title: 'BUG: Skills endpoint returns wrong data (generic soft skills)',
    type: 'Bug',
    priority: 'P1',
    status: 'Shipped',
    thread: `**Root cause:** Tool wasn't connecting to proper skills registry; returned generic soft skills instead of Atlas capabilities.

**What the fix unlocked:**
- Accurate skill introspection: Atlas can now correctly report its actual capabilities
- Self-awareness foundation: Enables meta-cognitive features where Atlas reasons about its own tools
- Better user guidance: Users get accurate information about what Atlas can do

**Fix applied:** Connected skills endpoint to actual skill registry, not placeholder data.`,
  },
  {
    wqId: '2f8780a7-8eef-819f-a91c-d54e3fe845c1',
    title: 'BUG: Skills/tool output formatting is raw JSON',
    type: 'Bug',
    priority: 'P2',
    status: 'Dispatched',
    thread: `**Problem:** Tool outputs are returned as raw JSON dumps rather than formatted for human reading. Makes Telegram responses unreadable.

**What fixing this unlocks:**
- Human-readable responses: Tool results formatted appropriately for chat context
- Better UX: Users don't need to parse JSON mentally
- Cleaner conversation flow: Responses feel natural, not technical

**Proposed approach:**
- Add formatters per tool type (list, detail, summary)
- Modular formatting layer between tool execution and response generation
- Context-aware formatting (brief for simple queries, detailed for complex)

**Related:** Conversational UX Overhaul depends on this being fixed.`,
  },
  {
    wqId: '2f8780a7-8eef-81ad-9ff4-f7503551063e',
    title: 'FEATURE: Atlas Health Check Battery — Startup Validation',
    type: 'Feature',
    priority: 'P1',
    status: 'Dispatched',
    thread: `**What it unlocks:**
- Reliable deployments: Validate all dependencies (Notion, APIs, MCP servers) before accepting requests
- Early error detection: Catch configuration issues at startup, not during user interaction
- Self-diagnostics: Atlas can report its own health status
- Graceful degradation: Know which capabilities are available vs degraded

**Proposed checks:**
1. Notion connectivity (Feed, Work Queue, Dev Pipeline)
2. Anthropic API key validity
3. MCP server connectivity (all configured servers)
4. Environment variable completeness
5. File system access (logs, data directories)

**Architecture pattern:** Health check battery returns structured status object, used by:
- Startup sequence (fail fast if critical checks fail)
- /health command (user-visible status)
- Monitoring integration (external health probes)`,
  },
  {
    wqId: '2f8780a7-8eef-8148-9701-fd4ec27d301d',
    title: 'FEATURE: Multi-Machine Identity — Atlas [laptop] vs [grove-node-1]',
    type: 'Feature',
    priority: 'P3',
    status: 'Dispatched',
    thread: `**What it unlocks:**
- Attribution clarity: Know which machine performed which action
- Debugging: Trace issues to specific deployment
- Multi-node operation: Run Atlas on multiple machines with clear identity
- Audit trail: Feed entries show machine origin

**Implementation:**
- Add ATLAS_NODE_NAME environment variable
- Include in Feed entries, Work Queue assignments, status reports
- Show in /status command output

**Related work:**
- Feed as Activity Log (needs machine identity for attribution)
- Agent coordination (specialist agents need identity)

**Low priority because:** Current single-machine operation works; multi-machine is future-proofing.`,
  },
  {
    wqId: '2f8780a7-8eef-813a-a126-d5700b53ec5c',
    title: 'FEATURE: Agent Lightning Integration — Atlas Self-Improvement Loop',
    type: 'Feature',
    priority: 'P2',
    status: 'Dispatched',
    thread: `**What it unlocks:**
- Self-improving accuracy: Classification accuracy improves over time without manual tuning
- Data-driven prompts: Feed 2.0 telemetry becomes training signal
- Automated prompt optimization: Microsoft APO finds better prompts automatically

**How it works:**
1. Feed 2.0 captures classification decisions and corrections
2. Agent Lightning APO analyzes patterns in corrections
3. System prompt updated with learned improvements
4. Continuous improvement loop

**Dependencies:**
- Feed 2.0 telemetry (in place)
- Correction logging (partial - needs Was Reclassified flag usage)

**Risk:** APO can overfit; need validation set to prevent regression.`,
  },
  {
    wqId: '2f8780a7-8eef-8196-a4d6-d3f696d886ae',
    title: 'FEATURE: Daily Briefing — Proactive Status Reports',
    type: 'Feature',
    priority: 'P1',
    status: 'Shipped',
    thread: `**What it unlocked:**
- Proactive communication: Atlas reaches out, doesn't just respond
- Situational awareness: Jim sees blocked items, due dates, active work without asking
- Persistent Agent pattern: First step toward Atlas as always-on assistant
- Scheduled execution: Foundation for time-based triggers

**Implementation:**
- Scheduled briefings at 7am, 12:30pm, 6pm
- Pulls from Work Queue: blocked items, due dates, active work
- Telegram notification with summary

**Related work:**
- @atlas Notion Trigger (async workflow support) uses similar patterns
- Health Check Battery can feed into briefings`,
  },
  {
    wqId: '2f8780a7-8eef-81bc-bd69-ece73530a3da',
    title: 'FEATURE: Conversational UX Overhaul — Claude as Front Door',
    type: 'Feature',
    priority: 'P1',
    status: 'In Progress',
    thread: `**What it unlocks:**
- Natural interaction: Claude handles conversation, tools are invisible infrastructure
- Better UX: Users talk to Atlas, not to a tool dispatcher
- Graceful tool integration: Tool results woven into natural responses
- Error handling: Failures explained helpfully, not as JSON errors

**Current state:** Active development. Partially implemented via Cognitive Router.

**Remaining work:**
- Tool output formatting (blocked by raw JSON bug)
- Conversation memory improvements
- Multi-turn tool chains

**Dependencies:**
- BUG: Skills/tool output formatting is raw JSON (must fix first)
- Conversation continuity fix (in progress)`,
  },
  {
    wqId: '2f8780a7-8eef-8123-a3ed-f009a99fa588',
    title: 'FEATURE: Feed as Activity Log — Notify Feed on All WQ Mutations',
    type: 'Feature',
    priority: 'P1',
    status: 'Shipped',
    thread: `**What it unlocked:**
- Complete audit trail: Every Work Queue change logged to Feed
- Session continuity: New sessions can see what happened in previous ones
- Debugging: Trace back any state to its origin
- Transparency: Jim can see exactly what Atlas did and when

**Implementation:**
- Work Queue mutations trigger Feed entry creation
- Includes: what changed, why, by whom (which Atlas instance)
- Links back to Work Queue item

**Related work:**
- Multi-Machine Identity (machine attribution in Feed)
- Health Check Battery (can log startup to Feed)`,
  },
  {
    wqId: '2f8780a7-8eef-817a-9ad6-e0b3d1213adb',
    title: 'FEATURE: ATLAS Failsafe Documentation Complete',
    type: 'Feature',
    priority: 'P1',
    status: 'Shipped',
    thread: `**What it unlocked:**
- Operational safety: Emergency procedures documented
- Recovery protocols: Know how to recover from failures
- Onboarding: New operators can understand safety measures
- Compliance foundation: Documentation for future security audits

**Contents:**
- Emergency stop procedures
- System recovery protocols
- Operational safety measures
- Escalation paths`,
  },
  {
    wqId: '2f9780a7-8eef-8139-91d9-fd0d966efc23',
    title: 'BUG: Script failed: gmail-anthropic-invoices.ts',
    type: 'Bug',
    priority: 'P2',
    status: 'Dispatched',
    thread: `**Problem:** Script at scripts/gmail-anthropic-invoices.ts fails with exit code 1.

**Error:** "Cannot find..." (truncated in original)

**What fixing this unlocks:**
- Automated invoice processing: Pull Anthropic invoices from Gmail
- Cost tracking: Feed into token usage tracking
- Expense automation: Part of expense capture workflow

**Investigation needed:**
- Check for missing dependencies
- Verify Gmail API credentials
- Check file paths

**Related:** Token Usage Tracking feature may depend on this.`,
  },
  {
    wqId: '2f8780a7-8eef-8199-a6cd-c55d900e47b5',
    title: 'FEATURE: Setup: Dev Machine (Claude Code Command Center)',
    type: 'Feature',
    priority: 'P1',
    status: 'Shipped',
    thread: `**What it unlocked:**
- Persistent sessions: Claude Code runs continuously on dedicated machine
- Remote access: Parsec (remote desktop), Tailscale (secure networking)
- Persistent terminals: SSH + tmux for always-on sessions
- Development velocity: No more setup/teardown per session

**Infrastructure:**
- Dedicated dev machine for Claude Code
- Parsec for GUI access
- Tailscale for secure remote access
- SSH + tmux for persistent terminal sessions

**Enables:**
- Multi-machine Atlas deployment
- Always-on development environment
- Remote Grove work`,
  },
  {
    wqId: '2f8780a7-8eef-81e8-9b57-e8c9c5b52ae9',
    title: 'SPRINT: Agent SDK Integration',
    type: 'Feature',
    priority: 'P1',
    status: 'Shipped',
    thread: `**What it unlocked:**
- Specialist agent spawning: Atlas can create focused sub-agents for specific tasks
- Agent coordination: Multiple agents work together on complex problems
- Scalable intelligence: Break complex tasks into parallelizable agent work

**Foundation:**
- Built on Cognitive Router v1.0
- Uses MCP infrastructure for tool access
- Integrates with Work Queue for task tracking

**Enables:**
- Research Agent (deep dives)
- Draft Agent (content generation)
- Analysis Agent (data processing)`,
  },
  {
    wqId: '2f8780a7-8eef-8017-a82d-d6e1ec96c948',
    title: 'FEATURE: Enhancement DB for Atlas — Enable Upgrades Through Chat',
    type: 'Feature',
    priority: 'P1',
    status: 'Dispatched',
    thread: `**What it unlocks:**
- Version management: Track Atlas capabilities and versions
- Chat-driven upgrades: Request features/fixes via conversation
- Feature rollouts: Controlled release of new capabilities
- Self-documentation: Atlas knows its own version history

**Proposed schema:**
- Enhancement ID, Title, Description
- Status (Proposed, Approved, Implemented, Deprecated)
- Version introduced
- Dependencies

**Why important:**
- Closes loop between user feedback and implementation
- Enables Atlas to reason about its own capabilities
- Supports multi-version deployments`,
  },
];

// ============================================================================
// PHASE 5: URL ITEMS TO UPDATE (4 items)
// ============================================================================
const URL_ITEMS_TO_UPDATE = [
  {
    id: '2f7780a7-8eef-817d-b233-eabad4ebc6ec',
    newTitle: 'Research: George SL Liu Threads Post (AI/Tech)',
    pillar: 'The Grove',
  },
  {
    id: '2f8780a7-8eef-8163-87d8-d50452472da8',
    newTitle: 'Research: JD Johnson Threads Post (AI/Tech)',
    pillar: 'The Grove',
  },
  {
    id: '2f9780a7-8eef-810f-9723-c926c3128c18',
    newTitle: 'Research: Avantika Penumarty Threads Post',
    pillar: 'The Grove',
  },
  {
    id: '2f8780a7-8eef-81c5-b72b-e98f9f5660b2',
    newTitle: 'Research: Token-Level Data Filtering for AI Safety (ArXiv 2601.21571)',
    pillar: 'The Grove',
    notes: 'ArXiv paper: "Shaping capabilities with token-level data filtering" - AI safety research about removing undesired capabilities during pretraining via token filtering. Relevant to Grove alignment/safety interests.',
  },
];

// ============================================================================
// EXECUTION FUNCTIONS
// ============================================================================

async function createFeedEntry(title: string, body: string): Promise<string> {
  const response = await notion.pages.create({
    parent: { database_id: FEED_ID },
    properties: {
      'Entry': { title: [{ text: { content: title } }] },
      'Source': { select: { name: 'Atlas [laptop]' } },
      'Pillar': { select: { name: 'The Grove' } },
      'Request Type': { select: { name: 'Process' } },
      'Status': { select: { name: 'Done' } },
      'Date': { date: { start: new Date().toISOString().split('T')[0] } },
      'Notes': { rich_text: [{ text: { content: body.substring(0, 2000) } }] },
    },
  });
  return response.id;
}

async function archiveItems(items: { id: string; title: string }[], label: string): Promise<number> {
  console.log(`\n📦 Archiving ${label}...`);
  let count = 0;
  for (const item of items) {
    try {
      await notion.pages.update({
        page_id: item.id,
        archived: true,
      });
      console.log(`  ✓ Archived: ${item.title.substring(0, 50)}`);
      count++;
    } catch (e: any) {
      console.log(`  ✗ Failed: ${item.title.substring(0, 30)} - ${e.message}`);
    }
  }
  return count;
}

async function createDevPipelineItem(item: DevPipelineItem): Promise<string | null> {
  try {
    const response = await notion.pages.create({
      parent: { database_id: DEV_PIPELINE_ID },
      properties: {
        'Discussion': { title: [{ text: { content: item.title } }] },
        'Type': { select: { name: item.type } },
        'Priority': { select: { name: item.priority } },
        'Status': { select: { name: item.status } },
        'Handler': { select: { name: 'Pit Crew' } },
        'Requestor': { select: { name: 'Jim' } },
        'Thread': { rich_text: [{ text: { content: item.thread.substring(0, 2000) } }] },
        'Dispatched': { date: { start: new Date().toISOString().split('T')[0] } },
      },
    });
    return response.id;
  } catch (e: any) {
    console.log(`  ✗ Failed to create: ${item.title} - ${e.message}`);
    return null;
  }
}

async function updateWorkQueueItem(id: string, updates: Record<string, any>): Promise<boolean> {
  try {
    await notion.pages.update({
      page_id: id,
      properties: updates,
    });
    return true;
  } catch (e: any) {
    console.log(`  ✗ Failed to update ${id.substring(0, 8)}: ${e.message}`);
    return false;
  }
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const phase = args.find(a => a.startsWith('--phase='))?.split('=')[1];

  console.log('='.repeat(70));
  console.log('WORK QUEUE 2.0 → DEV PIPELINE MIGRATION');
  console.log('='.repeat(70));
  console.log(`Mode: ${dryRun ? 'DRY RUN (no changes)' : 'LIVE EXECUTION'}`);
  console.log(`Phase: ${phase || 'ALL'}`);
  console.log();

  // PHASE 1: Feed entry + Archive garbage
  if (!phase || phase === '1') {
    console.log('\n' + '─'.repeat(70));
    console.log('PHASE 1: Log garbage items to Feed, then archive');
    console.log('─'.repeat(70));

    const garbageList = GARBAGE_ITEMS.map(i => `• ${i.title}`).join('\n');
    const feedBody = `**Work Queue 2.0 Testing Period Cleanup**

During Atlas development (2026-01-29 to 2026-02-01), ${GARBAGE_ITEMS.length} items were incorrectly captured as work items. These were raw chat messages, status questions, and test inputs that should not have been created as tasks.

**Root cause:** Insufficient input validation in the classification system. Chat messages like "yes!", "ok", and status questions were misclassified as actionable work items.

**Items archived:**
${garbageList}

**Prevention:** Input validation improvements planned:
- Minimum title length requirement (10+ chars)
- Question detection (items ending in "?" → don't create task)
- Chat phrase detection ("yes", "ok", "try again" → don't create task)

This cleanup restores Work Queue 2.0 to a usable state with only legitimate work items.`;

    if (!dryRun) {
      console.log('Creating Feed entry...');
      const feedId = await createFeedEntry('Work Queue Cleanup: Testing Period Garbage Archived', feedBody);
      console.log(`✓ Feed entry created: ${feedId.substring(0, 8)}`);

      const archived = await archiveItems(GARBAGE_ITEMS, 'garbage chat captures');
      console.log(`✓ Archived ${archived}/${GARBAGE_ITEMS.length} garbage items`);
    } else {
      console.log(`Would create Feed entry with ${GARBAGE_ITEMS.length} items`);
      console.log(`Would archive ${GARBAGE_ITEMS.length} garbage items`);
    }
  }

  // PHASE 2: Archive test items
  if (!phase || phase === '2') {
    console.log('\n' + '─'.repeat(70));
    console.log('PHASE 2: Archive test/validation items');
    console.log('─'.repeat(70));

    if (!dryRun) {
      const archived = await archiveItems(TEST_ITEMS, 'test/validation items');
      console.log(`✓ Archived ${archived}/${TEST_ITEMS.length} test items`);
    } else {
      console.log(`Would archive ${TEST_ITEMS.length} test items`);
    }
  }

  // PHASE 3: Archive duplicates
  if (!phase || phase === '3') {
    console.log('\n' + '─'.repeat(70));
    console.log('PHASE 3: Archive duplicates');
    console.log('─'.repeat(70));

    if (!dryRun) {
      const archived = await archiveItems(DUPLICATE_ITEMS, 'duplicates');
      console.log(`✓ Archived ${archived}/${DUPLICATE_ITEMS.length} duplicate items`);
    } else {
      console.log(`Would archive ${DUPLICATE_ITEMS.length} duplicate items`);
    }
  }

  // PHASE 4: Migrate to Dev Pipeline
  if (!phase || phase === '4') {
    console.log('\n' + '─'.repeat(70));
    console.log('PHASE 4: Migrate dev items to Dev Pipeline');
    console.log('─'.repeat(70));

    // Check for existing items to avoid duplicates
    const existing = await notion.databases.query({
      database_id: DEV_PIPELINE_ID,
      page_size: 100,
    });
    const existingTitles = new Set(
      existing.results.map((p: any) =>
        p.properties.Discussion?.title?.[0]?.plain_text?.toLowerCase() || ''
      )
    );

    let created = 0;
    let skipped = 0;
    for (const item of DEV_PIPELINE_MIGRATIONS) {
      const titleLower = item.title.toLowerCase();
      const alreadyExists = existingTitles.has(titleLower) ||
        Array.from(existingTitles).some(t => t.includes(titleLower.substring(0, 30)) || titleLower.includes(t.substring(0, 30)));

      if (alreadyExists) {
        console.log(`  ⏭ Skipped (exists): ${item.title.substring(0, 50)}`);
        skipped++;
        continue;
      }

      if (!dryRun) {
        const id = await createDevPipelineItem(item);
        if (id) {
          console.log(`  ✓ Created: ${item.title.substring(0, 50)}`);
          created++;

          // Archive the original Work Queue item
          await notion.pages.update({ page_id: item.wqId, archived: true });
        }
      } else {
        console.log(`  Would create: ${item.title.substring(0, 50)}`);
        created++;
      }
    }

    console.log(`\n✓ Created ${created} Dev Pipeline items, skipped ${skipped} existing`);
  }

  // PHASE 5: Update URL items
  if (!phase || phase === '5') {
    console.log('\n' + '─'.repeat(70));
    console.log('PHASE 5: Convert URL items to proper Research');
    console.log('─'.repeat(70));

    for (const item of URL_ITEMS_TO_UPDATE) {
      if (!dryRun) {
        // Note: Status uses 'status' type in Work Queue 2.0, not 'select'
        const updates: Record<string, any> = {
          'Task': { title: [{ text: { content: item.newTitle } }] },
          'Type': { select: { name: 'Research' } },
          'Pillar': { select: { name: item.pillar } },
        };
        if ((item as any).notes) {
          updates['Notes'] = { rich_text: [{ text: { content: (item as any).notes } }] };
        }
        const success = await updateWorkQueueItem(item.id, updates);
        if (success) {
          console.log(`  ✓ Updated: ${item.newTitle.substring(0, 50)}`);
        }
      } else {
        console.log(`  Would update: ${item.newTitle.substring(0, 50)}`);
      }
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log('MIGRATION COMPLETE');
  console.log('='.repeat(70));
}

main().catch(console.error);
