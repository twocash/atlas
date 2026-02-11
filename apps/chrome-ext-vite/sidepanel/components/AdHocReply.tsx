import { useState, useRef } from "react"
import { GROVE_CONTEXT } from "~src/types/comments"
import { MODEL_OPTIONS } from "~src/types/llm"

export function AdHocReply() {
  const [theirComment, setTheirComment] = useState("")
  const [context, setContext] = useState("")
  const [draft, setDraft] = useState("")
  const [feedback, setFeedback] = useState("")
  const [isGenerating, setIsGenerating] = useState(false)
  const [selectedModel, setSelectedModel] = useState("claude-haiku")
  const [showModelPicker, setShowModelPicker] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const generateDraft = async (instruction?: string) => {
    if (!theirComment.trim()) {
      setDraft("Please paste their comment first")
      return
    }

    setIsGenerating(true)

    const systemPrompt = `${GROVE_CONTEXT}

You are drafting a reply to a comment or message.
${instruction ? `User's specific request: ${instruction}` : ''}
${context ? `Additional context: ${context}` : ''}

Reply ONLY with the draft text, no preamble or explanation.`

    const userPrompt = draft && instruction
      ? `Current draft:\n"${draft}"\n\nTheir comment:\n"${theirComment}"\n\nRefine based on: ${instruction}`
      : `Their comment:\n"${theirComment}"\n\nDraft a reply.`

    try {
      const response = await chrome.runtime.sendMessage({
        name: "LLM_QUERY",
        body: {
          systemPrompt,
          prompt: userPrompt,
          maxTokens: 500,
          model: selectedModel,
        },
      })

      if (response?.text) {
        setDraft(response.text)
      } else if (response?.error) {
        setDraft(`Error: ${response.error}. Check API key in Settings.`)
      }
    } catch (e) {
      setDraft("Failed to generate. Check API key in Settings.")
    } finally {
      setIsGenerating(false)
      setFeedback("")
    }
  }

  const handleRefine = () => {
    if (feedback.trim()) {
      generateDraft(feedback.trim())
    }
  }

  const handleSelectAllAndCopy = async () => {
    textareaRef.current?.select()
    await navigator.clipboard.writeText(draft)
  }

  const handleReset = () => {
    setTheirComment("")
    setContext("")
    setDraft("")
    setFeedback("")
  }

  const getModelLabel = () => {
    const model = MODEL_OPTIONS.find((m) => m.id === selectedModel)
    return model?.name || "Claude Haiku"
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header with model selector */}
      <div className="px-4 py-2 border-b border-gray-200 flex items-center justify-between bg-gray-900">
        <div className="relative">
          <button
            onClick={() => setShowModelPicker(!showModelPicker)}
            className="flex items-center gap-1 text-sm text-white hover:bg-gray-800 px-2 py-1 rounded"
          >
            {getModelLabel()}
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {showModelPicker && (
            <div className="absolute top-full left-0 mt-1 bg-gray-800 rounded shadow-lg py-1 z-10 min-w-[180px]">
              {MODEL_OPTIONS.map((model) => (
                <button
                  key={model.id}
                  onClick={() => {
                    setSelectedModel(model.id)
                    setShowModelPicker(false)
                  }}
                  className={`w-full text-left px-3 py-1.5 text-sm hover:bg-gray-700 ${
                    selectedModel === model.id ? "text-white" : "text-gray-300"
                  }`}
                >
                  {model.name}
                  {selectedModel === model.id && " ✓"}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          onClick={handleReset}
          className="text-[10px] text-gray-400 hover:text-white"
        >
          Reset
        </button>
      </div>

      <div className="flex-1 flex flex-col p-4 overflow-y-auto space-y-4">
        {/* Their Comment Input */}
        <div>
          <label className="block text-[10px] font-medium text-gray-600 mb-1">
            Their comment:
          </label>
          <textarea
            value={theirComment}
            onChange={(e) => setTheirComment(e.target.value)}
            placeholder="Paste their comment or message here..."
            className="w-full h-24 text-sm border border-gray-300 rounded p-2 resize-none focus:outline-none focus:ring-2 focus:ring-atlas-500"
          />
        </div>

        {/* Optional Context */}
        <div>
          <label className="block text-[10px] font-medium text-gray-600 mb-1">
            Context (optional):
          </label>
          <input
            type="text"
            value={context}
            onChange={(e) => setContext(e.target.value)}
            placeholder="e.g., 'CTO at startup, interested in edge AI'"
            className="w-full text-sm border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-atlas-500"
          />
        </div>

        {/* Generate Button */}
        {!draft && (
          <button
            onClick={() => generateDraft()}
            disabled={!theirComment.trim() || isGenerating}
            className="w-full py-2 bg-atlas-600 text-white rounded hover:bg-atlas-700 disabled:opacity-50 text-sm font-medium"
          >
            {isGenerating ? "Generating..." : "Draft Reply"}
          </button>
        )}

        {/* Draft Area */}
        {draft && (
          <>
            <div className="border-t border-gray-200 pt-4">
              <div className="flex items-center justify-between mb-1">
                <label className="text-[10px] font-medium text-gray-600">Draft Reply:</label>
                <button
                  onClick={handleSelectAllAndCopy}
                  disabled={!draft || isGenerating}
                  className="text-[10px] text-atlas-600 hover:text-atlas-700 disabled:opacity-50 flex items-center gap-1"
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  Select All & Copy
                </button>
              </div>
              <textarea
                ref={textareaRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                disabled={isGenerating}
                className="w-full h-40 text-sm border border-gray-300 rounded p-3 resize-none focus:outline-none focus:ring-2 focus:ring-atlas-500 disabled:bg-gray-50"
              />
            </div>

            {/* Refinement */}
            <div>
              <div className="text-[10px] text-gray-500 mb-1.5">Refine the draft:</div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleRefine()}
                  placeholder="e.g., 'make it shorter' or 'add a question'"
                  disabled={isGenerating}
                  className="flex-1 text-sm border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-atlas-500 disabled:bg-gray-50"
                />
                <button
                  onClick={handleRefine}
                  disabled={isGenerating || !feedback.trim()}
                  className="text-sm px-4 py-2 bg-atlas-600 text-white rounded hover:bg-atlas-700 disabled:opacity-50"
                >
                  {isGenerating ? "..." : "Refine →"}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
