/**
 * Health Alert Producer
 *
 * Bridges health check results → Feed 2.0 Alert entries.
 * Dual-purpose: serves Chrome extension (Alert cards) AND
 * self-healing pipeline (Keywords: self-improvement for Zone 1/2).
 *
 * @see EPIC: Action Feed Producer Wiring (P1 contract)
 */

import { logger } from '../logger';
import { createActionFeedEntry, updateFeedEntryAction } from '../notion';
import { runHealthChecks, type HealthCheckResult, type HealthReport } from '../health';
import { isFeatureEnabled } from '../config/features';
import type { ActionDataAlert } from '../types';
import { createHash } from 'crypto';

// ==========================================
// Types
// ==========================================

interface AlertEntry {
  /** Dedup key: hash of component + message */
  dedupKey: string;
  /** Feed 2.0 page ID */
  feedPageId: string;
  /** When the alert was created */
  createdAt: Date;
  /** Health check component name */
  component: string;
}

// ==========================================
// State
// ==========================================

let healthTimer: ReturnType<typeof setInterval> | null = null;

/** Track active alerts for dedup and auto-resolve */
const activeAlerts = new Map<string, AlertEntry>();

/** Default interval: 15 minutes */
const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;

// ==========================================
// Core Functions
// ==========================================

/**
 * Generate a dedup key from component name and message
 */
function dedupKey(component: string, message: string): string {
  return createHash('md5')
    .update(`${component}:${message}`)
    .digest('hex')
    .substring(0, 12);
}

/**
 * Determine zone for a health check failure.
 * Maps health component categories to permission zones:
 * - data/voice/config issues → Zone 1 (auto-execute, self-improvement)
 * - notion/claude connectivity → Zone 2 (auto-notify, self-improvement)
 * - env/critical → Zone 3 (approve, alert card only)
 */
function classifyHealthZone(check: HealthCheckResult): 1 | 2 | 3 {
  const category = check.name.split(':')[0];

  switch (category) {
    case 'data':
    case 'voice':
      return 1;
    case 'notion':
    case 'claude':
      return 2;
    case 'env':
    default:
      return 3;
  }
}

/**
 * Translate a failed/warning health check into an ActionDataAlert
 */
function translateHealthResult(check: HealthCheckResult): ActionDataAlert {
  return {
    alert_type: 'health_check',
    platform: check.name,
    breakage_type: check.status === 'fail' ? 'TOTAL' : 'WARNING',
  };
}

/**
 * Deduplicate alerts: max 1 per component per cycle.
 * Returns only checks that don't already have an active alert.
 */
function deduplicateAlerts(checks: HealthCheckResult[]): HealthCheckResult[] {
  return checks.filter(check => {
    const key = dedupKey(check.name, check.message);
    return !activeAlerts.has(key);
  });
}

/**
 * Create Feed 2.0 Alert entries for failed health checks.
 * Zone 1/2 issues get 'self-improvement' keyword for auto-repair.
 * Zone 3 issues get Alert cards only.
 */
async function createHealthAlerts(checks: HealthCheckResult[]): Promise<void> {
  const failures = checks.filter(c => c.status === 'fail' || c.status === 'warn');
  const newAlerts = deduplicateAlerts(failures);

  if (newAlerts.length === 0) return;

  for (const check of newAlerts) {
    const zone = classifyHealthZone(check);
    const alertData = translateHealthResult(check);
    const keywords: string[] = [];

    // Zone 1/2: tag for self-improvement pipeline
    if (zone <= 2) {
      keywords.push('self-improvement');
    }

    const title = `[Health] ${check.name}: ${check.message}`;

    try {
      const pageId = await createActionFeedEntry(
        'Alert',
        alertData,
        'Atlas [telegram]',
        title,
        keywords.length > 0 ? keywords : undefined
      );

      const key = dedupKey(check.name, check.message);
      activeAlerts.set(key, {
        dedupKey: key,
        feedPageId: pageId,
        createdAt: new Date(),
        component: check.name,
      });

      logger.info('Health alert created', {
        component: check.name,
        zone,
        pageId,
        selfImprovement: zone <= 2,
      });
    } catch (error) {
      logger.error('Failed to create health alert', {
        component: check.name,
        error,
      });
    }
  }
}

/**
 * Auto-resolve alerts that are no longer failing.
 * Marks the Feed entry as Actioned.
 */
async function resolveHealthAlerts(report: HealthReport): Promise<void> {
  const passingNames = new Set(
    report.checks
      .filter(c => c.status === 'pass')
      .map(c => c.name)
  );

  for (const [key, alert] of activeAlerts.entries()) {
    if (passingNames.has(alert.component)) {
      try {
        await updateFeedEntryAction(alert.feedPageId, {
          actionStatus: 'Actioned',
          actionedAt: new Date().toISOString(),
          actionedVia: 'Telegram',
        });

        activeAlerts.delete(key);

        logger.info('Health alert auto-resolved', {
          component: alert.component,
          pageId: alert.feedPageId,
        });
      } catch (error) {
        logger.error('Failed to resolve health alert', {
          component: alert.component,
          error,
        });
      }
    }
  }
}

/**
 * Run one health check cycle: check → alert → resolve
 */
async function runHealthCycle(): Promise<void> {
  try {
    const report = await runHealthChecks();

    // Create alerts for new failures
    await createHealthAlerts(report.checks);

    // Auto-resolve alerts that recovered
    await resolveHealthAlerts(report);

    logger.debug('Health alert cycle complete', {
      overall: report.overall,
      activeAlerts: activeAlerts.size,
    });
  } catch (error) {
    logger.error('Health alert cycle failed', { error });
  }
}

// ==========================================
// Lifecycle
// ==========================================

/**
 * Start the health alert producer.
 * Runs health checks on interval and emits Alert entries to Feed 2.0.
 */
export function startHealthAlertProducer(
  intervalMs: number = DEFAULT_INTERVAL_MS
): void {
  if (!isFeatureEnabled('healthAlertProducer')) {
    logger.info('Health alert producer disabled by feature flag');
    return;
  }

  if (healthTimer) {
    logger.warn('Health alert producer already running');
    return;
  }

  // Run first cycle after a short delay (let startup finish)
  setTimeout(() => {
    runHealthCycle();
  }, 30_000);

  // Then run on interval
  healthTimer = setInterval(() => {
    runHealthCycle();
  }, intervalMs);

  logger.info('Health alert producer started', {
    intervalMs,
    intervalMin: Math.round(intervalMs / 60_000),
  });
}

/**
 * Stop the health alert producer.
 */
export function stopHealthAlertProducer(): void {
  if (healthTimer) {
    clearInterval(healthTimer);
    healthTimer = null;
    logger.info('Health alert producer stopped');
  }
}
