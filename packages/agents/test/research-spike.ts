/**
 * SPIKE: Test research agent with hallucination detection
 *
 * Tests both successful and failing research queries to verify:
 * 1. Google Search grounding is working
 * 2. Hallucination detection catches fake content
 * 3. Proper error handling for failed searches
 *
 * Run with: cd packages/agents && bun run test/research-spike.ts
 */

import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// ES Module compatible __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load env from apps/telegram
config({ path: resolve(__dirname, '../../../apps/telegram/.env') });

console.log("=== RESEARCH SPIKE - HALLUCINATION DETECTION TEST ===");
console.log("Time:", new Date().toISOString());
console.log("GEMINI_API_KEY:", process.env.GEMINI_API_KEY ? "SET" : "MISSING");
console.log("NOTION_API_KEY:", process.env.NOTION_API_KEY ? "SET" : "MISSING");

// Test queries - one should succeed, one should fail
const TEST_QUERIES = [
  {
    query: "TypeScript refactoring best practices 2024",
    expectSuccess: true,
    reason: "Common topic with many real sources"
  },
  // {
  //   query: "openclaw agent skills for claude code",
  //   expectSuccess: false,
  //   reason: "Gibberish/made-up topic"
  // }
];

async function runSpike() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("GEMINI_API_KEY is required");
    process.exit(1);
  }

  console.log("\n1. Loading Gemini SDK...");

  let genaiModule: any;
  let useNewSdk = false;

  try {
    genaiModule = await import("@google/genai");
    useNewSdk = true;
    console.log("   ✅ Using NEW SDK (@google/genai)");
  } catch (e) {
    console.log("   New SDK not found, trying legacy...");
    try {
      genaiModule = await import("@google/generative-ai");
      console.log("   ✅ Using LEGACY SDK (@google/generative-ai)");
    } catch (e2) {
      console.error("   ❌ No Gemini SDK found!", e2);
      process.exit(1);
    }
  }

  for (const testCase of TEST_QUERIES) {
    console.log("\n" + "=".repeat(70));
    console.log(`TESTING: "${testCase.query}"`);
    console.log(`Expected: ${testCase.expectSuccess ? "SUCCESS" : "FAILURE (hallucination detected)"}`);
    console.log(`Reason: ${testCase.reason}`);
    console.log("=".repeat(70));

    await runSingleTest(genaiModule, useNewSdk, apiKey, testCase);
  }
}

