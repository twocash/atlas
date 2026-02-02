/**
 * Debug: Check what URL format Gemini returns
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load env
const envPath = resolve(__dirname, '../../../apps/telegram/.env');
const envContent = readFileSync(envPath, 'utf-8');
for (const line of envContent.split('\n')) {
  const trimmed = line.trim();
  if (trimmed && !trimmed.startsWith('#')) {
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex > 0) {
      const key = trimmed.substring(0, eqIndex);
      let value = trimmed.substring(eqIndex + 1);
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  }
}

async function test() {
  const { GoogleGenerativeAI } = await import('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

  const model = genAI.getGenerativeModel({
    model: 'gemini-2.0-flash',
    tools: [{ google_search: {} }] as any,
  });

  console.log("Querying Gemini with MCP servers question...\n");

  const result = await model.generateContent('What are the best Model Context Protocol (MCP) servers for Claude AI assistant for personal productivity? MCP is Anthropic\'s protocol for connecting AI assistants to external tools and data sources. Return JSON with summary, findings array (each with claim, source, url fields), and sources array of URLs.');
  const response = result.response;

  console.log('=== RAW TEXT (first 3000 chars) ===');
  console.log(response.text().substring(0, 3000));

  const candidate = response.candidates?.[0];
  const gm = candidate?.groundingMetadata as any;
  console.log('\n=== GROUNDING METADATA ===');
  console.log('webSearchQueries:', JSON.stringify(gm?.webSearchQueries));
  console.log('groundingChunks count:', gm?.groundingChunks?.length || 0);

  if (gm?.groundingChunks) {
    console.log('\n=== GROUNDING CHUNK URLs (from metadata) ===');
    gm.groundingChunks.slice(0, 8).forEach((c: any, i: number) => {
      console.log(`${i + 1}. ${c.web?.title || 'no title'}`);
      console.log(`   URI: ${c.web?.uri?.substring(0, 120) || 'no uri'}...`);
    });
  }

  // Parse the JSON and show what URLs are in findings
  const text = response.text();
  const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/) || text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const jsonStr = jsonMatch[1] || jsonMatch[0];
      const parsed = JSON.parse(jsonStr);

      console.log('\n=== PARSED JSON URLs ===');
      if (parsed.findings) {
        console.log('Findings URLs:');
        parsed.findings.forEach((f: any, i: number) => {
          console.log(`  ${i + 1}. source: ${f.source}`);
          console.log(`     url: ${f.url?.substring(0, 100) || 'NO URL'}...`);
        });
      }
      if (parsed.sources) {
        console.log('\nSources array:');
        parsed.sources.forEach((s: string, i: number) => {
          console.log(`  ${i + 1}. ${s?.substring(0, 100) || 'empty'}...`);
        });
      }
    } catch (e) {
      console.log('JSON parse failed:', (e as Error).message);
    }
  }
}

test().catch(console.error);
