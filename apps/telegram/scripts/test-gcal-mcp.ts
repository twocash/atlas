/**
 * Smoke test: verify Google Calendar MCP server starts and lists tools.
 * Run: bun run scripts/test-gcal-mcp.ts
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { resolve } from 'path';

// Credentials live at primary worktree (gitignored, not in sprint worktrees)
const credsPath = process.env.GOOGLE_OAUTH_CREDENTIALS
  || 'C:/github/atlas/config/gcp-oauth.keys.json';

async function main() {
  console.log('[test] Starting Google Calendar MCP server...');
  console.log(`[test] Credentials: ${credsPath}`);

  const transport = new StdioClientTransport({
    command: 'npx',
    args: ['-y', '@cocal/google-calendar-mcp'],
    env: { ...process.env, GOOGLE_OAUTH_CREDENTIALS: credsPath } as Record<string, string>,
  });

  const client = new Client(
    { name: 'Atlas-Test', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  await client.connect(transport);
  console.log('[test] Connected!');

  const result = await client.listTools();
  console.log(`[test] Tools (${result.tools.length}):`);
  for (const tool of result.tools) {
    console.log(`  - ${tool.name}: ${(tool.description || '').substring(0, 80)}`);
  }

  // Quick live test: list calendars
  try {
    const calendars = await client.callTool({ name: 'list-calendars', arguments: {} });
    console.log('\n[test] Calendars:');
    const content = calendars.content as Array<{ type: string; text?: string }>;
    for (const c of content) {
      if (c.type === 'text' && c.text) {
        // Print first 500 chars
        console.log(c.text.substring(0, 500));
      }
    }
  } catch (err) {
    console.error('[test] list-calendars failed:', err);
  }

  await transport.close();
  console.log('\n[test] Done.');
}

main().catch(err => {
  console.error('[test] FAILED:', err);
  process.exit(1);
});
