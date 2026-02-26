#!/usr/bin/env bun
/**
 * rag-sync.ts — Client RAG Pipeline Ingestion
 *
 * Scans client document folders on grove-node-1 (local) and der-tier (via T: SMB mount),
 * uploads new/changed files to AnythingLLM workspaces for RAG retrieval.
 *
 * Runs on grove-node-1 where AnythingLLM Docker lives.
 * Scheduled via Windows Task Scheduler every 15 minutes.
 *
 * Usage:
 *   bun run scripts/rag-sync.ts
 *   bun run scripts/rag-sync.ts --dry-run    # show what would be uploaded
 *   bun run scripts/rag-sync.ts --verbose     # detailed logging
 */

import { readdir, stat, readFile, writeFile, mkdir, access } from "node:fs/promises"
import { join, relative, extname, basename, dirname } from "node:path"
import { createHash } from "node:crypto"

// ─── Configuration ────────────────────────────────────────

const LOCAL_CLIENTS_DIR = "C:\\GitHub\\clients"
const REMOTE_CLIENTS_DIR = "T:\\GitHub\\clients" // der-tier via SMB (capital G/H matches der-tier path)
const MANIFEST_PATH = join("C:\\github\\atlas", "data", "rag-manifest.json")
const LOG_PATH = join("C:\\github\\atlas", "data", "rag-sync.log")

const SUPPORTED_EXTENSIONS = new Set([".txt", ".md", ".pdf", ".docx", ".csv", ".json"])

// Client folder name → AnythingLLM workspace slug
const WORKSPACE_MAP: Record<string, string> = {
  monarch: "monarch",
  "take-flight": "take-flight",
  drumwave: "drumwave",
  "grove-corpus": "grove-corpus",
}

const DRY_RUN = process.argv.includes("--dry-run")
const VERBOSE = process.argv.includes("--verbose")

// ─── Types ────────────────────────────────────────────────

interface ManifestEntry {
  /** Original file path (for display/dedup) */
  path: string
  /** SHA-256 hash of file content */
  hash: string
  /** ISO timestamp of upload */
  uploadedAt: string
  /** AnythingLLM workspace slug */
  workspace: string
  /** docLocation returned by AnythingLLM upload API */
  docLocation: string
  /** Source: "local" (grove-node-1) or "remote" (der-tier via T:) */
  source: "local" | "remote"
}

interface Manifest {
  version: 1
  lastRun: string
  entries: Record<string, ManifestEntry> // keyed by normalized relative path
}

interface ScanResult {
  /** Absolute path to the file */
  absPath: string
  /** Relative path from clients root (e.g., "monarch/correspondence/note.txt") */
  relPath: string
  /** Which source */
  source: "local" | "remote"
  /** SHA-256 hash */
  hash: string
  /** Client folder name (first path segment) */
  clientFolder: string
}

// ─── Environment ──────────────────────────────────────────

function loadEnv(): { url: string; apiKey: string } {
  // Read .env file first, then let process.env override
  const envPath = join("C:\\github\\atlas", "apps", "telegram", ".env")
  const parsed: Record<string, string> = {}

  try {
    const text = require("node:fs").readFileSync(envPath, "utf-8") as string
    for (const line of text.split("\n")) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith("#")) continue
      const eqIdx = trimmed.indexOf("=")
      if (eqIdx === -1) continue
      const key = trimmed.slice(0, eqIdx).trim()
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "")
      parsed[key] = val
    }
  } catch {
    // Fall through to env vars only
  }

  // Process env overrides .env file
  const url = process.env.ANYTHINGLLM_URL || parsed.ANYTHINGLLM_URL || ""
  const apiKey = process.env.ANYTHINGLLM_API_KEY || parsed.ANYTHINGLLM_API_KEY || ""

  if (!url || !apiKey) {
    throw new Error(
      "Missing ANYTHINGLLM_URL or ANYTHINGLLM_API_KEY. " +
        "Set in apps/telegram/.env or environment."
    )
  }

  return { url: url.replace(/\/$/, ""), apiKey }
}

