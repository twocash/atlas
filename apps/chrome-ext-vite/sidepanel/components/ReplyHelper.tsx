import { useState, useRef, useEffect } from "react"
import type { LinkedInComment } from "~src/types/comments"
import { GROVE_CONTEXT } from "~src/types/comments"
import { MODEL_OPTIONS } from "~src/types/llm"

interface ReplyHelperProps {
  comment: LinkedInComment
  onClose: () => void
  onMarkReplied: (comment: LinkedInComment, finalReply: string) => void
}

export function ReplyHelper({ comment, onClose, onMarkReplied }: ReplyHelperProps) {
  const [draft, setDraft] = useState(comment.draftReply || "")
  const [feedback, setFeedback] = useState("")
  const [isGenerating, setIsGenerating] = useState(false)
  const [selectedModel, setSelectedModel] = useState("claude-haiku")
  const [showModelPicker, setShowModelPicker] = useState(false)
  const [isTopEngager, setIsTopEngager] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Auto-generate initial draft if none exists
  useEffect(() => {
    if (!draft && !isGenerating) {
      generateDraft()
    }
  }, [])

  const generateDraft = async (instruction?: string) => {
    setIsGenerating(true)

    const systemPrompt = `${GROVE_CONTEXT}

You are drafting a reply to a LinkedIn comment. Be concise and authentic.
${instruction ? `User's specific request: ${instruction}` : ''}

The comment is on Jim's post titled: "${comment.postTitle}"

Commenter info:
- Name: ${comment.author.name}
- Headline: ${comment.author.headline}
- Sector: ${comment.author.sector}
- Grove Alignment: ${comment.author.groveAlignment}

Reply ONLY with the draft text, no preamble or explanation.`

    const userPrompt = draft && instruction
      ? `Current draft:\n"${draft}"\n\nTheir comment:\n"${comment.content}"\n\nRefine the draft based on: ${instruction}`
      : `Their comment:\n"${comment.content}"\n\nDraft a reply.`

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

        // Auto-save draft to Notion
        if (comment.notionPageId) {
          try {
            await chrome.runtime.sendMessage({
              name: "SAVE_DRAFT",
              body: { notionPageId: comment.notionPageId, draftText: response.text },
            })
          } catch {
            // Silent fail - drafts are auto-saved but not critical
          }
        }
      } else if (response?.error) {
        console.error("LLM error:", response.error)
        setDraft(`Error: ${response.error}. Check that your Anthropic API key is set in Settings.`)
      }
    } catch (e) {
      console.error("Failed to generate draft:", e)
      setDraft("Failed to generate draft. Make sure your API key is configured in Settings.")
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

  const handleCopy = async () => {
    await navigator.clipboard.writeText(draft)
  }

  const handleOpenThread = () => {
    const url = comment.commentUrl || `https://www.linkedin.com/feed/update/${comment.postId}`
    // Reuse the same window instead of opening new tabs
    window.open(url, "atlas_linkedin_thread")
  }

  const handleMarkReplied = async () => {
    // Persist immediately — don't wait for toast
    onMarkReplied(comment, draft)

    // Update Notion if we have a page ID (fire-and-forget)
    if (comment.notionPageId) {
      chrome.runtime.sendMessage({
        name: "MARK_ENGAGEMENT_REPLIED",
        body: {
          notionPageId: comment.notionPageId,
          replyText: draft,
          notionContactId: comment.notionContactId,
          isTopEngager,
        },
      }).catch((e) => console.error("Failed to update Notion:", e))
    }

    // Queue follow-up (fire-and-forget)
    queueFollowUp().catch(() => {})
  }

  const queueFollowUp = async () => {
    try {
      const FOLLOWS_KEY = "atlas:pending-follows"
      const result = await chrome.storage.local.get(FOLLOWS_KEY)
      const follows = result[FOLLOWS_KEY] ?? []
      if (!follows.some((f: any) => f.profileUrl === comment.author.profileUrl)) {
        follows.push({
          profileUrl: comment.author.profileUrl,
          name: comment.author.name,
          queuedAt: new Date().toISOString(),
          fromPostTitle: comment.postTitle,
        })
        await chrome.storage.local.set({ [FOLLOWS_KEY]: follows })
      }
    } catch (e) {
      console.error("Failed to queue follow-up:", e)
    }
  }

  const handleSelectAllAndCopy = async () => {
    textareaRef.current?.select()
    await navigator.clipboard.writeText(draft)
  }

  const getModelLabel = () => {
    const model = MODEL_OPTIONS.find((m) => m.id === selectedModel)
    return model?.name || "Claude Haiku"
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-stretch justify-end z-50">
      <div className="w-full max-w-md bg-white flex flex-col shadow-xl">
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
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Comment Context */}
        <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-atlas-200 flex items-center justify-center text-atlas-700 font-medium text-sm">
              {comment.author.name.charAt(0)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-gray-800">{comment.author.name}</span>
                <span className="text-[9px] text-gray-400">•</span>
                <span className="text-[9px] text-gray-500">{comment.author.linkedInDegree}</span>
              </div>
              <div className="text-[10px] text-gray-500 truncate">{comment.author.headline}</div>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-[9px] px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded">{comment.author.sector}</span>
                <span className="text-[9px] text-gray-500">{comment.author.groveAlignment}</span>
                {comment.notionContactId && (
                  <>
                    <span className="text-gray-300">•</span>
                    <a
                      href={`https://notion.so/${comment.notionContactId.replace(/-/g, '')}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[9px] text-atlas-600 hover:text-atlas-700 hover:underline"
                    >
                      View in Notion ↗
                    </a>
                  </>
                )}
              </div>
            </div>
          </div>
          <div className="mt-3 text-xs text-gray-700 bg-white rounded p-2 border border-gray-200">
            "{comment.content}"
          </div>
          <div className="mt-2 text-[9px] text-gray-400">
            On: {comment.postTitle}
          </div>
        </div>

        {/* Draft Area */}
        <div className="flex-1 flex flex-col p-4 overflow-hidden">
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
            className="flex-1 text-sm border border-gray-300 rounded p-3 resize-none focus:outline-none focus:ring-2 focus:ring-atlas-500 focus:border-atlas-500 disabled:bg-gray-50 disabled:text-gray-500"
            placeholder={isGenerating ? "Generating draft..." : "Your reply will appear here. You can edit it directly."}
          />

          {/* Refinement Input */}
          <div className="mt-3">
            <div className="text-[10px] text-gray-500 mb-1.5">Refine the draft:</div>
            <div className="flex gap-2">
              <input
                type="text"
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleRefine()}
                placeholder="e.g., 'make it shorter' or 'add grove voice'"
                disabled={isGenerating}
                className="flex-1 text-sm border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-atlas-500 disabled:bg-gray-50"
              />
              <button
                onClick={handleRefine}
                disabled={isGenerating || !feedback.trim()}
                className="text-sm px-4 py-2 bg-atlas-600 text-white rounded hover:bg-atlas-700 disabled:opacity-50 transition-colors"
              >
                {isGenerating ? "..." : "Refine →"}
              </button>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="px-4 py-3 border-t border-gray-200 bg-gray-50">
          {/* Top Engager checkbox */}
          <label className="flex items-center gap-2 mb-3 cursor-pointer">
            <input
              type="checkbox"
              checked={isTopEngager}
              onChange={(e) => setIsTopEngager(e.target.checked)}
              className="w-4 h-4 text-atlas-600 rounded border-gray-300 focus:ring-atlas-500"
            />
            <span className="text-xs text-gray-700">⭐ Top Engager</span>
            <span className="text-[9px] text-gray-400">(flags this contact as high-value)</span>
          </label>

          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              disabled={!draft || isGenerating}
              className="flex-1 text-xs py-2 bg-white border border-gray-300 text-gray-700 rounded hover:bg-gray-50 disabled:opacity-50 transition-colors"
            >
              📋 Copy Reply
            </button>
            <button
              onClick={handleOpenThread}
              className="flex-1 text-xs py-2 bg-white border border-gray-300 text-gray-700 rounded hover:bg-gray-50 transition-colors"
            >
              ↗ Open Thread
            </button>
            <button
              onClick={handleMarkReplied}
              disabled={!draft || isGenerating}
              className="flex-1 text-xs py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50 transition-colors"
            >
              ✓ Mark Replied
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
