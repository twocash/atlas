/**
 * Bridge Health Module — Startup validation + alerting orchestrator.
 *
 * Called from the bridge server startup sequence, BEFORE identity hydration.
 * Validates all Notion databases the bridge depends on and:
 *   - Blocks startup if critical databases (Feed, WQ, System Prompts) are unreachable
 *   - Logs warnings + creates Feed alerts for enrichment database failures
 *   - Prints structured console output (Telegram healthCheckOrDie() pattern)
 *
 * ADR-008: Fail fast, fail loud.
 */

import { validateDatabases, type ValidationReport } from './db-validator';
import { createHealthAlerts } from './feed-alerter';

// ─── Console Formatting ──────────────────────────────────

const CHECK = '\u2713'; // ✓
const WARN = '\u26A0';  // ⚠
const FAIL = '\u2717';  // ✗

function formatResult(accessible: boolean, criticality: string, label: string, detail?: string): string {
  if (accessible) {
    return `  ${CHECK} ${label}`;
  }
  const icon = criticality === 'critical' ? FAIL : WARN;
  const suffix = detail ? ` — ${detail}` : '';
  return `  ${icon} ${label}${suffix}`;
}

// ─── Public API ──────────────────────────────────────────

/**
 * Run startup database validation for the bridge surface.
 *
 * Prints structured console output and returns the report.
 * Does NOT call process.exit() — the caller decides startup behavior.
 *
 * @returns Validation report with categorized failures
 */
export async function runBridgeHealthCheck(): Promise<ValidationReport> {
  console.log('\n  Bridge Database Access Validation');
  console.log('  ─────────────────────────────────');

  const report = await validateDatabases('bridge');

  // Print results
  for (const result of report.results) {
    console.log(formatResult(
      result.accessible,
      result.criticality,
      result.label,
      result.accessible ? undefined : result.error?.split('.')[0],
    ));
  }

  console.log(`\n  ${report.totalPassed}/${report.totalChecked} databases accessible`);

  // Critical failures
  if (report.criticalFailures.length > 0) {
    console.error(
      `\n  ${FAIL} CRITICAL: ${report.criticalFailures.length} critical database(s) unreachable.`,
    );
    for (const f of report.criticalFailures) {
      console.error(`    - ${f.label} (${f.dbId})`);
    }
    console.error('  Bridge cannot start without critical databases.\n');
  }

  // Enrichment failures — create Feed alerts (non-blocking)
  if (report.enrichmentFailures.length > 0) {
    console.warn(
      `\n  ${WARN} ${report.enrichmentFailures.length} enrichment database(s) unreachable — operating in degraded mode.`,
    );

    // Only attempt Feed alerts if Feed itself is reachable
    if (report.allCriticalPassed) {
      try {
        const alertResults = await createHealthAlerts(report.enrichmentFailures);
        const created = alertResults.filter((a) => a.created).length;
        const deduped = alertResults.filter((a) => a.skippedReason === 'Duplicate alert exists').length;
        if (created > 0) {
          console.info(`  ${CHECK} Created ${created} Feed health alert(s)`);
        }
        if (deduped > 0) {
          console.info(`  ${CHECK} ${deduped} existing alert(s) already open`);
        }
      } catch (err) {
        console.warn('  Feed alerting failed (non-blocking):', (err as Error).message);
      }
    }
  }

  console.log('');
  return report;
}

/** Re-export types for consumers */
export type { ValidationReport, DbValidationResult } from './db-validator';
