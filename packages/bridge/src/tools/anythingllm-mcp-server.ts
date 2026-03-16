/**
 * AnythingLLM MCP Server — exposes AnythingLLM workspace tools to Claude Desktop & Claude Code.
 *
 * Architecture:
 *   Claude Desktop/Code spawns this as a child process via MCP config.
 *   Communication is JSON-RPC over stdio (MCP standard transport).
 *
 *   tools/list  → returns workspace tool schemas
 *   tools/call  → HTTP request to AnythingLLM API at localhost:3001
 *
 * Usage (in claude_desktop_config.json or .mcp.json):
 *   {
 *     "mcpServers": {
 *       "anythingllm": {
 *         "command": "bun",
 *         "args": ["run", "C:/github/atlas/packages/bridge/src/tools/anythingllm-mcp-server.ts"]
 *       }
 *     }
 *   }
 *
 * Environment:
 *   ANYTHINGLLM_URL     — Base URL (default: http://localhost:3001)
 *   ANYTHINGLLM_API_KEY — Bearer token for API auth
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js"

// ─── Config ──────────────────────────────────────────────────

const ANYTHINGLLM_URL = (process.env.ANYTHINGLLM_URL || "http://localhost:3001").replace(/\/$/, "")
const ANYTHINGLLM_API_KEY = process.env.ANYTHINGLLM_API_KEY || ""
const TIMEOUT_MS = 120_000
const EMBED_TIMEOUT_MS = 900_000 // Ollama CPU embedding can take 10-15 min for large docs
const UPLOAD_TIMEOUT_MS = 120_000
const VERSION = "1.1.0"

// ─── HTTP Helper ─────────────────────────────────────────────

async function apiRequest(
  method: string,
  path: string,
  body?: Record<string, unknown>,
): Promise<{ ok: boolean; data?: any; error?: string }> {
  if (!ANYTHINGLLM_API_KEY) {
    return { ok: false, error: "ANYTHINGLLM_API_KEY not set" }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const res = await fetch(`${ANYTHINGLLM_URL}/api/v1${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${ANYTHINGLLM_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    })

    if (!res.ok) {
      const text = await res.text().catch(() => "")
      return { ok: false, error: `HTTP ${res.status}: ${text}` }
    }

    const data = await res.json()
    return { ok: true, data }
  } catch (err: any) {
    if (err.name === "AbortError") {
      return { ok: false, error: `Request timed out after ${TIMEOUT_MS}ms` }
    }
    return { ok: false, error: err.message }
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Upload a file via multipart/form-data. Separate from apiRequest because
 * Content-Type must be omitted (browser sets boundary automatically).
 */
async function apiUpload(
  filePath: string,
): Promise<{ ok: boolean; data?: any; error?: string }> {
  if (!ANYTHINGLLM_API_KEY) {
    return { ok: false, error: "ANYTHINGLLM_API_KEY not set" }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS)

  try {
    const { readFileSync, existsSync } = await import("fs")
    const { basename } = await import("path")

    if (!existsSync(filePath)) {
      return { ok: false, error: `File not found: ${filePath}` }
    }

    const fileContent = readFileSync(filePath)
    const fileName = basename(filePath)
    const formData = new FormData()
    formData.append("file", new Blob([fileContent]), fileName)

    const res = await fetch(`${ANYTHINGLLM_URL}/api/v1/document/upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${ANYTHINGLLM_API_KEY}` },
      body: formData,
      signal: controller.signal,
    })

    if (!res.ok) {
      const text = await res.text().catch(() => "")
      return { ok: false, error: `HTTP ${res.status}: ${text}` }
    }

    const data = await res.json()
    return { ok: true, data }
  } catch (err: any) {
    if (err.name === "AbortError") {
      return { ok: false, error: `Upload timed out after ${UPLOAD_TIMEOUT_MS}ms` }
    }
    return { ok: false, error: err.message }
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Embed or remove documents from a workspace. Uses the longer embed timeout
 * because Ollama CPU embedding can take 10-15 minutes for large documents.
 */
async function apiEmbed(
  workspaceSlug: string,
  adds: string[],
  deletes: string[],
): Promise<{ ok: boolean; data?: any; error?: string }> {
  if (!ANYTHINGLLM_API_KEY) {
    return { ok: false, error: "ANYTHINGLLM_API_KEY not set" }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), EMBED_TIMEOUT_MS)

  try {
    const res = await fetch(
      `${ANYTHINGLLM_URL}/api/v1/workspace/${workspaceSlug}/update-embeddings`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ANYTHINGLLM_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ adds, deletes }),
        signal: controller.signal,
      },
    )

    if (!res.ok) {
      const text = await res.text().catch(() => "")
      return { ok: false, error: `HTTP ${res.status}: ${text}` }
    }

    const data = await res.json()
    return { ok: true, data }
  } catch (err: any) {
    if (err.name === "AbortError") {
      return { ok: false, error: `Embedding timed out after ${EMBED_TIMEOUT_MS / 1000}s — large docs with Ollama CPU can be slow` }
    }
    return { ok: false, error: err.message }
  } finally {
    clearTimeout(timeout)
  }
}

