# Atlas

Personal cognitive co-pilot for Jim Calhoun.

## Apps

- **telegram/** — Mobile-first clarification layer
- **chrome-ext/** — Desktop co-pilot for web work

## Quick Start

```bash
# Install dependencies
bun install

# Run telegram bot
bun run dev:telegram

# Build chrome extension
cd apps/chrome-ext && bun run build
```

## Documentation

See `docs/` for:
- PRODUCT.md — Product vision
- DECISIONS.md — Architecture decisions
- SPARKS.md — Classification framework

## Related (Not in This Repo)

- **Grove Content Pipelines** — `claude-assist/grove_docs_refinery/`, `claude-assist/grove_research_generator/`
- **Grove Foundation** — `the-grove-foundation/` (software codebase)
