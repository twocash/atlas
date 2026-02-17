import { Storage } from "~src/lib/chrome-storage"
import { STORAGE_KEYS } from "~src/lib/storage"
import { ALARM_KEEPALIVE_MINUTES } from "~src/lib/constants"
import type { TaskQueueState } from "~src/types/leads"
import type { PostsState, MonitoredPost } from "~src/types/posts"
import { processQueue, skipCurrentLead, resetQueue } from "./lib/orchestrator"
import { routeLlmRequest } from "./lib/llm/router"
import {
  launchPostMonitor,
  getContainerStatus,
  getEngagementStats,
  hasApiKey,
  fetchAllLeadsFromAPI,
} from "~src/lib/phantombuster-api"
import {
  runFullSync,
  fetchCommentsNeedingReply,
  markEngagementReplied,
  saveDraft,
  enrichContactsFromCSV,
  getSegmentPendingCounts,
  fetchContactsBySegment,
  markContactsAsFollowing,
  markContactsAsFailed,
  dismissContacts,
  syncExtractedComments,
} from "~src/lib/sync-engine"
import {
  assessReplyContext as socraticAssessReplyContext,
  submitSocraticAnswer as socraticSubmitAnswer,
  cancelSocraticSession as socraticCancelSession,
} from "~src/lib/socratic-adapter"

const storage = new Storage({ area: "local" })

console.log("Atlas Orchestrator Initialized")

// Open side panel when extension icon is clicked
chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true })

// =============================================================================
// V3 ACTIVE CAPTURE: 4-Level Hierarchical Menus
// =============================================================================

import { createCaptureMenus, parseMenuItemId, type PromptComposition } from "~src/lib/capture-menus"
import { showCapturing, showSuccess, showError, setBadgeCount, clearBadge } from "~src/lib/badge"

const ATLAS_STATUS_SERVER = "http://localhost:3847"

// Create 4-level hierarchical menus on install/update
chrome.runtime.onInstalled.addListener(() => {
  createCaptureMenus()
})

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const menuItemId = info.menuItemId as string

  // Quick capture (bypass prompt composition)
  if (menuItemId === "atlas-quick") {
    await sendCapture(info, tab, { pillar: "Personal" })
    return
  }

  // Parse 4-level hierarchical menu selection
  const config = parseMenuItemId(menuItemId)
  if (!config) {
    // Intermediate menu click (pillar or action level), ignore
    console.log("Atlas: Intermediate menu click, waiting for voice selection:", menuItemId)
    return
  }

  // Full 4-level selection: Pillar -> Action -> Voice
  await sendCapture(info, tab, {
    pillar: config.pillar,
    action: config.action,
    voice: config.voice,
    promptIds: config.promptIds,
  })
})

interface CaptureOptions {
  pillar: string
  action?: string
  voice?: string
  promptIds?: PromptComposition
}

async function sendCapture(
  info: chrome.contextMenus.OnClickData,
  tab: chrome.tabs.Tab | undefined,
  options: CaptureOptions
) {
  const url = info.linkUrl || info.pageUrl || tab?.url
  if (!url) {
    console.error("Atlas: No URL to capture")
    return
  }

  showCapturing()

  const selectedText = info.selectionText || undefined
  const title = tab?.title || url

  console.log("Atlas: Capturing with V3 Active Capture", {
    url,
    pillar: options.pillar,
    action: options.action,
    voice: options.voice,
    promptIds: options.promptIds,
  })

  try {
    const response = await fetch(`${ATLAS_STATUS_SERVER}/capture`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url,
        title,
        selectedText,
        ...options,
      }),
    })

    const result = await response.json()

    if (result.ok) {
      showSuccess()
      console.log("Atlas: V3 capture successful")
    } else {
      showError()
      console.error("Atlas: V3 capture failed", result.error)
    }
  } catch (err) {
    showError()
    console.warn("Atlas: Backend offline", err)
  }
}

// Keepalive alarm (backup for heartbeat port)
chrome.alarms.create("atlas-keepalive", { periodInMinutes: ALARM_KEEPALIVE_MINUTES })

// Strategy config refresh alarm (hourly batch fetch from Notion)
chrome.alarms.create("atlas-strategy-refresh", { periodInMinutes: 60 })

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "atlas-keepalive") {
    // Just keep the service worker alive
  }

  if (alarm.name === "atlas-strategy-refresh") {
    import("~src/lib/strategy-config")
      .then(({ refreshStrategyConfig }) => refreshStrategyConfig())
      .then(() => console.log("[Atlas] Strategy config refreshed via alarm"))
      .catch((e) => console.warn("[Atlas] Strategy config refresh failed:", e))
  }
})

