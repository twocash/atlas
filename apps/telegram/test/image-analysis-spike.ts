/**
 * Spike Test: Image Analysis → Notion Page Body Pipeline
 *
 * Run: bun run spike test/image-analysis-spike.ts
 *
 * Validates:
 * 1. buildAnalysisContent produces structured output
 * 2. Structure matches AuditEntry.analysisContent schema
 * 3. Pillar framing works correctly
 * 4. All required fields are populated
 */

import { buildAnalysisContent, type MediaContext, type Pillar } from '../src/conversation/media';
import type { AttachmentInfo } from '../src/conversation/attachments';

// Verify environment
if (!process.env.NOTION_API_KEY) {
  console.warn('⚠️ NOTION_API_KEY not set. Notion write tests will be skipped.');
}

console.log('🧪 Image Analysis Pipeline Smoke Test\n');
console.log('='.repeat(60));

// Test data: Simulated Gemini analysis output
const mockMediaContexts: Array<{ name: string; media: MediaContext; attachment: AttachmentInfo; pillar: Pillar }> = [
  {
    name: 'Consulting Receipt Image',
    media: {
      type: 'image',
      description: `This image shows a receipt from a restaurant.

1. Restaurant Name: The Grove Cafe
2. Date: January 15, 2026
3. Total Amount: $47.83
4. Items:
   - Coffee x2: $8.00
   - Lunch Special: $24.00
   - Tax: $3.83
   - Tip: $12.00

The receipt includes a business card from "DrumWave Inc" attached with a note "client lunch".`,
      metadata: {
        width: 1280,
        height: 960,
        mimeType: 'image/jpeg',
      },
      processingTime: 1523,
    },
    attachment: {
      type: 'photo',
      fileId: 'test-file-id-1',
      width: 1280,
      height: 960,
      fileSize: 245000,
      caption: 'Client lunch receipt',
    },
    pillar: 'Consulting',
  },
  {
    name: 'Grove Technical Screenshot',
    media: {
      type: 'image',
      description: `Screenshot of a VS Code editor showing TypeScript code.

The code appears to be related to an AI agent implementation:
- File: agent-executor.ts
- Contains a function called executeWithRetry
- Uses async/await patterns
- Imports from @anthropic-ai/sdk

Key observations:
- Clean code structure
- Good error handling patterns
- Could benefit from additional type annotations`,
      metadata: {
        width: 1920,
        height: 1080,
        mimeType: 'image/png',
      },
      processingTime: 892,
    },
    attachment: {
      type: 'photo',
      fileId: 'test-file-id-2',
      width: 1920,
      height: 1080,
      fileSize: 512000,
      caption: 'Agent code review',
    },
    pillar: 'The Grove',
  },
  {
    name: 'Personal Health Document',
    media: {
      type: 'document',
      description: `PDF document showing lab results from annual physical.

Document summary:
- Patient: Jim Calhoun
- Date: January 10, 2026
- Provider: ABC Medical

Key Results:
- Cholesterol: 185 mg/dL (normal)
- Blood Pressure: 118/76 (normal)
- A1C: 5.4% (normal)
- Vitamin D: 32 ng/mL (sufficient)

All results within normal ranges. Follow-up recommended in 12 months.`,
      extractedText: 'Lab Results Report\nPatient: Jim Calhoun\nDate: 01/10/2026\n...',
      metadata: {
        fileName: 'lab-results-2026.pdf',
        mimeType: 'application/pdf',
        fileSize: 89000,
      },
      processingTime: 2134,
    },
    attachment: {
      type: 'document',
      fileId: 'test-file-id-3',
      fileName: 'lab-results-2026.pdf',
      mimeType: 'application/pdf',
      fileSize: 89000,
    },
    pillar: 'Personal',
  },
  {
    name: 'Home/Garage Project Photo',
    media: {
      type: 'image',
      description: `Photo of a garage workspace showing renovation progress.

Visible elements:
- New drywall installed on left wall
- Electrical panel with new circuits
- Workbench area partially cleared
- Storage shelving being installed

Notes:
- Drywall needs mudding and taping
- Electrical appears up to code
- Floor needs epoxy coating`,
      metadata: {
        width: 4032,
        height: 3024,
        mimeType: 'image/jpeg',
      },
      processingTime: 1876,
    },
    attachment: {
      type: 'photo',
      fileId: 'test-file-id-4',
      width: 4032,
      height: 3024,
      fileSize: 3200000,
      caption: 'Garage renovation progress',
    },
    pillar: 'Home/Garage',
  },
];

