/**
 * PhantomBuster API client
 * Handles agent configuration, launching, and status polling
 */

import { Storage } from "@plasmohq/storage"
import { STORAGE_KEYS } from "./storage"
import {
  PB_AGENTS,
  PB_S3_FOLDERS,
  PB_S3_BASE,
  type PbAgentConfig,
  type PbLaunchResult,
  type PbContainerStatus,
} from "~src/types/phantombuster"

const storage = new Storage({ area: "local" })
const PB_API_BASE = "https://api.phantombuster.com/api/v2"

async function getApiKey(): Promise<string | null> {
  return storage.get<string>(STORAGE_KEYS.PB_API_KEY)
}

async function pbFetch(
  endpoint: string,
  options: RequestInit = {}
): Promise<Response> {
  const apiKey = await getApiKey()
  if (!apiKey) {
    throw new Error("PhantomBuster API key not configured")
  }

  return fetch(`${PB_API_BASE}${endpoint}`, {
    ...options,
    headers: {
      "X-Phantombuster-Key-1": apiKey,
      "Content-Type": "application/json",
      ...options.headers,
    },
  })
}

/**
 * Fetch agent configuration
 */
export async function fetchAgentConfig(agentId: string): Promise<PbAgentConfig> {
  const resp = await pbFetch(`/agents/fetch?id=${agentId}`)
  if (!resp.ok) {
    throw new Error(`Failed to fetch agent: ${resp.status}`)
  }
  return resp.json()
}

/**
 * Launch an agent with optional argument overrides
 */
export async function launchAgent(
  agentId: string,
  argumentOverrides?: Record<string, unknown>
): Promise<PbLaunchResult> {
  // Fetch current config to get session cookie etc
  const config = await fetchAgentConfig(agentId)
  const savedArg = JSON.parse(config.argument || "{}")

  // Merge overrides
  const launchArg = argumentOverrides
    ? { ...savedArg, ...argumentOverrides }
    : savedArg

  const resp = await pbFetch("/agents/launch", {
    method: "POST",
    body: JSON.stringify({
      id: agentId,
      argument: JSON.stringify(launchArg),
    }),
  })

  if (!resp.ok) {
    const text = await resp.text()
    throw new Error(`Failed to launch agent: ${resp.status} - ${text.slice(0, 200)}`)
  }

  const data = await resp.json()
  return {
    containerId: data.containerId,
    status: "running",
  }
}

/**
 * Get container/execution status
 */
export async function getContainerStatus(containerId: string): Promise<PbContainerStatus> {
  const resp = await pbFetch(`/containers/fetch?id=${containerId}`)
  if (!resp.ok) {
    throw new Error(`Failed to fetch container: ${resp.status}`)
  }

  const data = await resp.json()
  return {
    id: containerId,
    status: data.status === "running" ? "running" : data.status === "finished" ? "finished" : "error",
    progress: data.progress,
    exitMessage: data.exitMessage,
  }
}

/**
 * Robust Result Fetching (No hardcoded folders)
 * 1. Asks PB where the results are for this specific agent
 * 2. Constructs the S3 URL dynamically
 */
export async function fetchAgentResults(agentId: string): Promise<unknown[]> {
  try {
    // Step 1: Get the agent's metadata from API
    const config = await fetchAgentConfig(agentId)

    // Step 2: Extract dynamic folder paths from the API response
    const orgFolder = config.orgS3Folder || 'fPnqqqrVtDA' // Fallback to known org folder
    const agentFolder = config.s3Folder

    if (!agentFolder) {
      console.log(`[PB] No S3 folder for agent ${agentId}`)
      // Fallback: try hardcoded mapping if API doesn't return folder
      const hardcodedFolder = PB_S3_FOLDERS[agentId]
      if (hardcodedFolder) {
        const url = `${PB_S3_BASE}/${hardcodedFolder}/result.json`
        const resp = await fetch(url)
        if (resp.ok) return resp.json()
      }
      return []
    }

    // Step 3: Construct the URL dynamically
    const url = `https://phantombuster.s3.amazonaws.com/${orgFolder}/${agentFolder}/result.json`
    console.log(`[PB] Fetching results from: ${url}`)

    const resp = await fetch(url)
    if (!resp.ok) {
      // 404 = agent hasn't run yet, not an error
      if (resp.status === 404) {
        console.log(`[PB] No results yet for agent ${agentId}`)
        return []
      }
      throw new Error(`Failed to fetch S3 results: ${resp.status}`)
    }

    return resp.json()
  } catch (e) {
    console.error(`[PB] fetchAgentResults error for ${agentId}:`, e)
    return []
  }
}

