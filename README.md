# Atlas

**Personal Cognitive Co-pilot**

---

## Why This Architecture?

Atlas is not productivity software. It's a **cognitive prosthetic**.

Most productivity tools assume you have reliable executive function—that you'll remember to check the app, maintain consistent routines, and translate intentions into actions. For ADHD brains, that assumption is catastrophic. These tools add cognitive load instead of removing it.

Atlas takes a different approach, built on the **extended mind thesis**: cognition doesn't stop at the skull. If a notebook can function as memory and a calculator as arithmetic processing, an AI system can function as extended executive function—not a tool you operate, but a cognitive partner that completes your thinking.

**This isn't accommodation. It's architecture.**

---

## Core Design Principles

### Pattern-Based Approval

You don't approve individual actions—you approve *categories* of action once. "Yes, file Grove-related content this way." "Yes, send daily briefings at 6am." One blessing enables unlimited future executions of that pattern.

This mirrors how executive function should work: decide once, implement automatically forever. Skills embody these approved patterns and compound over time.

### Self-Improving Infrastructure

Atlas doesn't just execute tasks—it identifies its own limitations and creates development work to address them. When Atlas hits a constraint, it logs the issue, dispatches a fix to development partners via MCP, and becomes more capable.

This "grows its own arms" approach shifts the developer role from debugger to approver, reducing cognitive load while expanding autonomous capability.

### MCP-First Extensibility

Built on the Model Context Protocol, Atlas treats capabilities as pluggable modules rather than hardcoded features. New integrations, workflows, and intelligence happen through MCP servers—no core rewrites required.

This includes agent-to-agent collaboration where Atlas doesn't just call tools, it partners with other AI systems in real-time development threads.

### Feed-First Processing

Every interaction flows through a structured activity log with full metadata. This isn't surveillance—it's context preservation and pattern detection.

The system learns from corrections, recognizes temporal patterns, and maintains continuity across sessions. Your decisions inform future routing without requiring you to remember what you decided last time.

### Shame-Resistant Design

ADHD often involves failure spirals: bad feelings lead to avoidance, avoidance leads to more failure.

Atlas handles failures automatically (retry without surfacing), manages backlogs proactively (no guilt-inducing overdue lists), and assumes positive intent. The emotional tenor is *competent assistant*, not disappointed parent keeping score.

---

## The Guiding Metric

Every design decision answers one question:

> **Does this reduce cognitive load on the user, or does it add to it?**

Features that require you to remember to use them have failed before they start. Notifications that interrupt without clear value make things worse. Approval flows that demand judgment on every item recreate the problem they're meant to solve.

The right design feels like having a better brain. Not a tool. Not an app. **A better brain.**

---

## Building the Ecosystem

### The Skills Vision

Skills are approved workflow patterns that execute automatically. The current development pipeline includes:

#### Google Workspace Agentic Command Center
Natural language control over email, calendar, and docs. "Move that meeting to Tuesday and draft a follow-up email" becomes a single command instead of four context switches across three apps.

#### Bug-to-Feature Conversion Pipeline
When Atlas encounters a failure, it doesn't just log an error—it creates a development request with reproduction steps, dispatches it to Pit Crew for implementation, and auto-integrates the fix. The system debugs itself.

#### YouTube Transcript Analysis
Extract transcripts, summarize key points, identify actionable insights, and file to relevant knowledge bases. Consuming long-form content without the cognitive overhead of watching at 1x speed or manually taking notes.

---

### Skills Anyone Could Build

The MCP architecture means you can extend Atlas without touching core code:

