/**
 * AnythingLLM MCP Server Wiring — Structural Tests
 *
 * Verifies that AnythingLLM MCP server is properly wired into
 * the Bridge's mcp-config.json and configureMcpServers() registration.
 *
 * Pattern: Source-code text inspection via Bun.file().text()
 * No mocking, no live API calls, no import-time side effects.
 */

import { describe, it, expect } from 'bun:test';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const thisDir = dirname(fileURLToPath(import.meta.url));
const bridgeRoot = resolve(thisDir, '..');

async function readSource(relativePath: string): Promise<string> {
  const fullPath = resolve(bridgeRoot, relativePath);
  return Bun.file(fullPath).text();
}

describe('AnythingLLM MCP wiring', () => {
  it('mcp-config.json contains anythingllm entry', async () => {
    const raw = await readSource('mcp-config.json');
    const config = JSON.parse(raw);
    expect(config.mcpServers).toHaveProperty('anythingllm');
    expect(config.mcpServers.anythingllm.command).toBe('bun');
    expect(config.mcpServers.anythingllm.args).toContain('packages/bridge/src/tools/anythingllm-mcp-server.ts');
  });

  it('mcp-config.json still contains atlas-browser (regression)', async () => {
    const raw = await readSource('mcp-config.json');
    const config = JSON.parse(raw);
    expect(config.mcpServers).toHaveProperty('atlas-browser');
    expect(config.mcpServers['atlas-browser'].command).toBe('bun');
  });

  it('configureMcpServers() registers anythingllm server', async () => {
    const serverSrc = await readSource('src/server.ts');
    expect(serverSrc).toContain('"anythingllm"');
    expect(serverSrc).toContain('anythingllm-mcp-server.ts');
  });

  it('configureMcpServers() still registers atlas-browser (regression)', async () => {
    const serverSrc = await readSource('src/server.ts');
    expect(serverSrc).toContain('"atlas-browser"');
    expect(serverSrc).toContain('mcp-server.ts');
  });

  it('configureMcpServers() passes env vars for AnythingLLM', async () => {
    const serverSrc = await readSource('src/server.ts');
    expect(serverSrc).toContain('ANYTHINGLLM_URL');
    expect(serverSrc).toContain('ANYTHINGLLM_API_KEY');
  });

  it('startup log lists registered servers', async () => {
    const serverSrc = await readSource('src/server.ts');
    expect(serverSrc).toContain('MCP servers registered');
  });

  it('warns when ANYTHINGLLM_API_KEY is missing', async () => {
    const serverSrc = await readSource('src/server.ts');
    expect(serverSrc).toContain('ANYTHINGLLM_API_KEY not set');
  });

  it('anythingllm-mcp-server.ts exists', () => {
    const serverPath = resolve(bridgeRoot, 'src/tools/anythingllm-mcp-server.ts');
    expect(existsSync(serverPath)).toBe(true);
  });
});