// --- Message Handlers ---

// Track current Atlas skill for emergency stop
let currentAtlasSkill: { skill: string; stopRequested: boolean } | null = null

// Rate limiting for selector health reports
let lastSelectorReportAt = 0
let selectorReportCount = 0

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  // --- Atlas Link Messages ---

  if (message.type === "atlas:ping") {
    sendResponse({ ok: true, connected: true })
    return true
  }

  if (message.type === "atlas:emergency_stop") {
    if (currentAtlasSkill) {
      currentAtlasSkill.stopRequested = true
      console.log("Atlas: Emergency stop requested for skill:", currentAtlasSkill.skill)
      // Broadcast stop event to sidepanel
      chrome.runtime.sendMessage({
        type: "atlas:skill:update",
        data: {
          skill: currentAtlasSkill.skill,
          step: "emergency_stop",
          status: "error",
          logs: ["Stopped by user"]
        }
      }).catch(() => {})
      currentAtlasSkill = null
    }
    sendResponse({ ok: true })
    return true
  }

  if (message.type === "atlas:skill:start") {
    const { skill } = message.data || {}
    currentAtlasSkill = { skill, stopRequested: false }
    console.log("Atlas: Skill started:", skill)
    sendResponse({ ok: true })
    return true
  }

  if (message.type === "atlas:skill:end") {
    currentAtlasSkill = null
    sendResponse({ ok: true })
    return true
  }

  if (message.type === "atlas:check_stop") {
    sendResponse({ stopRequested: currentAtlasSkill?.stopRequested ?? false })
    return true
  }

  if (message.name === "START_QUEUE") {
    (async () => {
      const queue = await storage.get<TaskQueueState>(STORAGE_KEYS.QUEUE_STATE)
      if (queue) {
        await storage.set(STORAGE_KEYS.QUEUE_STATE, {
          ...queue,
          status: "running",
          startedAt: queue.startedAt || new Date().toISOString(),
        })
        processQueue()
      }
    })()
    sendResponse({ ok: true })
    return true
  }

  if (message.name === "PAUSE_QUEUE") {
    storage.get<TaskQueueState>(STORAGE_KEYS.QUEUE_STATE).then(async (queue) => {
      if (queue) {
        await storage.set(STORAGE_KEYS.QUEUE_STATE, { ...queue, status: "paused" })
        console.log("Atlas: Queue paused by user")
      }
    })
    sendResponse({ ok: true })
    return true
  }

  if (message.name === "SKIP_LEAD") {
    skipCurrentLead()
    sendResponse({ ok: true })
    return true
  }

  if (message.name === "RESET_QUEUE") {
    resetQueue()
    sendResponse({ ok: true })
    return true
  }

  if (message.name === "LLM_QUERY") {
    routeLlmRequest({
      prompt: message.body?.prompt || "",
      systemPrompt: message.body?.systemPrompt,
      maxTokens: message.body?.maxTokens,
      model: message.body?.model,
    }).then((result) => sendResponse(result))
    return true // Keep channel open for async response
  }

  // --- Socratic Interview ---

  if (message.name === "SOCRATIC_ASSESS") {
    try {
      const result = socraticAssessReplyContext(message.body?.comment)
      sendResponse(result)
    } catch (e) {
      sendResponse({ type: 'error', message: e instanceof Error ? e.message : 'Assessment failed' })
    }
    return true
  }

  if (message.name === "SOCRATIC_ANSWER") {
    try {
      const result = socraticSubmitAnswer(
        message.body?.sessionId,
        message.body?.answerValue,
        message.body?.questionIndex ?? 0
      )
      sendResponse(result)
    } catch (e) {
      sendResponse({ type: 'error', message: e instanceof Error ? e.message : 'Answer failed' })
    }
    return true
  }

  if (message.name === "SOCRATIC_CANCEL") {
    socraticCancelSession(message.body?.sessionId)
    sendResponse({ ok: true })
    return true
  }

  // --- Post Monitoring ---

  if (message.name === "MONITOR_POST") {
    const postId = message.body?.postId
    if (!postId) {
      sendResponse({ ok: false, error: "No postId provided" })
      return true
    }

    ;(async () => {
      try {
        // Check API key
        if (!(await hasApiKey())) {
          await updatePostStatus(postId, "failed", "PhantomBuster API key not configured")
          sendResponse({ ok: false, error: "PB API key not configured" })
          return
        }

        // Get post URL from storage
        const postsState = await storage.get<PostsState>(STORAGE_KEYS.POSTS_STATE)
        const post = postsState?.posts.find((p) => p.id === postId)
        if (!post) {
          sendResponse({ ok: false, error: "Post not found" })
          return
        }

        // Launch PhantomBuster scraper
        console.log("Atlas: Launching PB monitor for post", post.url)
        const result = await launchPostMonitor(post.url)

        // Update post with container ID
        await updatePostStatus(postId, "running", undefined, result.containerId)

        // Poll for completion
        pollContainerStatus(postId, result.containerId)

        sendResponse({ ok: true, containerId: result.containerId })
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown error"
        console.error("Atlas: Monitor post error:", msg)
        await updatePostStatus(postId, "failed", msg)
        sendResponse({ ok: false, error: msg })
      }
    })()
    return true
  }

  if (message.name === "REFRESH_POST_STATS") {
    ;(async () => {
      try {
        const postsState = await storage.get<PostsState>(STORAGE_KEYS.POSTS_STATE)
        if (!postsState?.posts.length) {
          sendResponse({ ok: true })
          return
        }

        // Refresh stats for all posts
        for (const post of postsState.posts) {
          try {
            const stats = await getEngagementStats(post.url)
            await updatePostStats(post.id, stats.reactions, stats.comments)
          } catch (e) {
            console.log("Atlas: Failed to get stats for post", post.id, e)
          }
        }

        sendResponse({ ok: true })
      } catch (error) {
        sendResponse({ ok: false, error: String(error) })
      }
    })()
    return true
  }

  // --- Full Sync (PB → Notion → Comments) ---

  if (message.name === "RUN_FULL_SYNC") {
    ;(async () => {
      console.log("Atlas: Starting full sync...")
      try {
        const result = await runFullSync()
        console.log("Atlas: Sync complete:", result)
        sendResponse({ ok: true, result })
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        console.error("Atlas: Sync failed:", msg)
        sendResponse({ ok: false, error: msg })
      }
    })()
    return true
  }

  if (message.name === "FETCH_COMMENTS_NEEDING_REPLY") {
    ;(async () => {
      try {
        const comments = await fetchCommentsNeedingReply()
        sendResponse({ ok: true, comments })
      } catch (error) {
        sendResponse({ ok: false, error: String(error) })
      }
    })()
    return true
  }

  if (message.name === "SAVE_DRAFT") {
    const { notionPageId, draftText } = message.body || {}
    ;(async () => {
      try {
        const success = await saveDraft(notionPageId, draftText)
        sendResponse({ ok: success })
      } catch (error) {
        sendResponse({ ok: false, error: String(error) })
      }
    })()
    return true
  }

  if (message.name === "MARK_ENGAGEMENT_REPLIED") {
    const { notionPageId, replyText, notionContactId, isTopEngager } = message.body || {}
    ;(async () => {
      try {
        const success = await markEngagementReplied(notionPageId, replyText, notionContactId, isTopEngager)
        sendResponse({ ok: success })
      } catch (error) {
        sendResponse({ ok: false, error: String(error) })
      }
    })()
    return true
  }

  if (message.name === "SYNC_EXTRACTED_COMMENTS") {
    const { comments, postUrl, postTitle } = message.body || {}
    ;(async () => {
      try {
        const commentList = comments || []
        console.log(`[Atlas] Syncing ${commentList.length} extracted comments to Notion...`)

        // Phase B.2: Batch classify contacts before syncing
        let tierResults: Record<string, import("~src/types/classification").TierClassificationResult> | undefined
        try {
          const uniqueContacts = new Map<string, import("~src/types/classification").ClassificationInput>()
          for (const c of commentList) {
            if (c.isMe || !c.author?.profileUrl) continue
            if (!uniqueContacts.has(c.author.profileUrl)) {
              uniqueContacts.set(c.author.profileUrl, {
                profileUrl: c.author.profileUrl,
                name: c.author.name || '',
                headline: c.author.headline || '',
                commentText: c.content || '',
                degree: c.author.linkedInDegree,
              })
            }
          }

          if (uniqueContacts.size > 0) {
            const { classifyBatch, AnthropicClassificationProvider } = await import("~src/lib/ai-classifier")
            const { SecureStorage } = await import("~src/lib/chrome-storage")
            const secStore = new SecureStorage({ area: "local" })
            await secStore.setPassword("atlas-ext-v1")
            const apiKey = await secStore.get(STORAGE_KEYS.ANTHROPIC_KEY).catch(() => "") as string

            if (apiKey) {
              const provider = new AnthropicClassificationProvider(apiKey)
              const batchResult = await classifyBatch(Array.from(uniqueContacts.values()), provider)
              tierResults = batchResult.results
              console.log(`[Atlas] Classification: ${batchResult.aiClassified} AI, ${batchResult.cacheHits} cached, ${batchResult.fallbacks} rule-based`)
            } else {
              // No API key — use rule-based fallback
              const { classifyContactByRules } = await import("~src/lib/classification-rules")
              tierResults = {}
              for (const contact of uniqueContacts.values()) {
                tierResults[contact.profileUrl] = classifyContactByRules(contact)
              }
              console.log(`[Atlas] Classification: ${uniqueContacts.size} rule-based (no API key)`)
            }
          }
        } catch (classifyError) {
          console.warn('[Atlas] Classification failed, proceeding without tiers:', classifyError)
          // tierResults stays undefined — sync continues without tier data
        }

        const result = await syncExtractedComments(commentList, postUrl || '', postTitle, tierResults)
        console.log('[Atlas] DOM sync complete:', result)
        // Show badge count for new engagements
        if (result.engagementsCreated > 0) {
          setBadgeCount(result.engagementsCreated)
        }
        sendResponse({ ok: true, ...result })
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        console.error('[Atlas] DOM sync failed:', msg)
        sendResponse({ ok: false, error: msg })
      }
    })()
    return true
  }

  if (message.name === "CLEAR_BADGE") {
    clearBadge()
    sendResponse({ ok: true })
    return true
  }

  if (message.name === "REFRESH_STRATEGY_CONFIG") {
    ;(async () => {
      try {
        const { refreshStrategyConfig } = await import("~src/lib/strategy-config")
        const config = await refreshStrategyConfig()
        sendResponse({
          ok: true,
          archetypes: Object.keys(config.archetypes).length,
          modifiers: Object.keys(config.modifiers).length,
          rules: config.rules.length,
          hasCoreVoice: !!config.coreVoice,
        })
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        console.error("[Atlas] Manual strategy refresh failed:", msg)
        sendResponse({ ok: false, error: msg })
      }
    })()
    return true
  }

  if (message.name === "CLASSIFY_BATCH") {
    const { contacts } = message.body || {}
    ;(async () => {
      try {
        const { classifyBatch, AnthropicClassificationProvider } = await import("~src/lib/ai-classifier")
        const { SecureStorage } = await import("~src/lib/chrome-storage")
        const secStore = new SecureStorage({ area: "local" })
        await secStore.setPassword("atlas-ext-v1")
        const apiKey = await secStore.get(STORAGE_KEYS.ANTHROPIC_KEY).catch(() => "") as string

        if (!apiKey) {
          // No API key — classify with rules only
          const { classifyContactByRules } = await import("~src/lib/classification-rules")
          const results: Record<string, any> = {}
          for (const c of contacts || []) {
            results[c.profileUrl] = classifyContactByRules(c)
          }
          sendResponse({ ok: true, results, aiClassified: 0, cacheHits: 0, fallbacks: contacts?.length || 0 })
          return
        }

        const provider = new AnthropicClassificationProvider(apiKey)
        const result = await classifyBatch(contacts || [], provider)
        sendResponse({ ok: true, ...result })
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        console.error("[Atlas] CLASSIFY_BATCH failed:", msg)
        sendResponse({ ok: false, error: msg })
      }
    })()
    return true
  }

  if (message.name === "REPORT_SELECTOR_HEALTH") {
    const { repairPackets, postUrl } = message.body || {}
    ;(async () => {
      try {
        // Rate limit: max 3 reports per hour
        const now = Date.now()
        if (now - lastSelectorReportAt < 20 * 60 * 1000 && selectorReportCount >= 3) {
          console.log('[Atlas] Selector health report rate-limited')
          sendResponse({ ok: true, rateLimited: true })
          return
        }
        if (now - lastSelectorReportAt >= 60 * 60 * 1000) {
          selectorReportCount = 0
        }

        const { createFeedEntry } = await import("~src/lib/notion-api")
        for (const packet of (repairPackets || []).slice(0, 3)) {
          const notes = [
            `Selector: ${packet.selectorName}`,
            `Page: ${postUrl || packet.pageUrl}`,
            `Failed: ${packet.failedAt}`,
            `Expected: ${packet.expectedDescription}`,
            `Classes: ${packet.visibleClasses.slice(0, 10).join(', ')}`,
          ].join('\n')
          await createFeedEntry(
            `Selector Health: ${packet.selectorName}`,
            notes,
            "Alert"
          )
          selectorReportCount++
        }
        lastSelectorReportAt = now
        sendResponse({ ok: true, reported: repairPackets?.length || 0 })
      } catch (error) {
        console.error('[Atlas] Selector health report failed:', error)
        sendResponse({ ok: false, error: String(error) })
      }
    })()
    return true
  }

  if (message.name === "ENRICH_FROM_CSV") {
    const { leads } = message.body || {}
    ;(async () => {
      try {
        const result = await enrichContactsFromCSV(leads || [])
        sendResponse({ ok: true, updated: result })
      } catch (error) {
        sendResponse({ ok: false, error: String(error) })
      }
    })()
    return true
  }

  if (message.name === "TEST_LEADS_API") {
    console.log("Atlas: TEST_LEADS_API message received")
    ;(async () => {
      try {
        console.log("Atlas: About to call fetchAllLeadsFromAPI...")
        const leads = await fetchAllLeadsFromAPI()
        console.log("Atlas: fetchAllLeadsFromAPI returned:", typeof leads, Array.isArray(leads) ? leads.length : 'not array')
        console.log("Atlas: Full leads data:", leads)
        const count = Array.isArray(leads) ? leads.length : 0
        const sample = Array.isArray(leads) ? leads.slice(0, 1) : []
        sendResponse({ ok: true, count, sample })
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        console.error("Atlas: Leads API test EXCEPTION:", msg, error)
        sendResponse({ ok: false, error: msg })
      }
    })()
    return true
  }

  if (message.name === "GET_PHANTOM_STATUS") {
    const { containerId } = message.body || {}
    ;(async () => {
      try {
        const status = await getContainerStatus(containerId)
        sendResponse({ ok: true, ...status })
      } catch (error) {
        sendResponse({ ok: false, error: String(error) })
      }
    })()
    return true
  }

  // --- Outreach Notion Integration ---

  if (message.name === "GET_SEGMENT_COUNTS") {
    ;(async () => {
      try {
        const counts = await getSegmentPendingCounts()
        sendResponse({ ok: true, counts })
      } catch (error) {
        sendResponse({ ok: false, error: String(error) })
      }
    })()
    return true
  }

  if (message.name === "FETCH_SEGMENT_CONTACTS") {
    const { salesNavStatus } = message.body || {}
    ;(async () => {
      try {
        const contacts = await fetchContactsBySegment(salesNavStatus)
        sendResponse({ ok: true, contacts })
      } catch (error) {
        sendResponse({ ok: false, error: String(error) })
      }
    })()
    return true
  }

  if (message.name === "LOAD_QUEUE_FROM_NOTION") {
    const { leads, segment } = message.body || {}
    ;(async () => {
      try {
        await storage.set(STORAGE_KEYS.QUEUE_STATE, {
          status: "idle",
          leads,
          current: 0,
          activeTabId: null,
          lastActionTimestamp: 0,
        })
        sendResponse({ ok: true })
      } catch (error) {
        sendResponse({ ok: false, error: String(error) })
      }
    })()
    return true
  }

  if (message.name === "UPDATE_PROCESSED_CONTACTS") {
    const { contacts, contactPageIds, includeExtendedFields } = message.body || {}
    ;(async () => {
      try {
        // Support both old format (contactPageIds) and new format (contacts with salesNavUrl)
        const contactData = contacts || (contactPageIds || []).map((pageId: string) => ({ pageId }))
        const result = await markContactsAsFollowing(contactData, {
          includeRelationshipStage: includeExtendedFields,
          includeFollowDate: includeExtendedFields,
        })
        sendResponse({ ok: true, updated: result.updated, errors: result.errors })
      } catch (error) {
        sendResponse({ ok: false, error: String(error) })
      }
    })()
    return true
  }

  if (message.name === "DISMISS_CONTACTS") {
    const { pageIds } = message.body || {}
    console.log('[Atlas] DISMISS_CONTACTS received, pageIds:', pageIds)
    ;(async () => {
      try {
        const result = await dismissContacts(pageIds || [])
        console.log('[Atlas] dismissContacts result:', result)
        sendResponse({ ok: true, dismissed: result })
      } catch (error) {
        console.error('[Atlas] dismissContacts error:', error)
        sendResponse({ ok: false, error: String(error) })
      }
    })()
    return true
  }

  if (message.name === "AUTO_SYNC_QUEUE_RESULTS") {
    ;(async () => {
      try {
        const queue = await storage.get<TaskQueueState>(STORAGE_KEYS.QUEUE_STATE)
        if (!queue) {
          sendResponse({ ok: false, error: "No queue state found" })
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

        sendResponse({
          ok: true,
          succeeded: successResult.updated,
          failed: failedCount,
          errors: successResult.errors,
        })
      } catch (error) {
        sendResponse({ ok: false, error: String(error) })
      }
    })()
    return true
  }

  return false
})

