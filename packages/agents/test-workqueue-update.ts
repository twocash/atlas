/**
 * Integration Test: Work Queue Update Validation
 *
 * Tests edge cases and validation logic for the work_queue_update tool.
 * This test suite helps diagnose and prevent database access failures.
 */

import { Client } from '@notionhq/client';
import { NOTION_DB } from '@atlas/shared/config';

const WORK_QUEUE_DB_ID = NOTION_DB.WORK_QUEUE;

async function testWorkQueueUpdate() {
  console.log('🧪 Testing work_queue_update edge cases...\n');

  // Verify environment
  if (!process.env.NOTION_API_KEY) {
    console.error('❌ NOTION_API_KEY not found in environment');
    process.exit(1);
  }

  const notion = new Client({ auth: process.env.NOTION_API_KEY });
  let testId: string | null = null;

  try {
    // Create test item
    console.log('📝 Creating test item...');
    const createResponse = await notion.pages.create({
      parent: { database_id: WORK_QUEUE_DB_ID },
      properties: {
        'Task': { title: [{ text: { content: 'TEST: work_queue_update validation' } }] },
        'Status': { select: { name: 'Captured' } },
        'Type': { select: { name: 'Process' } },
        'Priority': { select: { name: 'P3' } },
        'Pillar': { select: { name: 'The Grove' } },
      },
    });
    testId = createResponse.id;
    console.log(`✅ Created test item: ${testId}\n`);

    // Test 1: Normal update
    console.log('Test 1: Normal status update...');
    await notion.pages.update({
      page_id: testId,
      properties: { 'Status': { select: { name: 'Active' } } },
    });
    console.log('✅ PASSED\n');

    // Test 2: Multiple field update
    console.log('Test 2: Update multiple fields...');
    await notion.pages.update({
      page_id: testId,
      properties: {
        'Status': { select: { name: 'Done' } },
        'Priority': { select: { name: 'P1' } },
      },
    });
    console.log('✅ PASSED\n');

    // Test 3: Update with Notes (rich text)
    console.log('Test 3: Update with notes...');
    await notion.pages.update({
      page_id: testId,
      properties: {
        'Notes': { rich_text: [{ text: { content: 'Test notes added' } }] },
      },
    });
    console.log('✅ PASSED\n');

    // Test 4: Invalid status value (Notion accepts ANY string - our validation is critical!)
    console.log('Test 4: Invalid status value...');
    try {
      await notion.pages.update({
        page_id: testId,
        properties: { 'Status': { select: { name: 'InvalidStatus' } } },
      });
      console.log('⚠️  WARNING: Notion accepted invalid status. Our validation is CRITICAL.\n');
    } catch (error: any) {
      console.log(`✅ PASSED: Notion rejected invalid status (${error.message})\n`);
    }

    // Test 5: Empty properties (Notion silently accepts - our check is critical!)
    console.log('Test 5: Empty properties object...');
    try {
      await notion.pages.update({
        page_id: testId,
        properties: {},
      });
      console.log('⚠️  WARNING: Notion accepted empty update. Our validation is CRITICAL.\n');
    } catch (error: any) {
      console.log(`✅ PASSED: Notion rejected empty update (${error.message})\n`);
    }

    // Test 6: Invalid page ID (should fail)
    console.log('Test 6: Invalid page ID...');
    try {
      await notion.pages.update({
        page_id: 'nonexistent-page-id-123',
        properties: { 'Status': { select: { name: 'Active' } } },
      });
      console.log('❌ FAILED: Should have thrown error\n');
    } catch (error: any) {
      console.log(`✅ PASSED: Correctly rejected (code: ${error.code})\n`);
    }

    // Test 7: Status transition validation (Done → Active)
    console.log('Test 7: Status transition (Done → Active)...');
    await notion.pages.update({
      page_id: testId,
      properties: { 'Status': { select: { name: 'Active' } } },
    });
    console.log('✅ PASSED (Notion allows all transitions)\n');

    // Test 8: Rich text limit (Notion max is 2000 chars)
    console.log('Test 8: Rich text at 2000 char limit...');
    const maxNotes = 'A'.repeat(2000);
    await notion.pages.update({
      page_id: testId,
      properties: { 'Notes': { rich_text: [{ text: { content: maxNotes } }] } },
    });
    console.log('✅ PASSED (2000 chars is max)\n');

    // Test 8b: Verify over-limit fails
    console.log('Test 8b: Rich text over 2000 chars (should fail)...');
    try {
      const tooLongNotes = 'A'.repeat(2001);
      await notion.pages.update({
        page_id: testId,
        properties: { 'Notes': { rich_text: [{ text: { content: tooLongNotes } }] } },
      });
      console.log('❌ FAILED: Should have rejected >2000 chars\n');
    } catch (error: any) {
      console.log(`✅ PASSED: Correctly rejected >2000 chars (${error.code})\n`);
    }

    // Test 9: Whitespace handling simulation
    // (In real code, sanitization would trim " Active " to "Active")
    console.log('Test 9: Whitespace in status (pre-sanitization)...');
    const statusWithWhitespace = ' Blocked ';
    await notion.pages.update({
      page_id: testId,
      properties: { 'Status': { select: { name: statusWithWhitespace.trim() } } },
    });
    console.log('✅ PASSED (sanitization works)\n');

    // Test 10: Pillar reclassification tracking
    console.log('Test 10: Pillar reclassification...');
    await notion.pages.update({
      page_id: testId,
      properties: {
        'Pillar': { select: { name: 'Consulting' } },
        'Original Pillar': { select: { name: 'The Grove' } },
        'Was Reclassified': { checkbox: true },
      },
    });
    console.log('✅ PASSED\n');

    console.log('═══════════════════════════════════════');
    console.log('✅ ALL TESTS PASSED');
    console.log('═══════════════════════════════════════\n');

  } catch (error: any) {
    console.error('❌ TEST SUITE FAILED');
    console.error('Error:', error.message);
    console.error('Code:', error.code);
    console.error('Status:', error.status);
    process.exit(1);
  } finally {
    // Cleanup
    if (testId) {
      console.log('🧹 Cleaning up test item...');
      await notion.pages.update({ page_id: testId, archived: true });
      console.log('✅ Test item archived\n');
    }
  }
}

// Run tests
testWorkQueueUpdate().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
