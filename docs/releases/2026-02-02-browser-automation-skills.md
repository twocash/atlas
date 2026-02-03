# Release: Browser Automation Skills Architecture

**Date:** 2026-02-02
**Version:** Atlas 2.1.0
**Codename:** Agency Upgrade

---

## What This Unlocks

This release transforms Atlas from a "chatbot that logs things" into an **agentic browser controller** with a composable skill architecture. The core insight: **any URL is a trigger for automation**.

### The URL → Action Pipeline

```
Telegram Message (URL)
    ↓
Skill Registry (pattern match)
    ↓
Skill Executor (runs steps)
    ↓
MCP Tools (browser automation)
    ↓
Notion (logs result)
    ↓
Telegram (confirms)
```

Every URL becomes a potential automation trigger. Skills define what happens.

---

## Capability Matrix

### Tier 0: Read-Only Extraction (Auto-deploy)

| Domain | Skill | What It Does |
|--------|-------|--------------|
| Twitter/X | `tweet-extract` | Pull tweet text, author, engagement stats |
| Twitter/X | `thread-extract` | Unroll and extract full thread |
| LinkedIn | `profile-extract` | Bio, headline, experience summary |
| LinkedIn | `post-extract` | Post content + engagement |
| YouTube | `video-metadata` | Title, description, channel, duration |
| YouTube | `transcript-extract` | Full video transcript |
| GitHub | `repo-overview` | README, stars, recent commits |
| News | `article-extract` | Readability-cleaned content |
| Generic | `page-snapshot` | Screenshot + text extraction |

### Tier 1: Creates Entries (Batch approval)

| Domain | Skill | What It Does |
|--------|-------|--------------|
| Any URL | `url-research` | Extract → Summarize → Log to Feed + Work Queue |
| Twitter | `twitter-lookup` | SPA-aware extraction → Feed entry |
| Threads | `threads-lookup` | Extract Threads post → Feed entry |
| YouTube | `video-to-research` | Transcript → Summary → Work Queue item |
| Article | `article-to-grove` | Extract → Classify → Grove research queue |

### Tier 2: External Actions (Explicit approval per action)

| Domain | Skill | What It Does |
|--------|-------|--------------|
| Twitter | `twitter-like` | Like a tweet |
| Twitter | `twitter-follow` | Follow an account |
| Twitter | `twitter-repost` | Repost/retweet |
| LinkedIn | `linkedin-connect` | Send connection request |
| LinkedIn | `linkedin-react` | React to a post |
| Generic | `bookmark-save` | Save to browser bookmarks |

---

## Subskill Composition Architecture

Skills can invoke other skills as steps. This enables **primitive → composite** patterns:

```yaml
# High-level skill composes primitives
name: twitter-to-grove-research
process:
  steps:
    - id: extract
      skill: tweet-extract          # Tier 0 primitive
      inputs:
        url: "$input.url"

    - id: summarize
      skill: content-summarize      # Tier 0 primitive
      inputs:
        content: "$step.extract.text"

    - id: create_research
      skill: grove-research-quick   # Tier 1
      inputs:
        topic: "$step.summarize.summary"
        source: "$input.url"
```

### Primitive Library (Building Blocks)

```
primitives/
├── extract/
│   ├── tweet-extract.yaml
│   ├── thread-extract.yaml
│   ├── profile-extract.yaml
│   ├── article-extract.yaml
│   ├── video-metadata.yaml
│   └── page-snapshot.yaml
├── transform/
│   ├── content-summarize.yaml
│   ├── sentiment-analyze.yaml
│   ├── entity-extract.yaml
│   └── topic-classify.yaml
├── action/
│   ├── social-like.yaml
│   ├── social-follow.yaml
│   ├── social-comment.yaml
│   └── bookmark-save.yaml
└── persist/
    ├── feed-log.yaml
    ├── workqueue-create.yaml
    └── notion-append.yaml
```

### Composition Rules

1. **Tier flows down** - Tier 1 skill can only compose Tier 0-1 primitives
2. **Depth limit: 3** - Prevents infinite nesting
3. **Circular detection** - A → B → A blocked automatically
4. **Approval inheritance** - Tier 2 primitive requires approval even in Tier 1 parent

---

## URL Router Pattern

The master skill that routes any URL to the appropriate handler:

```yaml
name: url-router
triggers:
  - type: pattern
    value: "https?://.*"  # Any URL

process:
  steps:
    - id: classify_url
      tool: url_classifier
      inputs:
        url: "$input.url"

    - id: route_to_skill
      type: conditional
      condition: "$step.classify_url.domain"
      cases:
        twitter.com: twitter-lookup
        x.com: twitter-lookup
        threads.net: threads-lookup
        linkedin.com: linkedin-lookup
        youtube.com: youtube-lookup
        github.com: github-lookup
        default: generic-article
```

This creates a **single entry point** that intelligently routes to domain-specific skills.

---

