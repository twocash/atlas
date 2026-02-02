/**
 * Web Search Spike Test
 *
 * Evaluate options for quick, low-latency web search for Atlas.
 * Goal: Sub-2-second response time for simple queries.
 *
 * Options to test:
 * 1. Claude's built-in server-side search (connector tool)
 * 2. Gemini Flash with grounding (existing pattern)
 * 3. Claude Haiku baseline (no search)
 */

import Anthropic from '@anthropic-ai/sdk';
import 'dotenv/config';

const TEST_QUERY = "What is the current price of Bitcoin today?";

interface SearchResult {
  method: string;
  success: boolean;
  latencyMs: number;
  resultPreview: string;
  sources?: string[];
  error?: string;
}

// ==========================================
// Option 1: Claude with Web Search Tool
// ==========================================
async function testClaudeSearch(): Promise<SearchResult> {
  const start = Date.now();
  const client = new Anthropic();

  try {
    // Use Claude's server-side web search connector
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      tools: [
        {
          type: "web_search_20250305",
          name: "web_search",
        } as any  // Type assertion needed for connector tool
      ],
      messages: [
        {
          role: 'user',
          content: `Search the web and answer: ${TEST_QUERY}`
        }
      ]
    });

    const latency = Date.now() - start;

    // Extract text response
    const textBlock = response.content.find(b => b.type === 'text');
    const text = textBlock?.type === 'text' ? textBlock.text : '';

    // Check for tool use (search was triggered)
    const toolUse = response.content.find(b => b.type === 'tool_use');
    const hasSearch = !!toolUse;

    return {
      method: 'Claude Web Search (connector)',
      success: true,
      latencyMs: latency,
      resultPreview: text.substring(0, 300),
      sources: hasSearch ? ['(server-side search triggered)'] : [],
    };
  } catch (error: any) {
    return {
      method: 'Claude Web Search (connector)',
      success: false,
      latencyMs: Date.now() - start,
      resultPreview: '',
      error: error.message,
    };
  }
}

// ==========================================
// Option 2: Gemini 2.0 Flash with Google Search Grounding (PRODUCTION PATTERN)
// Mirrors: apps/telegram/src/conversation/tools/core.ts executeWebSearch()
// ==========================================
async function testGeminiSearch(): Promise<SearchResult> {
  const start = Date.now();

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      method: 'Gemini 2.0 Flash + Grounding',
      success: false,
      latencyMs: 0,
      resultPreview: '',
      error: 'GEMINI_API_KEY not set',
    };
  }

  try {
    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(apiKey);

    // PRODUCTION PATTERN: Gemini 2.0 Flash with googleSearch tool at model level
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.0-flash',
      tools: [{ googleSearch: {} } as any], // Grounding enabled at model creation
    });

    // Simple string prompt (not contents array)
    const result = await model.generateContent(
      `Search the web for current information and provide a concise, factual answer for: ${TEST_QUERY}`
    );

    const text = result.response.text();
    const sources: string[] = [];

    // Extract grounding sources from metadata
    const candidate = result.response.candidates?.[0];
    const metadata = (candidate as any)?.groundingMetadata;
    if (metadata?.groundingChunks) {
      for (const chunk of metadata.groundingChunks) {
        if (chunk.web?.uri) sources.push(chunk.web.uri);
      }
    }

    return {
      method: 'Gemini 2.0 Flash + Grounding',
      success: true,
      latencyMs: Date.now() - start,
      resultPreview: text.substring(0, 300),
      sources,
    };
  } catch (error: any) {
    return {
      method: 'Gemini 2.0 Flash + Grounding',
      success: false,
      latencyMs: Date.now() - start,
      resultPreview: '',
      error: error.message,
    };
  }
}

// ==========================================
// Option 4: OpenRouter (cheap models with search)
// ==========================================
async function testOpenRouterSearch(): Promise<SearchResult> {
  const start = Date.now();

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return {
      method: 'OpenRouter (Perplexity Sonar)',
      success: false,
      latencyMs: 0,
      resultPreview: '',
      error: 'OPENROUTER_API_KEY not set',
    };
  }

  try {
    // Use Perplexity Sonar via OpenRouter - it has built-in web search
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://atlas.grove.dev',
        'X-Title': 'Atlas Web Search',
      },
      body: JSON.stringify({
        model: 'perplexity/sonar',  // Has built-in web search
        messages: [
          { role: 'user', content: TEST_QUERY }
        ],
        max_tokens: 1024,
      }),
    });

    const data = await response.json();
    const latency = Date.now() - start;

    if (!response.ok) {
      return {
        method: 'OpenRouter (Perplexity Sonar)',
        success: false,
        latencyMs: latency,
        resultPreview: '',
        error: data.error?.message || `HTTP ${response.status}`,
      };
    }

    const text = data.choices?.[0]?.message?.content || '';

    return {
      method: 'OpenRouter (Perplexity Sonar)',
      success: true,
      latencyMs: latency,
      resultPreview: text.substring(0, 300),
      sources: ['(Perplexity built-in search)'],
    };
  } catch (error: any) {
    return {
      method: 'OpenRouter (Perplexity Sonar)',
      success: false,
      latencyMs: Date.now() - start,
      resultPreview: '',
      error: error.message,
    };
  }
}

