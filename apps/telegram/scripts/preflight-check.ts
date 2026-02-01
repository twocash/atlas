#!/usr/bin/env bun
/**
 * Atlas Neuro-Link Pre-Flight Check
 *
 * Comprehensive validation before deployment:
 * 1. Database schema validation
 * 2. Module import validation
 * 3. Tool definition validation
 *
 * Run: bun run apps/telegram/scripts/preflight-check.ts
 */

// Load .env with override to prevent stale shell env vars from causing issues
import { config } from "dotenv";
config({ override: true });

import { Client } from "@notionhq/client";

console.log("═══════════════════════════════════════════════════════════════");
console.log("       Atlas Neuro-Link Pre-Flight Protocol");
console.log("═══════════════════════════════════════════════════════════════\n");

let failures: string[] = [];

// ==========================================
// Step 1: Environment Variables
// ==========================================

console.log("📋 STEP 1: Environment Variables\n");

const requiredEnvVars = [
  "NOTION_API_KEY",
  "TELEGRAM_BOT_TOKEN",
  "ANTHROPIC_API_KEY",
];

for (const envVar of requiredEnvVars) {
  if (process.env[envVar]) {
    console.log(`   ✅ ${envVar} is set`);
  } else {
    console.log(`   ❌ ${envVar} is NOT set`);
    failures.push(`Missing environment variable: ${envVar}`);
  }
}

// Optional but recommended
const optionalEnvVars = ["GEMINI_API_KEY"];
for (const envVar of optionalEnvVars) {
  if (process.env[envVar]) {
    console.log(`   ✅ ${envVar} is set (optional)`);
  } else {
    console.log(`   ⚠️  ${envVar} is not set (optional - needed for Research Agent)`);
  }
}

// ==========================================
// Step 2: Database Schema Validation
// ==========================================

console.log("\n📋 STEP 2: Database Schema Validation\n");

if (process.env.NOTION_API_KEY) {
  const notion = new Client({ auth: process.env.NOTION_API_KEY });

  const DBS = {
    WORK_QUEUE: "3d679030-b76b-43bd-92d8-1ac51abb4a28",
    DEV_PIPELINE: "ce6fbf1b-ee30-433d-a9e6-b338552de7c9",
  };

  // Check Work Queue
  try {
    const wqDb = await notion.databases.retrieve({ database_id: DBS.WORK_QUEUE });
    const wqProps = Object.keys(wqDb.properties);
    const wqRequired = ["Task", "Status", "Priority", "Type", "Pillar"];
    const wqMissing = wqRequired.filter((p) => !wqProps.includes(p));

    if (wqMissing.length === 0) {
      console.log(`   ✅ Work Queue 2.0 schema OK (${wqProps.length} properties)`);
    } else {
      console.log(`   ❌ Work Queue 2.0 missing: ${wqMissing.join(", ")}`);
      failures.push(`Work Queue missing properties: ${wqMissing.join(", ")}`);
    }
  } catch (err: any) {
    console.log(`   ❌ Work Queue 2.0 access failed: ${err?.message}`);
    failures.push(`Work Queue access failed: ${err?.message}`);
  }

  // Check Dev Pipeline
  try {
    const dpDb = await notion.databases.retrieve({ database_id: DBS.DEV_PIPELINE });
    const dpProps = Object.keys(dpDb.properties);
    const dpRequired = ["Discussion", "Status", "Priority", "Type"];
    const dpMissing = dpRequired.filter((p) => !dpProps.includes(p));

    if (dpMissing.length === 0) {
      console.log(`   ✅ Dev Pipeline schema OK (${dpProps.length} properties)`);
    } else {
      console.log(`   ❌ Dev Pipeline missing: ${dpMissing.join(", ")}`);
      failures.push(`Dev Pipeline missing properties: ${dpMissing.join(", ")}`);
    }
  } catch (err: any) {
    console.log(`   ❌ Dev Pipeline access failed: ${err?.message}`);
    failures.push(`Dev Pipeline access failed: ${err?.message}`);
  }
} else {
  console.log("   ⏭️  Skipped (NOTION_API_KEY not set)");
}

// ==========================================
// Step 3: Module Import Validation
// ==========================================

console.log("\n📋 STEP 3: Module Import Validation\n");