// ─── Logging ──────────────────────────────────────────────

const logLines: string[] = []

function log(msg: string): void {
  const ts = new Date().toISOString()
  const line = `[${ts}] ${msg}`
  console.log(line)
  logLines.push(line)
}

function logVerbose(msg: string): void {
  if (VERBOSE) log(msg)
}

async function flushLog(): Promise<void> {
  try {
    await mkdir(dirname(LOG_PATH), { recursive: true })
    const content = logLines.join("\n") + "\n"
    await writeFile(LOG_PATH, content, { flag: "a" })
  } catch (err) {
    console.error("Failed to write log:", (err as Error).message)
  }
}

// ─── Manifest ─────────────────────────────────────────────

async function loadManifest(): Promise<Manifest> {
  try {
    const raw = await readFile(MANIFEST_PATH, "utf-8")
    return JSON.parse(raw) as Manifest
  } catch {
    return { version: 1, lastRun: "", entries: {} }
  }
}

async function saveManifest(manifest: Manifest): Promise<void> {
  await mkdir(dirname(MANIFEST_PATH), { recursive: true })
  await writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2))
}

// ─── File Scanning ────────────────────────────────────────

async function hashFile(path: string): Promise<string> {
  const content = await readFile(path)
  return createHash("sha256").update(content).digest("hex")
}

async function isAccessible(dir: string): Promise<boolean> {
  try {
    await access(dir)
    return true
  } catch {
    return false
  }
}

async function scanDirectory(
  baseDir: string,
  source: "local" | "remote"
): Promise<ScanResult[]> {
  const results: ScanResult[] = []

  async function walk(dir: string): Promise<void> {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch (err) {
      logVerbose(`  Skip unreadable: ${dir} (${(err as Error).message})`)
      return
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry.name)

      if (entry.isDirectory()) {
        // Skip hidden directories
        if (entry.name.startsWith(".")) continue
        await walk(fullPath)
      } else if (entry.isFile()) {
        const ext = extname(entry.name).toLowerCase()
        if (!SUPPORTED_EXTENSIONS.has(ext)) continue

        const relPath = relative(baseDir, fullPath).replace(/\\/g, "/")
        const clientFolder = relPath.split("/")[0]

        if (!WORKSPACE_MAP[clientFolder]) {
          logVerbose(`  Skip unmapped client folder: ${clientFolder}`)
          continue
        }

        try {
          const hash = await hashFile(fullPath)
          results.push({
            absPath: fullPath,
            relPath,
            source,
            hash,
            clientFolder,
          })
        } catch (err) {
          log(`  WARN: Cannot hash ${fullPath}: ${(err as Error).message}`)
        }
      }
    }
  }

  await walk(baseDir)
  return results
}

// ─── AnythingLLM API ──────────────────────────────────────

async function checkHealth(config: { url: string; apiKey: string }): Promise<boolean> {
  try {
    const resp = await fetch(`${config.url}/api/v1/auth`, {
      headers: { Authorization: `Bearer ${config.apiKey}` },
      signal: AbortSignal.timeout(10_000),
    })
    return resp.ok
  } catch {
    return false
  }
}

async function listWorkspaces(
  config: { url: string; apiKey: string }
): Promise<{ slug: string; name: string }[]> {
  const resp = await fetch(`${config.url}/api/v1/workspaces`, {
    headers: { Authorization: `Bearer ${config.apiKey}` },
    signal: AbortSignal.timeout(10_000),
  })
  if (!resp.ok) throw new Error(`List workspaces failed: ${resp.status}`)
  const data = (await resp.json()) as { workspaces: { slug: string; name: string }[] }
  return data.workspaces ?? []
}

async function createWorkspace(
  config: { url: string; apiKey: string },
  name: string
): Promise<string> {
  const resp = await fetch(`${config.url}/api/v1/workspace/new`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!resp.ok) {
    const text = await resp.text().catch(() => "")
    throw new Error(`Create workspace failed: ${resp.status} ${text}`)
  }
  const data = (await resp.json()) as { workspace: { slug: string } }
  return data.workspace.slug
}