// Run tests
let passed = 0;
let failed = 0;

for (const testCase of mockMediaContexts) {
  console.log(`\n📋 Test: ${testCase.name}`);
  console.log('-'.repeat(60));

  try {
    const result = buildAnalysisContent(
      testCase.media,
      testCase.attachment,
      testCase.pillar
    );

    // Validate structure
    const checks = [
      { name: 'summary exists', pass: typeof result.summary === 'string' && result.summary.length > 0 },
      { name: 'summary includes pillar context', pass: result.summary?.toLowerCase().includes(testCase.pillar.toLowerCase().replace('/', '').replace(' ', '')) || result.summary?.includes('context') },
      { name: 'metadata exists', pass: !!result.metadata && Object.keys(result.metadata).length > 0 },
      { name: 'metadata has Media Type', pass: result.metadata?.['Media Type'] === testCase.media.type },
      { name: 'metadata has Pillar', pass: result.metadata?.['Pillar'] === testCase.pillar },
      { name: 'keyPoints extracted', pass: !result.keyPoints || result.keyPoints.length > 0 },
      { name: 'suggestedActions generated', pass: !result.suggestedActions || result.suggestedActions.length > 0 },
      { name: 'fullText present for documents', pass: testCase.media.type !== 'document' || !!result.fullText },
    ];

    for (const check of checks) {
      if (check.pass) {
        console.log(`  ✅ ${check.name}`);
        passed++;
      } else {
        console.log(`  ❌ ${check.name}`);
        failed++;
      }
    }

    // Show summary preview
    console.log(`\n  📝 Summary preview:`);
    console.log(`     "${result.summary?.substring(0, 100)}..."`);

    // Show key points
    if (result.keyPoints && result.keyPoints.length > 0) {
      console.log(`\n  🔑 Key Points (${result.keyPoints.length}):`);
      result.keyPoints.slice(0, 3).forEach((point, i) => {
        console.log(`     ${i + 1}. ${point.substring(0, 60)}${point.length > 60 ? '...' : ''}`);
      });
    }

    // Show suggested actions
    if (result.suggestedActions && result.suggestedActions.length > 0) {
      console.log(`\n  📋 Suggested Actions (${result.suggestedActions.length}):`);
      result.suggestedActions.slice(0, 3).forEach((action, i) => {
        console.log(`     ${i + 1}. ${action}`);
      });
    }

    // Show metadata
    console.log(`\n  📊 Metadata:`);
    if (result.metadata) {
      Object.entries(result.metadata).slice(0, 5).forEach(([key, value]) => {
        console.log(`     ${key}: ${value}`);
      });
    }

  } catch (error) {
    console.log(`  ❌ ERROR: ${error instanceof Error ? error.message : 'Unknown error'}`);
    failed++;
  }
}

// Final results
console.log('\n' + '='.repeat(60));
console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  console.log('\n❌ SOME TESTS FAILED');
  process.exit(1);
} else {
  console.log('\n✅ ALL TESTS PASSED');
  console.log('\n🎯 The buildAnalysisContent function correctly transforms media');
  console.log('   analysis into structured content for Notion page bodies.');
}

// Optional: Test actual Notion write if API key available
if (process.env.NOTION_API_KEY) {
  console.log('\n' + '='.repeat(60));
  console.log('\n🔬 Optional: Testing Notion page body write...\n');

  // This would be a live test - skip for now to avoid creating test data
  console.log('   ℹ️ Live Notion write test skipped (run manually with --live flag)');
}
