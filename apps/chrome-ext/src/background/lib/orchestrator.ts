import { Storage } from "@plasmohq/storage"
import { STORAGE_KEYS } from "~src/lib/storage"
import {
  INTER_LEAD_DELAY,
  BATCH_COOLDOWN,
  PAGE_LOAD_WAIT,
  SEGMENT_TO_LIST,
  getRandomDelay,
} from "~src/lib/constants"
import { debugLog } from "~src/lib/debug-log"
import type { TaskQueueState, LeadResult } from "~src/types/leads"
import {
  getOrCreateWorkerTab,
  waitForTabComplete,
  waitForContentReady,
} from "./tab-manager"
import { markContactsAsFollowing, markContactsAsFailed } from "~src/lib/sync-engine"

const storage = new Storage({ area: "local" })

async function getQueueState(): Promise<TaskQueueState | null> {
  return storage.get<TaskQueueState>(STORAGE_KEYS.QUEUE_STATE)
}

async function updateQueueState(patch: Partial<TaskQueueState>): Promise<void> {
  const current = await getQueueState()
  if (current) {
    await storage.set(STORAGE_KEYS.QUEUE_STATE, { ...current, ...patch })
  }
}

async function handleResult(leadId: string, result: LeadResult): Promise<void> {
  const queue = await getQueueState()
  if (!queue) return
  const leads = (queue.leads || []).map((l) =>
    l.id === leadId ? { ...l, status: result.status, result } : l
  )
  await storage.set(STORAGE_KEYS.QUEUE_STATE, { ...queue, leads })
}

