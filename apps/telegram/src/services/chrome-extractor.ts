/**
 * Chrome Extension Integration
 *
 * Stub client for communicating with Atlas Chrome Extension.
 * Falls back gracefully when extension is not available.
 *
 * Enable by setting CHROME_EXTENSION_URL in .env
 */

import { logger } from '../logger';
import type {
  ExtractRequest,
  ExtractResponse,
  CalendarRequest,
  CalendarResponse,
  HealthCheckResponse,
  ChromeExtensionConfig,
  DEFAULT_CONFIG,
} from '@atlas/shared/chrome-extension-api';

// Re-export types for convenience
export type { ExtractResponse, CalendarResponse };

// Configuration from environment
const config: ChromeExtensionConfig = {
  httpUrl: process.env.CHROME_EXTENSION_URL || undefined,
  mode: process.env.CHROME_EXTENSION_URL ? 'http' : 'disabled',
  defaultTimeout: 30000,
  retry: {
    maxAttempts: 3,
    backoffMs: 1000,
  },
};

/**
 * Check if Chrome extension integration is enabled
 */
export function isExtensionEnabled(): boolean {
  return config.mode !== 'disabled' && !!config.httpUrl;
}

/**
 * Extract content from a URL via Chrome extension
 *
 * @returns ExtractResponse if successful, null if extension unavailable
 */
export async function extractViaChromeExtension(
  url: string,
  timeout?: number
): Promise<ExtractResponse | null> {
  if (!isExtensionEnabled()) {
    logger.debug('Chrome extension disabled, skipping browser extraction');
    return null;
  }

  const request: ExtractRequest = {
    url,
    timeout: timeout || config.defaultTimeout,
    requestId: `extract-${Date.now()}`,
  };

  try {
    const response = await fetch(`${config.httpUrl}/api/extract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(request.timeout!),
    });

    if (!response.ok) {
      logger.warn('Chrome extension extraction failed', {
        status: response.status,
        url,
      });
      return null;
    }

    const result: ExtractResponse = await response.json();
    logger.info('Chrome extension extraction successful', {
      url,
      source: result.source,
      hasContent: !!result.content?.text,
    });

    return result;
  } catch (error) {
    logger.warn('Chrome extension unavailable', {
      error: error instanceof Error ? error.message : String(error),
      url,
    });
    return null; // Graceful fallback
  }
}

/**
 * Perform calendar action via Chrome extension
 *
 * @returns CalendarResponse if successful, null if extension unavailable
 */
export async function calendarViaChromeExtension(
  request: CalendarRequest
): Promise<CalendarResponse | null> {
  if (!isExtensionEnabled()) {
    logger.debug('Chrome extension disabled, skipping calendar action');
    return null;
  }

  try {
    const response = await fetch(`${config.httpUrl}/api/calendar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...request,
        requestId: request.requestId || `calendar-${Date.now()}`,
      }),
      signal: AbortSignal.timeout(config.defaultTimeout),
    });

    if (!response.ok) {
      logger.warn('Chrome extension calendar action failed', {
        status: response.status,
        action: request.action,
      });
      return null;
    }

    const result: CalendarResponse = await response.json();
    logger.info('Chrome extension calendar action successful', {
      action: request.action,
      success: result.success,
    });

    return result;
  } catch (error) {
    logger.warn('Chrome extension calendar unavailable', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Check Chrome extension health
 */
export async function checkExtensionHealth(): Promise<HealthCheckResponse | null> {
  if (!isExtensionEnabled()) {
    return null;
  }

  try {
    const response = await fetch(`${config.httpUrl}/api/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      return null;
    }

    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Get extension status for health checks
 */
export function getExtensionStatus(): {
  enabled: boolean;
  mode: string;
  url?: string;
} {
  return {
    enabled: isExtensionEnabled(),
    mode: config.mode,
    url: config.httpUrl,
  };
}
