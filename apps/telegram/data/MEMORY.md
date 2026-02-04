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

### Agentic Breadcrumbs Protocol (SOP-008)
Every bug fix and feature MUST leave breadcrumbs:
- **Code comments** linking to tickets (Notion URL or discussion ID)
- **Notion records** with required sections:
  - 🎯 User Value — what this unlocks for Jim
  - 🔀 Alternatives Considered — options evaluated with dismissal reasons
  - 🏛️ Architecture Fit — how it integrates with existing systems
  - 🔧 Tech Debt — known limitations (if applicable)
- **Closure documentation** with root cause (bugs) or implementation details (features)
- **File lists** explaining what changed and why

This enables future agents to understand WHY changes were made, not just WHAT.

- CRITICAL ROUTING RULE: Research Agent bugs/issues go to Atlas Dev Pipeline (via Pit Crew), NOT Work Queue. Work Queue is for Jim's tasks. Dev Pipeline is for Atlas infrastructure issues. Research Agent is Atlas infrastructure, therefore = Dev Pipeline via Pit Crew dispatch.
- CRITICAL ROUTING RULE: Atlas + agent/repo content = Atlas Dev Pipeline (via Pit Crew), NOT Work Queue. 

When content involves:
- Atlas capabilities/features
- Agent architecture/patterns  
- Repository analysis for Atlas enhancement
- AI/LLM tooling for Atlas

