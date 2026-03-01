/**
 * Gemini Grounding Diagnostic
 *
 * Isolates WHY groundingChunks returns empty despite groundingUsed=true.
 *
 * Tests 3 configurations:
 *   A. Minimal call — no systemInstruction
 *   B. Same query with systemInstruction (current post-RPO-001 pattern)
 *   C. Everything in contents — no systemInstruction (pre-RPO-001 pattern)
 *
 * Run: bun run packages/agents/test/gemini-grounding-diagnostic.ts
 */

const QUERY = 'What are the latest Anthropic product announcements in February 2026?';
const SYSTEM_INSTRUCTION = `You are Atlas Research Agent, an autonomous research assistant with access to Google Search.

## Instructions
Use Google Search to find current, authoritative information about this topic.

## Output Format
Provide your response as a well-structured analysis with inline source citations.
Cite sources using markdown links: [Source Name](URL).
Include a ## Sources section at the end listing all referenced URLs.`;

async function runDiagnostic() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('GEMINI_API_KEY not set');
    process.exit(1);
  }

  const { GoogleGenAI } = await import('@google/genai');
  const ai = new GoogleGenAI({ apiKey });

  // Also log the SDK version
  try {
    const pkg = await import('@google/genai/package.json');
    console.log(`@google/genai version: ${(pkg as any).version || (pkg as any).default?.version || 'unknown'}`);
  } catch {
    console.log('@google/genai version: could not determine');
  }

  console.log('='.repeat(80));
  console.log('GEMINI GROUNDING DIAGNOSTIC');
  console.log('='.repeat(80));
  console.log(`Query: "${QUERY}"`);
  console.log();

  // ===== TEST A: Minimal — no systemInstruction =====
  console.log('--- TEST A: Minimal (no systemInstruction) ---');
  try {
    const responseA = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: QUERY,
      config: {
        tools: [{ googleSearch: {} }],
        maxOutputTokens: 4096,
      },
    });
    dumpGrounding('A', responseA);
  } catch (err) {
    console.error('TEST A FAILED:', err);
  }

  console.log();

  // ===== TEST B: With systemInstruction (post-RPO-001 pattern) =====
  console.log('--- TEST B: With systemInstruction (post-RPO-001) ---');
  try {
    const responseB = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: QUERY,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        tools: [{ googleSearch: {} }],
        maxOutputTokens: 4096,
      },
    });
    dumpGrounding('B', responseB);
  } catch (err) {
    console.error('TEST B FAILED:', err);
  }

  console.log();

  // ===== TEST C: Everything in contents, no systemInstruction (pre-RPO-001 pattern) =====
  console.log('--- TEST C: All-in-contents (pre-RPO-001) ---');
  const combinedPrompt = `${SYSTEM_INSTRUCTION}\n\n## Research Task\nQuery: "${QUERY}"\nDepth: standard\nTarget Sources: 5+\n\nBegin your research now.`;
  try {
    const responseC = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: combinedPrompt,
      config: {
        tools: [{ googleSearch: {} }],
        maxOutputTokens: 4096,
      },
    });
    dumpGrounding('C', responseC);
  } catch (err) {
    console.error('TEST C FAILED:', err);
  }

  console.log();

  // ===== TEST D: Full production systemInstruction (drafter template + voice) =====
  console.log('--- TEST D: Full production systemInstruction (~8000 chars) ---');
  const FULL_SYSTEM_INSTRUCTION = `You are Atlas Research Agent, an autonomous research assistant with access to Google Search.

## STYLE GUIDELINES (CRITICAL - ADOPT THIS VOICE THROUGHOUT)
Write in a strategic, analytical voice. Lead with the insight, not the event. Be specific about mechanisms — name the company, the product, the number. Active voice, present tense. 8th-grade reading level with graduate-level thinking. No hedging language ("it seems", "perhaps"). No filler phrases. Every sentence earns its place.

Use clear section headers. Short paragraphs (2-3 sentences max). Bullet points for lists of 3+ items. No emoji. No exclamation marks unless quoting someone.

When analyzing technology decisions, focus on: What changed? Why now? Who benefits? What are the second-order effects? What does this mean for the industry trajectory?

## Instructions

Use Google Search to find current, authoritative information about this topic.
This is a DEEP research task. Focus on:
- Exhaustive coverage from 10-15+ sources
- Academic-level rigor and cross-referencing
- Primary source verification where possible
- Nuanced analysis with multiple perspectives
- Historical context and future implications
- Expert opinions and data-driven insights
- Challenge assumptions — look for contrarian views

## Output Format

Write a comprehensive research briefing in the following structure:

### Executive Summary
A 2-3 paragraph overview that captures the essential findings, key tensions, and strategic implications. Write this as if briefing a senior executive who has 60 seconds to understand the landscape.

### Key Findings
Organize your research into thematic sections. Each section should:
- Lead with the most important insight
- Support claims with specific data points and named sources
- Include direct quotes where they add credibility
- Note where sources disagree or where evidence is thin

### Analysis & Implications
- What are the first-order effects?
- What are the second-order effects that most observers are missing?
- Who are the winners and losers?
- What decisions does this inform?

### Sources
List all referenced URLs with brief descriptions of what each source contributed.

## Source Requirements

- Cite sources inline using markdown links: [Source Name](URL)
- Include a ## Sources section at the end listing all referenced URLs
- EVERY URL must be a real URL from your Google Search results
- Do NOT use placeholder URLs like "url1.com", "example.com", or "source-url.com"
- Do NOT fabricate URLs — only include URLs that Google Search actually returned
- If Google Search returns NO relevant results, state this clearly at the top of your response

## Quality Guidelines

For DEEP research:
- Minimum 10 unique, authoritative sources
- Cross-reference key claims across multiple sources
- Include publication dates for time-sensitive information
- Distinguish between primary reporting and derivative coverage
- Flag any claims that appear in only one source as unverified
- Provide confidence levels for key findings (high/medium/low based on source convergence)`;

  const PRODUCTION_CONTENTS = `## Research Task
Query: "Anthropic OpenAI government controversy last week - what OpenAI agreed to versus Anthropic's position on military AI ethics"
Depth: deep — Exhaustive investigation with 10-15+ sources, primary source verification, cross-referencing, and nuanced analysis. For topics requiring thorough understanding.
Target Sources: 15+

Begin your research now.`;

  try {
    console.log(`  systemInstruction length: ${FULL_SYSTEM_INSTRUCTION.length} chars`);
    console.log(`  contents length: ${PRODUCTION_CONTENTS.length} chars`);
    const responseD = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: PRODUCTION_CONTENTS,
      config: {
        systemInstruction: FULL_SYSTEM_INSTRUCTION,
        tools: [{ googleSearch: {} }],
        maxOutputTokens: 8192,
      },
    });
    dumpGrounding('D', responseD);
  } catch (err) {
    console.error('TEST D FAILED:', err);
  }

  console.log();

  // ===== TEST E: Same query as D but all in contents (pre-RPO-001 style) =====
  console.log('--- TEST E: Same full payload, all in contents (pre-RPO-001 style) ---');
  const COMBINED_FULL = `${FULL_SYSTEM_INSTRUCTION}\n\n${PRODUCTION_CONTENTS}`;
  try {
    console.log(`  combined contents length: ${COMBINED_FULL.length} chars`);
    const responseE = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: COMBINED_FULL,
      config: {
        tools: [{ googleSearch: {} }],
        maxOutputTokens: 8192,
      },
    });
    dumpGrounding('E', responseE);
  } catch (err) {
    console.error('TEST E FAILED:', err);
  }

  console.log();
  console.log('='.repeat(80));
  console.log('DIAGNOSTIC COMPLETE');
  console.log('='.repeat(80));
}