/**
 * Upload a file to AnythingLLM via multipart/form-data.
 * Returns the docLocation path needed for embedding.
 */
async function uploadDocument(
  config: { url: string; apiKey: string },
  filePath: string
): Promise<string> {
  const fileContent = await readFile(filePath)
  const fileName = basename(filePath)

  const formData = new FormData()
  formData.append("file", new Blob([fileContent]), fileName)

  const resp = await fetch(`${config.url}/api/v1/document/upload`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: formData,
    signal: AbortSignal.timeout(60_000), // large files may take a while
  })

  if (!resp.ok) {
    const text = await resp.text().catch(() => "")
    throw new Error(`Upload failed for ${fileName}: ${resp.status} ${text}`)
  }

  const data = (await resp.json()) as {
    success: boolean
    error: string | null
    documents: { location: string }[]
  }

  if (!data.success || !data.documents?.length) {
    throw new Error(`Upload returned no documents for ${fileName}: ${data.error ?? "unknown"}`)
  }

  return data.documents[0].location
}

/**
 * Embed an uploaded document into a workspace.
 * Uses the docLocation from the upload API response.
 */
async function embedInWorkspace(
  config: { url: string; apiKey: string },
  workspaceSlug: string,
  docLocation: string
): Promise<void> {
  const resp = await fetch(
    `${config.url}/api/v1/workspace/${workspaceSlug}/update-embeddings`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ adds: [docLocation], deletes: [] }),
      signal: AbortSignal.timeout(60_000),
    }
  )

  if (!resp.ok) {
    const text = await resp.text().catch(() => "")
    throw new Error(
      `Embed failed for ${docLocation} in ${workspaceSlug}: ${resp.status} ${text}`
    )
  }
}

// ─── Main ─────────────────────────────────────────────────

