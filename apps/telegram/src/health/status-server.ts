/**
 * Atlas Status Server - HTTP Bridge for Chrome Extension
 *
 * Provides an HTTP endpoint for the Chrome extension to poll
 * skill execution status. This bridges the gap between the
 * Telegram bot (Node/Bun) and Chrome extension (browser context).
 *
 * @see AtlasLink.tsx for the polling client
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from '../logger';
import type { Pillar } from '../conversation/types';

const app = new Hono();

// Enable CORS for Chrome extension
app.use('*', cors({
  origin: '*', // Allow any origin (chrome-extension:// URLs)
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type'],
}));

// =============================================================================
// ACTIVITY BUFFER
// =============================================================================

interface SkillActivity {
  skill: string;
  step: string;
  status: 'running' | 'success' | 'error' | 'waiting';
  logs: string[];
  timestamp: number;
}

// Ring buffer for last 50 activities
const activityBuffer: SkillActivity[] = [];
const MAX_ACTIVITIES = 50;

// Track current running skill
let currentSkill: string | null = null;

/**
 * Push a skill activity to the buffer
 * Called by logHudUpdate() in executor.ts
 */
export function pushActivity(
  skill: string,
  step: string,
  status: 'running' | 'success' | 'error' | 'waiting',
  logs: string[] = []
): void {
  activityBuffer.push({
    skill,
    step,
    status,
    logs,
    timestamp: Date.now(),
  });

  // Trim to max size (ring buffer behavior)
  if (activityBuffer.length > MAX_ACTIVITIES) {
    activityBuffer.shift();
  }

  // Track current skill
  if (status === 'running') {
    currentSkill = skill;
  } else if (status === 'success' || status === 'error') {
    // Clear after a brief delay to show completion state
    if (currentSkill === skill) {
      setTimeout(() => {
        if (currentSkill === skill) {
          currentSkill = null;
        }
      }, 2000);
    }
  }

  logger.debug('Activity pushed to status server', { skill, step, status });
}

/**
 * Get the current running skill (if any)
 */
export function getCurrentSkill(): string | null {
  return currentSkill;
}

/**
 * Clear all activities (for testing/reset)
 */
export function clearActivities(): void {
  activityBuffer.length = 0;
  currentSkill = null;
}

// =============================================================================
// HTTP ENDPOINTS
// =============================================================================

// Health check / status endpoint (main endpoint for Chrome extension polling)
app.get('/status', (c) => {
  return c.json({
    connected: true,
    uptime: process.uptime(),
    activities: activityBuffer.slice(-20), // Last 20 activities
    currentSkill,
    timestamp: Date.now(),
  });
});

// Simple health check
app.get('/health', (c) => {
  return c.json({ ok: true, timestamp: Date.now() });
});

// Test endpoint - push a fake activity to verify the bridge works
app.get('/test', (c) => {
  pushActivity('test-skill', 'step-1', 'running', ['Testing heartbeat bridge...']);
  setTimeout(() => pushActivity('test-skill', 'step-2', 'running', ['Processing...']), 500);
  setTimeout(() => pushActivity('test-skill', 'step-3', 'success', ['Test complete!']), 1000);
  return c.json({ ok: true, message: 'Test activities pushed - check Chrome extension' });
});

