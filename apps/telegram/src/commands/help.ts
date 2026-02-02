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
  // Note: Bot uses HTML parse_mode, so escape < and > as &lt; &gt;
  return `🤖 <b>Atlas Commands</b>

<b>RESEARCH &amp; AGENTS</b>
/agent research "query"     — Research a topic
  --light                   — Quick (2-3 sources)
  --standard                — Thorough (5-8 sources)
  --deep                    — Academic (10+ sources)
  --focus "area"            — Narrow focus
  --voice &lt;id&gt;              — Writing voice (see below)
/agent status               — List running agents
/agent cancel &lt;id&gt;          — Stop an agent
/agent test                 — Test agent system

<b>VOICE OPTIONS</b> (for --voice)
  grove        — Technical thought leadership
  consulting   — Executive/recommendations
  linkedin     — Punchy, shareable
  personal     — Reflective, growth-focused
  (omit --voice for interactive selection)

<b>WORK QUEUE EXECUTION</b>
/work                       — Run one worker cycle
/work status                — Show queue depth &amp; worker state
/work start                 — Start continuous polling
/work stop                  — Stop continuous polling

<b>BRIEFINGS</b>
/briefing now               — Send briefing immediately
/briefing status            — Show next scheduled time
  (Auto: 7am, 12:30pm, 6pm ET)

<b>MODEL SELECTION</b>
/model                      — Show current model
/model &lt;name&gt;               — Switch model (auto/haiku/sonnet)

<b>SESSION</b>
/new                        — Clear conversation session
/status                     — Quick status check
/health                     — Full system diagnostics
/stats                      — Weekly usage &amp; work queue stats
/help                       — This message

<b>COMING SOON</b>
/skill new                  — Create custom agent type
/draft "topic"              — Generate content

—
💡 Or just message me naturally — I'll figure out what you need.`;
}
