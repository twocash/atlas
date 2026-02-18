/**
 * Inspect the actual Work Queue 2.0 database schema from Notion
 * to find property name/value mismatches
 */

import { Client } from '@notionhq/client';
import { NOTION_DB } from '@atlas/shared/config';

const WORK_QUEUE_DB_ID = NOTION_DB.WORK_QUEUE;

async function inspectSchema() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('   WORK QUEUE 2.0 DATABASE SCHEMA INSPECTOR');
  console.log('═══════════════════════════════════════════════════════\n');

  const apiKey = process.env.NOTION_API_KEY;
  if (!apiKey) {
    console.error('❌ NOTION_API_KEY not found');
    process.exit(1);
  }

  const notion = new Client({ auth: apiKey });

  try {
    // Get database schema
    console.log('Fetching database schema...\n');
    const database = await notion.databases.retrieve({
      database_id: WORK_QUEUE_DB_ID,
    });

    console.log('═══════════════════════════════════════════════════════');
    console.log('DATABASE PROPERTIES:');
    console.log('═══════════════════════════════════════════════════════\n');

    const properties = database.properties as Record<string, any>;

    for (const [propName, propDef] of Object.entries(properties)) {
      const propType = propDef.type;

      console.log(`Property: "${propName}"`);
      console.log(`  Type: ${propType}`);

      // For select/status properties, show available options
      if (propType === 'select' && propDef.select?.options) {
        console.log(`  Options:`);
        for (const option of propDef.select.options) {
          console.log(`    - "${option.name}" (id: ${option.id})`);
        }
      }

      // For status properties, show available options
      if (propType === 'status' && propDef.status?.options) {
        console.log(`  Options:`);
        for (const option of propDef.status.options) {
          console.log(`    - "${option.name}" (id: ${option.id})`);
        }
      }

      console.log('');
    }

    // Check for common mismatches
    console.log('═══════════════════════════════════════════════════════');
    console.log('MISMATCH DETECTION:');
    console.log('═══════════════════════════════════════════════════════\n');

    // Check if "Task" or "Item" property exists
    if (!properties['Task'] && properties['Item']) {
      console.log('⚠️  MISMATCH: Code expects "Task" but database has "Item"');
    } else if (properties['Task']) {
      console.log('✅ "Task" property found');
    }

    // Check if "Type" property has correct type
    if (properties['Type']) {
      const typeType = properties['Type'].type;
      console.log(`✅ "Type" property found (type: ${typeType})`);

      if (typeType === 'select' && properties['Type'].select?.options) {
        const typeOptions = properties['Type'].select.options.map((o: any) => o.name);
        console.log(`   Values: ${typeOptions.join(', ')}`);

        // Check if "Research" exists
        if (!typeOptions.includes('Research')) {
          console.log(`   ⚠️  MISMATCH: Code expects "Research" but not found in options`);
        }
      }
    } else {
      console.log('⚠️  "Type" property NOT found');
    }

    // Check if "Status" property exists and has correct type
    if (properties['Status']) {
      const statusType = properties['Status'].type;
      console.log(`✅ "Status" property found (type: ${statusType})`);

      if (statusType === 'select') {
        const statusOptions = properties['Status'].select.options.map((o: any) => o.name);
        console.log(`   Values: ${statusOptions.join(', ')}`);

        // Check for expected values
        const expected = ['Captured', 'Triaged', 'Active', 'Paused', 'Blocked', 'Done', 'Shipped'];
        const missing = expected.filter(v => !statusOptions.includes(v));
        if (missing.length > 0) {
          console.log(`   ⚠️  MISMATCH: Missing status values: ${missing.join(', ')}`);
        }
      } else if (statusType === 'status') {
        const statusOptions = properties['Status'].status.options.map((o: any) => o.name);
        console.log(`   Values: ${statusOptions.join(', ')}`);

        const expected = ['Captured', 'Triaged', 'Active', 'Paused', 'Blocked', 'Done', 'Shipped'];
        const missing = expected.filter(v => !statusOptions.includes(v));
        if (missing.length > 0) {
          console.log(`   ⚠️  MISMATCH: Missing status values: ${missing.join(', ')}`);
        }
      }
    } else {
      console.log('⚠️  "Status" property NOT found');
    }

    console.log('\n═══════════════════════════════════════════════════════');
    console.log('SCHEMA INSPECTION COMPLETE');
    console.log('═══════════════════════════════════════════════════════');

  } catch (error: any) {
    console.error('❌ ERROR:', error.message);
    console.error('   Code:', error.code);
    console.error('   Status:', error.status);
    process.exit(1);
  }
}

inspectSchema().catch(console.error);
