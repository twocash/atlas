import { getRandomDelay, SCROLL_SETTLE, FOCUS_PAUSE } from "./constants"

/**
 * Wait for an element matching any of the given selectors to appear in the DOM.
 * Returns the first match found.
 */
export async function waitForElement(
  selectors: readonly string[],
  timeout = 8000
): Promise<HTMLElement | null> {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    for (const selector of selectors) {
      const el = document.querySelector<HTMLElement>(selector)
      if (el) return el
    }
    await delay(300)
  }
  return null
}

/**
 * Wait for an element containing specific text.
 * Searches buttons and list items by default.
 */
export async function waitForElementByText(
  text: string,
  containerSelectors: readonly string[] = ["button", "li", "label", "div[role='option']"],
  timeout = 5000
): Promise<HTMLElement | null> {
  const start = Date.now()
  const lowerText = text.toLowerCase()
  while (Date.now() - start < timeout) {
    for (const selector of containerSelectors) {
      const elements = document.querySelectorAll<HTMLElement>(selector)
      for (const el of elements) {
        if (el.textContent?.toLowerCase().includes(lowerText)) {
          return el
        }
      }
    }
    await delay(300)
  }
  return null
}

/**
 * Human-emulated click sequence:
 * 1. Scroll into view (smooth)
 * 2. Micro-pause (hover delay)
 * 3. Focus the element
 * 4. Short pause
 * 5. Click
 */
export async function humanClick(el: HTMLElement): Promise<void> {
  // 1. Scroll into view
  el.scrollIntoView({ behavior: "smooth", block: "center" })
  await delay(getRandomDelay(SCROLL_SETTLE.min, SCROLL_SETTLE.max))

  // 2. Focus
  el.dispatchEvent(new FocusEvent("focus", { bubbles: true }))
  await delay(getRandomDelay(FOCUS_PAUSE.min, FOCUS_PAUSE.max))

  // 3. Click
  el.click()
}

/** Async delay helper */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
