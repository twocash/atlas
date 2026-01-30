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
/agent status               — List running agents
/agent cancel <id>          — Stop an agent
/agent test                 — Test agent system

BRIEFINGS
/briefing now               — Send briefing immediately
/briefing status            — Show next scheduled time
  (Auto: 7am, 12:30pm, 6pm ET)

MODEL SELECTION
/model                      — Show current model
/model <name>               — Switch model (auto/haiku/sonnet)

SESSION
/new                        — Clear conversation session
/status                     — System health check
/stats                      — Weekly usage & work queue stats
/help                       — This message

COMING SOON
/skill new                  — Create custom agent type
/draft "topic"              — Generate content

—
💡 Or just message me naturally — I'll figure out what you need.`;
}