// ─── Tool Schemas ────────────────────────────────────────────

const TOOL_SCHEMAS = [
  {
    name: "anythingllm_list_workspaces",
    description:
      "List all available AnythingLLM workspaces. Returns workspace names, " +
      "slugs, and document counts. Use this to discover which knowledge bases " +
      "are available before querying them.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "anythingllm_chat",
    description:
      "Send a message to an AnythingLLM workspace and get a response. " +
      "In 'chat' mode, the workspace LLM generates a response using its " +
      "embedded documents as context. In 'query' mode, it returns matching " +
      "document chunks without LLM generation. Use this to ask questions " +
      "about documents stored in a workspace.",
    inputSchema: {
      type: "object" as const,
      properties: {
        workspace: {
          type: "string",
          description:
            "Workspace slug (e.g. 'grove-vision', 'grove-technical', 'monarch', " +
            "'take-flight'). Use anythingllm_list_workspaces to find available slugs.",
        },
        message: {
          type: "string",
          description: "The message or question to send to the workspace.",
        },
        mode: {
          type: "string",
          enum: ["chat", "query"],
          description:
            "Mode: 'chat' uses the workspace LLM to generate a response with " +
            "document context. 'query' returns raw matching document chunks " +
            "without LLM generation. Defaults to 'chat'.",
        },
      },
      required: ["workspace", "message"],
    },
  },
  {
    name: "anythingllm_search",
    description:
      "Perform a vector similarity search across a workspace's embedded documents. " +
      "Returns the most relevant document chunks ranked by similarity score. " +
      "Use this for precise document retrieval without LLM interpretation.",
    inputSchema: {
      type: "object" as const,
      properties: {
        workspace: {
          type: "string",
          description: "Workspace slug to search.",
        },
        query: {
          type: "string",
          description: "The search query text.",
        },
        topN: {
          type: "number",
          description: "Number of results to return. Defaults to 5.",
        },
      },
      required: ["workspace", "query"],
    },
  },
  {
    name: "anythingllm_get_workspace",
    description:
      "Get detailed information about a specific workspace including its " +
      "settings, document list, and configuration.",
    inputSchema: {
      type: "object" as const,
      properties: {
        workspace: {
          type: "string",
          description: "Workspace slug.",
        },
      },
      required: ["workspace"],
    },
  },
  {
    name: "anythingllm_upload_document",
    description:
      "Upload a file to AnythingLLM's document store. Returns the docLocation " +
      "path needed for embedding into a workspace. Supports text, markdown, PDF, " +
      "and other document formats. After uploading, use anythingllm_embed_document " +
      "to embed it into a specific workspace.",
    inputSchema: {
      type: "object" as const,
      properties: {
        file_path: {
          type: "string",
          description:
            "Absolute path to the file to upload (e.g. 'C:/github/clients/monarch/report.pdf').",
        },
      },
      required: ["file_path"],
    },
  },
  {
    name: "anythingllm_embed_document",
    description:
      "Embed an uploaded document into a workspace so it becomes searchable " +
      "via RAG. Use the docLocation returned by anythingllm_upload_document. " +
      "WARNING: Embedding large documents with Ollama CPU can take 10-15 minutes.",
    inputSchema: {
      type: "object" as const,
      properties: {
        workspace: {
          type: "string",
          description: "Workspace slug to embed the document into.",
        },
        doc_location: {
          type: "string",
          description:
            "Document location path from the upload response (e.g. 'custom-documents/report-abc123.json').",
        },
      },
      required: ["workspace", "doc_location"],
    },
  },
  {
    name: "anythingllm_remove_document",
    description:
      "Remove a document from a workspace (un-embed and delete). Use this " +
      "before re-uploading a replacement to prevent duplicate accumulation. " +
      "Get the doc_location from anythingllm_list_documents or anythingllm_get_workspace.",
    inputSchema: {
      type: "object" as const,
      properties: {
        workspace: {
          type: "string",
          description: "Workspace slug to remove the document from.",
        },
        doc_location: {
          type: "string",
          description: "Document location path to remove.",
        },
      },
      required: ["workspace", "doc_location"],
    },
  },
  {
    name: "anythingllm_list_documents",
    description:
      "List all documents embedded in a specific workspace. Returns document " +
      "names, locations, and metadata. Useful for finding doc_location values " +
      "needed for removal or replacement.",
    inputSchema: {
      type: "object" as const,
      properties: {
        workspace: {
          type: "string",
          description: "Workspace slug.",
        },
      },
      required: ["workspace"],
    },
  },
]

