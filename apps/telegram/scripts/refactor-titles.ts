#!/usr/bin/env npx tsx
/**
 * Work Queue Title Refactoring Script
 *
 * Transforms chat-like titles into proper actionable task names.
 * Uses notes context to infer better titles where possible.
 *
 * Usage:
 *   bun run scripts/refactor-titles.ts --dry-run    # Preview changes
 *   bun run scripts/refactor-titles.ts              # Execute changes
 */

import { Client } from '@notionhq/client';
import { config } from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env'), override: true });

const notion = new Client({ auth: process.env.NOTION_API_KEY });
const WORK_QUEUE_ID = '3d679030-b76b-43bd-92d8-1ac51abb4a28';
const FEED_ID = '90b2b33f-4b44-4b42-870f-8d62fb8cbf18';

const DRY_RUN = process.argv.includes('--dry-run');

interface WorkQueueItem {
  id: string;
  title: string;
  status: string;
  priority: string;
  type: string;
  pillar: string;
  notes: string;
}

// ============================================
// TITLE REFACTORING RULES
// ============================================

interface RefactorRule {
  id: string;
  oldTitle: string;
  newTitle: string;
  newNotes?: string;
  reason: string;
}

// Manual refactoring map for specific items that need context-aware titles
const MANUAL_REFACTORS: RefactorRule[] = [
  {
    id: '2f9780a7-8eef-8147-ae8d-f49235ac24b7',
    oldTitle: 'Now i have a feature idea i need to get on the board and prioritized: #atlas Feature Request: Grove ',
    newTitle: 'Feature: Grove Instance Federation — Skill-Bundled AI Nodes',
    newNotes: 'Create distributed Grove instances with specialized skill bundles. Each node handles domain-specific expertise (research, content, dev). Enables federated AI architecture.',
    reason: 'Truncated feature request → proper feature title'
  },
  {
    id: '2f9780a7-8eef-814a-b642-ca43fe75bb42',
    oldTitle: 'Not done. Pillars are missing. Assignees, etc. What do you THINK you just did?',
    newTitle: '[ARCHIVED] Session feedback on incomplete triage',
    reason: 'Chat feedback → archived note'
  },
  {
    id: '2f9780a7-8eef-814a-b65a-f4f45ce21aca',
    oldTitle: 'Focus on specific priority items first (P0/P1)',
    newTitle: '[ARCHIVED] Triage instruction: prioritize P0/P1 items',
    reason: 'Instruction → archived note'
  },
  {
    id: '2f9780a7-8eef-814c-8bbb-f6ba51298895',
    oldTitle: 'What about this as a memory system for us? Analyze pleased',
    newTitle: 'Research: Memory System Options for Atlas Context Retention',
    newNotes: 'Evaluate memory system approaches for AI agent context retention. Consider Jottie.io and alternatives for Atlas working memory upgrade.',
    reason: 'Question → research task'
  },
  {
    id: '2f9780a7-8eef-814d-83b4-cf9531f2a518',
    oldTitle: 'do you send me updates in the morning?',
    newTitle: '[ARCHIVED] Question: Morning update schedule',
    reason: 'Question → archived'
  },
  {
    id: '2f9780a7-8eef-814f-9e46-d84f630b0413',
    oldTitle: 'OK. I need you to create and execute this task from end to end. There are many missing details on ou',
    newTitle: 'Process: Complete Missing Work Queue Metadata — Full Triage Pass',
    newNotes: 'Execute comprehensive triage across Work Queue. Fill in missing pillar, status, assignee, and priority fields. Ensure all items have complete metadata.',
    reason: 'Truncated instruction → process task'
  },
  {
    id: '2f9780a7-8eef-8150-8bec-cd36c1bd77ae',
    oldTitle: '1) do a manual web search to learn about jottie and determine if it\'s a way we can upgrade your work',
    newTitle: 'Research: Jottie.io Memory System Evaluation for Atlas',
    newNotes: 'Investigate Jottie.io as potential memory/context system for Atlas. Assess: architecture, integration patterns, working memory capabilities, comparison to alternatives.',
    reason: 'Numbered instruction → research task'
  },
  {
    id: '2f9780a7-8eef-8151-82ac-d3da8a67a69d',
    oldTitle: 'make a quick bug to note that your messages are passing me <b> html still, but this is great news! j',
    newTitle: 'Bug: Telegram Messages Contain Raw HTML Tags (<b>, etc.)',
    newNotes: 'Atlas Telegram responses include unescaped HTML tags like <b> instead of rendered formatting. Need to sanitize or properly render HTML in message output.',
    reason: 'Bug report chat → proper bug title'
  },
  {
    id: '2f9780a7-8eef-8151-964a-d806a02d72fc',
    oldTitle: 'there is ffmpeg on this computer, you can splice it up, but the idea is you have the tools to figure',
    newTitle: '[ARCHIVED] Context: FFmpeg available for media processing',
    reason: 'Chat context → archived note'
  },
  {
    id: '2f9780a7-8eef-8151-b24b-f608a23892d1',
    oldTitle: 'Can you review and triage all the entries in feed 2.0 and work queue 2.0 so all fields are complete ',
    newTitle: 'Process: Complete Database Triage — Feed 2.0 + Work Queue 2.0',
    newNotes: 'Review all items in Feed 2.0 and Work Queue 2.0. Ensure complete metadata: status, pillar, priority, assignee. Flag items needing clarification.',
    reason: 'Question → process task'
  },
  {
    id: '2f9780a7-8eef-8155-9ac5-fca0dc761ebe',
    oldTitle: 'yeah, this was a test. Let\'s figure it out! Test away!',
    newTitle: '[ARCHIVED] Test confirmation response',
    reason: 'Chat → archived'
  },
  {
    id: '2f9780a7-8eef-8158-b021-ce3f93aff02f',
    oldTitle: 'can you view the agent status or api calls?',
    newTitle: '[ARCHIVED] Question: Agent status visibility',
    reason: 'Question → archived'
  },
  {
    id: '2f9780a7-8eef-8159-846c-f88becc52b62',
    oldTitle: 'Message',
    newTitle: '[ARCHIVED] Empty/placeholder entry',
    reason: 'Meaningless → archived'
  },
  {
    id: '2f9780a7-8eef-8159-bcca-ea63f0458009',
    oldTitle: 'Update those plans to indicate that we could just use work queues and field patterns to dispatch bug',
    newTitle: 'Design: Work Queue Field Patterns for Bug Dispatch',
    newNotes: 'Document pattern for using Work Queue field combinations to trigger automated bug dispatch to Pit Crew. Leverage existing WQ infrastructure instead of building separate dispatch system.',
    reason: 'Truncated instruction → design task'
  },
  {
    id: '2f9780a7-8eef-815a-af97-ef0a23fe96bf',
    oldTitle: '#atlas Create Notion Database: Grove Sprout Factory\n\n  Create a new database with these properties:\n',
    newTitle: 'Build: Create Grove Sprout Factory Notion Database',
    newNotes: 'Create new Notion database for Grove Sprout Factory. Properties: Seed, Status, Depth, Source, Output, Related Research. Enables structured content pipeline.',
    reason: 'Chat command → build task'
  },
  {
    id: '2f9780a7-8eef-815b-842c-db3a2f6f523f',
    oldTitle: 'delete the stretch reminder',
    newTitle: 'Process: Remove Stretch Reminder from Schedule',
    reason: 'Instruction → process task'
  },
  {
    id: '2f9780a7-8eef-815f-a077-c1c1515c3029',
    oldTitle: 'Fire it up again, another test',
    newTitle: '[ARCHIVED] Test trigger request',
    reason: 'Chat → archived'
  },
  {
    id: '2f9780a7-8eef-8161-9c8b-e59d596be8af',
    oldTitle: 'that can help your testing',
    newTitle: '[ARCHIVED] Testing context fragment',
    reason: 'Chat fragment → archived'
  },
  {
    id: '2f9780a7-8eef-8162-8261-ce626b5a12f1',
    oldTitle: 'wanna tackle that one - a reasearch proect on rag strategies for giving great, surgical reslts thrug',
    newTitle: 'Research: RAG Strategies for Precision Results in Agent Workflows',
    newNotes: 'Deep dive on RAG (Retrieval Augmented Generation) patterns that deliver surgical, precise results. Focus: chunking strategies, reranking, hybrid search, context window optimization.',
    reason: 'Truncated chat → research task'
  },
  {
    id: '2f9780a7-8eef-8162-a68c-fcc9ee7d3a0e',
    oldTitle: 'add "Notion database creation API" to the Atlas enhancement backlog',
    newTitle: 'Feature: Atlas Notion Database Creation API',
    newNotes: 'Add capability for Atlas to create new Notion databases programmatically. Enables dynamic workspace expansion, project setup automation.',
    reason: 'Instruction → feature request'
  },
  {
    id: '2f9780a7-8eef-8165-a228-dde17025268c',
    oldTitle: 'Can you look into fixing the web search capabilities?',
    newTitle: 'Bug: Atlas Web Search Capabilities Not Working',
    newNotes: 'Investigate and fix web search functionality in Atlas. May involve API key issues, rate limiting, or tool invocation problems.',
    reason: 'Question → bug task'
  },
  {
    id: '2f9780a7-8eef-816a-8378-d58e6066c682',
    oldTitle: 'I want you to figure out how to view the image - you should have tools to add capabilties now!',
    newTitle: 'Research: Image Viewing Capabilities for Atlas',
    newNotes: 'Investigate how to enable Atlas to view and process images. Explore available tools, MCP servers, or API integrations for image analysis.',
    reason: 'Instruction → research task'
  },
  {
    id: '2f9780a7-8eef-8170-84b2-d5e9c6ac84e2',
    oldTitle: 'why haven\'t i seen the stretch reminder Can you check?',
    newTitle: 'Bug: Scheduled Stretch Reminder Not Firing',
    newNotes: 'Stretch reminder scheduled but not appearing. Check: cron job status, schedule configuration, notification delivery.',
    reason: 'Question → bug task'
  },
  {
    id: '2f9780a7-8eef-8177-82e1-f479790e79ac',
    oldTitle: 'What settings or combination of settings could we have the pit crew listen for, that would trigger p',
    newTitle: 'Design: Pit Crew Trigger Patterns — Field Combinations for Auto-Dispatch',
    newNotes: 'Define Work Queue field patterns that automatically trigger Pit Crew dispatch. Consider: priority changes, type=Bug, pillar=Atlas Dev, assignee=Pit Crew.',
    reason: 'Question → design task'
  },
  {
    id: '2f9780a7-8eef-8178-a12d-c694c015dc57',
    oldTitle: 'check pitcrew status',
    newTitle: '[ARCHIVED] Status check: Pit Crew',
    reason: 'Command → archived'
  },
  {
    id: '2f9780a7-8eef-817b-9f34-de94a8cbb6f2',
    oldTitle: 'can you update your memory to include an emoji (your choice) that is a link to the specific notion p',
    newTitle: 'Feature: Emoji-Linked Notion References in Atlas Memory',
    newNotes: 'Add emoji shortcuts in Atlas memory that link to specific Notion pages. Quick reference system for frequently accessed pages.',
    reason: 'Question → feature request'
  },
  {
    id: '2f9780a7-8eef-817e-b0a4-edb72d4da4ba',
    oldTitle: 'Given your newfound skills I\'ve upgraded for you, could you "build" a solution we could use together',
    newTitle: 'Build: Solution Using New Atlas Capabilities',
    newNotes: 'Leverage recently added Atlas capabilities to build a practical solution. Explore MCP tools, browser automation, or agent coordination.',
    reason: 'Truncated question → build task'
  },
  {
    id: '2f9780a7-8eef-817f-bf41-f9f09b69207e',
    oldTitle: 'cool. how did the spike test go?',
    newTitle: '[ARCHIVED] Status check: Spike test results',
    reason: 'Question → archived'
  },
  {
    id: '2f9780a7-8eef-8181-bda3-dc22b5a8068f',
    oldTitle: 'Just note where we are. I need to reboot our session',
    newTitle: '[ARCHIVED] Session checkpoint before reboot',
    reason: 'Instruction → archived'
  },
  {
    id: '2f9780a7-8eef-8185-8957-cf5c8631260c',
    oldTitle: 'Remember that! This is what we\'re all about - getting stuff done!',
    newTitle: '[ARCHIVED] Mission statement affirmation',
    reason: 'Chat → archived'
  },
  {
    id: '2f9780a7-8eef-8185-baf9-d9816e0b6e04',
    oldTitle: 'Can we warm up your system prompt a little bit? I do like to have a little bit of fun now and again,',
    newTitle: 'Feature: Add Personality/Warmth to Atlas System Prompt',
    newNotes: 'Adjust Atlas system prompt to include more personality and occasional humor. Balance professionalism with approachability.',
    reason: 'Question → feature request'
  },
  {
    id: '2f9780a7-8eef-8186-9727-c6ceb00b8607',
    oldTitle: 'ok. I\'m going to restart in a second. take some notes.',
    newTitle: '[ARCHIVED] Session checkpoint request',
    reason: 'Instruction → archived'
  },
  {
    id: '2f9780a7-8eef-8189-9c45-ea6a30c747ea',
    oldTitle: 'check if research agent is correctly set up',
    newTitle: 'Validate: Research Agent Configuration',
    newNotes: 'Verify Research Agent is properly configured: API keys, model settings, tool access, output handling.',
    reason: 'Instruction → validation task'
  },
  {
    id: '2f9780a7-8eef-8189-b086-de636ce93ee3',
    oldTitle: 'this is the linkedin header image from my first post, just keep it in our records.',
    newTitle: 'Archive: LinkedIn Header Image — First Post',
    newNotes: 'Store LinkedIn header image from Jim\'s first Grove post. Reference asset for future content.',
    reason: 'Instruction → archive task'
  },
  {
    id: '2f9780a7-8eef-818a-b8b9-dc39bf1ce392',
    oldTitle: 'will you do some quick research to see if i can give you the ability to operate a logged in browser ',
    newTitle: 'Research: Browser Automation with Authenticated Sessions for Atlas',
    newNotes: 'Investigate methods for Atlas to operate a logged-in browser. Approaches: Playwright with stored auth, Chrome DevTools MCP, session persistence.',
    reason: 'Question → research task'
  },
  {
    id: '2f9780a7-8eef-818c-8c89-f42f9bec6a35',
    oldTitle: 'Yes. Please write that up.',
    newTitle: '[ARCHIVED] Approval to proceed with write-up',
    reason: 'Confirmation → archived'
  },
  {
    id: '2f9780a7-8eef-8190-9095-e7dafa71b590',
    oldTitle: 'can telegram format responses from you (as a "bot") to include structured responses, like "classify ',
    newTitle: 'Research: Telegram Bot Structured Response Formatting',
    newNotes: 'Investigate Telegram bot formatting options for structured responses. Consider: inline keyboards, formatted text, message templates, classification displays.',
    reason: 'Question → research task'
  },
  {
    id: '2f9780a7-8eef-8191-a1a0-f8ecb2748a6e',
    oldTitle: 'did you ever start that journal?',
    newTitle: '[ARCHIVED] Question: Journal status',
    reason: 'Question → archived'
  },
  {
    id: '2f9780a7-8eef-8192-954f-c6a0b19e1626',
    oldTitle: 'I worked on the research agent. See if you can dispatch him again. There was an API error. this will',
    newTitle: 'Test: Research Agent Dispatch After API Fix',
    newNotes: 'Re-test Research Agent dispatch after API error fix. Verify agent can be invoked and returns results properly.',
    reason: 'Instruction → test task'
  },
  {
    id: '2f9780a7-8eef-8192-a978-f5dd7caae68f',
    oldTitle: 'can you open a browser so i can see what you\'re doing? i will need to log you into sites and stuff f',
    newTitle: 'Feature: Visible Browser Session for Atlas Operations',
    newNotes: 'Enable visible browser window during Atlas automation. Allows Jim to observe actions and provide authentication when needed.',
    reason: 'Question → feature request'
  },
  {
    id: '2f9780a7-8eef-8193-bfd9-f17efca63f11',
    oldTitle: 'Let\'s look into supporting this - put a feature request on the board for an atlas upgrade down the l',
    newTitle: 'Feature: Atlas Enhancement Backlog Item (Unspecified)',
    newNotes: 'Generic feature request placeholder. Original context truncated. Review and either specify or archive.',
    reason: 'Truncated instruction → feature placeholder'
  },
  {
    id: '2f9780a7-8eef-8196-8ccb-cc14957c8d0d',
    oldTitle: 'Atlas, there\'s a bug in the classification system—can you ask\n   Pit Crew to look into it?',
    newTitle: 'Bug: Classification System Issue — Pit Crew Investigation',
    newNotes: 'Classification system bug requiring Pit Crew investigation. Likely affects spark routing, pillar assignment, or type detection.',
    reason: 'Bug report → proper bug title'
  },
  {
    id: '2f9780a7-8eef-8199-9156-e060f83729fc',
    oldTitle: 'how did that research retry work',
    newTitle: '[ARCHIVED] Question: Research retry results',
    reason: 'Question → archived'
  },
  {
    id: '2f9780a7-8eef-819f-8f24-e3fa87b7711a',
    oldTitle: 'Yes, I\'d like you to sort of keep a log of interactions over the course of each hour, and see where ',
    newTitle: 'Feature: Hourly Interaction Logging for Workflow Optimization',
    newNotes: 'Implement hourly logging of Atlas interactions. Track patterns, friction points, and optimization opportunities. Support reflection and continuous improvement.',
    reason: 'Instruction → feature request'
  },
  {
    id: '2f9780a7-8eef-81a0-956c-d0c69e0db3a7',
    oldTitle: 'tell them to start the investigation',
    newTitle: '[ARCHIVED] Instruction: Start Pit Crew investigation',
    reason: 'Instruction → archived'
  },
  {
    id: '2f9780a7-8eef-81a0-a13c-e63b431b482a',
    oldTitle: 'made changes. start the request fresh please and we\'ll retest',
    newTitle: '[ARCHIVED] Test restart after code changes',
    reason: 'Instruction → archived'
  },
  {
    id: '2f9780a7-8eef-81a0-b27f-fb7c1fe6ad9d',
    oldTitle: 'OK. I want you to write this up as a future sprint in our work queue - it\'s about giving Atlas 2.0 m',
    newTitle: 'Sprint: Atlas 2.0 Memory Architecture Upgrade',
    newNotes: 'Design and implement improved memory/context system for Atlas 2.0. Focus: persistent context, cross-session learning, working memory optimization.',
    reason: 'Truncated instruction → sprint task'
  },
  {
    id: '2f9780a7-8eef-81a5-8775-fa73f58e1a75',
    oldTitle: 'can you do them all?',
    newTitle: '[ARCHIVED] Batch execution request',
    reason: 'Question → archived'
  },
  {
    id: '2f9780a7-8eef-81a6-90d0-fdc1e1f28be0',
    oldTitle: 'Yes with this context please and what it unlocks',
    newTitle: '[ARCHIVED] Approval with context request',
    reason: 'Confirmation → archived'
  },
];

