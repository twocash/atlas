/**
 * Awakening Report Formatter
 *
 * Console-friendly output for awakening validation results.
 * Same visual pattern as bridge health check output.
 *
 * @module @atlas/shared/awakening
 */

import type { AwakeningReport } from './types';

const STATUS_ICONS: Record<string, string> = {
  pass: '\u2705',  // ✅
  warn: '\u26A0\uFE0F',  // ⚠️
  fail: '\u274C',  // ❌
};

/**
 * Format an awakening report for console output.
 */
export function formatAwakeningReport(report: AwakeningReport): string {
  const lines: string[] = [];

  lines.push('');
  lines.push('  Autonomaton Awakening Validation');
  lines.push(`  Surface: ${report.surface} | ${report.checkedAt}`);
  lines.push('  ' + '-'.repeat(50));

  for (const check of report.checks) {
    const icon = STATUS_ICONS[check.status] || '?';
    lines.push(`  ${icon} ${check.message}`);
  }

  lines.push('  ' + '-'.repeat(50));

  const { total, passed, warned, failed } = report.summary;
  const statusLine = `  ${passed}/${total} passed`;
  const extras: string[] = [];
  if (warned > 0) extras.push(`${warned} warned`);
  if (failed > 0) extras.push(`${failed} failed`);
  const suffix = extras.length > 0 ? ` (${extras.join(', ')})` : '';

  lines.push(statusLine + suffix);

  if (report.canAwaken) {
    lines.push('  System can awaken.');
  } else {
    lines.push('  SYSTEM CANNOT AWAKEN — critical checks failed.');
  }

  lines.push('');

  return lines.join('\n');
}
