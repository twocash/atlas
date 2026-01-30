import { useState } from "react"
import { extractActivityId } from "~src/types/posts"

interface AddPostFormProps {
  onAdd: (url: string, title: string) => void
  onCancel: () => void
}

export function AddPostForm({ onAdd, onCancel }: AddPostFormProps) {
  const [url, setUrl] = useState("")
  const [title, setTitle] = useState("")
  const [error, setError] = useState("")

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError("")

    if (!url.trim()) {
      setError("Please enter a LinkedIn post URL")
      return
    }

    // Validate URL format
    if (!url.includes("linkedin.com")) {
      setError("Please enter a valid LinkedIn URL")
      return
    }

    // Try to extract activity ID
    const activityId = extractActivityId(url)
    if (!activityId) {
      setError("Could not extract post ID from URL. Make sure it's a LinkedIn post or activity URL.")
      return
    }

    // Use provided title or generate from activity ID
    const postTitle = title.trim() || `Post ...${activityId.slice(-8)}`
    onAdd(url.trim(), postTitle)
  }

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (text.includes("linkedin.com")) {
        setUrl(text)
        setError("")
      }
    } catch {
      // Clipboard access denied
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4">
        <div className="px-4 py-3 border-b border-gray-200">
          <h3 className="text-sm font-semibold text-gray-800">Add Post to Monitor</h3>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {/* URL input */}
          <div>
            <label className="block text-[10px] font-medium text-gray-600 mb-1">
              LinkedIn Post URL
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value)
                  setError("")
                }}
                placeholder="https://www.linkedin.com/posts/..."
                className="flex-1 text-xs border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-atlas-500 focus:border-atlas-500"
              />
              <button
                type="button"
                onClick={handlePaste}
                className="text-[10px] text-atlas-600 hover:text-atlas-700 px-2"
              >
                Paste
              </button>
            </div>
            {url && extractActivityId(url) && (
              <div className="mt-1 text-[9px] text-green-600">
                ✓ Activity ID: {extractActivityId(url)}
              </div>
            )}
          </div>

          {/* Title input */}
          <div>
            <label className="block text-[10px] font-medium text-gray-600 mb-1">
              Post Title (optional)
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., AI Infrastructure thoughts..."
              className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-atlas-500 focus:border-atlas-500"
            />
            <div className="mt-1 text-[9px] text-gray-400">
              A short description to identify this post
            </div>
          </div>

          {/* Error message */}
          {error && (
            <div className="text-[10px] text-red-600 bg-red-50 p-2 rounded">
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onCancel}
              className="text-xs text-gray-600 hover:text-gray-800 px-3 py-1.5"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="text-xs bg-atlas-600 text-white px-3 py-1.5 rounded hover:bg-atlas-700"
            >
              Add Post
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