## Real-World Workflows Enabled

### 1. Research Capture
```
Jim sends: https://x.com/karpathy/status/123456789

Atlas:
1. Matches twitter-lookup skill
2. Opens Chrome tab (via MCP)
3. Waits for SPA hydration
4. Extracts tweet + thread
5. Summarizes with Claude
6. Logs to Feed: "Twitter: @karpathy on [topic]"
7. Creates Work Queue item if actionable
8. Replies: "Captured Karpathy thread on transformers. Added to Grove research queue."
```

### 2. Competitor Monitoring
```
Jim sends: https://linkedin.com/company/competitor-ai/posts

Atlas:
1. Matches linkedin-posts skill
2. Extracts recent posts
3. Summarizes themes
4. Logs to Feed with "Consulting" pillar
5. Replies: "Competitor posted 3 times this week. Theme: enterprise AI. Want me to draft a response angle?"
```

### 3. Content Pipeline
```
Jim sends: https://youtube.com/watch?v=abc123
Jim adds: "turn this into a grove blog post"

Atlas:
1. Matches youtube-to-content skill
2. Extracts transcript
3. Summarizes key points
4. Creates Work Queue: "Draft: Blog post from [video title]"
5. Optionally dispatches to Grove Docs Refinery
```

### 4. Social Engagement (with approval)
```
Jim sends: "like and follow https://x.com/interesting_researcher"

Atlas:
1. Matches social-engage skill (Tier 2)
2. Returns: "This will like the post and follow @researcher. Approve? [Yes] [No]"
3. On approval: executes actions
4. Logs to Feed: "Engaged: liked + followed @researcher"
```

---

## Safety Architecture

### Tier-Based Approval Model

| Tier | Risk | Approval | Examples |
|------|------|----------|----------|
| 0 | None (read-only) | Auto-deploy | Extract, snapshot, summarize |
| 1 | Internal writes | Batch approval | Log to Feed, create Work Queue |
| 2 | External actions | Per-action approval | Like, follow, comment, post |

### Emergency Stop

- `/stop` command in Telegram halts current skill
- Chrome extension "Stop" button (when MCP bridge complete)
- Skill aborts after current step with "Execution stopped by user"

### Browser Automation Guardrails

- Graceful degradation if Chrome offline
- SPA-aware waiting (no blind clicks)
- Tab cleanup on completion
- Timeout limits per skill (default 30s, configurable)

---

## What's Next

### Phase 2: Primitive Library
- Build out 15-20 extraction primitives
- Cover top 10 domains Jim uses
- Each primitive is small, tested, composable

### Phase 3: Smart Routing
- URL classifier that detects domain + content type
- Auto-suggest skill when pattern not matched
- Learn from corrections

### Phase 4: Skill Learning
- When Jim manually does something 5+ times, propose skill
- "I noticed you extract YouTube transcripts often. Create a skill?"
- Auto-generate YAML from action patterns

### Phase 5: Scheduled Automation
- "Monitor this URL daily and alert on changes"
- "Check competitor LinkedIn every Monday"
- "Run this skill on all new Feed entries tagged 'research'"

---

## Files Added/Modified

### New Files
- `apps/chrome-ext/sidepanel/components/AtlasLink.tsx` - Browser automation HUD
- `apps/telegram/data/skills/twitter-lookup/skill.yaml` - Twitter extraction (v1.1.0)
- `apps/telegram/data/skills/threads-lookup/skill.yaml` - Threads extraction
- `apps/telegram/data/skills/social-engage/skill.yaml` - Engagement actions (Tier 2)

### Modified Files
- `apps/telegram/src/skills/executor.ts` - Stop control, browser automation support
- `apps/telegram/src/skills/index.ts` - Export stop functions
- `apps/telegram/src/bot.ts` - `/stop` command
- `apps/telegram/src/commands/help.ts` - Updated help text
- `apps/chrome-ext/sidepanel/components/NavRail.tsx` - Atlas tab
- `apps/chrome-ext/sidepanel/sidepanel.tsx` - AtlasLink view
- `apps/chrome-ext/src/background/index.ts` - Atlas message handlers

---

## Architectural Notes

### MCP Tool Flow
```
Telegram Bot (Node.js)
    ↓ calls
MCP Hub (stdio connection)
    ↓ routes to
claude-in-chrome MCP Server
    ↓ controls
Chrome Extension
    ↓ automates
Browser Tab
```

### Known Limitations (v2.1.0)

1. **HUD Updates** - Currently logs only. Real-time push requires `update_hud` MCP tool in claude-in-chrome.

2. **Stop Latency** - Stop is checked between steps, not mid-step. Long-running steps (e.g., 30s page load) won't interrupt immediately.

3. **Chrome Dependency** - Browser automation requires Chrome + claude-in-chrome MCP running. Graceful error if unavailable.

---

*Atlas 2.1.0 - From Chatbot to Agentic Browser Controller*
