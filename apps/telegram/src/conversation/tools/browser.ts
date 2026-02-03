/**
 * Browser Automation Tools
 *
 * Puppeteer-based browser automation for skills that need web content extraction.
 * Provides equivalent functionality to claude-in-chrome MCP tools but runs headless.
 *
 * Uses puppeteer-core with system Chrome for better Windows compatibility.
 *
 * Tools:
 * - browser_open_page: Open a URL and return page content
 * - browser_execute_js: Execute JavaScript on a page
 * - browser_get_text: Extract text content from current page
 * - browser_click: Click an element
 * - browser_close: Close browser instance
 */

import type Anthropic from '@anthropic-ai/sdk';
import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import { spawn, type ChildProcess } from 'child_process';
import { logger } from '../../logger';

// Browser instance management (singleton for efficiency)
let browserInstance: Browser | null = null;
let chromeProcess: ChildProcess | null = null;
const activePagesMap = new Map<string, Page>();
let pageIdCounter = 0;

// CDP debugging port - use a high port to avoid conflicts
const CDP_PORT = 9224;

// Chrome paths to try on Windows
const CHROME_PATHS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];

/**
 * Find Chrome executable
 */
async function findChrome(): Promise<string> {
  const { existsSync } = await import('fs');

  for (const chromePath of CHROME_PATHS) {
    if (existsSync(chromePath)) {
      return chromePath;
    }
  }

  throw new Error('Chrome not found. Please install Google Chrome.');
}

/**
 * Start Chrome with CDP debugging enabled
 */
async function startChrome(): Promise<void> {
  if (chromeProcess) {
    return; // Already running
  }

  const chromePath = await findChrome();
  logger.info('Starting Chrome for browser automation', { chromePath, port: CDP_PORT });

  const args = [
    `--remote-debugging-port=${CDP_PORT}`,
    '--headless=new', // New headless mode (Chrome 112+)
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-breakpad',
    '--disable-component-update',
    '--disable-default-apps',
    '--disable-dev-shm-usage',
    '--disable-extensions',
    '--disable-sync',
    '--no-sandbox',
    '--disable-gpu',
    'about:blank',
  ];

  chromeProcess = spawn(chromePath, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });

  // Wait for Chrome to start and be ready for connections
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Chrome startup timeout'));
    }, 15000);

    chromeProcess!.stderr?.on('data', (data) => {
      const text = data.toString();
      if (text.includes('DevTools listening')) {
        clearTimeout(timeout);
        logger.info('Chrome DevTools listening', { port: CDP_PORT });
        // Give it a moment to fully initialize
        setTimeout(resolve, 500);
      }
    });

    chromeProcess!.on('error', (err) => {
      clearTimeout(timeout);
      chromeProcess = null;
      reject(new Error(`Failed to start Chrome: ${err.message}`));
    });

    chromeProcess!.on('exit', (code) => {
      if (code !== null && code !== 0) {
        clearTimeout(timeout);
        chromeProcess = null;
        reject(new Error(`Chrome exited with code ${code}`));
      }
    });
  });
}

/**
 * Get or create browser instance via Puppeteer
 */
async function getBrowser(): Promise<Browser> {
  if (!browserInstance || !browserInstance.connected) {
    // Start Chrome if not running
    await startChrome();

    logger.info('Connecting to Chrome with Puppeteer');

    // Connect via Puppeteer
    browserInstance = await puppeteer.connect({
      browserURL: `http://127.0.0.1:${CDP_PORT}`,
      defaultViewport: null,
    });

    logger.info('Browser connected via Puppeteer');
  }
  return browserInstance;
}

/**
 * Generate unique page ID
 */
function generatePageId(): string {
  return `page_${++pageIdCounter}_${Date.now()}`;
}

/**
 * Browser automation tool definitions
 */