async function runSingleTest(
  genaiModule: any,
  useNewSdk: boolean,
  apiKey: string,
  testCase: { query: string; expectSuccess: boolean; reason: string }
) {
  // Build prompt with FIXED format (no placeholder URLs)
  const prompt = `You are Atlas Research Agent, an autonomous research assistant with access to Google Search.

## Research Task
Query: "${testCase.query}"
Depth: light — Quick overview with key facts
Target Sources: 3+

## Instructions

Use Google Search to find current, authoritative information about this topic.
This is a QUICK research task. Focus on:
- Getting the key facts fast
- 2-3 authoritative sources maximum
- Brief, actionable summary
- Skip deep analysis — surface-level overview only

## Output Format

Provide your response in this exact JSON format:

\`\`\`json
{
  "summary": "2-3 sentence executive summary with key takeaways",
  "findings": [
    {
      "claim": "Specific fact or insight discovered",
      "source": "Name of the publication or website",
      "url": "<THE_ACTUAL_URL_FROM_YOUR_SEARCH>"
    }
  ],
  "sources": ["<REAL_URL_1>", "<REAL_URL_2>", "..."]
}
\`\`\`

## CRITICAL: Source Integrity

**EVERY URL must be a real URL from your Google Search results.**
- Do NOT use placeholder URLs like "url1.com", "example.com", or "source-url.com"
- Do NOT fabricate URLs - only include URLs that Google Search actually returned
- If Google Search returns NO relevant results for this query, respond with:
\`\`\`json
{
  "error": "NO_SEARCH_RESULTS",
  "summary": "Google Search did not return relevant results for this query. The topic may be too niche, misspelled, or not well-indexed.",
  "findings": [],
  "sources": []
}
\`\`\`

## Guidelines
- Speed over depth — get the essentials
- Prefer recent, well-known sources
- One source per major claim is acceptable
- Summary should be 2-3 complete sentences

Begin your research now.`;

  console.log("\n2. Prompt length:", prompt.length);
  console.log("\n3. Calling Gemini API...");
  const startTime = Date.now();

  try {
    let responseText = "";
    let citations: Array<{ url: string; title: string }> = [];
    let webSearchQueries: string[] = [];

    if (useNewSdk) {
      const { GoogleGenAI } = genaiModule;
      const ai = new GoogleGenAI({ apiKey });

      const response = await ai.models.generateContent({
        model: "gemini-2.0-flash",
        contents: prompt,
        config: {
          tools: [{ googleSearch: {} }],
          maxOutputTokens: 2048,
        },
      });

      responseText = response.text || "";

      const candidate = response.candidates?.[0];
      const groundingMetadata = candidate?.groundingMetadata;

      // Extract ALL grounding metadata
      webSearchQueries = (groundingMetadata as any)?.webSearchQueries || [];
      const groundingChunks = (groundingMetadata as any)?.groundingChunks || [];
      const searchEntryPoint = (groundingMetadata as any)?.searchEntryPoint;

      console.log("\n   --- GROUNDING METADATA ---");
      console.log("   Finish reason:", candidate?.finishReason);
      console.log("   Web search queries:", JSON.stringify(webSearchQueries));
      console.log("   Grounding chunks count:", groundingChunks.length);
      console.log("   Search entry point:", searchEntryPoint ? "present" : "missing");

      for (const chunk of groundingChunks) {
        if (chunk.web) {
          citations.push({
            url: chunk.web.uri || "",
            title: chunk.web.title || "",
          });
        }
      }
    } else {
      const { GoogleGenerativeAI } = genaiModule;
      const genAI = new GoogleGenerativeAI(apiKey);

      // Gemini 2.0 Flash with google_search tool
      // Note: Grounding works via groundingSupports (not groundingChunks)
      console.log("   Using gemini-2.0-flash with google_search");

      const model = genAI.getGenerativeModel({
        model: "gemini-2.0-flash",
        tools: [{ google_search: {} }] as any,
        generationConfig: {
          maxOutputTokens: 2048,
        },
      });

      const result = await model.generateContent(prompt);
      const response = result.response;

      // DEBUG: Dump full response structure to understand grounding
      console.log("\n   --- FULL RESPONSE STRUCTURE DEBUG ---");
      console.log("   Response keys:", Object.keys(response));
      const candidate = response.candidates?.[0];
      if (candidate) {
        console.log("   Candidate keys:", Object.keys(candidate));
        if (candidate.groundingMetadata) {
          console.log("   GroundingMetadata keys:", Object.keys(candidate.groundingMetadata));
          // Dump FULL grounding metadata
          console.log("   FULL GroundingMetadata:", JSON.stringify(candidate.groundingMetadata, null, 2));
        } else {
          console.log("   ⚠️ No groundingMetadata on candidate!");
        }
        // Check if there are other fields on candidate
        console.log("   Full candidate (except content):", JSON.stringify({
          ...candidate,
          content: "[omitted]"
        }, null, 2).substring(0, 2000));
      }
      // Check result level
      console.log("   Result keys:", Object.keys(result));
      console.log("   --- END DEBUG ---");

      responseText = response.text();

      // candidate already declared above
      const groundingMetadata = candidate?.groundingMetadata;

      webSearchQueries = (groundingMetadata as any)?.webSearchQueries || [];
      const groundingChunks = (groundingMetadata as any)?.groundingChunks ||
                              (groundingMetadata as any)?.groundingChuncks || [];

      console.log("\n   --- GROUNDING METADATA ---");
      console.log("   Finish reason:", candidate?.finishReason);
      console.log("   Web search queries:", JSON.stringify(webSearchQueries));
      console.log("   Grounding chunks count:", groundingChunks.length);

      for (const chunk of groundingChunks) {
        if (chunk.web) {
          citations.push({
            url: chunk.web.uri || "",
            title: chunk.web.title || "",
          });
        }
      }
    }

    const elapsed = Date.now() - startTime;

    console.log(`\n4. Response received in ${elapsed}ms`);
    console.log("   Text length:", responseText.length);
    console.log("   Grounding citations:", citations.length);

    // Log citations
    if (citations.length > 0) {
      console.log("\n   --- CITATIONS ---");
      for (const c of citations.slice(0, 5)) {
        console.log(`   - ${c.title.substring(0, 40)}: ${c.url.substring(0, 60)}...`);
      }
    } else {
      console.log("\n   ⚠️ WARNING: No grounding citations returned!");
    }

    if (webSearchQueries.length === 0) {
      console.log("   ⚠️ WARNING: No web search queries generated - grounding may not be working!");
    }

    // Parse response
    console.log("\n5. Parsing response...");

    let parsed: any = null;

    // Try code block first
    const codeBlockMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/);
    if (codeBlockMatch) {
      try {
        parsed = JSON.parse(codeBlockMatch[1]);
        console.log("   ✅ Parsed from code block");
      } catch (e) {
        console.log("   ❌ Code block parse failed:", (e as Error).message);
      }
    }

    // Try raw JSON
    if (!parsed) {
      const jsonMatch = responseText.match(/\{[\s\S]*"summary"[\s\S]*\}/);
      if (jsonMatch) {
        try {
          parsed = JSON.parse(jsonMatch[0]);
          console.log("   ✅ Parsed from raw JSON");
        } catch (e) {
          console.log("   ❌ Raw JSON parse failed:", (e as Error).message);
        }
      }
    }

    if (!parsed) {
      console.log("\n   ❌ FAILED TO PARSE JSON");
      console.log("\n   --- RAW RESPONSE ---");
      console.log(responseText.substring(0, 500));
      console.log("   --- END RAW ---");
      return;
    }

    // Check for error response
    if (parsed.error === "NO_SEARCH_RESULTS") {
      console.log("\n   ✅ Model correctly reported NO_SEARCH_RESULTS");
      console.log("   Summary:", parsed.summary);
      return;
    }

    // Extract sources
    const sources = parsed.sources || [];
    console.log("\n6. Checking for hallucination...");
    console.log("   Sources found:", sources.length);
    console.log("   Sources:", JSON.stringify(sources.slice(0, 3)));

    // HALLUCINATION DETECTION
    const placeholderPatterns = [
      /^https?:\/\/url\d+\.com/i,
      /^https?:\/\/source-url\.com/i,
      /^https?:\/\/example\.com/i,
      /^https?:\/\/.*placeholder/i,
    ];

    const placeholderUrls = sources.filter((url: string) =>
      placeholderPatterns.some(pattern => pattern.test(url))
    );

    if (placeholderUrls.length > 0) {
      console.log("\n   ❌ HALLUCINATION DETECTED: Placeholder URLs found!");
      console.log("   Bad URLs:", placeholderUrls);
      if (testCase.expectSuccess) {
        console.log("\n   ⚠️ TEST FAILED: Expected success but got hallucination");
      } else {
        console.log("\n   ✅ TEST PASSED: Correctly detected hallucination");
      }
      return;
    }

    // Check findings for "unspecified" sources
    const findings = parsed.findings || [];
    const hasUnspecified = findings.some((f: any) =>
      f.source?.toLowerCase().includes('unspecified') ||
      f.url === 'unavailable' ||
      f.url === ''
    );

    if (citations.length === 0 && hasUnspecified) {
      console.log("\n   ❌ HALLUCINATION DETECTED: Zero citations + unspecified sources");
      if (testCase.expectSuccess) {
        console.log("\n   ⚠️ TEST FAILED: Expected success but got hallucination");
      } else {
        console.log("\n   ✅ TEST PASSED: Correctly detected hallucination");
      }
      return;
    }

    // Looks good!
    console.log("\n   ✅ No hallucination detected");
    console.log("\n   --- PARSED RESULT ---");
    console.log("   Summary:", parsed.summary?.substring(0, 150) + "...");
    console.log("   Findings count:", findings.length);
    console.log("   Sources count:", sources.length);

    if (testCase.expectSuccess) {
      console.log("\n   ✅ TEST PASSED: Got valid research results");
    } else {
      console.log("\n   ⚠️ TEST MAYBE FAILED: Expected hallucination detection but got results");
      console.log("   (This might be OK if the topic actually had real results)");
    }

  } catch (error) {
    console.error("\n❌ API ERROR:", error);
  }
}

runSpike().catch(console.error);
