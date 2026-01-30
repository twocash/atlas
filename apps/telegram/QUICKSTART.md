# Atlas Telegram Bot - Quick Start Guide

Get the Atlas Telegram bot running in 5 minutes.

---

## Prerequisites

1. **Bun runtime** - [Install Bun](https://bun.sh/docs/installation)
   ```bash
   # Windows (PowerShell)
   powershell -c "irm bun.sh/install.ps1 | iex"
   
   # macOS/Linux
   curl -fsSL https://bun.sh/install | bash
   ```

2. **Telegram Bot Token** - Get from [@BotFather](https://t.me/BotFather)
   - Send `/newbot` to @BotFather
   - Follow prompts to create your bot
   - Save the token (looks like `123456789:ABCdefGHI...`)

3. **Your Telegram User ID** - Get from [@userinfobot](https://t.me/userinfobot)
   - Send any message to @userinfobot
   - It will reply with your user ID

4. **Notion Integration Token** - [Create Integration](https://www.notion.so/my-integrations)
   - Click "New integration"
   - Name it "Atlas Telegram"
   - Copy the "Internal Integration Token"
   - **Important:** Share your Atlas Inbox 2.0 and Work Queue 2.0 databases with this integration

5. **Anthropic API Key** - [Get API Key](https://console.anthropic.com/)
   - Or authenticate via `claude` CLI

---

## Setup

### 1. Clone and Install

```bash
cd C:\github\claude-assist\atlas-telegram

# Install dependencies
bun install
```

### 2. Configure Environment

```bash
# Copy example config
cp .env.example .env

# Edit .env with your values
notepad .env
```

Required values:
```env
TELEGRAM_BOT_TOKEN=your_bot_token_here
TELEGRAM_ALLOWED_USERS=your_telegram_id_here
NOTION_API_KEY=secret_your_notion_key_here
ANTHROPIC_API_KEY=sk-ant-api03-your_key_here
```

### 3. Test Connections

```bash
# Test Notion
bun run test:notion

# Test Claude
bun run test:claude
```

Both should show ✅ success.

### 4. Start the Bot

```bash
# Development (auto-reload)
bun run dev

# Production
bun run start
```

You should see:
```
🤖 Atlas Bot is running as @YourBotName
```

---

## Usage

1. **Open Telegram** and find your bot
2. **Send `/start`** to verify it's running
3. **Share a link** - e.g., paste a GitHub URL
4. **Tap to classify** - Bot presents options
5. **Check Notion** - Item appears in Inbox 2.0

### Example Flow

```
You: https://github.com/anthropics/claude-code

Bot: github.com: Claude Code → Grove Build?
     [✓ Confirm] [Change] [✗ Dismiss]

You: [tap Confirm]

Bot: ✓ Captured to Inbox (The Grove / Build) → routing to Work Queue
```

---

## Commands

| Command | Description |
|---------|-------------|
| `/start` | Show welcome message |
| `/status` | Check Notion + Claude connections |
| `/new` | Clear session, start fresh |

---

## Troubleshooting

### Bot doesn't respond
- Check `TELEGRAM_ALLOWED_USERS` matches your user ID
- Verify bot token is correct
- Check logs in `./logs/audit.log`

### Notion errors
- Ensure databases are shared with integration
- Verify database IDs in `.env` or defaults
- Run `bun run test:notion` to diagnose

### Claude errors
- Verify `ANTHROPIC_API_KEY` is set
- Check API key has credits
- Run `bun run test:claude` to diagnose

### "Cannot find module" errors
```bash
bun install
```

---

## File Locations

| File | Purpose |
|------|---------|
| `.env` | Your configuration (never commit!) |
| `./logs/audit.log` | All interactions |
| `./workspace/CLAUDE.md` | Atlas personality |
| `./workspace/SPARKS.md` | Classification rules |

---

## Next Steps

- **Run as service:** See IMPLEMENTATION.md Sprint 4
- **Customize classification:** Edit `workspace/SPARKS.md`
- **Modify personality:** Edit `workspace/CLAUDE.md`

---

## Support

- Design docs: `HANDOFF.md`
- Architecture: `ARCHITECTURE.md`
- Sprint plan: `IMPLEMENTATION.md`

Questions? Add to `CLAUDE.md` Open Questions section.
