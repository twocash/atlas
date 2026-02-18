#!/usr/bin/env bun
/**
 * Atlas Neuro-Link Pre-Flight Check: Database Schema Validator
 *
 * Validates that the Notion databases have the required properties
 * before any code tries to write to them.
 *
 * Run: bun run apps/telegram/scripts/validate-db-schema.ts
 */

import { Client } from "@notionhq/client";
import { NOTION_DB } from "@atlas/shared/config";

// Check for API key
if (!process.env.NOTION_API_KEY) {
  console.error("❌ NOTION_API_KEY environment variable is required");
  process.exit(1);
}

const notion = new Client({ auth: process.env.NOTION_API_KEY });

// Canonical IDs from @atlas/shared/config
const DBS = {
  WORK_QUEUE: NOTION_DB.WORK_QUEUE,
  DEV_PIPELINE: NOTION_DB.DEV_PIPELINE,
  FEED: NOTION_DB.FEED,
};

interface SchemaCheck {
  name: string;
  dbId: string;
  requiredProps: string[];
  statusProperty?: string; // Property name that uses "status" type
  statusValues?: string[]; // Required status values
}

const SCHEMA_CHECKS: SchemaCheck[] = [
  {
    name: "Work Queue 2.0",
    dbId: DBS.WORK_QUEUE,
    requiredProps: ["Task", "Status", "Priority", "Type", "Pillar", "Assignee", "Queued"],
    statusProperty: "Status",
    statusValues: ["Captured", "Triaged", "Active", "Paused", "Blocked", "Done", "Shipped"],
  },
  {
    name: "Dev Pipeline",
    dbId: DBS.DEV_PIPELINE,
    requiredProps: ["Discussion", "Status", "Priority", "Type", "Thread", "Requestor", "Handler"],
  },
  {
    name: "Feed 2.0",
    dbId: DBS.FEED,
    requiredProps: ["Entry"],
  },
];

async function checkSchema(check: SchemaCheck): Promise<boolean> {
  console.log(`\n🔍 Checking ${check.name} (${check.dbId})...`);

  try {
    const db = await notion.databases.retrieve({ database_id: check.dbId });
    const props = db.properties as Record<string, any>;
    const propNames = Object.keys(props);

    console.log(`   Found ${propNames.length} properties`);

    // Check required properties exist
    const missing = check.requiredProps.filter((p) => !propNames.includes(p));

    if (missing.length > 0) {
      console.error(`   ❌ MISSING PROPERTIES: ${missing.join(", ")}`);
      console.log(`   📋 Available: ${propNames.join(", ")}`);
      return false;
    }

    console.log(`   ✅ All required properties present`);

    // Check status values if specified
    if (check.statusProperty && check.statusValues) {
      const statusProp = props[check.statusProperty];

      if (statusProp?.type === "status" && statusProp.status?.options) {
        const availableStatuses = statusProp.status.options.map((o: any) => o.name);
        const missingStatuses = check.statusValues.filter(
          (s) => !availableStatuses.includes(s)
        );

        if (missingStatuses.length > 0) {
          console.error(`   ⚠️  Missing Status values: ${missingStatuses.join(", ")}`);
          console.log(`   📋 Available: ${availableStatuses.join(", ")}`);
          // Warning but don't fail - statuses can be added
        } else {
          console.log(`   ✅ All required Status values present`);
        }
      } else if (statusProp?.type === "select") {
        // Some databases use "select" instead of "status"
        const availableOptions = statusProp.select?.options?.map((o: any) => o.name) || [];
        console.log(`   📋 Status uses 'select' type. Options: ${availableOptions.join(", ")}`);
      }
    }

    return true;
  } catch (err: any) {
    if (err?.code === "object_not_found") {
      console.error(`   ❌ Database not found or not shared with integration`);
      console.error(`   💡 Make sure the Atlas integration is added to this database in Notion`);
    } else {
      console.error(`   ❌ Failed to read database: ${err?.message || err}`);
    }
    return false;
  }
}

async function main() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("       Atlas Neuro-Link Pre-Flight: Database Schema Validator");
  console.log("═══════════════════════════════════════════════════════════════");

  let allPassed = true;

  for (const check of SCHEMA_CHECKS) {
    const passed = await checkSchema(check);
    if (!passed) allPassed = false;
  }

  console.log("\n═══════════════════════════════════════════════════════════════");

  if (allPassed) {
    console.log("✅ All database schemas validated successfully!");
    console.log("   Safe to proceed with deployment.");
    process.exit(0);
  } else {
    console.log("❌ Schema validation FAILED!");
    console.log("   Fix the database schemas before running any agents.");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
