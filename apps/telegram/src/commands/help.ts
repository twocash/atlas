/**
 * Atlas Telegram Bot - Help Command
 *
 * Static text response showing all commands grouped by category.
 * Per SOP-001: All new features must update this file.
 */

/**
 * Generate help text for /help command
 */
export function getHelpText(): string {
  return `🤖 Atlas Commands

RESEARCH & AGENTS
/agent research "query"     — Research a topic
  --light                   — Quick (2-3 sources)
  --standard                — Thorough (5-8 sources)
  --deep                    — Academic (10+ sources)
  --focus "area"            — Narrow focus
  --voice <id>              — Writing voice (see below)
/agent status               — List running agents
/agent cancel <id>          — Stop an agent
/agent test                 — Test agent system

VOICE OPTIONS (for --voice)
  grove        — Technical thought leadership
  consulting   — Executive/recommendations
  linkedin     — Punchy, shareable
  personal     — Reflective, growth-focused
  (omit --voice for interactive selection)

WORK QUEUE EXECUTION
/work                       — Run one worker cycle
/work status                — Show queue depth & worker state
/work start                 — Start continuous polling
/work stop                  — Stop continuous polling

BRIEFINGS
/briefing now               — Send briefing immediately
/briefing status            — Show next scheduled time
  (Auto: 7am, 12:30pm, 6pm ET)

MODEL SELECTION
/model                      — Show current model
/model <name>               — Switch model (auto/haiku/sonnet)

SESSION
/new                        — Clear conversation session
/status                     — Quick status check
/health                     — Full system diagnostics
/stats                      — Weekly usage & work queue stats
/help                       — This message

COMING SOON
/skill new                  — Create custom agent type
/draft "topic"              — Generate content

—
💡 Or just message me naturally — I'll figure out what you need.`;
}
