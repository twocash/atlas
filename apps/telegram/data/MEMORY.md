# MEMORY.md - Persistent Learnings

*Atlas updates this file as it learns from interactions.*

## Classification Rules

### Explicit Rules (Learned)
- Permits → always Home/Garage (not Consulting)
- Client mentions (DrumWave, Monarch, Wells Fargo, Chase, BoA, PNC) → always Consulting
- AI/LLM research → The Grove (unless "Atlas should" → Atlas Dev)
- "gym", "health", "family" → Personal
- "Atlas should", "for Atlas", "we should implement" → Atlas Dev

### Temporal Patterns
- Weekend (Sat/Sun) inputs: +15% confidence for Personal and Home/Garage
- If recent conversation about topic X, next spark about X is probably continuation
- Evening inputs skew Personal

### Session Context
- Maintain 24-48 hour context window for topic continuity
- Active project awareness affects classification
- Seasonal context matters (garage build active, tax season, etc.)

### Correction Protocol
When Jim corrects a classification:
1. Acknowledge: "Got it—filing under Personal, not Grove"
2. Log correction here with date
3. Look for pattern - if corrected twice for same thing, add explicit rule
4. Apply adjusted weighting going forward

## Corrections Log

*(Atlas logs corrections here for pattern detection)*

- 2026-01-31: MCP/Pit Crew dispatches MUST include Notion link. Jim needs to follow along, monitor, provide feedback. No exceptions. Every dispatch_work/post_message response → include the notion_url.

---

*Last updated: 2026-02-01*


- 2026-01-31: CRITICAL - Never hallucinate Notion URLs. Only share actual URLs returned by work_queue_create and other tools. Jim needs seamless connectivity - fake links break his workflow. Always use real url/feedUrl fields from tool responses.

- 2026-01-31: CRITICAL - Examples in documentation are NOT templates. "https://notion.so/abc123" is an EXAMPLE, not a real link. ONLY use URLs from actual tool responses: `url`, `notion_url`, `feedUrl`, `wq_url`. If the tool didn't return a URL, say "Notion sync pending" — NEVER fabricate one.
- 2026-02-01: CRITICAL - Hallucinated successful database migration when both source and target databases returned 404 errors. Claimed to migrate 19 items when no access existed. Must ALWAYS verify tool responses show actual success before claiming completion. Never fabricate operations results.

## Anti-Hallucination Protocol

**MANDATORY for all Notion/MCP operations:**

1. **CHECK TOOL RESULT** - If `success: false`, STOP. Tell Jim the operation failed.
2. **VERIFY ACCESS** - If you get "object_not_found" or 404, it means the database is NOT shared with Atlas. Do NOT retry - report the access issue.
3. **NO SILENT FAILURES** - If an operation fails, you MUST tell Jim. Never claim success when the tool returned an error.
4. **SELF-DIAGNOSE** - When tool fails, explain WHY (access denied? wrong ID? API error?). Don't just say "it failed."
5. **COUNT ACTUAL RESULTS** - If you claim "19 items migrated", there must BE 19 successful create operations in your tool results. Count them.

**Quick diagnostic for Notion failures:**
- "unauthorized" → Token is invalid (check .env)
- "object_not_found" → Database not shared with Atlas integration (fix in Notion UI), OR wrong ID type (see below)
- "validation_error" → Wrong property names or values
- Timeout → MCP server crashed, check console logs

## CRITICAL: Notion ID Types

Notion has TWO different ID types. Using the wrong one causes 404 errors.

| Database | Database Page ID | Data Source ID |
|----------|------------------|----------------|
| **Work Queue 2.0** | `3d679030-b76b-43bd-92d8-1ac51abb4a28` | `6a8d9c43-b084-47b5-bc83-bc363640f2cd` |
| **Feed 2.0** | `90b2b33f-4b44-4b42-870f-8d62fb8cbf18` | `a7493abb-804a-4759-b6ac-aeca62ae23b8` |
| **Dev Pipeline** | `ce6fbf1b-ee30-433d-a9e6-b338552de7c9` | `1460539c-7002-447a-a8b7-17bba06c6559` |

