#!/usr/bin/env bun
/**
 * CEX-002 Smoke Test — Jina Reader × Threads Extraction
 *
 * Tests different header configurations against real Threads URLs
 * to find a working recipe per Jim's Jina tuning protocol:
 *   1. X-Target-Selector (strip nav chrome)
 *   2. X-Wait-For-Selector (wait for SPA hydration)
 *   3. X-With-Shadow-Dom (flatten Meta's Shadow DOM)
 *
 * Usage:
 *   bun run scripts/test-jina-threads.ts
 *   bun run scripts/test-jina-threads.ts --url https://threads.net/...
 *   bun run scripts/test-jina-threads.ts --config 3   # run specific config only
 */

// Bun auto-loads .env from CWD — run from apps/telegram/ directory
// For worktrees: symlink or copy the production .env

const JINA_API_KEY = process.env.JINA_API_KEY;
const JINA_BASE_URL = "https://r.jina.ai/";

if (!JINA_API_KEY) {
  console.error("❌ JINA_API_KEY not found in .env");
  process.exit(1);
}

// ─── Test URLs (real Threads posts from Feed 2.0) ─────────────

const TEST_URLS = [
  "https://www.threads.net/@peteryang/post/DGXDzOCJOBe",   // Peter Yang AI infrastructure (Jim's test)
  "https://www.threads.net/@simplpear/post/DU-tZ30DE4Z",   // From test fixtures
];

// ─── Header Configurations to Test ────────────────────────────

interface JinaConfig {
  name: string;
  description: string;
  headers: Record<string, string>;
}

const CONFIGS: JinaConfig[] = [
  {
    name: "Config 0: Current (no selectors, text format)",
    description: "What we have now — no target/wait selectors, text format, removeSelector for nav",
    headers: {
      "x-return-format": "text",
      "x-retain-images": "none",
      "x-remove-selector": "header, nav, [role=\"banner\"]",
      "x-no-cache": "true",
      "x-timeout": "20",
    },
  },
  {
    name: "Config 1: Protocol baseline (main + article + shadow)",
    description: "Jim's protocol: target=main, wait=article, shadow=true, markdown",
    headers: {
      "x-target-selector": "main",
      "x-wait-for-selector": "article",
      "x-with-shadow-dom": "true",
      "x-return-format": "markdown",
      "x-no-cache": "true",
      "x-timeout": "25",
    },
  },
  {
    name: "Config 2: Protocol + text format",
    description: "Same as Config 1 but text format (strip markdown noise)",
    headers: {
      "x-target-selector": "main",
      "x-wait-for-selector": "article",
      "x-with-shadow-dom": "true",
      "x-return-format": "text",
      "x-no-cache": "true",
      "x-timeout": "25",
    },
  },
  {
    name: "Config 3: Article-only target + shadow",
    description: "Target article directly (narrower than main), shadow DOM",
    headers: {
      "x-target-selector": "article",
      "x-wait-for-selector": "article",
      "x-with-shadow-dom": "true",
      "x-return-format": "text",
      "x-no-cache": "true",
      "x-timeout": "25",
    },
  },
  {
    name: "Config 4: Shadow DOM only (no selectors)",
    description: "Just add shadow DOM flattening to current config — minimal change",
    headers: {
      "x-with-shadow-dom": "true",
      "x-return-format": "text",
      "x-retain-images": "none",
      "x-remove-selector": "header, nav, [role=\"banner\"]",
      "x-no-cache": "true",
      "x-timeout": "25",
    },
  },
  {
    name: "Config 5: main + shadow + text (no wait)",
    description: "Target main with shadow DOM but no wait-for (in case wait-for causes timeout)",
    headers: {
      "x-target-selector": "main",
      "x-with-shadow-dom": "true",
      "x-return-format": "text",
      "x-retain-images": "none",
      "x-no-cache": "true",
      "x-timeout": "30",
    },
  },
  {
    name: "Config 6: body wait + shadow (broadest possible)",
    description: "Wait for body (guaranteed to exist), flatten shadow DOM, target main",
    headers: {
      "x-target-selector": "main",
      "x-wait-for-selector": "body",
      "x-with-shadow-dom": "true",
      "x-return-format": "text",
      "x-no-cache": "true",
      "x-timeout": "30",
    },
  },
];

// ─── Jina Request ─────────────────────────────────────────────