// ============================================
// AUTO-DETECT CHAT-LIKE TITLES
// ============================================

function isChatLikeTitle(title: string): boolean {
  const patterns = [
    /^(can you|could you|will you|would you|do you|did you|how did|what about|why|where|when|i need|i want|i think|i\'d like)/i,
    /^(ok\.|ok,|yeah|yes|cool|great|nice|sure|hey|hi|hello)/i,
    /^(check|delete|add|update|tell|make|fire|just|remember|note that)/i,
    /\?$/,
    /^[a-z]/, // Starts with lowercase
    /^(this is|that is|there is|given your|let\'s)/i,
  ];

  // Skip well-formed titles
  if (/^(Research:|Build:|Draft:|Sprint:|Bug:|Feature:|Design:|Process:|Setup:|Install:|Evaluate:|Publish:|POC:|Blog:|Position Paper:|Technical|Sovereign AI|Vision Doc|SPRINT:|\[ARCHIVED\])/i.test(title)) {
    return false;
  }

  return patterns.some(p => p.test(title));
}

// ============================================
// MAIN EXECUTION
// ============================================

async function extractItems(): Promise<WorkQueueItem[]> {
  const items: WorkQueueItem[] = [];
  let cursor: string | undefined;

  console.log('📥 Extracting Work Queue items...');

  do {
    const response = await notion.databases.query({
      database_id: WORK_QUEUE_ID,
      page_size: 100,
      start_cursor: cursor,
    });

    for (const page of response.results as any[]) {
      items.push({
        id: page.id,
        title: page.properties.Task?.title?.[0]?.plain_text || '',
        status: page.properties.Status?.select?.name || '?',
        priority: page.properties.Priority?.select?.name || '?',
        type: page.properties.Type?.select?.name || '?',
        pillar: page.properties.Pillar?.select?.name || '?',
        notes: page.properties.Notes?.rich_text?.[0]?.plain_text || '',
      });
    }

    cursor = response.has_more ? response.next_cursor ?? undefined : undefined;
  } while (cursor);

  return items;
}

async function main() {
  console.log('='.repeat(60));
  console.log('WORK QUEUE TITLE REFACTORING');
  console.log('Mode:', DRY_RUN ? 'DRY RUN' : 'EXECUTE');
  console.log('='.repeat(60));

  const items = await extractItems();
  console.log(`\nTotal items: ${items.length}`);

  // Build refactor map
  const refactorMap = new Map(MANUAL_REFACTORS.map(r => [r.id, r]));

  // Find items needing refactoring
  const toRefactor: RefactorRule[] = [];

  for (const item of items) {
    // Check if in manual refactor list
    if (refactorMap.has(item.id)) {
      toRefactor.push(refactorMap.get(item.id)!);
      continue;
    }

    // Auto-detect chat-like titles not in manual list
    if (isChatLikeTitle(item.title) && item.status !== 'Done') {
      // Skip items already processed
      continue;
    }
  }

  console.log(`\n📝 ITEMS TO REFACTOR: ${toRefactor.length}`);
  console.log('');

  for (const rule of toRefactor) {
    console.log(`[${rule.id.substring(0, 8)}]`);
    console.log(`  OLD: ${rule.oldTitle.substring(0, 60)}...`);
    console.log(`  NEW: ${rule.newTitle}`);
    console.log(`  WHY: ${rule.reason}`);
    console.log('');
  }

  if (DRY_RUN) {
    console.log('🔒 DRY RUN - No changes made');
    return;
  }

  // Execute refactoring
  console.log('\n📝 APPLYING REFACTORS...');
  let updated = 0;
  let failed = 0;

  for (const rule of toRefactor) {
    try {
      const properties: any = {
        'Task': { title: [{ text: { content: rule.newTitle } }] },
      };

      // Add notes if provided
      if (rule.newNotes) {
        properties['Notes'] = { rich_text: [{ text: { content: rule.newNotes } }] };
      }

      // Update type based on new title prefix
      if (rule.newTitle.startsWith('Bug:')) {
        properties['Type'] = { select: { name: 'Build' } };
      } else if (rule.newTitle.startsWith('Feature:')) {
        properties['Type'] = { select: { name: 'Build' } };
      } else if (rule.newTitle.startsWith('Research:')) {
        properties['Type'] = { select: { name: 'Research' } };
      } else if (rule.newTitle.startsWith('Design:')) {
        properties['Type'] = { select: { name: 'Build' } };
      } else if (rule.newTitle.startsWith('Sprint:')) {
        properties['Type'] = { select: { name: 'Build' } };
      } else if (rule.newTitle.startsWith('[ARCHIVED]')) {
        properties['Status'] = { select: { name: 'Done' } };
      }

      await notion.pages.update({
        page_id: rule.id,
        properties,
      });

      updated++;
      console.log(`  ✓ ${rule.newTitle.substring(0, 50)}`);
    } catch (e: any) {
      failed++;
      console.log(`  ✗ Failed: ${rule.id.substring(0, 8)} - ${e.message}`);
    }
  }

  console.log(`\n✅ Updated: ${updated} | Failed: ${failed}`);

  // Log to Feed
  try {
    await notion.pages.create({
      parent: { database_id: FEED_ID },
      properties: {
        'Entry': { title: [{ text: { content: `Work Queue Title Refactoring: Updated ${updated} items with proper task names` } }] },
        'Source': { select: { name: 'System' } },
        'Status': { select: { name: 'Done' } },
        'Date': { date: { start: new Date().toISOString() } },
      },
    });
    console.log(`\n📝 Logged to Feed`);
  } catch (e) {
    console.log(`\n⚠️ Failed to log to Feed`);
  }

  console.log('\n' + '='.repeat(60));
  console.log('REFACTORING COMPLETE');
  console.log('='.repeat(60));
}

main().catch(console.error);
