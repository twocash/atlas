/**
 * Smoke test for research response parsing
 * Run with: npx tsx packages/agents/test/research-parse-test.ts
 */

// Simulate parseResearchResponse logic inline for testing
interface ResearchFinding {
  claim: string;
  source: string;
  url: string;
  relevance?: number;
}

interface ResearchResult {
  summary: string;
  findings: ResearchFinding[];
  sources: string[];
  query: string;
  depth: string;
}

function parseResearchResponse(
  text: string,
  citations: Array<{ url: string; title: string }>
): ResearchResult {
  console.log("\n=== PARSING TEST ===");
  console.log("Raw text length:", text.length);
  console.log("Raw text preview:", text.substring(0, 300) + "...");

  let parsed: { summary?: string; findings?: ResearchFinding[]; sources?: string[] } | null = null;

  // Pattern 1: Standard markdown code block
  const codeBlockMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
  if (codeBlockMatch) {
    console.log("Found code block, attempting parse...");
    try {
      parsed = JSON.parse(codeBlockMatch[1]);
      console.log("✅ Code block JSON parsed OK");
    } catch (e) {
      console.log("❌ Code block parse failed:", e);
    }
  }

  // Pattern 2: Raw JSON object containing summary
  if (!parsed) {
    const jsonStart = text.indexOf('{"summary"');
    const jsonStart2 = text.indexOf('{ "summary"');
    const startIdx = jsonStart !== -1 ? jsonStart : jsonStart2;

    if (startIdx !== -1) {
      console.log("Found JSON object at index", startIdx);
      try {
        let braceCount = 0;
        let endIdx = startIdx;
        for (let i = startIdx; i < text.length; i++) {
          if (text[i] === '{') braceCount++;
          if (text[i] === '}') braceCount--;
          if (braceCount === 0) {
            endIdx = i + 1;
            break;
          }
        }
        const jsonStr = text.substring(startIdx, endIdx);
        parsed = JSON.parse(jsonStr);
        console.log("✅ Raw JSON parsed OK");
      } catch (e) {
        console.log("❌ Raw JSON parse failed:", e);
      }
    }
  }

  // Pattern 3: Entire response is JSON
  if (!parsed && text.trim().startsWith('{')) {
    console.log("Trying to parse entire response as JSON...");
    try {
      parsed = JSON.parse(text.trim());
      console.log("✅ Full response JSON parsed OK");
    } catch (e) {
      console.log("❌ Full response parse failed:", e);
    }
  }

  if (parsed?.summary) {
    console.log("\n✅ SUCCESS - Parsed data:");
    console.log("  Summary length:", parsed.summary.length);
    console.log("  Findings count:", parsed.findings?.length || 0);
    console.log("  Sources count:", parsed.sources?.length || 0);

    const cleanedSummary = parsed.summary
      .replace(/\\n\\n/g, '\n\n')
      .replace(/\\n/g, '\n')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\')
      .trim();

    return {
      summary: cleanedSummary,
      findings: parsed.findings || [],
      sources: parsed.sources || [],
      query: "test",
      depth: "standard",
    };
  }

  console.log("\n❌ FALLBACK - JSON parsing failed");
  return {
    summary: "PARSING FAILED",
    findings: [],
    sources: [],
    query: "test",
    depth: "standard",
  };
}

// ============================================
// TEST CASES
// ============================================

const testCases = [
  {
    name: "Standard code block format",
    input: `Here is my research:

\`\`\`json
{
  "summary": "TypeScript refactoring is the process of restructuring code without changing its behavior. Key tools include ESLint for static analysis and Prettier for formatting.",
  "findings": [
    {"claim": "ESLint catches code issues early", "source": "ESLint Docs", "url": "https://eslint.org"},
    {"claim": "Prettier enforces consistent formatting", "source": "Prettier", "url": "https://prettier.io"}
  ],
  "sources": ["https://eslint.org", "https://prettier.io"]
}
\`\`\``,
    citations: [],
  },
  {
    name: "Raw JSON (no code block)",
    input: `{"summary": "Vibe coding produces rapid prototypes but needs refactoring for production. Use incremental migration strategies.", "findings": [{"claim": "Incremental adoption reduces risk", "source": "TypeScript Handbook", "url": "https://typescriptlang.org"}], "sources": ["https://typescriptlang.org"]}`,
    citations: [],
  },
  {
    name: "JSON with escaped newlines",
    input: `\`\`\`json
{
  "summary": "First paragraph about refactoring.\\n\\nSecond paragraph with more details.\\n\\nThird paragraph with conclusions.",
  "findings": [{"claim": "Test claim", "source": "Test", "url": "https://example.com"}],
  "sources": ["https://example.com"]
}
\`\`\``,
    citations: [],
  },
  {
    name: "Prose followed by JSON",
    input: `Based on my research, here are the findings:

{"summary": "The research shows that TypeScript refactoring tools have evolved significantly.", "findings": [{"claim": "Modern IDEs support automated refactoring", "source": "VS Code", "url": "https://code.visualstudio.com"}], "sources": ["https://code.visualstudio.com"]}`,
    citations: [],
  },
  {
    name: "With grounding citations",
    input: `\`\`\`json
{
  "summary": "AI-assisted refactoring is emerging as a key trend.",
  "findings": [],
  "sources": []
}
\`\`\``,
    citations: [
      { url: "https://github.com/features/copilot", title: "GitHub Copilot" },
      { url: "https://cursor.sh", title: "Cursor IDE" },
    ],
  },
];

// Run tests
console.log("======================================");
console.log("RESEARCH PARSING SMOKE TEST");
console.log("======================================");

let passed = 0;
let failed = 0;

for (const tc of testCases) {
  console.log(`\n\n🧪 TEST: ${tc.name}`);
  console.log("─".repeat(40));

  const result = parseResearchResponse(tc.input, tc.citations);

  if (result.summary !== "PARSING FAILED" && result.summary.length > 20) {
    console.log("\n✅ PASSED");
    console.log("Summary preview:", result.summary.substring(0, 150) + "...");
    console.log("Findings:", result.findings.length);
    console.log("Sources:", result.sources.length);
    passed++;
  } else {
    console.log("\n❌ FAILED - Got fallback or empty summary");
    failed++;
  }
}

console.log("\n\n======================================");
console.log(`RESULTS: ${passed} passed, ${failed} failed`);
console.log("======================================");

if (failed > 0) {
  process.exit(1);
}
