/**
 * Test script to diagnose Research Agent issues
 * Run with: bun run src/test-research.ts
 */

import { config } from "dotenv";
config({ override: true });

console.log("=== Research Agent Diagnostic ===\n");

// Check environment
console.log("1. Environment Check:");
console.log(`   GEMINI_API_KEY: ${process.env.GEMINI_API_KEY ? `Set (${process.env.GEMINI_API_KEY.length} chars)` : "NOT SET"}`);
console.log(`   NOTION_API_KEY: ${process.env.NOTION_API_KEY ? `Set (${process.env.NOTION_API_KEY.length} chars)` : "NOT SET"}`);

// Test Gemini SDK import
console.log("\n2. Testing SDK Import:");
try {
  const newSdk = await import("@google/genai").catch(() => null);
  if (newSdk) {
    console.log("   ✓ @google/genai (new SDK) available");
  } else {
    console.log("   ✗ @google/genai not installed");
  }
} catch (e) {
  console.log(`   ✗ @google/genai import error: ${e}`);
}

try {
  const legacySdk = await import("@google/generative-ai");
  console.log("   ✓ @google/generative-ai (legacy SDK) available");
} catch (e) {
  console.log(`   ✗ @google/generative-ai import error: ${e}`);
}

// Test Gemini API call directly - try multiple model names
console.log("\n3. Testing Gemini API Call (trying multiple models):");

const modelNamesToTry = [
  "gemini-2.0-flash",
  "gemini-2.0-flash-exp",
  "gemini-1.5-flash-latest",
  "gemini-1.5-flash-001",
  "gemini-pro",
];

let workingModel: string | null = null;

for (const modelName of modelNamesToTry) {
  try {
    const { GoogleGenerativeAI } = await import("@google/generative-ai");
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
    const model = genAI.getGenerativeModel({ model: modelName });

    const result = await model.generateContent("Say 'OK'");
    const text = result.response.text();
    console.log(`   ✓ ${modelName}: Works! Response: "${text.slice(0, 50)}..."`);
    workingModel = modelName;
    break;
  } catch (e: any) {
    console.log(`   ✗ ${modelName}: ${e.message.includes("404") ? "Not found" : e.message.slice(0, 50)}`);
  }
}

if (workingModel) {
  console.log(`   → Use model: ${workingModel}`);
} else {
  console.log(`   → No working model found!`);
}

// Test with Google Search grounding - try BOTH SDKs
console.log("\n4. Testing Google Search Grounding:");

// 4a. Try NEW SDK (@google/genai) with google_search
console.log("\n   4a. New SDK (@google/genai) with google_search:");
try {
  const genaiModule = await import("@google/genai");
  console.log(`   Available exports: ${Object.keys(genaiModule).join(", ")}`);

  // Try GoogleGenAI constructor
  if (genaiModule.GoogleGenAI) {
    const ai = new genaiModule.GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    console.log(`   GoogleGenAI instantiated`);
    console.log(`   ai.models exists: ${!!ai.models}`);

    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: "What is today's date?",
      config: {
        tools: [{ googleSearch: {} }],
      },
    });
    console.log(`   ✓ Response: "${String(response.text || response).slice(0, 100)}..."`);
  } else {
    console.log(`   GoogleGenAI not found in exports`);
  }
} catch (e: any) {
  console.log(`   ✗ New SDK error: ${e.message}`);
}

// 4b. Try legacy SDK with google_search (not googleSearchRetrieval)
console.log("\n   4b. Legacy SDK with google_search field:");
try {
  const { GoogleGenerativeAI } = await import("@google/generative-ai");
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

  const model = genAI.getGenerativeModel({
    model: "gemini-2.0-flash",
    tools: [{ google_search: {} }] as any,  // Try snake_case
  });

  const result = await model.generateContent("What is today's date?");
  const text = result.response.text();
  console.log(`   ✓ Response: "${text.slice(0, 100)}..."`);

  const groundingMetadata = result.response.candidates?.[0]?.groundingMetadata;
  console.log(`   Grounding: ${groundingMetadata ? "PRESENT" : "NOT PRESENT"}`);
} catch (e: any) {
  console.log(`   ✗ Legacy SDK error: ${e.message.slice(0, 100)}`);
}

// 4c. Try legacy SDK with googleSearch (camelCase)
console.log("\n   4c. Legacy SDK with googleSearch (camelCase):");
try {
  const { GoogleGenerativeAI } = await import("@google/generative-ai");
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

  const model = genAI.getGenerativeModel({
    model: "gemini-2.0-flash",
    tools: [{ googleSearch: {} }] as any,  // camelCase
  });

  const result = await model.generateContent("What is today's date?");
  const text = result.response.text();
  console.log(`   ✓ Response: "${text.slice(0, 100)}..."`);

  const groundingMetadata = result.response.candidates?.[0]?.groundingMetadata;
  console.log(`   Grounding: ${groundingMetadata ? "PRESENT" : "NOT PRESENT"}`);
} catch (e: any) {
  console.log(`   ✗ Legacy SDK error: ${e.message.slice(0, 100)}`);
}

// Test research module import
console.log("\n5. Testing Research Module Import:");
try {
  const researchModule = await import("../../../packages/agents/src/agents/research");
  console.log("   ✓ Research module loaded");
  console.log(`   Exports: ${Object.keys(researchModule).join(", ")}`);
} catch (e: any) {
  console.log(`   ✗ Research module import error: ${e.message}`);
  // Try alternate path
  try {
    const alt = await import("../../packages/agents/src/agents/research");
    console.log("   ✓ Research module loaded (alt path)");
  } catch {
    console.log("   → Check relative path from test file location");
  }
}

console.log("\n=== Diagnostic Complete ===");
