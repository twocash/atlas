#!/usr/bin/env npx tsx
/**
 * Atlas Self-Update Script
 *
 * Pulls latest code and triggers a restart.
 * Can be called by Atlas via the update_self tool.
 *
 * Usage:
 *   bun run scripts/self-update.ts [--check-only]
 *
 * Options:
 *   --check-only  Just check if updates are available, don't apply
 */

import { execSync } from 'child_process';
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, '../../..');
const TELEGRAM_DIR = join(__dirname, '..');

const checkOnly = process.argv.includes('--check-only');

interface UpdateResult {
  success: boolean;
  hasUpdates: boolean;
  currentCommit: string;
  latestCommit?: string;
  commitsBehind?: number;
  commits?: string[];
  message: string;
  error?: string;
}

function run(cmd: string, cwd: string = ROOT_DIR): string {
  try {
    return execSync(cmd, { cwd, encoding: 'utf-8', timeout: 30000 }).trim();
  } catch (err: any) {
    throw new Error(`Command failed: ${cmd}\n${err.message}`);
  }
}

async function checkForUpdates(): Promise<UpdateResult> {
  try {
    // Get current commit
    const currentCommit = run('git rev-parse --short HEAD');
    const currentBranch = run('git rev-parse --abbrev-ref HEAD');

    // Fetch latest from remote
    run('git fetch origin');

    // Check if we're behind
    const behindCount = run(`git rev-list HEAD..origin/${currentBranch} --count`);
    const commitsBehind = parseInt(behindCount, 10);

    if (commitsBehind === 0) {
      return {
        success: true,
        hasUpdates: false,
        currentCommit,
        message: `Already up to date at ${currentCommit}`,
      };
    }

    // Get the commits we're missing
    const latestCommit = run(`git rev-parse --short origin/${currentBranch}`);
    const commitLog = run(`git log --oneline HEAD..origin/${currentBranch}`);
    const commits = commitLog.split('\n').filter(Boolean);

    return {
      success: true,
      hasUpdates: true,
      currentCommit,
      latestCommit,
      commitsBehind,
      commits,
      message: `${commitsBehind} update(s) available: ${currentCommit} → ${latestCommit}`,
    };
  } catch (err: any) {
    return {
      success: false,
      hasUpdates: false,
      currentCommit: 'unknown',
      message: 'Failed to check for updates',
      error: err.message,
    };
  }
}

async function applyUpdate(): Promise<UpdateResult> {
  const checkResult = await checkForUpdates();

  if (!checkResult.success) {
    return checkResult;
  }

  if (!checkResult.hasUpdates) {
    return checkResult;
  }

  try {
    // Stash any local changes
    const status = run('git status --porcelain');
    const hasLocalChanges = status.length > 0;

    if (hasLocalChanges) {
      console.log('Stashing local changes...');
      run('git stash');
    }

    // Pull latest
    console.log('Pulling latest code...');
    run('git pull origin');

    // Pop stash if we had changes
    if (hasLocalChanges) {
      console.log('Restoring local changes...');
      try {
        run('git stash pop');
      } catch {
        console.warn('Warning: Could not restore stashed changes (may have conflicts)');
      }
    }

    const newCommit = run('git rev-parse --short HEAD');

    // Trigger restart by touching the entry point (works with bun --watch)
    const triggerFile = join(TELEGRAM_DIR, 'src', 'index.ts');
    const now = new Date();
    writeFileSync(join(TELEGRAM_DIR, '.last-update'), now.toISOString());

    // Touch the file to trigger bun --watch reload
    const content = await Bun.file(triggerFile).text();
    await Bun.write(triggerFile, content);

    return {
      success: true,
      hasUpdates: true,
      currentCommit: newCommit,
      latestCommit: newCommit,
      commitsBehind: 0,
      commits: checkResult.commits,
      message: `Updated to ${newCommit}. Restart triggered.`,
    };
  } catch (err: any) {
    return {
      success: false,
      hasUpdates: checkResult.hasUpdates,
      currentCommit: checkResult.currentCommit,
      message: 'Failed to apply update',
      error: err.message,
    };
  }
}

// Main execution
async function main() {
  console.log('=== Atlas Self-Update ===\n');

  if (checkOnly) {
    console.log('Mode: Check only\n');
    const result = await checkForUpdates();
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.success ? 0 : 1);
  } else {
    console.log('Mode: Apply update\n');
    const result = await applyUpdate();
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.success ? 0 : 1);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

// Export for use as module
export { checkForUpdates, applyUpdate };
