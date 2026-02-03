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

// Root endpoint
app.get('/', (c) => {
  return c.json({
    service: 'Atlas Status Server',
    version: '1.0.0',
    endpoints: {
      '/status': 'GET - Full status with activities',
      '/health': 'GET - Simple health check',
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