async function main(): Promise<void> {
  const startTime = Date.now()
  log("=== RAG Sync Start ===")
  if (DRY_RUN) log("DRY RUN MODE — no uploads will be performed")

  // ── Preflight ──
  const config = loadEnv()
  log(`AnythingLLM URL: ${config.url}`)

  // Check local clients dir
  if (!(await isAccessible(LOCAL_CLIENTS_DIR))) {
    log(`FATAL: Local clients directory not found: ${LOCAL_CLIENTS_DIR}`)
    process.exit(1)
  }
  log(`Local source: ${LOCAL_CLIENTS_DIR} [OK]`)

  // Check remote clients dir (non-fatal — der-tier may be offline)
  const remoteAvailable = await isAccessible(REMOTE_CLIENTS_DIR)
  if (remoteAvailable) {
    log(`Remote source: ${REMOTE_CLIENTS_DIR} [OK]`)
  } else {
    log(
      `WARN: Remote source ${REMOTE_CLIENTS_DIR} not reachable. ` +
        `Is der-tier online? Is T: drive mapped? (net use T: \\\\der-tier\\Der-TierC)`
    )
  }

  // Health check AnythingLLM
  const healthy = await checkHealth(config)
  if (!healthy) {
    log(
      "FATAL: AnythingLLM not responding. Is Docker running? " +
        "Try: docker start anythingllm"
    )
    process.exit(1)
  }
  log("AnythingLLM health check [OK]")

  // ── Verify/create workspaces ──
  const existingWorkspaces = await listWorkspaces(config)
  const existingSlugs = new Set(existingWorkspaces.map((w) => w.slug))
  log(`Existing workspaces: ${[...existingSlugs].join(", ")}`)

  for (const [folder, slug] of Object.entries(WORKSPACE_MAP)) {
    if (!existingSlugs.has(slug)) {
      if (DRY_RUN) {
        log(`  Would create workspace: ${slug}`)
      } else {
        log(`  Creating workspace: ${slug}`)
        const created = await createWorkspace(config, slug)
        log(`  Created workspace: ${created}`)
        existingSlugs.add(created)
      }
    }
  }

  // ── Scan files ──
  log("Scanning local files...")
  const localFiles = await scanDirectory(LOCAL_CLIENTS_DIR, "local")
  log(`  Found ${localFiles.length} supported files locally`)

  let remoteFiles: ScanResult[] = []
  if (remoteAvailable) {
    log("Scanning remote files (der-tier via T:)...")
    remoteFiles = await scanDirectory(REMOTE_CLIENTS_DIR, "remote")
    log(`  Found ${remoteFiles.length} supported files remotely`)
  }

  // ── Dedup: local wins on identical relPath + hash ──
  const localRelPaths = new Set(localFiles.map((f) => f.relPath))
  const dedupedRemote = remoteFiles.filter((rf) => {
    // If same relPath exists locally with same hash, skip remote
    const localMatch = localFiles.find((lf) => lf.relPath === rf.relPath)
    if (localMatch && localMatch.hash === rf.hash) {
      logVerbose(`  Dedup: skip remote ${rf.relPath} (identical to local)`)
      return false
    }
    // If same relPath exists locally with different hash, local wins
    if (localMatch) {
      logVerbose(`  Dedup: skip remote ${rf.relPath} (local version is different, local wins)`)
      return false
    }
    return true
  })

  const allFiles = [...localFiles, ...dedupedRemote]
  log(`Total files after dedup: ${allFiles.length}`)

  // ── Check manifest ──
  const manifest = await loadManifest()
  const toUpload: ScanResult[] = []

  for (const file of allFiles) {
    const existing = manifest.entries[file.relPath]
    if (existing && existing.hash === file.hash) {
      logVerbose(`  Unchanged: ${file.relPath}`)
      continue
    }
    toUpload.push(file)
    if (existing) {
      logVerbose(`  Changed: ${file.relPath} (hash differs)`)
    } else {
      logVerbose(`  New: ${file.relPath}`)
    }
  }

  log(`Files to upload: ${toUpload.length}`)

  if (toUpload.length === 0) {
    log("Nothing to sync — all files up to date.")
    manifest.lastRun = new Date().toISOString()
    if (!DRY_RUN) await saveManifest(manifest)
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
    log(`=== RAG Sync Complete (${elapsed}s, 0 uploads) ===`)
    await flushLog()
    return
  }

  // ── Upload & embed ──
  let uploaded = 0
  let failed = 0

  for (const file of toUpload) {
    const workspace = WORKSPACE_MAP[file.clientFolder]
    if (!workspace) {
      log(`  SKIP: No workspace mapping for ${file.clientFolder}`)
      continue
    }

    if (DRY_RUN) {
      log(`  [DRY] Would upload: ${file.relPath} → ${workspace}`)
      uploaded++
      continue
    }

    try {
      log(`  Uploading: ${file.relPath} → ${workspace}`)

      // Step 1: Upload to AnythingLLM document store
      const docLocation = await uploadDocument(config, file.absPath)
      logVerbose(`    docLocation: ${docLocation}`)

      // Step 2: Embed into workspace
      await embedInWorkspace(config, workspace, docLocation)
      log(`    Embedded in workspace: ${workspace}`)

      // Step 3: Update manifest
      manifest.entries[file.relPath] = {
        path: file.absPath,
        hash: file.hash,
        uploadedAt: new Date().toISOString(),
        workspace,
        docLocation,
        source: file.source,
      }
      uploaded++
    } catch (err) {
      log(`  ERROR: ${file.relPath}: ${(err as Error).message}`)
      failed++
    }
  }

  // ── Save manifest ──
  manifest.lastRun = new Date().toISOString()
  if (!DRY_RUN) await saveManifest(manifest)

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
  log(
    `=== RAG Sync Complete (${elapsed}s, ${uploaded} uploaded, ${failed} failed) ===`
  )
  await flushLog()

  if (failed > 0) process.exit(1)
}

main().catch((err) => {
  log(`FATAL: ${(err as Error).message}`)
  flushLog().finally(() => process.exit(1))
})
