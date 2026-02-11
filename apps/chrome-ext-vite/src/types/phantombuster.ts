/**
 * PhantomBuster API types
 */

export interface PbAgentConfig {
  id: string
  name: string
  scriptId: string
  argument: string              // JSON string of agent arguments
  launchType: string
  lastEndMessage?: string
  lastEndStatus?: string
  s3Folder?: string             // Agent-specific folder (dynamic)
  orgS3Folder?: string          // Organization folder (dynamic)
}

export interface PbLaunchResult {
  containerId: string
  status: 'running' | 'finished' | 'error'
}

export interface PbContainerStatus {
  id: string
  status: 'running' | 'finished' | 'error'
  progress?: number
  exitMessage?: string
}

export interface PbAgentResult {
  resultObject?: unknown
  output?: string
  exitCode?: number
}

/**
 * PhantomBuster agent IDs for LinkedIn scraping
 * These match the IDs in phantombuster_etl.py
 */
export const PB_AGENTS = {
  // Master scraper that gets both commenters and likers
  MASTER_SCRAPER: '5464281464072346',
  // Individual export phantoms
  LIKERS_EXPORT: '7681394493723575',
  COMMENTERS_EXPORT: '589974210280169',
  PROFILE_SCRAPER: '1194668210811742',
} as const

/**
 * S3 folder mappings for result fetching
 */
export const PB_S3_FOLDERS: Record<string, string> = {
  '5464281464072346': 'jtS7HbSonE1KJQH2XbGQyQ',
  '7681394493723575': 'Nd6Y4mRgYhJAk7FDqRLlww',
  '589974210280169': '8qohyJcD21I9aXuPlftiLA',
  '1194668210811742': 'OSfw84VqJ92HoMMcJGtdSw',
}

export const PB_S3_BASE = 'https://phantombuster.s3.amazonaws.com/fPnqqqrVtDA'