// --- Post Monitoring Helpers ---

async function updatePostStatus(
  postId: string,
  status: MonitoredPost["scrapeStatus"],
  error?: string,
  containerId?: string
) {
  const postsState = await storage.get<PostsState>(STORAGE_KEYS.POSTS_STATE)
  if (!postsState) return

  const updated: PostsState = {
    ...postsState,
    posts: postsState.posts.map((p) =>
      p.id === postId
        ? {
            ...p,
            scrapeStatus: status,
            scrapeError: error,
            pbContainerId: containerId || p.pbContainerId,
            lastScrapedAt: status === "completed" ? new Date().toISOString() : p.lastScrapedAt,
          }
        : p
    ),
    lastUpdated: new Date().toISOString(),
  }
  await storage.set(STORAGE_KEYS.POSTS_STATE, updated)
}

async function updatePostStats(postId: string, reactions: number, comments: number) {
  const postsState = await storage.get<PostsState>(STORAGE_KEYS.POSTS_STATE)
  if (!postsState) return

  const updated: PostsState = {
    ...postsState,
    posts: postsState.posts.map((p) =>
      p.id === postId
        ? { ...p, reactions, comments }
        : p
    ),
    lastUpdated: new Date().toISOString(),
  }
  await storage.set(STORAGE_KEYS.POSTS_STATE, updated)
}