function dumpGrounding(label: string, response: any) {
  const candidate = response.candidates?.[0];
  const gm = candidate?.groundingMetadata;

  const chunks = gm?.groundingChunks || [];
  const supports = gm?.groundingSupports || [];
  const queries = gm?.webSearchQueries || [];
  const searchEntry = gm?.searchEntryPoint;

  console.log(`[${label}] finishReason: ${candidate?.finishReason}`);
  console.log(`[${label}] text length: ${response.text?.length || 0}`);
  console.log(`[${label}] groundingChunks: ${chunks.length}`);
  console.log(`[${label}] groundingSupports: ${supports.length}`);
  console.log(`[${label}] webSearchQueries: ${JSON.stringify(queries)}`);
  console.log(`[${label}] searchEntryPoint present: ${!!searchEntry}`);

  if (chunks.length > 0) {
    console.log(`[${label}] CITATIONS FOUND:`);
    for (const chunk of chunks.slice(0, 5)) {
      if (chunk.web) {
        console.log(`  - ${chunk.web.title || '(no title)'}: ${chunk.web.uri || '(no uri)'}`);
      }
    }
  } else {
    console.log(`[${label}] ** NO CITATION URLS **`);
  }

  // Dump raw groundingMetadata keys for discovery
  if (gm) {
    console.log(`[${label}] groundingMetadata keys: ${Object.keys(gm).join(', ')}`);
  } else {
    console.log(`[${label}] groundingMetadata: NULL`);
  }
}

runDiagnostic().catch(console.error);