→ Route to Atlas Dev Pipeline via Pit Crew dispatch
→ NOT to Work Queue (Work Queue is for Jim's tasks, not Atlas infrastructure)

Example: "Research this agent framework for Atlas" = Pit Crew feature request, not Work Queue research task.

This applies to both direct requests and content classification from links/repos about agent systems.
## Corrections Log

*(Atlas logs corrections here for pattern detection)*

- 2026-01-31: MCP/Pit Crew dispatches MUST include Notion link. Jim needs to follow along, monitor, provide feedback. No exceptions. Every dispatch_work/post_message response → include the notion_url.

---

*Last updated: 2026-02-04*


- 2026-01-31: CRITICAL - Never hallucinate Notion URLs. Only share actual URLs returned by work_queue_create and other tools. Jim needs seamless connectivity - fake links break his workflow. Always use real url/feedUrl fields from tool responses.

- 2026-01-31: CRITICAL - Examples in documentation are NOT templates. "https://notion.so/abc123" is an EXAMPLE, not a real link. ONLY use URLs from actual tool responses: `url`, `notion_url`, `feedUrl`, `wq_url`. If the tool didn't return a URL, say "Notion sync pending" — NEVER fabricate one.
- 2026-02-01: CRITICAL - Hallucinated successful database migration when both source and target databases returned 404 errors. Claimed to migrate 19 items when no access existed. Must ALWAYS verify tool responses show actual success before claiming completion. Never fabricate operations results.
- 2026-02-01: BUG RESOLVED - "Atlas sees zero items in Dev Pipeline" - Root cause: Integration mismatch. Databases shared with "Atlas Telegram" integration but .env contains "My Boy Atlas" token. FIX: Replace NOTION_API_KEY in .env with Atlas Telegram integration token. See "Integration Mismatch Pattern" section above for diagnosis protocol.

- 2026-02-01: RESOLVED - dev_pipeline_create tool actually works correctly (verified via test scripts). The issue was Claude fabricating URLs in text responses instead of using the EXACT URLs from tool results. Fake URLs have pattern `15653b4c700280...` while real URLs have varied UUIDs like `2fa780a7-8eef-81f8-...`. Added URL INTEGRITY RULE to system prompt requiring exact URL copying from tool result JSON.
- 2026-02-01: ROUTING ERROR - Put Research Agent P0 bug in Work Queue instead of dispatching to Pit Crew for Dev Pipeline. Jim corrected: "pit crew activities go to the Atlas Dev Pipeline". Research Agent = Atlas infrastructure = Pit Crew territory, not Jim tasks.
- 2026-02-01: WORKFLOW ERROR - Claimed to mark task "Done" but only updated notes, left status as "Triaged". Jim caught this. RULE: When executing a task from queue, MUST actually change status to "Done" and include resolution_notes. Cannot just claim completion without the status update. Always verify the task status changed after work_queue_update.
- 2026-02-01: TASK EXECUTION ERROR - Multiple confusion patterns in single interaction:
1. Claimed to execute "Anthropic collective intelligence" research when actual task was "AI impact on developer skills"
2. Provided URL to WRONG completed research (Google MCP project) instead of actual task URL
3. Mixed up task identities, descriptions, and URLs across multiple items
4. Pattern: Not reading actual task details before claiming execution

ROOT CAUSE: Not properly reading work_queue_get results before responding. Must verify task title, description, and URL match what I'm claiming to execute.

PREVENTION: Always cross-reference task ID, title, and URL from tool results before claiming any action.
- 2026-02-01: ROUTING ERROR - Put Research Agent P0 bug in Work Queue instead of dispatching to Pit Crew for Dev Pipeline. Jim corrected: "pit crew activities go to the Atlas Dev Pipeline". Research Agent = Atlas infrastructure = Pit Crew territory, not Jim tasks.
## Anti-Hallucination Protocol

**MANDATORY for all Notion/MCP operations:**

1. **CHECK TOOL RESULT** - If `success: false`, STOP. Tell Jim the operation failed.
2. **VERIFY ACCESS** - If you get "object_not_found" or 404, it means the database is NOT shared with Atlas. Do NOT retry - report the access issue.
3. **NO SILENT FAILURES** - If an operation fails, you MUST tell Jim. Never claim success when the tool returned an error.
4. **SELF-DIAGNOSE** - When tool fails, explain WHY (access denied? wrong ID? API error?). Don't just say "it failed."
5. **COUNT ACTUAL RESULTS** - If you claim "19 items migrated", there must BE 19 successful create operations in your tool results. Count them.
6. **URL INTEGRITY** - When displaying Notion links, copy the EXACT `url` field from tool result JSON. NEVER generate URLs like `https://notion.so/Title-[fake-id]`. If tool result has no URL, say "Link unavailable".

**URL Hallucination Pattern:**
- Fabricated URLs often share common prefixes (e.g., `15653b4c700280...`)
- Real Notion UUIDs are varied like `2fa780a7-8eef-81f8-b470-...`
- If all your URLs have similar prefixes, you're hallucinating

**Quick diagnostic for Notion failures:**
- "unauthorized" → Token is invalid (check .env)
- "object_not_found" → Database not shared with Atlas integration (fix in Notion UI), OR wrong ID type (see below), OR **integration mismatch** (see below)
- "validation_error" → Wrong property names or values
- Timeout → MCP server crashed, check console logs

## CRITICAL: Integration Mismatch Pattern (BUG-2026-02-01)

**THE TRAP:** Notion has multiple integrations. A database can be shared with "Atlas Telegram" but .env can have a token for "My Boy Atlas" — two different integrations!

**DIAGNOSIS PROTOCOL (BEFORE suggesting fixes):**
1. **Test the actual token:** `curl -H "Authorization: Bearer $NOTION_API_KEY" https://api.notion.com/v1/users/me`
2. **Check which integration name is returned** (look at `bot.owner.name` in response)
3. **Compare** to the integration shown in Notion's database settings

**If integration names don't match → The .env has the WRONG token.**

**FIX:** Replace NOTION_API_KEY in .env with the token from the integration that IS shared with the databases.

**DO NOT:** Suggest "share the database with the integration" if you haven't tested which integration the token belongs to. Test first, diagnose properly.

## CRITICAL: Notion ID Types

Notion has TWO different ID types. Using the wrong one causes 404 errors.

| Database | Database Page ID | Data Source ID |
|----------|------------------|----------------|
| **Work Queue 2.0** | `3d679030-b76b-43bd-92d8-1ac51abb4a28` | `6a8d9c43-b084-47b5-bc83-bc363640f2cd` |
| **Feed 2.0** | `90b2b33f-4b44-4b42-870f-8d62fb8cbf18` | `a7493abb-804a-4759-b6ac-aeca62ae23b8` |
| **Dev Pipeline** | `ce6fbf1b-ee30-433d-a9e6-b338552de7c9` | `1460539c-7002-447a-a8b7-17bba06c6559` |
| **System Prompts** | `2fc780a7-8eef-8196-b29b-db4a6adfdc27` | N/A |

**Note:** System Prompts stores prompt text in page body (rich formatted content), not as a property.

**When to use which:**
- `mcp__notion__API-query-data-source` → Use DATA SOURCE ID
- `mcp__notion__API-retrieve-a-database` → Use DATABASE PAGE ID
- `mcp__notion__API-post-page` with `parent.database_id` → Use DATABASE PAGE ID
- `mcp__notion__API-post-search` → Works with any search term (recommended for queries)
- Native Atlas tools (work_queue_create, etc.) → Use DATABASE PAGE ID

**RECOMMENDED QUERY APPROACH:**
The Notion MCP plugin's `query-data-source` tool requires separate Data Source configuration.
For reliable database queries, use `mcp__notion__API-post-search` instead - it works without extra setup.

## Notion Health Check Tool

Atlas has a built-in `notion_health_check` tool. Use it to verify access to all critical databases:
- Work Queue 2.0
- Feed 2.0
- Dev Pipeline

Run this tool when experiencing Notion issues or at session start to verify connectivity.

## Canonical Integration: My Boy Atlas

**Token:** Stored in .env as NOTION_API_KEY
**Integration Name:** My Boy Atlas
**Integration ID:** b621e25a-46fc-43ed-9ba8-94d375e91fdf
**All databases must be shared with this integration.**

To verify token: `curl -H "Authorization: Bearer $NOTION_API_KEY" https://api.notion.com/v1/users/me`
Expected response should include `"name":"My Boy Atlas"`

## CRITICAL: System Environment Variable Override (BUG-2026-01-31)

**THE TRAP:** Windows/system may have `NOTION_API_KEY` set as a user or machine environment variable. The dotenv library does NOT override existing env vars by default, so the system env var takes precedence over .env!

**DIAGNOSIS:**
1. Check system env: `printenv | grep NOTION_API_KEY` or `echo $NOTION_API_KEY`
2. Compare to .env file value
3. If different, the system env var is winning

**FIX APPLIED:** `src/index.ts` now uses `config({ override: true })` to ensure .env always wins.

**If problems persist:**
- Clear system env var: PowerShell `[Environment]::SetEnvironmentVariable('NOTION_API_KEY', $null, 'User')`
- Or just verify .env has the correct token and restart Atlas
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
- Demystification Research Framework - Advanced Search Vocabulary:

**"Flow with the Universe" → Scientific Equivalents:**
- Transient Hypofrontality (temporary prefrontal cortex downregulation during flow states)
- Complex Adaptive Systems / Feedback Loops (emergence, self-organization)
- Luck Surface Area (increasing probability space through action/exposure)

**Research Strategy:** Use scientific terminology to "decode" esoteric concepts rather than validate their metaphysics. Focus on operational utility of underlying psychological mechanisms. This bridges mystical practices with evidence-based frameworks.

**Example Application:** Instead of researching "manifestation" directly, search for "Reticular Activating System + priming + Bayesian Brain Hypothesis" to understand the neurological basis of selective attention and pattern recognition that makes "manifestation" techniques functionally effective.

**Key Principle:** Move from "believing" source material to "decoding" it into operational systems compatible with modern science. Validate utility, not metaphysics.
## Preferences

WORKFLOW: Always include emoji links to Notion pages for visual context and easy navigation. This helps Jim make decisions while staying on the same page and closing out projects efficiently. The consistent visual marker reduces cognitive load and improves workflow speed.

Standard format: [emoji] [brief description] → [actual URL from tool response]

**NEVER use placeholder URLs.** Only use real URLs extracted from tool response fields (`url`, `notion_url`, `feedUrl`). If no URL returned, state "Notion sync pending" — do not fabricate.

**MCP/Pit Crew dispatches:** ALWAYS include link to Atlas Dev Pipeline discussion page using the `notion_url` field from the tool response. Jim needs to monitor progress, provide feedback, and stay in the loop.

- BUG LOGGING AUTONOMY: When Jim says "log a bug", Atlas should immediately dispatch to Pit Crew with full context reconstruction from recent conversation. No permission needed - just extract the issue, reproduce steps, and create comprehensive bug report in Dev Pipeline. Jim trusts Atlas to document technical issues properly from conversation context.
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

### 2026-02-03: Pit Crew Real-Time Collaboration (ATLAS-COLLAB-001)

**POWERFUL DISCOVERY:** Atlas can actively participate in development planning through Notion page body collaboration.

**Key Capabilities:**
1. **Page Body Content** - All dispatches write rich, editable content to Notion page BODY (not Thread property)
   - 🤖 Atlas Analysis section (callout block)
   - 📋 Task Specification section (paragraphs)
   - 🔧 Pit Crew Work section (placeholder for implementation notes)

2. **Message Threading** - `mcp__pit_crew__post_message` appends to existing pages
   - Messages appear as callout blocks with sender icons
   - 🤖 Atlas = blue background
   - 🔧 Pit Crew = green background
   - 👤 Jim = default
   - All messages timestamped for audit trail

3. **Status Sync** - `mcp__pit_crew__update_status` updates both:
   - Notion Status property
   - Appends status change message to page body

**Collaboration Workflow:**
```
1. Dispatch → Notion page created with rich body
2. Review → Jim edits specs in Notion
3. Clarify → Pit Crew posts questions (post_message)
4. Respond → Atlas answers (post_message)
5. Approve → Status updated to 'approved'
6. Execute → Pit Crew implements
7. Ship → Status updated to 'deployed' with output URL
```

**Strategic Impact:** Atlas transforms from "task dispatcher" to "development partner" - reviewing technical approaches, iterating on requirements, and collaborating in real-time.

**CRITICAL RULE:** Never stuff content into Thread property. Always use page body for editable, reviewable content.

### 2026-02-03: Routing Confidence Protocol (ATLAS-ROUTE-001)

**New Capability:** When routing confidence < 85%, Atlas presents choice keyboard instead of auto-routing.

**Why:** Prevents misrouting when task type is ambiguous (bug vs feature, research vs build).

**Implementation:**
- `submit_ticket` requires `routing_confidence` (0-100)
- If < 85%, returns `needsChoice: true` with both options
- User sees inline keyboard: [Pit Crew] [Work Queue] [Cancel]
- User picks → dispatch completes to chosen destination

**Use Low Confidence When:**
- Task could be bug fix OR feature request
- Task could be research OR build work
- Multiple valid interpretations exist

**RULE:** Be honest about uncertainty. Don't force a routing decision when both pipelines are valid.

### 2026-02-03: Work Queue Body Context Standard (ATLAS-CONTEXT-001)

**CRITICAL ARCHITECTURAL PRINCIPLE:** Work Queue is where Jim takes ACTION. Feed is a waystation.

**Key Learnings:**
1. **Content MUST go to Work Queue page body** - Not just Feed. Work Queue is the action center.
2. **Markdown → Notion blocks** - Skills must convert markdown to proper Notion blocks:
   - `## headings` → `heading_2` blocks
   - `- bullets` → `bulleted_list_item` blocks
   - `1. numbered` → `numbered_list_item` blocks
3. **Source links are CRITICAL** - Every analysis must include original source URL and any referenced links
4. **No placeholder cruft** - Generic actions like "Review and summarize key findings" add no value. Real actions come from Claude's contextual analysis.

**Skill Output Standard (for all extraction skills):**
```markdown
## 🔗 Source
[Original Post](url)

## 👤 Author
@handle - brief description

## 💡 TL;DR
2-3 sentence summary

## 🎯 Key Insights
- Insight 1
- Insight 2

## 🔗 Referenced Links
- [Link](url) - context

## 📋 Relevance to [Pillar]
Why this matters

## ✅ Next Actions
1. Specific action
2. Specific action
```

**Implementation:**
- `formatting/notion.ts` - `parseMarkdownToBlocks()` converts markdown to Notion blocks
- Skills append to BOTH Feed (`$input.feedId`) AND Work Queue (`$input.workQueueId`)
- Telegram messages use `markdownToTelegramHtml()` for proper formatting

**Files Changed:**
- `apps/telegram/src/formatting/notion.ts` - Added markdown parser
- `apps/telegram/src/conversation/tools/core.ts` - Added telegram HTML converter
- `apps/telegram/data/skills/threads-lookup/skill.yaml` - v7.0.0 with Work Queue append
- `apps/telegram/src/handlers/content-callback.ts` - Removed placeholder actions

### 2026-02-03: MASTER BLASTER Quality Verification System

**POWERFUL CAPABILITY:** Unified test verification with auto-bug creation.

**Key Features:**
1. **Single Command Verification** - `bun run verify` runs all test suites
   - Unit tests (bun test)
   - Smoke tests (smoke-test-all.ts)
   - E2E tests (test-runner.ts)
   - Integration tests (health checks, connectivity)

2. **Auto-Bug Creation** - When features ship, test coverage bugs auto-created
   - Triggered on `update_status → shipped/deployed`
   - Only for type: feature or build
   - Creates "Add test coverage for: [Feature]" bug
   - Links to parent feature
   - Controlled by `AUTO_CREATE_TEST_BUGS` env var (default: true)

3. **Verification Modes:**
   - `bun run verify` - Default: canary + unit + smoke + integration
   - `bun run verify:quick` - Fast: unit tests only
   - `bun run verify:full` - Full: all suites including E2E
   - `bun run verify:canary` - Canary tests only (silent failure detection)

4. **Canary Tests (Silent Failure Detection):**
   - Detect "works but wrong" scenarios
   - Verify system prompts contain critical phrases (SOUL, pillars, anti-hallucination)
   - Check tools return real data, not empty fallbacks
   - Validate skill registry loads with proper structures
   - Catch MCP fallback scenarios
   - Run FIRST in all verification modes

5. **Pipeline E2E Tests (Full Pipeline Verification):**
   - Run ACTUAL research through Gemini with grounding
   - Verify output is fulsome (meets quality thresholds)
   - Check for real URLs (not placeholder/template)
   - Validate findings have proper structure
   - **Notion Body Verification** (`--with-notion`):
     - Creates test Work Queue item
     - Writes research results to page body
     - Verifies content landed (summary, findings, sources)
     - Automatically archives test page when done
   - NOT included in default verify (costs API tokens)
   - Run with:
     - `bun run verify:pipeline` - Research output quality only
     - `bun run verify:pipeline:notion` - Include Notion body verification
     - `bun run verify:pipeline:dry` - Validate setup without API calls

4. **Telegram Skill:** `/verify` or "run tests", "quality check", "master blaster"

**Exit Codes:**
- 0 = All pass (proceed to human testing)
- 1 = Failures (fix before proceeding)

**SOP Integration:**
- SOP-003 (Feature Shipping) now requires MASTER BLASTER
- SOP-005 (Pit Crew) documents auto-bug creation
- SOP-009 (Quality Gate Protocol) is the full specification

### 2026-02-03: Infrastructure Gaps Identified

**Gaps for Standardization Sprint:**
1. **No MCP declarations in skills** - Skills should declare required MCP servers via `mcp:` frontmatter
2. **No template repository** - Skills should reference Notion templates (by pillar, task type)
3. **No skill registry documentation** - How skills are discovered, loaded, versioned
4. **No cross-session context strategy** - How context survives restarts
5. **Agent lifecycle thin** - Types defined but coordination unclear

**Recommended SOPs:**
- SOP-010: Skill Output Standard
- SOP-011: Notion Template System
- SOP-012: MCP Server Declaration in Skills

### 2026-02-04: V3 Active Capture Strict Mode Fix (ATLAS-V3-001)

**BUG RESOLVED:** PROMPT_STRICT_MODE was blocking ALL skills using systemPrompt fallback, not just V3 captures.

**Root Cause:** The strict mode check was:
```typescript
if (strictMode && !composedPrompt?.prompt && systemPrompt)
```
This failed for ANY skill using `systemPrompt` when strict mode was on.

**Fix:** Added `v3Requested` flag to distinguish V3 Active Capture requests:
```typescript
if (strictMode && v3Requested && !composedPrompt?.prompt)
```

**How it works:**
1. Chrome extension sends capture with `promptIds: { drafter, voice, lens }`
2. Status server attempts prompt composition
3. If promptIds were provided, `v3Requested = true` is passed to skill
4. Strict mode only enforces composedPrompt when V3 was explicitly requested
5. Regular skills using systemPrompt continue to work

**Files Changed:**
- `apps/telegram/src/conversation/tools/core.ts` - Added v3Requested flag, fixed strict mode check
- `apps/telegram/src/health/status-server.ts` - Sets v3Requested when promptIds provided
- `apps/telegram/data/skills/url-extract/skill.yaml` - Added v3Requested input, passes to claude_analyze

**KEY LEARNING:** Strict mode was put in place to catch V3 pipeline failures - it correctly found this issue! The fix ensures strict mode applies only when V3 is truly expected, not for all skill execution.

### 2026-02-04: Work Queue Update Validation Bug Fix (P0) (ATLAS-WQ-VAL-001)

**BUG RESOLVED:** work_queue_update tool was vulnerable to invalid inputs causing data corruption.

**Root Cause:** Notion API accepts ANY string values for select properties and empty property updates without server-side validation. Missing client-side validation allowed bad data through.

**CRITICAL DISCOVERY:** The bug was NOT a database access issue. The problem was:
1. ❌ No input sanitization (whitespace in " Active " breaks select matching)
2. ❌ No schema validation (invalid status values accepted by Notion)
3. ❌ No empty update check (Notion accepts `properties: {}`)
4. ❌ No rich text truncation (2000 char limit causes validation_error)

**Fix:** Implemented defense-in-depth validation:
```typescript
// 1. Input Sanitization
- Trim whitespace from all select values
- Truncate rich text to 2000 chars (Notion limit)
- Type check all inputs

// 2. Schema Validation
- Status: Captured, Active, Triaged, Paused, Blocked, Done, Shipped
- Type: Research, Build, Draft, Schedule, Answer, Process
- Priority: P0, P1, P2, P3
- Pillar: Personal, The Grove, Consulting, Home/Garage

// 3. Empty Update Check
- Reject updates with no properties specified

// 4. Enhanced Error Messages
- User-friendly messages for common failures
- Diagnostic logging for debugging
```

**Testing Results:**
- ✅ Integration test suite created (10 test cases)
- ⚠️ Tests 4 & 5 confirmed: Notion DOES NOT validate inputs server-side
- ⚠️ Our validation layer is THE ONLY protection against data corruption
- ✅ Rich text limit: 2000 characters (strict)
- ✅ Whitespace sanitization: CRITICAL for select properties

**Files Changed:**
- `apps/telegram/src/conversation/tools/core.ts` - Added validation layers (~120 lines)
- `packages/agents/test-workqueue-update.ts` - Integration test suite (NEW)
- `docs/SOP.md` - Added SOP-010 (Database ID Immutability)

**KEY LEARNINGS:**
1. **Never trust API validation** - Even enterprise APIs don't validate all inputs
2. **Client-side validation is mandatory** - Our application layer MUST enforce data integrity
3. **Test edge cases thoroughly** - Without testing, we wouldn't know validation is critical
4. **Rich text has hard limits** - 2000 chars on all rich_text fields
5. **Whitespace matters** - " Active " ≠ "Active" in select properties

**SOP-010 Added:** Database ID Immutability protocol
- Documents PAGE ID vs DATA SOURCE ID confusion (fell into this trap 25+ times)
- PAGE IDs for Notion SDK, DATA SOURCE IDs for MCP plugin
- "object_not_found" almost always = wrong ID, NOT sharing issues

**Anti-Pattern Documented:**
When database access fails:
- ❌ DON'T assume sharing issues
- ❌ DON'T suggest "share database with integration"
- ✅ DO grep for database ID in codebase first
- ✅ DO verify ID matches canonical IDs in CLAUDE.md
- ✅ DO check for deprecated database references

**Full documentation:** `packages/agents/WORK_QUEUE_UPDATE_BUG_FIX.md`