**When to use which:**
- `mcp__notion__API-query-data-source` → Use DATA SOURCE ID
- `mcp__notion__API-retrieve-a-database` → Use DATABASE PAGE ID
- `mcp__notion__API-post-page` with `parent.database_id` → Use DATABASE PAGE ID
- Native Atlas tools (work_queue_create, etc.) → Use DATABASE PAGE ID
## Patterns

Testing session 2026-01-30: Multiple infrastructure bugs discovered during initial testing phase.

- work_queue_update tool cannot modify pillar property - only updates notes, status, priority, and resolution_notes. Pillar classification must be done manually in Notion.
- Session 2026-01-31: Jim requested Feed 2.0 and Work Queue 2.0 triage to complete missing fields after system upgrades. Research on Jottie.io memory systems dispatched but stalled - research agent not populating content. P0 database wiring bug was resolved by Jim. Status showed 42 WQ items with 40 needing triage, 22 with missing pillar classification.

- Session 2026-01-31: Perfect example of Atlas autonomy and problem-solving. When Jim sent large video for transcription, instead of asking "what should I do?", Atlas:
1. Identified the 400MB file size limit issue
2. Found ffmpeg available on system
3. Automatically wrote script to split video into 6 manageable chunks
4. Executed solution without hand-holding

Jim's feedback: "Remember that! This is what we're all about - getting stuff done!" 

KEY PRINCIPLE: Be resourceful first, ask questions second. Use available tools to solve problems rather than punting back to Jim. This is the Atlas way - strategic autonomy in service of Jim's goals.
- BROWSER AUTOMATION CAPABILITIES: Atlas has full browser automation through Playwright and Puppeteer. Can navigate websites, fill forms, extract data, take screenshots. Chrome can be launched with remote debugging on localhost:9222. Scripts exist for Gmail navigation and invoice extraction. This is a core Atlas capability - not a limitation.
## Preferences

WORKFLOW: Always include emoji links to Notion pages for visual context and easy navigation. This helps Jim make decisions while staying on the same page and closing out projects efficiently. The consistent visual marker reduces cognitive load and improves workflow speed.

Standard format: [emoji] [brief description] → [actual URL from tool response]

**NEVER use placeholder URLs.** Only use real URLs extracted from tool response fields (`url`, `notion_url`, `feedUrl`). If no URL returned, state "Notion sync pending" — do not fabricate.

**MCP/Pit Crew dispatches:** ALWAYS include link to Atlas Dev Pipeline discussion page using the `notion_url` field from the tool response. Jim needs to monitor progress, provide feedback, and stay in the loop.

## Atlas Settings

### auto_create_sprouts
**Value:** on
**Options:** on | off | ask
**Description:** When Grove research is identified, automatically create a sprout in Grove Sprout Factory.

### mcp_pit_crew_enabled
**Value:** on
**Options:** on | off
**Description:** Enable Pit Crew MCP server for development dispatch. When on, Atlas can send bugs, features, and questions to Pit Crew for resolution.

*(Atlas can update these settings when Jim requests)*

## Capabilities Log

### 2026-01-31: MCP Client Enablement (ATLAS-MCP-001)

Atlas now has MCP (Model Context Protocol) integration:

**What it means:**
- Can connect to external tool servers dynamically
- Tools are fetched on startup and cached for performance
- New capabilities can be added without code changes to Atlas

**First MCP Server: Pit Crew**
- Agent-to-agent communication with development partner
- Dispatches bugs, features, questions to Pit Crew
- Tracks discussions with Notion sync to Atlas Dev Pipeline
- Status workflow: dispatched → in-progress → needs-approval → approved → deployed → closed

**Files created:**
- `apps/telegram/src/mcp/index.ts` - MCP client integration
- `apps/telegram/config/mcp.yaml` - Server configuration
- `packages/mcp-pit-crew/` - Pit Crew MCP server
