import { useState } from "react"
import { usePostsState } from "~src/lib/posts-hooks"
import { useCommentsState } from "~src/lib/comments-hooks"
import type { PhantomSlot } from "~src/types/posts"
import { PostRow } from "./PostRow"
import { AddPostForm } from "./AddPostForm"
import { CommentQueue } from "./CommentQueue"

type SubView = "posts" | "replies" | "creating"

export function PostsTab() {
  const [postsState, { addPost, updatePost, removePost, refreshStats }] = usePostsState()
  const [commentsState, { updateComment, removeComment, replaceAllComments, loadMockData }] = useCommentsState()
  const [subView, setSubView] = useState<SubView>("posts")
  const [isRefreshing, setIsRefreshing] = useState(false)

  const handleAddPost = async (url: string, title: string) => {
    const post = await addPost(url, title)
    if (post) {
      setSubView("posts")
    }
  }

  const needsReplyCount = commentsState.comments.filter((c) => c.status === "needs_reply").length
  const [isSyncing, setIsSyncing] = useState(false)
  const [syncStatus, setSyncStatus] = useState<string | null>(null)

  const handleFullSync = async () => {
    setIsSyncing(true)
    setSyncStatus("PB → Classify → Notion → Replies...")

    try {
      const response = await chrome.runtime.sendMessage({ name: "RUN_FULL_SYNC" })

      if (response?.ok) {
        const r = response.result
        const summary = `${r.newContacts} new • ${r.newEngagements} engagements • ${r.commentsNeedingReply?.length || 0} need reply`
        setSyncStatus(summary)

        // Replace all comments with fresh data from Notion
        await replaceAllComments(r.commentsNeedingReply || [])

        setTimeout(() => setSyncStatus(null), 5000)
      } else {
        setSyncStatus(`Error: ${response?.error || "Unknown error"}`)
        setTimeout(() => setSyncStatus(null), 5000)
      }
    } catch (e) {
      setSyncStatus(`Error: ${e}`)
      setTimeout(() => setSyncStatus(null), 5000)
    } finally {
      setIsSyncing(false)
    }
  }

  const handleTestLeadsAPI = async () => {
    console.log("PostsTab: Test API button clicked")
    try {
      console.log("PostsTab: Sending TEST_LEADS_API message...")
      const response = await chrome.runtime.sendMessage({ name: "TEST_LEADS_API" })
      console.log("PostsTab: Got response:", response)
      alert(JSON.stringify(response, null, 2))
    } catch (e) {
      console.error("PostsTab: Error:", e)
      alert(`Error: ${e}`)
    }
  }

  const handleMonitor = async (postId: string) => {
    // Update status to running
    await updatePost(postId, { scrapeStatus: "running" })
    // Send message to background to launch PB scrape
    chrome.runtime.sendMessage({ name: "MONITOR_POST", body: { postId } })
  }

  const handleRefresh = async () => {
    setIsRefreshing(true)
    await refreshStats()
    setTimeout(() => setIsRefreshing(false), 2000)
  }

  // Calculate totals
  const totals = postsState.posts.reduce(
    (acc, post) => ({
      impressions: acc.impressions + post.impressions,
      reactions: acc.reactions + post.reactions,
      comments: acc.comments + post.comments,
    }),
    { impressions: 0, reactions: 0, comments: 0 }
  )

  
  // If creating, show the form in full focus (Gemini's recommendation)
  if (subView === "creating") {
    return (
      <div className="h-full flex flex-col p-4">
        <button
          onClick={() => setSubView("posts")}
          className="text-xs text-gray-500 hover:text-gray-900 mb-3 flex items-center gap-1 self-start"
        >
          ← Cancel
        </button>
        <AddPostForm
          onAdd={handleAddPost}
          onCancel={() => setSubView("posts")}
        />
      </div>
    )
  }

  // If viewing replies, render the CommentQueue instead
  if (subView === "replies") {
    return (
      <div className="flex flex-col h-full">
        {/* Sub-nav */}
        <div className="px-4 py-2 bg-white border-b border-gray-200 flex items-center gap-2">
          <button
            onClick={() => setSubView("posts")}
            className="text-[10px] text-gray-500 hover:text-gray-700"
          >
            ← Posts
          </button>
          <span className="text-[10px] text-gray-300">|</span>
          <span className="text-[10px] font-medium text-gray-800">Replies</span>
          {commentsState.comments.length === 0 && (
            <button
              onClick={loadMockData}
              className="ml-auto text-[9px] text-atlas-600 hover:text-atlas-700"
            >
              Load test data
            </button>
          )}
        </div>
        <CommentQueue
          comments={commentsState.comments}
          onUpdateComment={updateComment}
          onRemoveComment={removeComment}
          onBulkMarkReplied={() => {}}
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* HERO: Add Post Button (Gemini recommendation) */}
      <div className="p-4 bg-white">
        <button
          onClick={() => setSubView("creating")}
          className="w-full py-3 bg-white border-2 border-dashed border-gray-300 rounded-xl flex items-center justify-center gap-2 text-gray-600 font-medium hover:border-atlas-400 hover:text-atlas-600 transition-all group"
        >
          <div className="w-8 h-8 rounded-full bg-atlas-50 text-atlas-600 flex items-center justify-center group-hover:bg-atlas-100">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </div>
          <span className="text-sm">Add Post to Monitor</span>
        </button>
      </div>

      {/* Performance Stats */}
      <div className="px-4 pb-3 bg-white border-b border-gray-200">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Performance</h3>
          <button
            onClick={() => setSubView("replies")}
            className="text-[10px] text-atlas-600 hover:text-atlas-700 relative"
          >
            View Replies
            {needsReplyCount > 0 && (
              <span className="ml-1 bg-amber-500 text-white text-[8px] px-1.5 py-0.5 rounded-full">
                {needsReplyCount}
              </span>
            )}
          </button>
        </div>

        {/* Totals row */}
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="bg-gray-50 rounded p-2">
            <div className="text-lg font-bold text-gray-800">{totals.impressions.toLocaleString()}</div>
            <div className="text-[9px] text-gray-500 uppercase">Impressions</div>
          </div>
          <div className="bg-blue-50 rounded p-2">
            <div className="text-lg font-bold text-blue-600">{totals.reactions.toLocaleString()}</div>
            <div className="text-[9px] text-gray-500 uppercase">Reactions</div>
          </div>
          <div className="bg-green-50 rounded p-2">
            <div className="text-lg font-bold text-green-600">{totals.comments.toLocaleString()}</div>
            <div className="text-[9px] text-gray-500 uppercase">Comments</div>
          </div>
        </div>
      </div>

      {/* Posts list */}
      <div className="flex-1 overflow-y-auto">
        {postsState.posts.length === 0 ? (
          <div className="flex items-center justify-center h-full p-4">
            <div className="text-center">
              <div className="text-gray-400 text-sm mb-2">No posts monitored yet</div>
              <button
                onClick={() => setSubView("creating")}
                className="text-xs text-atlas-600 hover:underline"
              >
                Add your first post
              </button>
            </div>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {postsState.posts.map((post) => (
              <PostRow
                key={post.id}
                post={post}
                onMonitor={() => handleMonitor(post.id)}
                onRemove={() => removePost(post.id)}
                onAssignSlot={(slot) => updatePost(post.id, { phantomSlot: slot })}
              />
            ))}
          </div>
        )}
      </div>

      {/* Last updated footer */}
      {postsState.lastUpdated && (
        <div className="px-4 py-1 bg-gray-50 border-t border-gray-200">
          <span className="text-[9px] text-gray-400">
            Last updated: {new Date(postsState.lastUpdated).toLocaleString()}
          </span>
        </div>
      )}
    </div>
  )
}
