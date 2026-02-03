/**
 * Quick test for markdown-to-Notion parser
 */

import { parseMarkdownToBlocks } from '../src/formatting/notion';

const testContent = `# Threads Post Analysis

## **Author**
simplifyinai - AI-focused content creator

## **Main Message**
PageIndex is a new library that disrupts vector databases by using document trees instead of embeddings.

## **Key Insights**
- Core claim: Vector databases just got disrupted
- Performance metric: 98.7% accuracy on FinanceBench
- Technical approach: Document trees + LLM reasoning

## **Suggested Actions**
1. Evaluate the technology
2. Analyze cost implications
3. Monitor community validation`;

const blocks = parseMarkdownToBlocks(testContent);

console.log('='.repeat(60));
console.log('MARKDOWN TO NOTION PARSER TEST');
console.log('='.repeat(60));
console.log(`\nBlocks created: ${blocks.length}\n`);

blocks.forEach((b, i) => {
  const content = (b as any)[b.type]?.rich_text?.[0]?.text?.content || '';
  console.log(`${i + 1}. [${b.type}] ${content.slice(0, 60)}${content.length > 60 ? '...' : ''}`);
});

console.log('\n' + '='.repeat(60));
console.log('TEST COMPLETE');
console.log('='.repeat(60));
