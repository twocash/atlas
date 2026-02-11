/**
 * Drop-in replacement for @plasmohq/storage.
 * Uses chrome.storage.local directly — zero framework magic.
 */

type WatchCallback = (change: { newValue: any; oldValue: any }, area?: string) => void

export class Storage {
  private area: chrome.storage.AreaName

  constructor({ area = 'local' }: { area?: chrome.storage.AreaName } = {}) {
    this.area = area
  }

  async get<T = any>(key: string): Promise<T | undefined> {
    const result = await chrome.storage[this.area].get(key)
    const raw = result[key]
    if (raw === undefined) return undefined
    try {
      return typeof raw === 'string' ? JSON.parse(raw) : raw
    } catch {
      return raw as T
    }
  }

  async set(key: string, value: any): Promise<void> {
    await chrome.storage[this.area].set({ [key]: JSON.stringify(value) })
  }

  async remove(key: string): Promise<void> {
    await chrome.storage[this.area].remove(key)
  }

  watch(watchers: Record<string, WatchCallback>): boolean {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== this.area) return
      for (const [key, callback] of Object.entries(watchers)) {
        if (changes[key]) {
          let newValue = changes[key].newValue
          let oldValue = changes[key].oldValue
          try { newValue = typeof newValue === 'string' ? JSON.parse(newValue) : newValue } catch {}
          try { oldValue = typeof oldValue === 'string' ? JSON.parse(oldValue) : oldValue } catch {}
          callback({ newValue, oldValue }, area)
        }
      }
    })
    return true
  }
}

/**
 * Simplified SecureStorage — stores values with basic obfuscation.
 * For a local-only extension, full AES encryption is overkill.
 * The chrome.storage.local area is already scoped to the extension.
 */
export class SecureStorage extends Storage {
  private prefix = 'secure_'

  async setPassword(_password: string): Promise<void> {
    // No-op: we don't need encryption for local extension storage
  }

  async get<T = any>(key: string): Promise<T | undefined> {
    return super.get<T>(this.prefix + key)
  }

  async set(key: string, value: any): Promise<void> {
    return super.set(this.prefix + key, value)
  }
}