async function pollContainerStatus(postId: string, containerId: string) {
  const maxAttempts = 60 // Poll for up to 10 minutes (every 10s)
  let attempts = 0

  const poll = async () => {
    try {
      const status = await getContainerStatus(containerId)

      if (status.status === "finished") {
        // Scrape completed - fetch updated stats
        console.log("Atlas: PB scrape completed for post", postId)
        const postsState = await storage.get<PostsState>(STORAGE_KEYS.POSTS_STATE)
        const post = postsState?.posts.find((p) => p.id === postId)
        if (post) {
          const stats = await getEngagementStats(post.url)
          await updatePostStats(postId, stats.reactions, stats.comments)
        }
        await updatePostStatus(postId, "completed")
        return
      }

      if (status.status === "error") {
        await updatePostStatus(postId, "failed", status.exitMessage || "Scrape failed")
        return
      }

      // Still running - continue polling
      attempts++
      if (attempts < maxAttempts) {
        setTimeout(poll, 10000) // Poll every 10 seconds
      } else {
        await updatePostStatus(postId, "failed", "Timeout waiting for scrape to complete")
      }
    } catch (error) {
      console.error("Atlas: Poll error:", error)
      await updatePostStatus(postId, "failed", "Error checking scrape status")
    }
  }

  // Start polling after a short delay
  setTimeout(poll, 5000)
}

// --- Heartbeat Port ---

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === "heartbeat") {
    port.onMessage.addListener((msg) => {
      if (msg.type === "PING") {
        port.postMessage({ type: "PONG" })
      }
    })
  }
})

// --- Crash Recovery ---

chrome.runtime.onStartup.addListener(async () => {
  const queue = await storage.get<TaskQueueState>(STORAGE_KEYS.QUEUE_STATE)
  if (queue?.status === "running") {
    await storage.set(STORAGE_KEYS.QUEUE_STATE, { ...queue, status: "paused" })
    console.log("Atlas: Recovered from crash — queue paused for manual resume")
  }
})
