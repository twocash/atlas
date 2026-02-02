/**
 * SPIKE: Test Gemini research directly
 * Run with: node test/spike.mjs
 */

import 'dotenv/config';

console.log("=== RESEARCH SPIKE ===");
console.log("GEMINI_API_KEY:", process.env.GEMINI_API_KEY ? "SET" : "MISSING");

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error("GEMINI_API_KEY is required");
  process.exit(1);
}

console.log("\n1. Loading Gemini SDK...");

let genaiModule;
try {
  genaiModule = await import("@google/generative-ai");
  console.log("   Using @google/generative-ai");
} catch (e) {
  console.error("   SDK not found!", e.message);
  process.exit(1);
}

const { GoogleGenerativeAI } = genaiModule;
const genAI = new GoogleGenerativeAI(apiKey);

const prompt = `You are a research assistant. Research "TypeScript refactoring tools 2024" and respond in JSON:

\`\`\`json
{
  "summary": "Brief 2-3 sentence summary",
  "findings": [{"claim": "fact", "source": "name", "url": "https://..."}],
  "sources": ["https://..."]
}
\`\`\``;

console.log("\n2. Calling Gemini...");

try {
  const model = genAI.getGenerativeModel({
    model: "gemini-2.0-flash",
    tools: [{ google_search: {} }],
    generationConfig: { maxOutputTokens: 2048 },
  });

  const result = await model.generateContent(prompt);
  const response = result.response;
  const text = response.text();

  console.log("\n=== RAW RESPONSE ===");
  console.log(text);
  console.log("====================");

  // Test parsing
  const match = text.match(/```json\s*([\s\S]*?)\s*```/);
  if (match) {
    try {
      const parsed = JSON.parse(match[1]);
      console.log("\n✅ PARSED OK:");
      console.log("  Summary:", parsed.summary?.substring(0, 100));
      console.log("  Findings:", parsed.findings?.length);
    } catch (e) {
      console.log("\n❌ Parse failed:", e.message);
    }
  } else {
    console.log("\n❌ No JSON code block found");
  }

} catch (e) {
  console.error("API Error:", e);
}