export const BROWSER_TOOLS: Anthropic.Tool[] = [
  {
    name: 'browser_open_page',
    description: 'Open a URL in a headless browser and return the page ID for subsequent operations. Use for sites that require JavaScript rendering.',
    input_schema: {
      type: 'object' as const,
      properties: {
        url: {
          type: 'string',
          description: 'The URL to open',
        },
        waitForSelector: {
          type: 'string',
          description: 'Optional CSS selector to wait for before returning',
        },
        timeout: {
          type: 'number',
          description: 'Timeout in milliseconds (default: 30000)',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'browser_get_text',
    description: 'Get the text content of a page opened with browser_open_page',
    input_schema: {
      type: 'object' as const,
      properties: {
        pageId: {
          type: 'string',
          description: 'The page ID returned from browser_open_page',
        },
        selector: {
          type: 'string',
          description: 'Optional CSS selector to get text from specific element',
        },
      },
      required: ['pageId'],
    },
  },
  {
    name: 'browser_execute_js',
    description: 'Execute JavaScript on a page and return the result',
    input_schema: {
      type: 'object' as const,
      properties: {
        pageId: {
          type: 'string',
          description: 'The page ID returned from browser_open_page',
        },
        code: {
          type: 'string',
          description: 'JavaScript code to execute. Can be async. Return value will be JSON-stringified.',
        },
      },
      required: ['pageId', 'code'],
    },
  },
  {
    name: 'browser_click',
    description: 'Click an element on the page',
    input_schema: {
      type: 'object' as const,
      properties: {
        pageId: {
          type: 'string',
          description: 'The page ID returned from browser_open_page',
        },
        selector: {
          type: 'string',
          description: 'CSS selector for the element to click',
        },
      },
      required: ['pageId', 'selector'],
    },
  },
  {
    name: 'browser_close_page',
    description: 'Close a browser page to free resources. Always call this when done with a page.',
    input_schema: {
      type: 'object' as const,
      properties: {
        pageId: {
          type: 'string',
          description: 'The page ID to close',
        },
      },
      required: ['pageId'],
    },
  },
  {
    name: 'browser_extract_links',
    description: 'Extract all links from a page',
    input_schema: {
      type: 'object' as const,
      properties: {
        pageId: {
          type: 'string',
          description: 'The page ID returned from browser_open_page',
        },
        filterDomain: {
          type: 'string',
          description: 'Optional: only return links NOT matching this domain (e.g., "threads.net" to exclude internal links)',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of links to return (default: 20)',
        },
      },
      required: ['pageId'],
    },
  },
];

/**
 * Execute browser tools
 */
export async function executeBrowserTools(
  toolName: string,
  input: Record<string, unknown>
): Promise<{ success: boolean; result: unknown; error?: string } | null> {
  switch (toolName) {
    case 'browser_open_page': {
      const { url, waitForSelector, timeout = 30000 } = input as {
        url: string;
        waitForSelector?: string;
        timeout?: number;
      };

      try {
        const browser = await getBrowser();
        const page = await browser.newPage();
        const pageId = generatePageId();

        logger.info('Opening page', { pageId, url });

        await page.goto(url, {
          timeout,
          waitUntil: 'networkidle2',
        });

        if (waitForSelector) {
          await page.waitForSelector(waitForSelector, { timeout });
        }

        activePagesMap.set(pageId, page);

        return {
          success: true,
          result: {
            pageId,
            title: await page.title(),
            url: page.url(),
          },
        };
      } catch (error) {
        logger.error('Failed to open page', { url, error });
        return {
          success: false,
          result: null,
          error: `Failed to open page: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }

    case 'browser_get_text': {
      const { pageId, selector } = input as { pageId: string; selector?: string };

      const page = activePagesMap.get(pageId);
      if (!page) {
        return {
          success: false,
          result: null,
          error: `Page not found: ${pageId}. It may have been closed.`,
        };
      }

      try {
        let text: string;
        if (selector) {
          const element = await page.$(selector);
          text = element ? await page.$eval(selector, (el) => el.innerText) : '';
        } else {
          text = await page.$eval('body', (el) => el.innerText);
        }

        // Truncate if too long
        const maxLength = 50000;
        if (text.length > maxLength) {
          text = text.substring(0, maxLength) + '\n\n[Content truncated...]';
        }

        return { success: true, result: text };
      } catch (error) {
        return {
          success: false,
          result: null,
          error: `Failed to get text: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }

    case 'browser_execute_js': {
      const { pageId, code } = input as { pageId: string; code: string };

      const page = activePagesMap.get(pageId);
      if (!page) {
        return {
          success: false,
          result: null,
          error: `Page not found: ${pageId}. It may have been closed.`,
        };
      }

      try {
        const result = await page.evaluate(code);
        return { success: true, result };
      } catch (error) {
        return {
          success: false,
          result: null,
          error: `JS execution failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }

    case 'browser_click': {
      const { pageId, selector } = input as { pageId: string; selector: string };

      const page = activePagesMap.get(pageId);
      if (!page) {
        return {
          success: false,
          result: null,
          error: `Page not found: ${pageId}. It may have been closed.`,
        };
      }

      try {
        await page.click(selector);
        // Wait for any navigation or dynamic content
        await new Promise((resolve) => setTimeout(resolve, 500));
        return { success: true, result: 'Clicked successfully' };
      } catch (error) {
        return {
          success: false,
          result: null,
          error: `Click failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }

    case 'browser_close_page': {
      const { pageId } = input as { pageId: string };

      const page = activePagesMap.get(pageId);
      if (page) {
        try {
          await page.close();
          activePagesMap.delete(pageId);
          logger.info('Closed page', { pageId });
          return { success: true, result: 'Page closed' };
        } catch (error) {
          activePagesMap.delete(pageId);
          return { success: true, result: 'Page closed (may have already been closed)' };
        }
      }
      return { success: true, result: 'Page not found (already closed)' };
    }

    case 'browser_extract_links': {
      const { pageId, filterDomain, limit = 20 } = input as {
        pageId: string;
        filterDomain?: string;
        limit?: number;
      };

      const page = activePagesMap.get(pageId);
      if (!page) {
        return {
          success: false,
          result: null,
          error: `Page not found: ${pageId}. It may have been closed.`,
        };
      }

      try {
        const links = await page.$$eval(
          'a[href]',
          (anchors, args) => {
            const [filterDom, maxLinks] = args as [string | undefined, number];
            return anchors
              .map((a) => ({
                text: a.innerText.trim().substring(0, 100),
                href: a.href,
              }))
              .filter((l) => {
                if (!l.href.startsWith('http')) return false;
                if (filterDom && l.href.includes(filterDom)) return false;
                return true;
              })
              .slice(0, maxLinks);
          },
          [filterDomain, limit] as [string | undefined, number]
        );

        return { success: true, result: links };
      } catch (error) {
        return {
          success: false,
          result: null,
          error: `Link extraction failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }

    default:
      return null;
  }
}

/**
 * Cleanup all browser resources
 * Call this on process exit
 */
export async function closeBrowser(): Promise<void> {
  for (const [pageId, page] of activePagesMap.entries()) {
    try {
      await page.close();
    } catch {
      // Ignore close errors
    }
    activePagesMap.delete(pageId);
  }

  if (browserInstance) {
    try {
      await browserInstance.disconnect();
    } catch {
      // Ignore
    }
    browserInstance = null;
  }

  // Kill Chrome process
  if (chromeProcess) {
    try {
      chromeProcess.kill('SIGTERM');
    } catch {
      // Ignore
    }
    chromeProcess = null;
  }

  logger.info('Browser closed');
}

// Cleanup on process exit
process.on('exit', () => {
  if (chromeProcess) {
    chromeProcess.kill('SIGTERM');
  }
});

process.on('SIGINT', async () => {
  await closeBrowser();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await closeBrowser();
  process.exit(0);
});
