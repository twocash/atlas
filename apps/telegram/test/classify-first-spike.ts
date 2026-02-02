/**
 * Spike Test: Classify-First Flow Verification
 *
 * Tests the full workflow from content detection → classification → audit trail
 *
 * Run: bun test/classify-first-spike.ts
 */

import { Client } from '@notionhq/client';
import type { AuditEntry } from '../src/conversation/audit';

// Feed 2.0 database ID
const FEED_DB_ID = '90b2b33f-4b44-4b42-870f-8d62fb8cbf18';
const WORK_QUEUE_DB_ID = '3d679030-b76b-43bd-92d8-1ac51abb4a28';

const notion = new Client({ auth: process.env.NOTION_API_KEY });

async function main() {
  console.log('=== CLASSIFY-FIRST SPIKE TEST ===\n');

  // Test 1: Verify database access
  console.log('1. Testing database access...');
  try {
    const feedDb = await notion.databases.retrieve({ database_id: FEED_DB_ID });
    console.log('   ✅ Feed 2.0 accessible:', (feedDb as any).title?.[0]?.plain_text || 'Feed 2.0');
  } catch (error: any) {
    console.log('   ❌ Feed 2.0 FAILED:', error.message);
  }

  try {
    const wqDb = await notion.databases.retrieve({ database_id: WORK_QUEUE_DB_ID });
    console.log('   ✅ Work Queue 2.0 accessible:', (wqDb as any).title?.[0]?.plain_text || 'Work Queue 2.0');
  } catch (error: any) {
    console.log('   ❌ Work Queue 2.0 FAILED:', error.message);
  }

  // Test 2: Check Feed 2.0 schema for new pattern learning fields
  console.log('\n2. Checking Feed 2.0 schema for pattern learning fields...');
  try {
    const feedDb = await notion.databases.retrieve({ database_id: FEED_DB_ID });
    const properties = (feedDb as any).properties || {};

    const patternFields = [
      'Content Type',
      'Content Source',
      'Classification Confirmed',
      'Classification Adjusted',
      'Original Suggestion',
      'Context Payload',
    ];

    for (const field of patternFields) {
      if (properties[field]) {
        console.log(`   ✅ ${field}: ${properties[field].type}`);
      } else {
        console.log(`   ⚠️ ${field}: MISSING - needs to be added to Notion`);
      }
    }
  } catch (error: any) {
    console.log('   ❌ Schema check failed:', error.message);
  }

  // Test 3a: Simulate audit trail creation (minimal - core fields only)
  console.log('\n3a. Testing audit trail creation (MINIMAL - core fields)...');
  try {
    const { createAuditTrail } = await import('../src/conversation/audit');

    const minimalEntry: AuditEntry = {
      entry: '[SPIKE TEST] Minimal Entry',
      pillar: 'The Grove',
      requestType: 'Research',
      source: 'Telegram',
      author: 'Atlas [Telegram]',
      confidence: 1.0,
      keywords: ['spike-test'],
      workType: 'spike test',
      userId: 123456789,
      messageText: 'Testing minimal entry',
      hasAttachment: false,
    };

    console.log('   Creating minimal audit trail...');
    const minResult = await createAuditTrail(minimalEntry);

    if (minResult) {
      console.log('   ✅ Minimal audit trail created!');
      console.log(`      Feed URL: ${minResult.feedUrl}`);
      console.log(`      Work Queue URL: ${minResult.workQueueUrl}`);
    } else {
      console.log('   ❌ Minimal audit trail returned NULL - CORE BUG!');
    }
  } catch (error: any) {
    console.log('   ❌ Minimal audit trail FAILED:', error.message);
  }

  // Test 3b: Simulate audit trail creation (full - with optional fields + analysis content)
  console.log('\n3b. Testing audit trail creation (FULL - with analysis content)...');
  try {
    // Import the actual audit module
    const { createAuditTrail } = await import('../src/conversation/audit');

    const testEntry: AuditEntry = {
      entry: '[SPIKE TEST] Analysis Content Test',
      pillar: 'The Grove',
      requestType: 'Research',
      source: 'Telegram',
      author: 'Atlas [Telegram]',
      confidence: 1.0,
      keywords: ['spike-test', 'analysis-content'],
      workType: 'spike test verification',
      userId: 123456789,
      messageText: 'Testing analysis content writing to Feed page body',
      hasAttachment: true,
      attachmentType: 'photo',
      // URL content fields
      url: 'https://example.com/test',
      urlTitle: 'Test URL',
      urlDomain: 'example.com',
      extractionMethod: 'Gemini',
      // Pattern learning fields
      contentType: 'image',
      contentSource: 'screenshot',
      classificationConfirmed: true,
      classificationAdjusted: false,
      originalSuggestion: 'Research',
      // Analysis content - THIS SHOULD BE WRITTEN TO PAGE BODY
      analysisContent: {
        summary: 'This is a test screenshot showing the Atlas classify-first flow working correctly. The image contains the Telegram interface with classification buttons.',
        keyPoints: [
          'Classification keyboard appears instantly',
          'Pillar selection triggers Gemini analysis',
          'Pattern learning fields are populated',
        ],
        suggestedActions: [
          'Review and verify the classification flow',
          'Check pattern suggestions are improving',
          'Document the UX improvements',
        ],
        metadata: {
          'Source': 'screenshot',
          'Analyzed': new Date().toISOString(),
          'Method': 'Gemini Vision',
        },
      },
    };

    console.log('   Creating full audit trail...');
    const result = await createAuditTrail(testEntry);

    if (result) {
      console.log('   ✅ Full audit trail created!');
      console.log(`      Feed ID: ${result.feedId}`);
      console.log(`      Feed URL: ${result.feedUrl}`);
      console.log(`      Work Queue ID: ${result.workQueueId}`);
      console.log(`      Work Queue URL: ${result.workQueueUrl}`);

      // Verify URLs are proper Notion URLs
      if (result.feedUrl.includes('notion.so')) {
        console.log('   ✅ Feed URL is valid Notion URL');
      } else {
        console.log('   ⚠️ Feed URL may be malformed:', result.feedUrl);
      }

      if (result.workQueueUrl.includes('notion.so')) {
        console.log('   ✅ Work Queue URL is valid Notion URL');
      } else {
        console.log('   ⚠️ Work Queue URL may be malformed:', result.workQueueUrl);
      }

      // Verify analysis content was written to page body
      console.log('\n   Checking page body for analysis content...');
      try {
        const blocks = await notion.blocks.children.list({
          block_id: result.feedId,
          page_size: 20,
        });

        const hasAnalysisHeader = blocks.results.some((block: any) =>
          block.type === 'heading_2' &&
          block.heading_2?.rich_text?.[0]?.plain_text === 'Analysis'
        );

        const hasKeyPoints = blocks.results.some((block: any) =>
          block.type === 'heading_3' &&
          block.heading_3?.rich_text?.[0]?.plain_text === 'Key Points'
        );

        const hasSuggestedActions = blocks.results.some((block: any) =>
          block.type === 'heading_3' &&
          block.heading_3?.rich_text?.[0]?.plain_text === 'Suggested Actions'
        );

        console.log(`      Total blocks: ${blocks.results.length}`);
        console.log(`      ${hasAnalysisHeader ? '✅' : '❌'} Analysis header found`);
        console.log(`      ${hasKeyPoints ? '✅' : '❌'} Key Points section found`);
        console.log(`      ${hasSuggestedActions ? '✅' : '❌'} Suggested Actions section found`);

        if (hasAnalysisHeader && hasKeyPoints && hasSuggestedActions) {
          console.log('   ✅ Analysis content successfully written to page body!');
        } else {
          console.log('   ⚠️ Some analysis sections missing from page body');
        }
      } catch (blockError: any) {
        console.log(`   ⚠️ Could not verify page blocks: ${blockError.message}`);
      }
    } else {
      console.log('   ❌ Full audit trail creation returned NULL');
      console.log('      This explains "Logged (links unavailable)"');
      console.log('      Check logs for specific property errors');
    }
  } catch (error: any) {
    console.log('   ❌ Full audit trail creation FAILED:', error.message);
    console.log('      Stack:', error.stack?.split('\n').slice(0, 3).join('\n'));
  }

  // Test 4: Test pattern suggestion query
  console.log('\n4. Testing pattern suggestion query...');
  try {
    const { getPatternSuggestion } = await import('../src/conversation/content-patterns');

    const pattern = await getPatternSuggestion({
      pillar: 'The Grove',
      contentType: 'image',
    });

    if (pattern) {
      console.log('   ✅ Pattern found!');
      console.log(`      Suggested type: ${pattern.suggestedType}`);
      console.log(`      Confidence: ${(pattern.confidence * 100).toFixed(0)}%`);
      console.log(`      Sample count: ${pattern.sampleCount}`);
      console.log(`      Breakdown:`, pattern.breakdown);
    } else {
      console.log('   ⚠️ No patterns found (expected if < 5 confirmed classifications)');
    }
  } catch (error: any) {
    console.log('   ❌ Pattern query FAILED:', error.message);
  }

  // Test 5: Query recent Feed entries to check pattern learning fields
  console.log('\n5. Checking recent Feed entries for pattern learning data...');
  try {
    const response = await notion.databases.query({
      database_id: FEED_DB_ID,
      page_size: 5,
      sorts: [{ property: 'Date', direction: 'descending' }],
    });

    console.log(`   Found ${response.results.length} recent entries:`);

    for (const page of response.results) {
      const props = (page as any).properties;
      const title = props['Entry']?.title?.[0]?.plain_text || 'Untitled';
      const contentType = props['Content Type']?.select?.name || 'N/A';
      const confirmed = props['Classification Confirmed']?.checkbox;

      console.log(`   - "${title.substring(0, 40)}..."`);
      console.log(`     Content Type: ${contentType}, Confirmed: ${confirmed ?? 'N/A'}`);
    }
  } catch (error: any) {
    console.log('   ❌ Feed query FAILED:', error.message);
  }

  console.log('\n=== SPIKE TEST COMPLETE ===');
}

main().catch(console.error);
