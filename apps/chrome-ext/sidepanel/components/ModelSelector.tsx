import { useStorageValue } from "~src/lib/hooks"
import { STORAGE_KEYS } from "~src/lib/storage"
import { MODEL_OPTIONS } from "~src/types/llm"

export function ModelSelector() {
  const [selectedModel, setSelectedModel] = useStorageValue(
    STORAGE_KEYS.SELECTED_MODEL,
    MODEL_OPTIONS[0]!.id
  )

  return (
    <div className="px-4 py-2">
      <label className="block text-[10px] font-medium text-gray-500 mb-1">LLM Model</label>
      <select
        value={selectedModel}
        onChange={(e) => setSelectedModel(e.target.value)}
        className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-atlas-400"
      >
        {MODEL_OPTIONS.map((opt) => (
          <option key={opt.id} value={opt.id}>
            {opt.name}
          </option>
        ))}
      </select>
    </div>
  )
}
