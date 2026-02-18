/**
 * Atlas Startup Integrity Check
 *
 * Validates database schema before boot. If Atlas's memory (Notion) is corrupted,
 * refuse to start rather than fail silently during tool calls.
 *
 * This is the final lock on the door.
 */

import { Client } from "@notionhq/client";
import { NOTION_DB } from '@atlas/shared/config';
import { logger } from "../logger";

// Schema validation against canonical IDs from @atlas/shared/config
const REQUIRED_SCHEMA: Record<string, { name: string; properties: string[] }> = {
  // Work Queue 2.0
  [NOTION_DB.WORK_QUEUE]: {
    name: 'Work Queue 2.0',
    properties: ['Task', 'Status', 'Priority', 'Type', 'Pillar']
  },
  // Dev Pipeline
  [NOTION_DB.DEV_PIPELINE]: {
    name: 'Dev Pipeline',
    properties: ['Discussion', 'Status', 'Priority', 'Type']
  }
};

/**
 * Verify that all required Notion databases are accessible and have correct schema.
 * Returns false if ANY database is inaccessible or missing required columns.
 */
export async function verifySystemIntegrity(): Promise<boolean> {
  logger.info("Performing Startup Integrity Check...");

  if (!process.env.NOTION_API_KEY) {
    logger.error("FATAL: NOTION_API_KEY is missing.");
    return false;
  }

  const notion = new Client({ auth: process.env.NOTION_API_KEY });
  let healthy = true;

  for (const [id, config] of Object.entries(REQUIRED_SCHEMA)) {
    try {
      const db = await notion.databases.retrieve({ database_id: id });
      const availableProps = Object.keys(db.properties);

      const missing = config.properties.filter(p => !availableProps.includes(p));

      if (missing.length > 0) {
        logger.error(`FATAL: ${config.name} is missing columns: [${missing.join(', ')}]`);
        logger.error(`   Atlas cannot write to this database without them.`);
        healthy = false;
      } else {
        logger.info(`${config.name} schema verified (${availableProps.length} properties)`);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`FATAL: Could not access ${config.name} (${id}): ${message}`);
      healthy = false;
    }
  }

  if (healthy) {
    logger.info("Integrity check passed - all databases accessible and schema valid");
  }

  return healthy;
}