async function testJina(url: string, config: JinaConfig): Promise<{
  status: number;
  contentLength: number;
  hasRealContent: boolean;
  snippet: string;
  error?: string;
  durationMs: number;
}> {
  const jinaUrl = `${JINA_BASE_URL}${url}`;
  const headers: Record<string, string> = {
    Accept: "application/json",
    Authorization: `Bearer ${JINA_API_KEY}`,
    ...config.headers,
  };

  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 45_000);

    const response = await fetch(jinaUrl, {
      headers,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const durationMs = Date.now() - start;

    if (!response.ok) {
      return {
        status: response.status,
        contentLength: 0,
        hasRealContent: false,
        snippet: `HTTP ${response.status}: ${response.statusText}`,
        error: `${response.status} ${response.statusText}`,
        durationMs,
      };
    }

    const data = await response.json() as any;
    const content = data.data?.content || data.data?.text || "";
    const title = data.data?.title || "";

    // Check for login wall signals
    const loginSignals = ["log in", "sign up", "create account", "join threads", "instagram"];
    const isLoginWall = loginSignals.some(s => content.toLowerCase().includes(s) && content.length < 500);

    // Check for real content (not just nav/boilerplate)
    const strippedContent = content
      .replace(/https?:\/\/[^\s]+/g, "")  // strip URLs
      .replace(/[#*_\[\]()]/g, "")         // strip markdown
      .trim();

    const hasRealContent = strippedContent.length > 100 && !isLoginWall;

    // First 200 chars as snippet
    const snippet = content.substring(0, 300).replace(/\n/g, " ").trim();

    return {
      status: response.status,
      contentLength: content.length,
      hasRealContent,
      snippet,
      durationMs,
      ...(isLoginWall ? { error: "LOGIN WALL DETECTED" } : {}),
    };
  } catch (err: any) {
    return {
      status: 0,
      contentLength: 0,
      hasRealContent: false,
      snippet: "",
      error: err.message || String(err),
      durationMs: Date.now() - start,
    };
  }
}

// ─── Main ─────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const customUrl = args.find((a, i) => args[i - 1] === "--url");
  const configFilter = args.find((a, i) => args[i - 1] === "--config");

  const urls = customUrl ? [customUrl] : TEST_URLS;
  const configsToTest = configFilter
    ? [CONFIGS[parseInt(configFilter)]]
    : CONFIGS;

  console.log("═══════════════════════════════════════════════════════");
  console.log("  CEX-002 Smoke Test — Jina × Threads Extraction");
  console.log("═══════════════════════════════════════════════════════");
  console.log(`  URLs: ${urls.length}`);
  console.log(`  Configs: ${configsToTest.length}`);
  console.log(`  Total requests: ${urls.length * configsToTest.length}`);
  console.log("═══════════════════════════════════════════════════════\n");

  const results: Array<{
    url: string;
    config: string;
    status: number;
    contentLength: number;
    hasRealContent: boolean;
    snippet: string;
    error?: string;
    durationMs: number;
  }> = [];

  for (const url of urls) {
    console.log(`\n🔗 URL: ${url}\n${"─".repeat(60)}`);

    for (const cfg of configsToTest) {
      process.stdout.write(`  ⏳ ${cfg.name}...`);
      const result = await testJina(url, cfg);
      results.push({ url, config: cfg.name, ...result });

      const icon = result.hasRealContent ? "✅" : result.error ? "❌" : "⚠️";
      console.log(
        `\r  ${icon} ${cfg.name}` +
        `\n     Status: ${result.status} | Content: ${result.contentLength} chars | ${result.durationMs}ms` +
        (result.error ? `\n     Error: ${result.error}` : "") +
        `\n     Snippet: ${result.snippet.substring(0, 150)}...` +
        `\n`
      );
    }
  }

  // ─── Summary ──────────────────────────────────────────────

  console.log("\n═══════════════════════════════════════════════════════");
  console.log("  SUMMARY");
  console.log("═══════════════════════════════════════════════════════\n");

  const winners = results.filter(r => r.hasRealContent);
  const losers = results.filter(r => !r.hasRealContent);

  if (winners.length > 0) {
    console.log(`✅ WORKING CONFIGS (${winners.length}):`);
    for (const w of winners) {
      console.log(`   ${w.config} → ${w.contentLength} chars in ${w.durationMs}ms`);
    }
  } else {
    console.log("❌ NO WORKING CONFIGS FOUND");
  }

  if (losers.length > 0) {
    console.log(`\n❌ FAILED CONFIGS (${losers.length}):`);
    for (const l of losers) {
      console.log(`   ${l.config} → ${l.error || `${l.contentLength} chars (too short)`}`);
    }
  }

  console.log("\n═══════════════════════════════════════════════════════\n");
}

main().catch(console.error);
