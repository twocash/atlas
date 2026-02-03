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
  let acceptedInvite = false

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

    // Pause before checking for invite
    await delay(getRandomDelay(500, 1000))

    // --- Step 3: Accept connection invite if pending ---
    acceptedInvite = await acceptConnectionInvite(logs)

    // --- Step 4: Scrape profile text ---
    const scrapedText = scrapeProfileText(pageType)
    if (scrapedText) {
      logs.push(`Scraped ${scrapedText.length} chars of profile text`)
    }

    // --- Step 5: Capture Sales Navigator URL if on Sales Nav page ---
    let salesNavUrl: string | undefined
    if (pageType === "sales_nav") {
      salesNavUrl = window.location.href
      logs.push(`Captured Sales Nav URL: ${salesNavUrl}`)
    }

    return {
      success: savedToList || followed || acceptedInvite, // Success if any action worked
      savedToList,
      followed,
      acceptedInvite,
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

  // FIRST: Check if already saved before clicking anything
  const alreadySavedIndicator = document.querySelector('[aria-label*="Saved"]')
  if (alreadySavedIndicator) {
    logs.push("Already saved in Sales Navigator — skipping")
    return true
  }

  // Also check for "Saved" button text
  const allButtons = document.querySelectorAll('button')
  for (const btn of allButtons) {
    const text = btn.textContent?.trim().toLowerCase() || ''
    const ariaLabel = btn.getAttribute('aria-label')?.toLowerCase() || ''
    if ((text === 'saved' || ariaLabel.includes('saved')) && !text.includes('save to')) {
      logs.push("Already saved (button state) — skipping")
      return true
    }
  }

  const saveBtn = await waitForElement(SELECTORS.saveButton)

  if (!saveBtn) {
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

  // FIRST: Check if already saved (before trying to click anything)
  // Look for button with "Saved" text (not "Save in Sales Navigator")
  const allButtons = document.querySelectorAll('button')
  for (const btn of allButtons) {
    const text = btn.textContent?.trim().toLowerCase() || ''
    // "Saved in Sales Navigator" or just "Saved" = already saved
    // "Save in Sales Navigator" = not saved yet
    if (text === 'saved' || text === 'saved in sales navigator') {
      logs.push("Already saved in Sales Navigator — skipping")
      return true
    }
  }

  // Also check aria-label for "Saved" state
  const savedByAria = document.querySelector('[aria-label*="Saved"][aria-label*="Sales Navigator"]')
  if (savedByAria) {
    logs.push("Already saved (aria-label) — skipping")
    return true
  }

  // Try the aria-label selectors
  let saveBtn = await waitForElement(SELECTORS.saveInSalesNavButton, 3000)

  // Fallback: search by visible text
  if (!saveBtn) {
    saveBtn = await waitForElementByText("Save in Sales Navigator", ["button", "a"], 3000)
  }

  if (!saveBtn) {
    logs.push("'Save in Sales Navigator' button not found")
    return false
  }

  // Double-check the button text before clicking
  const btnText = saveBtn.textContent?.trim().toLowerCase() || ''
  if (btnText.includes('saved') && !btnText.includes('save in')) {
    logs.push("Button shows 'Saved' state — skipping")
    return true
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

// --- Accept Connection Invite ---

async function acceptConnectionInvite(logs: string[]): Promise<boolean> {
  logs.push("Checking for pending connection invite...")

  // Look for Accept button (they sent us a connection request)
  // Common patterns:
  // - Button with text "Accept"
  // - Button with aria-label containing "Accept"
  // - Button in a pending invite section

  // Method 1: Find button by exact text "Accept"
  const allButtons = document.querySelectorAll('button')
  for (const btn of allButtons) {
    const text = btn.textContent?.trim().toLowerCase() || ''
    const ariaLabel = btn.getAttribute('aria-label')?.toLowerCase() || ''

    if (text === 'accept' || ariaLabel.includes('accept invitation') || ariaLabel.includes('accept connection')) {
      logs.push("Found Accept button — clicking...")
      await humanClick(btn)
      await delay(getRandomDelay(1000, 2000))
      logs.push("Accepted connection invite!")
      return true
    }
  }

  // Method 2: Check for pending invite indicator + Accept button
  const pendingSection = document.querySelector('[class*="pending"], [class*="invitation"]')
  if (pendingSection) {
    const acceptBtn = pendingSection.querySelector('button')
    if (acceptBtn && acceptBtn.textContent?.trim().toLowerCase().includes('accept')) {
      logs.push("Found Accept in pending section — clicking...")
      await humanClick(acceptBtn)
      await delay(getRandomDelay(1000, 2000))
      logs.push("Accepted connection invite!")
      return true
    }
  }

  logs.push("No pending invite found")
  return false
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