export async function processQueue(): Promise<void> {
  const queue = await getQueueState()

  if (!queue || queue.status !== "running") {
    await debugLog("orchestrator", `Guard: status=${queue?.status || "null"}, stopping`)
    return
  }

  const leads = queue.leads || []
  if (queue.current >= leads.length) {
    await updateQueueState({ status: "completed", completedAt: new Date().toISOString() })
    await debugLog("orchestrator", `Queue completed (${leads.length} leads)`)

    // Auto-sync to Notion
    await autoSyncQueueResults()

    return
  }

  const currentLead = leads[queue.current]
  if (!currentLead) {
    await debugLog("orchestrator", `Lead at index ${queue.current} is null, skipping`)
    await updateQueueState({ current: queue.current + 1 })
    processQueue()
    return
  }

  await debugLog("orchestrator", `--- Lead ${queue.current + 1}/${leads.length}: ${currentLead.name} ---`)
  await debugLog("orchestrator", `URL: ${currentLead.profileUrl}`)
  await debugLog("orchestrator", `Segment: ${currentLead.segment}`)

  // Mark in_progress
  const leadsUpdated = leads.map((l, i) =>
    i === queue.current ? { ...l, status: "in_progress" as const } : l
  )
  await storage.set(STORAGE_KEYS.QUEUE_STATE, {
    ...queue,
    leads: leadsUpdated,
    lastActionTimestamp: Date.now(),
  })

  try {
    // Tab
    await debugLog("orchestrator", `Getting worker tab (existing: ${queue.activeTabId})`)
    const tabId = await getOrCreateWorkerTab(queue.activeTabId)
    await updateQueueState({ activeTabId: tabId })
    await debugLog("orchestrator", `Worker tab: ${tabId}`)

    // Navigate
    await debugLog("orchestrator", `Navigating to ${currentLead.profileUrl}`)
    await chrome.tabs.update(tabId, { url: currentLead.profileUrl })
    await waitForTabComplete(tabId)
    await debugLog("orchestrator", "Tab load complete")

    // Page settle
    const settleMs = getRandomDelay(PAGE_LOAD_WAIT.min, PAGE_LOAD_WAIT.max)
    await debugLog("orchestrator", `Page settle: ${settleMs}ms`)
    await new Promise<void>((r) => setTimeout(r, settleMs))

    // Hydration gate
    await debugLog("orchestrator", "Waiting for content script ready...")
    await waitForContentReady(tabId)
    await debugLog("orchestrator", "Content script ready")

    // Execute
    await debugLog("orchestrator", "Sending EXECUTE_ACTION")
    const result = await chrome.tabs.sendMessage(tabId, {
      name: "EXECUTE_ACTION",
      body: {
        action: "save_and_follow",
        listName: SEGMENT_TO_LIST[currentLead.segment],
        segment: currentLead.segment,
      },
    })

    await debugLog("orchestrator", `Result: success=${result.success} saved=${result.savedToList} followed=${result.followed}`)
    if (result.error) {
      await debugLog("orchestrator", `Error: ${result.error} (${result.errorType || "none"})`)
    }
    if (result.logs?.length) {
      for (const log of result.logs) {
        await debugLog("content", log)
      }
    }

    await handleResult(currentLead.id, {
      success: result.success,
      status: result.success ? "completed" : "failed",
      savedToList: result.savedToList,
      followed: result.followed,
      error: result.error,
      errorType: result.errorType,
      logs: result.logs || [],
      scrapedText: result.scrapedText,
      salesNavUrl: result.salesNavUrl,
      timestamp: Date.now(),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Orchestrator Error"
    await debugLog("orchestrator", `CATCH: ${message}`)

    await handleResult(currentLead.id, {
      success: false,
      status: "failed",
      error: message,
      errorType: "UNKNOWN",
      logs: [],
      timestamp: Date.now(),
    })
  }

  // Cooldown
  const leadsProcessed = queue.current + 1
  const isBatchBoundary = leadsProcessed % BATCH_COOLDOWN.every === 0 && leadsProcessed > 0

  if (isBatchBoundary) {
    const cooldown = getRandomDelay(BATCH_COOLDOWN.min, BATCH_COOLDOWN.max)
    await debugLog("orchestrator", `Batch cooldown: ${Math.round(cooldown / 1000)}s`)
    await new Promise<void>((r) => setTimeout(r, cooldown))
  } else {
    const delay = getRandomDelay(INTER_LEAD_DELAY.min, INTER_LEAD_DELAY.max)
    await debugLog("orchestrator", `Inter-lead delay: ${Math.round(delay / 1000)}s`)
    await new Promise<void>((r) => setTimeout(r, delay))
  }

  // Re-read state
  const freshState = await getQueueState()
  if (freshState?.status === "running") {
    await updateQueueState({ current: (freshState.current ?? queue.current) + 1 })
    await debugLog("orchestrator", `Advancing to lead ${(freshState.current ?? queue.current) + 2}`)
    processQueue()
  } else {
    await debugLog("orchestrator", `Queue no longer running (status=${freshState?.status})`)
  }
}

export async function skipCurrentLead(): Promise<void> {
  const queue = await getQueueState()
  if (!queue || queue.status !== "running") return
  const currentLead = (queue.leads || [])[queue.current]
  if (currentLead) {
    await debugLog("orchestrator", `Skipping lead: ${currentLead.name}`)
    await handleResult(currentLead.id, {
      success: false,
      status: "skipped",
      logs: ["Skipped by user"],
      timestamp: Date.now(),
    })
  }
}

export async function resetQueue(): Promise<void> {
  await debugLog("orchestrator", "Queue reset — clearing all leads")
  await storage.set(STORAGE_KEYS.QUEUE_STATE, {
    status: "idle",
    leads: [],
    current: 0,
    activeTabId: null,
    lastActionTimestamp: 0,
    startedAt: undefined,
    completedAt: undefined,
  })
}

/**
 * Auto-sync queue results to Notion after completion
 */
async function autoSyncQueueResults(): Promise<void> {
  try {
    await debugLog("orchestrator", "Triggering auto-sync to Notion...")

    const queue = await getQueueState()
    if (!queue) {
      await debugLog("orchestrator", "Auto-sync: No queue state found")
      return
    }

    // Separate successes and failures
    const succeeded = queue.leads
      .filter((l) => l.status === "completed" && l.notionPageId)
      .map((l) => ({
        pageId: l.notionPageId!,
        salesNavUrl: l.result?.salesNavUrl,
      }))

    const failed = queue.leads
      .filter((l) => l.status === "failed" && l.notionPageId)
      .map((l) => ({ pageId: l.notionPageId!, error: l.result?.error || "Unknown error" }))

    // Update both succeeded and failed contacts
    const successResult = await markContactsAsFollowing(succeeded, {
      includeRelationshipStage: true,
      includeFollowDate: true,
    })
    const failedCount = await markContactsAsFailed(failed)

    await debugLog(
      "orchestrator",
      `Auto-sync: ${successResult.updated} succeeded, ${failedCount} failed`
    )

    if (successResult.errors.length > 0) {
      await debugLog("orchestrator", `Auto-sync errors: ${successResult.errors.join("; ")}`)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await debugLog("orchestrator", `Auto-sync error: ${message}`)
    // Don't throw - auto-sync failure shouldn't break queue completion
  }
}
