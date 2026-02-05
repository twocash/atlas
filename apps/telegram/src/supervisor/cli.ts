#!/usr/bin/env bun
/**
 * Atlas Supervisor CLI
 *
 * Run with: bun run apps/telegram/src/supervisor/cli.ts [--dev]
 *
 * Options:
 *   --dev      Run in dev mode (prompts for worktree path)
 *   --path     Specify custom source path
 */

import { Supervisor } from './index';
import { createInterface } from 'readline';

async function main() {
  const args = process.argv.slice(2);
  const isDev = args.includes('--dev');
  const pathIndex = args.indexOf('--path');

  let sourcePath: string;

  if (pathIndex !== -1 && args[pathIndex + 1]) {
    sourcePath = args[pathIndex + 1];
  } else if (isDev) {
    // Prompt for worktree path in dev mode
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    sourcePath = await new Promise<string>((resolve) => {
      rl.question('Enter worktree path: ', (answer) => {
        rl.close();
        resolve(answer || 'C:\\github\\atlas\\apps\\telegram');
      });
    });
  } else {
    sourcePath = 'C:\\github\\atlas\\apps\\telegram';
  }

  console.log(`
╔═══════════════════════════════════════════════════════════╗
║           ATLAS SUPERVISOR                                ║
╠═══════════════════════════════════════════════════════════╣
║  Mode: ${isDev ? 'Development' : 'Production'}                                      ║
║  Source: ${sourcePath.substring(0, 45).padEnd(45)}  ║
╚═══════════════════════════════════════════════════════════╝
`);

  const supervisor = new Supervisor({
    mode: isDev ? 'dev' : 'production',
    sourcePath,
    pitCrewEnabled: true,
    errorThreshold: 3,
    telemetryInterval: 15 * 60 * 1000, // 15 minutes
  });

  // Handle shutdown
  process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down supervisor...');
    await supervisor.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('\n🛑 Shutting down supervisor...');
    await supervisor.stop();
    process.exit(0);
  });

  // Start supervisor
  await supervisor.start();

  console.log('👀 Supervisor running. Press Ctrl+C to stop.\n');
  console.log('Commands:');
  console.log('  status   - Show current status');
  console.log('  restart  - Restart the bot');
  console.log('  stop     - Stop supervisor\n');

  // Simple command interface
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  rl.on('line', async (line) => {
    const cmd = line.trim().toLowerCase();

    switch (cmd) {
      case 'status':
        const status = supervisor.getStatus();
        console.log('\n📊 Status:', JSON.stringify(status, null, 2), '\n');
        break;
      case 'restart':
        console.log('🔄 Restarting bot...');
        await supervisor.restart();
        break;
      case 'stop':
        console.log('🛑 Stopping...');
        await supervisor.stop();
        rl.close();
        process.exit(0);
        break;
      default:
        if (cmd) {
          console.log('Unknown command. Try: status, restart, stop');
        }
    }
  });
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