// ==========================================
// Option 3: Claude Haiku (Fast, No Search)
// ==========================================
async function testClaudeHaikuNoSearch(): Promise<SearchResult> {
  const start = Date.now();
  const client = new Anthropic();

  try {
    const response = await client.messages.create({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 512,
      messages: [
        {
          role: 'user',
          content: `${TEST_QUERY} (Answer based on your knowledge, acknowledge if data may be outdated)`
        }
      ]
    });

    const latency = Date.now() - start;
    const textBlock = response.content.find(b => b.type === 'text');
    const text = textBlock?.type === 'text' ? textBlock.text : '';

    return {
      method: 'Claude Haiku (no search, baseline)',
      success: true,
      latencyMs: latency,
      resultPreview: text.substring(0, 300),
    };
  } catch (error: any) {
    return {
      method: 'Claude Haiku (no search, baseline)',
      success: false,
      latencyMs: Date.now() - start,
      resultPreview: '',
      error: error.message,
    };
  }
}

// ==========================================
// Main: Run All Tests
// ==========================================
async function main() {
  console.log('='.repeat(60));
  console.log('WEB SEARCH SPIKE TEST');
  console.log(`Query: "${TEST_QUERY}"`);
  console.log('='.repeat(60));
  console.log('');

  const results: SearchResult[] = [];

  // Test 1: Claude Haiku baseline
  console.log('Testing Claude Haiku (baseline, no search)...');
  results.push(await testClaudeHaikuNoSearch());

  // Test 2: Gemini with Grounding
  console.log('Testing Gemini Flash + Grounding...');
  results.push(await testGeminiSearch());

  // Test 3: OpenRouter (Perplexity via OpenRouter)
  console.log('Testing OpenRouter (Perplexity Sonar)...');
  results.push(await testOpenRouterSearch());

  // Test 4: Claude Server-Side Search (expensive, slow - baseline comparison)
  console.log('Testing Claude Web Search (connector, expensive)...');
  results.push(await testClaudeSearch());

  // Print results
  console.log('\n' + '='.repeat(60));
  console.log('RESULTS');
  console.log('='.repeat(60));

  for (const r of results) {
    console.log(`\n📊 ${r.method}`);
    console.log(`   Status: ${r.success ? '✅ SUCCESS' : '❌ FAILED'}`);
    console.log(`   Latency: ${r.latencyMs}ms`);
    if (r.error) {
      console.log(`   Error: ${r.error}`);
    } else {
      console.log(`   Preview: ${r.resultPreview.substring(0, 150)}...`);
      if (r.sources?.length) {
        console.log(`   Sources: ${r.sources.length} found`);
      }
    }
  }

  // Recommendation
  console.log('\n' + '='.repeat(60));
  console.log('ANALYSIS');
  console.log('='.repeat(60));

  const successfulResults = results.filter(r => r.success);
  if (successfulResults.length === 0) {
    console.log('❌ No successful search methods found!');
    return;
  }

  const fastest = successfulResults.reduce((a, b) =>
    a.latencyMs < b.latencyMs ? a : b
  );

  const withSources = successfulResults.filter(r => r.sources && r.sources.length > 0);

  console.log(`\n⚡ Fastest: ${fastest.method} (${fastest.latencyMs}ms)`);
  if (withSources.length > 0) {
    console.log(`📚 With sources: ${withSources.map(r => r.method).join(', ')}`);
  }

  console.log('\n💡 RECOMMENDATION for Atlas web_search tool:');

  // Check which worked best
  const geminiResult = results.find(r => r.method.includes('Gemini'));
  const claudeSearchResult = results.find(r => r.method.includes('connector'));

  if (claudeSearchResult?.success && claudeSearchResult.sources?.length) {
    console.log('→ PRIMARY: Claude Web Search (connector tool)');
    console.log('  - Integrated with existing Claude calls');
    console.log('  - Sources included');
    console.log(`  - Latency: ${claudeSearchResult.latencyMs}ms`);
  }

  if (geminiResult?.success) {
    console.log(claudeSearchResult?.success ? '\n→ ALTERNATIVE: ' : '→ PRIMARY: ');
    console.log('  Gemini Flash + Grounding');
    console.log('  - Already used in research agent');
    console.log('  - Strong source citations');
    console.log(`  - Latency: ${geminiResult.latencyMs}ms`);
  }
}

main().catch(console.error);