// Test dispatcher module
try {
  const dispatcher = await import("../src/conversation/tools/dispatcher");
  if (dispatcher.DISPATCHER_TOOL && dispatcher.handleSubmitTicket) {
    console.log("   ✅ Dispatcher module loads correctly");
    console.log(`      - submit_ticket tool defined: ${!!dispatcher.DISPATCHER_TOOL}`);
  } else {
    throw new Error("Missing exports");
  }
} catch (err: any) {
  console.log(`   ❌ Dispatcher module failed: ${err?.message}`);
  failures.push(`Dispatcher module error: ${err?.message}`);
}

// Test tools index
try {
  const tools = await import("../src/conversation/tools/index");
  const allTools = tools.getAllTools();
  const hasSubmitTicket = allTools.some((t: any) => t.name === "submit_ticket");

  if (hasSubmitTicket) {
    console.log(`   ✅ Tools index loads correctly (${allTools.length} tools)`);
    console.log(`      - submit_ticket in tool list: true`);
  } else {
    console.log(`   ⚠️  Tools index loads but submit_ticket not found`);
  }
} catch (err: any) {
  console.log(`   ❌ Tools index failed: ${err?.message}`);
  failures.push(`Tools index error: ${err?.message}`);
}

// ==========================================
// Step 4: Tool Definition Validation
// ==========================================

console.log("\n📋 STEP 4: Tool Definition Validation\n");

try {
  const { DISPATCHER_TOOL } = await import("../src/conversation/tools/dispatcher");

  // Check required properties
  const schema = DISPATCHER_TOOL.input_schema as any;
  const props = schema?.properties || {};
  const required = schema?.required || [];

  const expectedProps = ["reasoning", "category", "title", "description", "priority"];
  const missingProps = expectedProps.filter((p) => !props[p]);

  if (missingProps.length === 0) {
    console.log("   ✅ submit_ticket has all required properties");
  } else {
    console.log(`   ❌ submit_ticket missing properties: ${missingProps.join(", ")}`);
    failures.push(`submit_ticket missing: ${missingProps.join(", ")}`);
  }

  // Check category enum
  const categoryEnum = props.category?.enum || [];
  const expectedCategories = ["research", "dev_bug", "content"];
  const missingCategories = expectedCategories.filter((c) => !categoryEnum.includes(c));

  if (missingCategories.length === 0) {
    console.log("   ✅ category enum is correct");
  } else {
    console.log(`   ❌ category enum missing: ${missingCategories.join(", ")}`);
    failures.push(`category enum missing: ${missingCategories.join(", ")}`);
  }

  // Check reasoning is required
  if (required.includes("reasoning")) {
    console.log("   ✅ reasoning is a required field");
  } else {
    console.log("   ⚠️  reasoning should be required (Task Architect model)");
  }
} catch (err: any) {
  console.log(`   ❌ Tool validation failed: ${err?.message}`);
  failures.push(`Tool validation error: ${err?.message}`);
}

// ==========================================
// Step 5: Routing Logic Validation
// ==========================================

console.log("\n📋 STEP 5: Routing Logic Smoke Test\n");

try {
  const { handleSubmitTicket } = await import("../src/conversation/tools/dispatcher");

  // We can't actually call it without real Notion, but we can check it's a function
  if (typeof handleSubmitTicket === "function") {
    console.log("   ✅ handleSubmitTicket is callable");
  } else {
    console.log("   ❌ handleSubmitTicket is not a function");
    failures.push("handleSubmitTicket is not a function");
  }
} catch (err: any) {
  console.log(`   ❌ Routing validation failed: ${err?.message}`);
  failures.push(`Routing validation error: ${err?.message}`);
}

// ==========================================
// Summary
// ==========================================

console.log("\n═══════════════════════════════════════════════════════════════");

if (failures.length === 0) {
  console.log("✅ ALL PRE-FLIGHT CHECKS PASSED!");
  console.log("   Safe to deploy.");
  process.exit(0);
} else {
  console.log(`❌ PRE-FLIGHT CHECK FAILED (${failures.length} issue(s)):\n`);
  for (const failure of failures) {
    console.log(`   • ${failure}`);
  }
  console.log("\n   Fix these issues before deployment.");
  process.exit(1);
}
