import { SELECTORS, SEGMENT_TO_LIST, INTRA_LEAD_DELAY, getRandomDelay } from "./constants"
import { waitForElement, waitForElementByText, humanClick, delay } from "./dom-helpers"
import type { Segment } from "~src/types/leads"
import type { ActionResultMessage } from "~src/types/messages"

type PageType = "sales_nav" | "regular"

function detectPageType(): PageType {
  return window.location.pathname.startsWith("/sales/") ? "sales_nav" : "regular"
}

/**
 * Execute Save and Follow on a LinkedIn profile page.
 * Handles both Sales Navigator and regular LinkedIn profiles.
 */
export async function executeSaveAndFollow(
  segment: Segment
): Promise<ActionResultMessage> {
  const logs: string[] = []
  const pageType = detectPageType()
  logs.push(`Page type: ${pageType} (${window.location.pathname})`)

  let savedToList = false
  let followed = false

  try {
    // --- Step 1: Save ---
    if (pageType === "sales_nav") {
      const result = await saveSalesNav(segment, logs)
      savedToList = result
    } else {
      const result = await saveRegularProfile(logs)
      savedToList = result
    }

    // Pause between save and follow
    await delay(getRandomDelay(INTRA_LEAD_DELAY.min, INTRA_LEAD_DELAY.max))

    // --- Step 2: Follow ---
    followed = await doFollow(logs)

    // --- Step 3: Scrape profile text ---
    const scrapedText = scrapeProfileText(pageType)
    if (scrapedText) {
      logs.push(`Scraped ${scrapedText.length} chars of profile text`)
    }

    // --- Step 4: Capture Sales Navigator URL if on Sales Nav page ---
    let salesNavUrl: string | undefined
    if (pageType === "sales_nav") {
      salesNavUrl = window.location.href
      logs.push(`Captured Sales Nav URL: ${salesNavUrl}`)
    }

    return {
      success: savedToList || followed, // Success if either action worked
      savedToList,
      followed,
      logs,
      scrapedText,
      salesNavUrl,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logs.push(`Error: ${message}`)
    return {
      success: false,
      savedToList,
      followed,
      error: message,
      errorType: "UNKNOWN",
      logs,
    }
  }
}

// --- Sales Nav Save-to-List ---

async function saveSalesNav(segment: Segment, logs: string[]): Promise<boolean> {
  logs.push("Looking for Save button (Sales Nav)...")
  const saveBtn = await waitForElement(SELECTORS.saveButton)

  if (!saveBtn) {
    const alreadySaved = document.querySelector('[aria-label*="Saved"]')
    if (alreadySaved) {
      logs.push("Already saved — skipping")
      return true
    }
    logs.push("Save button not found (Sales Nav)")
    return false
  }

  logs.push("Clicking Save button...")
  await humanClick(saveBtn)
  await delay(getRandomDelay(800, 1500))

  // Find the correct list by name
  const listName = SEGMENT_TO_LIST[segment]
  logs.push(`Looking for list: ${listName}`)

  const listOption = await waitForElementByText(listName, SELECTORS.listDropdownOption)
  if (listOption) {
    logs.push(`Found list: ${listName}`)
    await humanClick(listOption)
    logs.push("Saved to list")
    return true
  }

  // Fallback: first list option
  logs.push(`List "${listName}" not found — trying first available`)
  const firstOption = await waitForElement(SELECTORS.listDropdownOption)
  if (firstOption) {
    await humanClick(firstOption)
    logs.push("Saved to first available list")
    return true
  }

  logs.push("No list options found")
  return false
}

// --- Regular Profile: "Save in Sales Navigator" ---

async function saveRegularProfile(logs: string[]): Promise<boolean> {
  logs.push("Looking for 'Save in Sales Navigator' button...")

  // Try the aria-label selectors first
  let saveBtn = await waitForElement(SELECTORS.saveInSalesNavButton, 3000)

  // Fallback: search by visible text
  if (!saveBtn) {
    saveBtn = await waitForElementByText("Save in Sales Navigator", ["button", "a"], 3000)
  }

  if (!saveBtn) {
    // Check if already saved
    const alreadySaved =
      document.querySelector('[aria-label*="Saved"]') ||
      await waitForElementByText("Saved", ["button", "a", "span"], 1000)
    if (alreadySaved) {
      logs.push("Already saved — skipping")
      return true
    }
    logs.push("'Save in Sales Navigator' button not found")
    return false
  }

  logs.push("Clicking 'Save in Sales Navigator'...")
  await humanClick(saveBtn)
  await delay(getRandomDelay(1500, 3000))

  // After clicking, a modal/dropdown may appear for list selection
  // Try to find and select a list
  const listOption = await waitForElement(SELECTORS.listDropdownOption, 3000)
  if (listOption) {
    logs.push("List dropdown appeared — selecting first list")
    await humanClick(listOption)
    await delay(getRandomDelay(500, 1000))
  }

  logs.push("Save in Sales Navigator clicked")
  return true
}

// --- Follow ---

async function doFollow(logs: string[]): Promise<boolean> {
  logs.push("Looking for Follow button...")

  // First check if already following
  const alreadyFollowing = document.querySelector('[aria-label*="Following"]')
  if (alreadyFollowing) {
    logs.push("Already following — skipping")
    return true
  }

  const followBtn = await waitForElement(SELECTORS.followButton, 3000)

  if (!followBtn) {
    // Try text-based search
    const textBtn = await waitForElementByText("Follow", ["button"], 2000)
    if (textBtn) {
      const text = textBtn.textContent?.trim().toLowerCase() || ""
      if (text === "follow" || text.startsWith("follow ")) {
        logs.push("Clicking Follow button (text match)...")
        await humanClick(textBtn)
        logs.push("Followed")
        return true
      }
    }
    logs.push("Follow button not found — continuing")
    return false
  }

  // Check if it actually says "Following"
  const btnText = followBtn.textContent?.trim().toLowerCase() || ""
  if (btnText.includes("following")) {
    logs.push("Already following")
    return true
  }

  logs.push("Clicking Follow button...")
  await humanClick(followBtn)
  logs.push("Followed")
  return true
}

// --- Profile Scraping ---

function scrapeProfileText(pageType: PageType): string | undefined {
  const selectors =
    pageType === "sales_nav"
      ? [
          ".profile-topcard__summary",
          ".profile-topcard__headline",
          ".profile-topcard__title",
          "[data-anonymize='headline-text']",
          "[data-anonymize='person-name']",
        ]
      : [
          // Regular LinkedIn profile
          "h1",                           // Name
          ".text-body-medium",            // Headline
          ".pv-about-section",            // About section
          "div.display-flex.ph5 span",    // Headline area
          ".pv-top-card--experience-list", // Experience summary
        ]

  const parts: string[] = []
  for (const selector of selectors) {
    const el = document.querySelector(selector)
    if (el?.textContent?.trim()) {
      parts.push(el.textContent.trim())
    }
  }

  return parts.length > 0 ? parts.join("\n") : undefined
}