const TOOL_NAMES = new Set(TOOL_SCHEMAS.map((s) => s.name))

// ─── Tool Handlers ───────────────────────────────────────────

async function handleTool(
  name: string,
  args: Record<string, unknown>,
): Promise<{ text: string; isError?: boolean }> {
  switch (name) {
    case "anythingllm_list_workspaces": {
      const result = await apiRequest("GET", "/workspaces")
      if (!result.ok) {
        return { text: `Error listing workspaces: ${result.error}`, isError: true }
      }
      const workspaces = result.data?.workspaces || []
      // The /workspaces list endpoint doesn't include documents —
      // fetch each workspace's detail in parallel to get real document counts
      const summary = await Promise.all(workspaces.map(async (ws: any) => {
        const detail = await apiRequest("GET", `/workspace/${ws.slug}`)
        const docs = detail.ok
          ? (Array.isArray(detail.data?.workspace)
              ? detail.data.workspace[0]?.documents || []
              : detail.data?.workspace?.documents || [])
          : []
        return {
          name: ws.name,
          slug: ws.slug,
          documents: docs.length,
          threads: ws.threads?.length || 0,
          chatMode: ws.chatMode || "chat",
          createdAt: ws.createdAt,
        }
      }))
      return { text: JSON.stringify(summary, null, 2) }
    }

    case "anythingllm_chat": {
      const workspace = args.workspace as string
      const message = args.message as string
      const mode = (args.mode as string) || "chat"

      const result = await apiRequest("POST", `/workspace/${workspace}/chat`, {
        message,
        mode,
      })

      if (!result.ok) {
        return { text: `Error chatting with workspace '${workspace}': ${result.error}`, isError: true }
      }

      // Format response
      const response: any = {
        textResponse: result.data?.textResponse || "",
        type: result.data?.type || "textResponse",
      }

      // Include sources if available
      if (result.data?.sources?.length > 0) {
        response.sources = result.data.sources.map((s: any) => ({
          title: s.title,
          text: s.text?.slice(0, 500),
          score: s._distance ? (1 - s._distance).toFixed(3) : undefined,
        }))
      }

      return { text: JSON.stringify(response, null, 2) }
    }

    case "anythingllm_search": {
      const workspace = args.workspace as string
      const query = args.query as string
      const topN = (args.topN as number) || 5

      // Use chat endpoint in query mode for vector search
      const result = await apiRequest("POST", `/workspace/${workspace}/chat`, {
        message: query,
        mode: "query",
      })

      if (!result.ok) {
        return { text: `Error searching workspace '${workspace}': ${result.error}`, isError: true }
      }

      // Extract and format sources/chunks
      const sources = (result.data?.sources || []).slice(0, topN).map((s: any, i: number) => ({
        rank: i + 1,
        title: s.title || "Unknown",
        text: s.text,
        score: s._distance ? (1 - s._distance).toFixed(3) : undefined,
      }))

      return {
        text: JSON.stringify({
          query,
          workspace,
          resultCount: sources.length,
          results: sources,
        }, null, 2),
      }
    }

    case "anythingllm_get_workspace": {
      const workspace = args.workspace as string
      const result = await apiRequest("GET", `/workspace/${workspace}`)

      if (!result.ok) {
        return { text: `Error getting workspace '${workspace}': ${result.error}`, isError: true }
      }

      return { text: JSON.stringify(result.data, null, 2) }
    }

    case "anythingllm_upload_document": {
      const filePath = args.file_path as string

      const result = await apiUpload(filePath)
      if (!result.ok) {
        return { text: `Upload failed: ${result.error}`, isError: true }
      }

      const docs = result.data?.documents || []
      if (!result.data?.success || docs.length === 0) {
        return {
          text: `Upload returned no documents: ${result.data?.error ?? "unknown error"}`,
          isError: true,
        }
      }

      const { basename } = await import("path")
      return {
        text: JSON.stringify({
          success: true,
          fileName: basename(filePath),
          docLocation: docs[0].location,
          message: `Uploaded successfully. Use anythingllm_embed_document with doc_location="${docs[0].location}" to embed into a workspace.`,
        }, null, 2),
      }
    }

    case "anythingllm_embed_document": {
      const workspace = args.workspace as string
      const docLocation = args.doc_location as string

      const result = await apiEmbed(workspace, [docLocation], [])
      if (!result.ok) {
        return { text: `Embed failed in '${workspace}': ${result.error}`, isError: true }
      }

      return {
        text: JSON.stringify({
          success: true,
          workspace,
          docLocation,
          message: `Document embedded into '${workspace}'. It is now searchable via RAG.`,
        }, null, 2),
      }
    }

    case "anythingllm_remove_document": {
      const workspace = args.workspace as string
      const docLocation = args.doc_location as string

      const result = await apiEmbed(workspace, [], [docLocation])
      if (!result.ok) {
        return { text: `Remove failed in '${workspace}': ${result.error}`, isError: true }
      }

      return {
        text: JSON.stringify({
          success: true,
          workspace,
          docLocation,
          message: `Document removed from '${workspace}'.`,
        }, null, 2),
      }
    }

    case "anythingllm_list_documents": {
      const workspace = args.workspace as string
      const result = await apiRequest("GET", `/workspace/${workspace}`)

      if (!result.ok) {
        return { text: `Error listing documents in '${workspace}': ${result.error}`, isError: true }
      }

      // Handle AnythingLLM's array-returns-workspace jank
      const wsData = Array.isArray(result.data?.workspace)
        ? result.data.workspace[0]
        : result.data?.workspace
      const docs = (wsData?.documents || []).map((d: any) => ({
        name: d.name || d.title,
        docLocation: d.docpath || d.location,
        pinned: d.pinned || false,
        watched: d.watched || false,
        createdAt: d.createdAt,
      }))

      return {
        text: JSON.stringify({
          workspace,
          documentCount: docs.length,
          documents: docs,
        }, null, 2),
      }
    }

    default:
      return { text: `Unknown tool: ${name}`, isError: true }
  }
}

// ─── MCP Server Setup ────────────────────────────────────────

const server = new Server(
  { name: "anythingllm", version: VERSION },
  { capabilities: { tools: {} } },
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOL_SCHEMAS.map((schema) => ({
    name: schema.name,
    description: schema.description,
    inputSchema: schema.inputSchema,
  })),
}))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params

  if (!TOOL_NAMES.has(name)) {
    return {
      content: [{ type: "text" as const, text: `Unknown tool: ${name}` }],
      isError: true,
    }
  }

  const result = await handleTool(name, (args ?? {}) as Record<string, unknown>)

  return {
    content: [{ type: "text" as const, text: result.text }],
    isError: result.isError,
  }
})

// ─── Start ───────────────────────────────────────────────────

const transport = new StdioServerTransport()
await server.connect(transport)
