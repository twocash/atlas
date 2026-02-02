/**
 * SPIKE: Test research agent directly
 *
 * Run with: bun run test/research-spike.ts
 */

import 'dotenv/config';

console.log("=== RESEARCH SPIKE ===");
console.log("GEMINI_API_KEY:", process.env.GEMINI_API_KEY ? "SET (" + process.env.GEMINI_API_KEY.substring(0, 8) + "...)" : "MISSING");

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
    console.log("   Using NEW SDK (@google/genai)");
  } catch (e) {
    console.log("   New SDK not found, trying legacy...");
    try {
      genaiModule = await import("@google/generative-ai");
      console.log("   Using LEGACY SDK (@google/generative-ai)");
    } catch (e2) {
      console.error("   No Gemini SDK found!", e2);
      process.exit(1);
    }
  }

  console.log("\n2. Creating prompt...");
  const prompt = `You are Atlas Research Agent, an autonomous research assistant with access to Google Search.

## Research Task
Query: "TypeScript refactoring best practices 2024"
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
      "source": "Name of the source",
      "url": "https://source-url.com"
    }
  ],
  "sources": ["https://url1.com", "https://url2.com"]
}
\`\`\`

## Guidelines
- Speed over depth — get the essentials
- Prefer recent, well-known sources
- One source per major claim is acceptable
- Summary should be 2-3 complete sentences

Begin your research now.`;

  console.log("   Prompt length:", prompt.length);

  console.log("\n3. Calling Gemini API...");
  const startTime = Date.now();

  try {
    let responseText = "";
    let citations: Array<{ url: string; title: string }> = [];

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

      const groundingMetadata = response.candidates?.[0]?.groundingMetadata;
      const groundingChunks = (groundingMetadata as any)?.groundingChunks || [];

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

      const model = genAI.getGenerativeModel({
        model: "gemini-2.0-flash",
        tools: [{ google_search: {} }] as any,
        generationConfig: {
          maxOutputTokens: 2048,
        },
      });

      const result = await model.generateContent(prompt);
      const response = result.response;

      responseText = response.text();

      const groundingMetadata = response.candidates?.[0]?.groundingMetadata;
      const groundingChunks = (groundingMetadata as any)?.groundingChunks ||
                              (groundingMetadata as any)?.groundingChuncks || [];

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
    console.log("   Citations:", citations.length);

    console.log("\n========== RAW RESPONSE TEXT ==========");
    console.log(responseText);
    console.log("========================================");

    if (citations.length > 0) {
      console.log("\n========== CITATIONS ==========");
      for (const c of citations.slice(0, 5)) {
        console.log(`  - ${c.title}: ${c.url.substring(0, 80)}...`);
      }
      console.log("================================");
    }

    // Now test parsing
    console.log("\n5. Testing parse logic...");

    let parsed: any = null;

    // Pattern 1: Code block
    const codeBlockMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/);
    if (codeBlockMatch) {
      console.log("   Found code block, parsing...");
      try {
        parsed = JSON.parse(codeBlockMatch[1]);
        console.log("   ✅ Parsed successfully!");
      } catch (e) {
        console.log("   ❌ Parse failed:", e);
      }
    }

    // Pattern 2: Raw JSON
    if (!parsed) {
      const jsonStart = responseText.indexOf('{"summary"');
      if (jsonStart !== -1) {
        console.log("   Found raw JSON at index", jsonStart);
        try {
          let braceCount = 0;
          let endIdx = jsonStart;
          for (let i = jsonStart; i < responseText.length; i++) {
            if (responseText[i] === '{') braceCount++;
            if (responseText[i] === '}') braceCount--;
            if (braceCount === 0) {
              endIdx = i + 1;
              break;
            }
          }
          parsed = JSON.parse(responseText.substring(jsonStart, endIdx));
          console.log("   ✅ Parsed successfully!");
        } catch (e) {
          console.log("   ❌ Parse failed:", e);
        }
      }
    }

    if (parsed) {
      console.log("\n========== PARSED RESULT ==========");
      console.log("Summary:", parsed.summary?.substring(0, 200) + "...");
      console.log("Findings:", parsed.findings?.length || 0);
      console.log("Sources:", parsed.sources?.length || 0);
      console.log("====================================");
    } else {
      console.log("\n❌ FAILED TO PARSE JSON FROM RESPONSE");
    }

  } catch (error) {
    console.error("\n❌ API ERROR:", error);
  }
}

runSpike().catch(console.error);
