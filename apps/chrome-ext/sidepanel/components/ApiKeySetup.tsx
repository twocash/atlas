import { useState, useEffect } from "react"
import { Storage } from "@plasmohq/storage"
import { SecureStorage } from "@plasmohq/storage/secure"
import { STORAGE_KEYS } from "~src/lib/storage"

const storage = new Storage({ area: "local" })
const secureStorage = new SecureStorage({ area: "local" })

// SecureStorage requires a password for encryption
const STORAGE_PASSWORD = "atlas-ext-v1"

export function ApiKeySetup() {
  const [anthropicKey, setAnthropicKey] = useState("")
  const [openrouterKey, setOpenrouterKey] = useState("")
  const [pbKey, setPbKey] = useState("")
  const [notionKey, setNotionKey] = useState("")
  const [saved, setSaved] = useState(false)
  const [initialized, setInitialized] = useState(false)

  useEffect(() => {
    secureStorage.setPassword(STORAGE_PASSWORD)
    Promise.all([
      secureStorage.get(STORAGE_KEYS.ANTHROPIC_KEY).catch(() => ""),
      secureStorage.get(STORAGE_KEYS.OPENROUTER_KEY).catch(() => ""),
      storage.get(STORAGE_KEYS.PB_API_KEY).catch(() => ""),
      storage.get(STORAGE_KEYS.NOTION_KEY).catch(() => ""),
    ]).then(([ak, ok, pk, nk]) => {
      if (ak) setAnthropicKey(ak as string)
      if (ok) setOpenrouterKey(ok as string)
      if (pk) setPbKey(pk as string)
      if (nk) setNotionKey(nk as string)
      setInitialized(true)
    })
  }, [])

  const handleSave = async () => {
    await secureStorage.setPassword(STORAGE_PASSWORD)
    if (anthropicKey.trim()) {
      await secureStorage.set(STORAGE_KEYS.ANTHROPIC_KEY, anthropicKey.trim())
    }
    if (openrouterKey.trim()) {
      await secureStorage.set(STORAGE_KEYS.OPENROUTER_KEY, openrouterKey.trim())
    }
    if (pbKey.trim()) {
      await storage.set(STORAGE_KEYS.PB_API_KEY, pbKey.trim())
    }
    if (notionKey.trim()) {
      await storage.set(STORAGE_KEYS.NOTION_KEY, notionKey.trim())
    }
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  if (!initialized) return null

  return (
    <div className="px-4 py-2 space-y-2">
      <div className="text-[10px] font-medium text-gray-500">API Keys</div>

      <div>
        <label className="block text-[10px] text-gray-400 mb-0.5">Anthropic</label>
        <input
          type="password"
          value={anthropicKey}
          onChange={(e) => setAnthropicKey(e.target.value)}
          placeholder="sk-ant-..."
          className="w-full text-xs border border-gray-300 rounded px-2 py-1 font-mono focus:outline-none focus:ring-1 focus:ring-atlas-400"
        />
      </div>

      <div>
        <label className="block text-[10px] text-gray-400 mb-0.5">OpenRouter</label>
        <input
          type="password"
          value={openrouterKey}
          onChange={(e) => setOpenrouterKey(e.target.value)}
          placeholder="sk-or-..."
          className="w-full text-xs border border-gray-300 rounded px-2 py-1 font-mono focus:outline-none focus:ring-1 focus:ring-atlas-400"
        />
      </div>

      <div className="pt-2 border-t border-gray-200">
        <label className="block text-[10px] text-gray-400 mb-0.5">PhantomBuster API Key</label>
        <input
          type="password"
          value={pbKey}
          onChange={(e) => setPbKey(e.target.value)}
          placeholder="Your PB API key..."
          className="w-full text-xs border border-gray-300 rounded px-2 py-1 font-mono focus:outline-none focus:ring-1 focus:ring-atlas-400"
        />
        <div className="text-[9px] text-gray-400 mt-0.5">
          Required for post monitoring.
        </div>
      </div>

      <div>
        <label className="block text-[10px] text-gray-400 mb-0.5">Notion Integration Token</label>
        <input
          type="password"
          value={notionKey}
          onChange={(e) => setNotionKey(e.target.value)}
          placeholder="secret_..."
          className="w-full text-xs border border-gray-300 rounded px-2 py-1 font-mono focus:outline-none focus:ring-1 focus:ring-atlas-400"
        />
        <div className="text-[9px] text-gray-400 mt-0.5">
          Required for syncing contacts/engagements. Find it in Notion → Integrations.
        </div>
      </div>

      <button
        onClick={handleSave}
        className="w-full py-1 rounded text-xs font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
      >
        {saved ? "Saved" : "Save Keys"}
      </button>
    </div>
  )
}