/**
 * Launch the master scraper to monitor a LinkedIn post
 * This updates the post URL and launches the scraper
 */
export async function launchPostMonitor(postUrl: string): Promise<PbLaunchResult> {
  // The master scraper uses 'spreadsheetUrl' or 'postUrl' depending on config
  // We'll set both to be safe
  return launchAgent(PB_AGENTS.MASTER_SCRAPER, {
    spreadsheetUrl: postUrl,
    postUrl: postUrl,
    numberOfLinesPerLaunch: 1,  // Process this one post
  })
}

/**
 * Get engagement stats from the master scraper results
 * Returns aggregated counts of likers and commenters
 */
export async function getEngagementStats(postUrl: string): Promise<{
  reactions: number
  comments: number
  commenters: string[]
  likers: string[]
}> {
  const results = await fetchAgentResults(PB_AGENTS.MASTER_SCRAPER) as Array<{
    postsUrl?: string
    hasLiked?: string
    hasCommented?: string
    fullName?: string
  }>

  // Filter to this post's engagements
  const postEngagements = results.filter((r) => {
    const url = r.postsUrl || ""
    // Match by activity ID since URLs can have different params
    return url.includes(postUrl) || postUrl.includes(url.split("?")[0])
  })

  const likers = postEngagements
    .filter((r) => r.hasLiked === "true")
    .map((r) => r.fullName || "Unknown")

  const commenters = postEngagements
    .filter((r) => r.hasCommented === "true")
    .map((r) => r.fullName || "Unknown")

  return {
    reactions: likers.length,
    comments: commenters.length,
    likers,
    commenters,
  }
}

/**
 * Fetch all lists from PB
 */
export async function fetchAllLists(): Promise<any[]> {
  try {
    const resp = await pbFetch('/org-storage/lists/fetch-all')
    if (!resp.ok) {
      console.log('[PB Lists API] Failed:', resp.status)
      return []
    }
    const data = await resp.json()
    console.log('[PB Lists API] Lists:', data)
    return data.lists || data || []
  } catch (e) {
    console.error('[PB Lists API] Error:', e)
    return []
  }
}

/**
 * Fetch all leads from PB's centralized Leads database
 * This has enriched data from Profile Scraper
 */
export async function fetchAllLeadsFromAPI(): Promise<unknown[]> {
  try {
    // First, try to get all lists
    console.log('[PB] Fetching lists...')
    const lists = await fetchAllLists()
    console.log('[PB] Found lists:', lists.length)

    // If we have lists, fetch leads from each
    if (lists.length > 0) {
      const allLeads: unknown[] = []
      for (const list of lists) {
        const listId = list.id || list._id
        console.log(`[PB] Fetching leads from list: ${list.name || listId}`)

        const resp = await pbFetch(`/org-storage/leads/by-list/${listId}`, {
          method: 'POST',
          body: JSON.stringify({}),
        })

        if (resp.ok) {
          const data = await resp.json()
          const leads = data.leads || data.results || data || []
          console.log(`[PB] Got ${leads.length} leads from ${list.name}`)
          allLeads.push(...leads)
        }
      }
      return allLeads
    }

    // Fallback: try search endpoint
    console.log('[PB] Trying search endpoint...')
    const resp = await pbFetch('/org-storage/leads-objects/search', {
      method: 'POST',
      body: JSON.stringify({ filter: {}, limit: 1000 }),
    })

    if (resp.ok) {
      const data = await resp.json()
      console.log('[PB Leads API] Search result:', data)
      return data.leads || data.results || []
    }

    console.log('[PB] All methods failed')
    return []
  } catch (e) {
    console.error('[PB Leads API] Error:', e)
    return []
  }
}

/**
 * Check if PB API key is configured
 */
export async function hasApiKey(): Promise<boolean> {
  const key = await getApiKey()
  return !!key && key.length > 10
}