| Skill | Description |
|-------|-------------|
| **Email Triage Agent** | Understands the difference between urgent and important (critical for ADHD urgency blindness). Routes "needs response today" separately from "interesting but not time-sensitive." |
| **Meeting Prep Assistant** | Auto-pulls past notes about clients, recent project updates, and stated priorities when you accept a calendar invite. Context without scrambling. |
| **Project Kickoff Scaffolding** | Say "starting a new client project for DrumWave." The skill asks clarifying questions, generates folder structure, creates placeholder docs, and adds tasks. Breaking down large projects happens automatically. |
| **Hyperfocus Session Capture** | Detects flow state, logs what you accomplished, files artifacts, creates a breadcrumb trail for tomorrow—even if you have zero memory of what you were thinking. |
| **Interrupt Recovery Protocol** | When you return from an urgent call mid-task: "You were drafting the Q2 strategy deck, had three sections done, and were researching competitive pricing. Here's where you left off." |
| **Decision Journal** | Captures "why I chose X" moments. Six months later when you wonder "why did we go with Vendor A?" the reasoning is there. |
| **Energy-Based Task Routing** | Learns your high-energy vs low-energy patterns. Routes demanding work to peak hours, administrative work to low-energy periods. |

---

### MCP Server Contributions

If you build MCP servers, you can plug them into Atlas instantly:

| Pattern | Risk Level | Example |
|---------|------------|---------|
| **Read-only intelligence** | Auto-approved | Analysis, classification, pattern detection |
| **Structured creation** | Batch approval | Database entries, formatted documents |
| **External integrations** | Explicit approval | Calendar, email, project management |
| **Development partnership** | Collaborative | AI systems that help build Atlas |

The protocol handles the plumbing. You focus on the cognitive value.

---

## Technical Foundation

> **This is a prototype.** The system explores new models of AI-augmented cognition, not production-grade security infrastructure.

### Current Stack

| Component | Technology |
|-----------|------------|
| Runtime | Bun + TypeScript |
| Primary Interface | Telegram Bot API |
| Intelligence | Claude (Anthropic API), Gemini (research grounding) |
| Knowledge Layer | Notion API (activity logging, task management) |
| Extensibility | Model Context Protocol (MCP) |

### Known Security Risks

This system has deliberate security tradeoffs to maximize cognitive partnership exploration:

- **Prompt injection vulnerabilities** — Skills can influence routing and execution
- **Credential exposure** — API keys in environment, sensitive data in logs
- **Skill injection risks** — Malicious skills could access data or execute arbitrary actions
- **No sandboxing** — Skills run with full system privileges
- **Trust assumptions** — Assumes benevolent use and controlled environment

**If you deploy this, understand the risk model.** Atlas is designed for single-user scenarios with trusted skill sources. This is a research prototype, not an enterprise security framework.

The tradeoff is intentional: maximum cognitive fluidity requires maximum trust. We're exploring what's possible when AI has agency, not building defense-in-depth security layers.

---

## Who This Serves

Atlas was built for ADHD brains, but the principles apply universally.

The ADHD-specific design just means it's *effortless* compared to traditional productivity methodologies. Where other systems demand constant executive function (remember to review your tasks, manually track time, force yourself to start things, maintain your own context across interruptions), Atlas does that work for you.

| If you have ADHD | This architecture compensates for unreliable executive function |
|------------------|----------------------------------------------------------------|
| If you don't | This architecture eliminates unnecessary cognitive overhead |

Either way, you're freed to focus on **substance** instead of **coordination**.

The "disability accommodation" framing misses the point. This is just better cognitive architecture—removing work that humans shouldn't have to do in the first place.

---

## For Developers

If you're building with this framework, you're building extensions of a mind. Ask:

- **Does this require initiation?** Eliminate that requirement.
- **Does this require decision-making?** Batch those decisions or make them once.
- **Does this require memory?** Externalize that memory completely.
- **Does this surface failure?** Handle failure without shame.
- **Does this interrupt?** Is the interruption worth the cost?

### The Ultimate Success Metric

The user forgets the system is there—not because it's invisible, but because it's so integrated into how they think that the boundary between human cognition and AI augmentation disappears.

---

## Quick Start

```bash
# Telegram Bot
cd apps/telegram
bun install
bun run dev

# Run Master Blaster tests
bun run scripts/test-v3-capture-pipeline.ts
```

## Documentation

See `docs/` for:
- `PRODUCT.md` — Product vision
- `DECISIONS.md` — Architecture decisions
- `SPARKS.md` — Classification framework

---

*Atlas v4.0 — Triage, organize, execute, learn*