// Debug endpoint - check skill registry and matching
app.get('/debug/skills', async (c) => {
  try {
    const { getSkillRegistry } = await import('../skills/registry');
    const registry = getSkillRegistry();

    const url = c.req.query('url') || 'https://www.threads.com/test';
    const pillarInput = c.req.query('pillar') || 'Personal';
    // Cast to Pillar type for registry matching (debug endpoint, no validation needed)
    const pillar = pillarInput as 'The Grove' | 'Personal' | 'Consulting' | 'Home/Garage';

    // Get all enabled skills
    const skills = registry.getEnabled().map(s => ({
      name: s.name,
      tier: s.tier,
      triggers: s.triggers,
    }));

    // Try to find a match
    const match = registry.findBestMatch(url, { pillar });

    return c.json({
      totalSkills: skills.length,
      skills: skills.map(s => s.name),
      testUrl: url,
      testPillar: pillar,
      match: match ? {
        skill: match.skill.name,
        score: match.score,
        trigger: match.trigger,
      } : null,
    });
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

// =============================================================================
// PAGE CAPTURE ENDPOINT (Chrome Extension → Atlas)
// =============================================================================

/**
 * Prompt composition IDs for V3 Active Capture
 * Object form: { drafter?, voice?, lens? }
 */
interface PromptCompositionIds {
  drafter?: string;  // e.g. "drafter.capture", "drafter.research"
  voice?: string;    // e.g. "voice.grove-analytical", "voice.linkedin-punchy"
  lens?: string;     // e.g. "lens.strategic", "lens.tactical" (future)
}

interface CaptureRequest {
  url: string;
  title?: string;
  pillar?: string;
  selectedText?: string;
  // V3 Active Capture fields
  action?: string;   // e.g. "capture", "research"
  voice?: string;    // e.g. "grove-analytical", "consulting"
  promptIds?: PromptCompositionIds;
}

// Queue for captures (processed async)
const captureQueue: CaptureRequest[] = [];
let processingCapture = false;

app.post('/capture', async (c) => {
  try {
    const body = await c.req.json() as CaptureRequest;

    if (!body.url) {
      return c.json({ ok: false, error: 'URL is required' }, 400);
    }

    logger.info('Page capture received', { url: body.url, title: body.title, pillar: body.pillar });

    // Push activity for UI feedback
    pushActivity('page-capture', 'received', 'running', [`Capturing: ${body.title || body.url}`]);

    // Add to queue
    captureQueue.push(body);

    // Start processing if not already
    if (!processingCapture) {
      processCaptureQueue();
    }

    return c.json({
      ok: true,
      message: 'Page queued for capture',
      url: body.url,
    });
  } catch (err) {
    logger.error('Capture endpoint error', { error: err });
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

async function processCaptureQueue() {
  if (processingCapture || captureQueue.length === 0) return;

  processingCapture = true;

  while (captureQueue.length > 0) {
    const capture = captureQueue.shift()!;

    try {
      await processCapture(capture);
    } catch (err) {
      logger.error('Capture processing failed', { url: capture.url, error: err });
      pushActivity('page-capture', 'error', 'error', [String(err)]);
    }
  }

  processingCapture = false;
}

async function processCapture(capture: CaptureRequest) {
  const { url, title, pillar = 'Personal', selectedText, action, voice, promptIds } = capture;

  // V3 Active Capture: Log when new params received
  if (action || voice || promptIds) {
    logger.info('V3 Active Capture parameters received', {
      action,
      voice,
      promptIds,
      url: url.substring(0, 50),
    });
  }

  pushActivity('page-capture', 'creating-entries', 'running', ['Creating Feed and Work Queue entries...']);

  try {
    // Import Notion client
    const { Client } = await import('@notionhq/client');
    const notion = new Client({ auth: process.env.NOTION_API_KEY });

    // Database IDs (canonical)
    const FEED_DB = '90b2b33f-4b44-4b42-870f-8d62fb8cbf18';
    const WORK_QUEUE_DB = '3d679030-b76b-43bd-92d8-1ac51abb4a28';

    const entryTitle = title || url;
    const capturedAt = new Date().toISOString();

    // Create Feed entry
    // Properties based on action-log.ts which successfully creates Feed entries
    const feedEntry = await notion.pages.create({
      parent: { database_id: FEED_DB },
      properties: {
        'Entry': { title: [{ text: { content: entryTitle } }] },
        'Pillar': { select: { name: pillar } },
        'Source': { select: { name: 'Chrome Extension' } },
        'Request Type': { select: { name: 'Research' } },
        'Author': { select: { name: 'Atlas [Chrome]' } },
        'Status': { select: { name: 'Captured' } },
        'Date': { date: { start: new Date().toISOString() } },
      },
    });

    // Add source URL to Feed page body
    await notion.blocks.children.append({
      block_id: feedEntry.id,
      children: [
        {
          type: 'bookmark',
          bookmark: { url },
        },
      ],
    });

    // Create Work Queue entry
    // Properties based on dispatcher.ts which successfully creates WQ entries
    const wqEntry = await notion.pages.create({
      parent: { database_id: WORK_QUEUE_DB },
      properties: {
        'Task': { title: [{ text: { content: entryTitle } }] },
        'Status': { select: { name: 'Captured' } },
        'Priority': { select: { name: action === 'research' ? 'P1' : 'P2' } },
        'Type': { select: { name: 'Research' } },
        'Pillar': { select: { name: pillar } },
        'Assignee': { select: { name: 'Atlas [Chrome]' } },
        'Queued': { date: { start: new Date().toISOString().split('T')[0] } },
      },
    });

    // Add source URL to Work Queue page body
    await notion.blocks.children.append({
      block_id: wqEntry.id,
      children: [
        {
          type: 'callout',
          callout: {
            icon: { emoji: '🔗' },
            color: 'blue_background',
            rich_text: [{ type: 'text', text: { content: `Source: `, link: null } }, { type: 'text', text: { content: url, link: { url } } }],
          },
        },
        ...(selectedText ? [{
          type: 'quote' as const,
          quote: {
            rich_text: [{ type: 'text' as const, text: { content: selectedText.substring(0, 2000) } }],
          },
        }] : []),
      ],
    });

    pushActivity('page-capture', 'entries-created', 'success', ['Feed and Work Queue entries created']);

    // V3 Active Capture: Compose prompts using the shared composition core
    // This now uses the composePrompt function which handles drafter/voice resolution
    let composedPrompt: { prompt: string; temperature: number; maxTokens: number; metadata?: { drafter: string; voice?: string; lens?: string } } | null = null;

    if (promptIds && (promptIds.drafter || promptIds.voice || promptIds.lens)) {
      try {
        pushActivity('page-capture', 'composing-prompts', 'running', ['Composing prompts from V3 selection...']);

        // Use the shared composition core - it handles the full Drafter + Voice + Lens pattern
        const { composePrompt, getPillarFromSlug } = await import('../../../../packages/agents/src');

        // Extract action from drafter ID (e.g., "drafter.the-grove.research" → "research")
        const drafterParts = promptIds.drafter?.split('.') || [];
        const actionFromDrafter = drafterParts[drafterParts.length - 1] as 'research' | 'draft' | 'capture' | 'analysis' | 'summarize' || 'capture';

        // Resolve pillar from drafter ID or use the provided pillar
        // Type: 'The Grove' | 'Personal' | 'Consulting' | 'Home/Garage'
        let compositionPillar = pillar as 'The Grove' | 'Personal' | 'Consulting' | 'Home/Garage';
        if (drafterParts.length >= 2) {
          const pillarFromDrafter = getPillarFromSlug(drafterParts[1]);
          if (pillarFromDrafter) {
            compositionPillar = pillarFromDrafter;
          }
        }

        // Extract voice ID (strip "voice." prefix if present)
        const voiceId = promptIds.voice?.replace(/^voice\./, '');

        const result = await composePrompt({
          pillar: compositionPillar,
          action: actionFromDrafter,
          voice: voiceId,
          content: url,
          title: title || url,
          url,
        });

        composedPrompt = {
          prompt: result.prompt,
          temperature: result.temperature,
          maxTokens: result.maxTokens,
          metadata: result.metadata,
        };

        logger.info('V3 Prompt composition successful (shared core)', {
          drafter: result.metadata.drafter,
          voice: result.metadata.voice,
          action: actionFromDrafter,
          pillar: compositionPillar,
          promptLength: result.prompt.length,
        });
        pushActivity('page-capture', 'prompts-composed', 'success', ['Prompts composed successfully']);
      } catch (err) {
        logger.error('V3 Prompt composition failed', { promptIds, error: err });
        pushActivity('page-capture', 'prompts-error', 'error', ['Prompt composition failed, using default']);
        // Continue with default extraction
      }
    }

    // Now trigger skill execution for rich extraction
    pushActivity('page-capture', 'extracting', 'running', ['Running content extraction...']);

    const { getSkillRegistry, initializeSkillRegistry } = await import('../skills/registry');
    const { executeSkill } = await import('../skills/executor');

    // Ensure registry is initialized
    await initializeSkillRegistry();
    const registry = getSkillRegistry();

    // Find matching skill (url-extract will match if no domain-specific skill)
    const match = registry.findBestMatch(url, { pillar: pillar as any });

    if (match) {
      // Get owner's Telegram chat ID for notifications
      const ownerChatId = parseInt(process.env.TELEGRAM_ALLOWED_USERS?.split(',')[0]?.trim() || '0', 10);

      logger.info('Executing skill for capture', {
        skill: match.skill.name,
        url,
        hasComposedPrompt: !!composedPrompt,
        ownerChatId,
      });

      // V3: v3Requested is true when promptIds were explicitly provided
      // This flag tells claude_analyze to enforce strict mode for V3 captures
      const v3Requested = !!(promptIds && (promptIds.drafter || promptIds.voice || promptIds.lens));

      await executeSkill(match.skill, {
        userId: ownerChatId,
        messageText: url,
        pillar: pillar as Pillar,
        approvalLatch: true, // Chrome captures are user-initiated (clicked menu)
        input: {
          url,
          title: title || url,  // Page title for notifications
          pillar,  // Skill uses $input.pillar for prompts
          feedId: feedEntry.id,
          workQueueId: wqEntry.id,
          workQueueUrl: (wqEntry as any).url,  // Full Notion URL from API response
          feedUrl: (feedEntry as any).url,      // Full Notion URL for Feed entry
          depth: action === 'research' ? 'deep' : 'standard',
          telegramChatId: ownerChatId, // For notification step
          // V3: Pass composed prompt and request flag for skill to use
          composedPrompt,
          v3Requested,
        },
      });

      // Push rich result to Chrome extension feed
      const notionUrl = (wqEntry as any).url;
      pushActivity('page-capture', 'complete', 'success', [
        `✅ ${pillar} / ${title || url}`,
        `🔗 ${notionUrl}`,
        `View full analysis in Notion`,
      ]);
    } else {
      // No skill matched - still show the Notion entry
      const notionUrl = (wqEntry as any).url;
      pushActivity('page-capture', 'complete', 'success', [
        `✅ ${pillar} / ${title || url}`,
        `🔗 ${notionUrl}`,
        `Saved (no extraction skill matched)`,
      ]);
    }

  } catch (err) {
    logger.error('Capture processing error', { url, error: err });
    pushActivity('page-capture', 'error', 'error', [`Failed: ${String(err)}`]);
    throw err;
  }
}

// Root endpoint
app.get('/', (c) => {
  return c.json({
    service: 'Atlas Status Server',
    version: '1.1.0',
    endpoints: {
      '/status': 'GET - Full status with activities',
      '/health': 'GET - Simple health check',
      '/capture': 'POST - Capture page from Chrome extension',
    },
  });
});

// =============================================================================
// SERVER LIFECYCLE
// =============================================================================

let server: ReturnType<typeof Bun.serve> | null = null;

/**
 * Start the status server
 * @param port - Port to listen on (default: 3847)
 */
export function startStatusServer(port = 3847): void {
  if (server) {
    logger.warn('Status server already running');
    return;
  }

  try {
    server = Bun.serve({
      fetch: app.fetch,
      port,
    });

    logger.info('Status server started', { port, url: `http://localhost:${port}` });
  } catch (err) {
    logger.error('Failed to start status server', { error: err, port });
    throw err;
  }
}

/**
 * Stop the status server
 */
export function stopStatusServer(): void {
  if (server) {
    server.stop();
    server = null;
    logger.info('Status server stopped');
  }
}

/**
 * Check if the server is running
 */
export function isStatusServerRunning(): boolean {
  return server !== null;
}
