# LinkedIn Engagement Workflow

Simple, self-evident workflow for capturing and responding to LinkedIn post engagement.

---

## Setup (One-Time)

### 1. Create Google Sheet

Create a Google Sheet with post URLs:

| Column A |
|----------|
| LinkedIn Post URL |
| https://linkedin.com/posts/jimcalhoun_... |
| https://linkedin.com/posts/jimcalhoun_... |

Share the sheet: **Anyone with link can view**

### 2. PhantomBuster Phantom

**LinkedIn Post Monitoring** - [Console](https://phantombuster.com/2316148405398457/phantoms/7765431788333726/console)

- Input: Google Sheet URL
- Watcher Mode: Enabled (only tracks NEW comments)
- Schedule: Daily

---

## When You Publish a Post

```
1. Copy LinkedIn post URL
2. Paste into Google Sheet Column A
3. Done
```

That's it. The Phantom auto-detects new URLs and starts tracking alongside existing posts.

**No rotation. No Monday chores. No slot management.**

---

## Daily Engagement Check

1. Open Atlas Chrome extension
2. Click **Refresh** button
3. Review items in Inbox (sorted by priority)
4. For each comment:
   - Read the comment and author's headline
   - Draft reply if warranted
   - Click **Mark Replied** after posting on LinkedIn
5. Click **Dismiss** for comments that don't need a reply

### What Gets Flagged?

Comments over 15 characters are marked "Needs Reply". This catches:
- "Can we chat about this?" (23 chars)
- "DM sent" (7 chars) - caught with new threshold
- "Link broken?" (12 chars) - caught with new threshold
- "Why?" (4 chars) - too brief, auto-dismissed

---

## Verification

After initial setup, verify the workflow:

1. Create Google Sheet with one test post URL
2. Configure Phantom with Google Sheets input + Watcher Mode
3. Trigger manual phantom run (or wait for schedule)
4. Click Refresh in extension
5. Verify comments appear with "Needs Reply" status
6. Reply to one, verify status changes to "Posted"

---

## Architecture

```
LinkedIn Post
     ↓
Google Sheet (paste URL)
     ↓
PhantomBuster "LinkedIn Post Monitoring" (daily)
     ↓
S3 result.json
     ↓
Atlas Extension (Refresh button)
     ↓
Notion (Engagements DB)
     ↓
Reply Inbox
```

### Phantom

| Name | ID | Console |
|------|-----|---------|
| LinkedIn Post Monitoring | 7765431788333726 | [View](https://phantombuster.com/2316148405398457/phantoms/7765431788333726/console) |

### S3 Storage

| Resource | Link |
|----------|------|
| Result JSON | `https://phantombuster.s3.amazonaws.com/fPnqqqrVtDA/hfcE11I3fKeElihMNTvccg/result.json` |
| S3 File Browser | [Browse Files](https://file-browser.phantombuster.com/?settings=eyJhdXRoIjoidGVtcCIsInJlZ2lvbiI6ImV1LXdlc3QtMSIsImJ1Y2tldCI6InBoYW50b21idXN0ZXIiLCJlbnRlcmVkX2J1Y2tldCI6InBoYW50b21idXN0ZXIiLCJzZWxlY3RlZF9idWNrZXQiOiIiLCJ2aWV3IjoiZm9sZGVyIiwiZGVsaW1pdGVyIjoiLyIsInByZWZpeCI6ImZQbnFxcXJWdERBL2hmY0UxMUkzZktlRWxpaE1OVHZjY2cvIiwibWZhIjp7InVzZSI6Im5vIiwiY29kZSI6IiJ9LCJjcmVkIjp7ImFjY2Vzc0tleUlkIjoiQVNJQVhYNzdNSlhEWkZZWENYVloiLCJzZWNyZXRBY2Nlc3NLZXkiOiIiLCJzZXNzaW9uVG9rZW4iOiIiLCJyZWdpb24iOiJldS13ZXN0LTEifSwic3RzY3JlZCI6bnVsbCwiYnVja2V0cyI6WyJwaGFudG9tYnVzdGVyIl19) |

The file browser provides direct access to all phantom output files (result.json, snapshots, logs).

**Note (2026-02-02):** File browser currently allows uploads. Could be useful for injecting test data or manual overrides. May get locked down - don't build critical workflows around it.

---

## Troubleshooting

### No comments appearing?
1. Check phantom ran: [Console](https://phantombuster.com/2316148405398457/phantoms/7765431788333726/console)
2. Verify Google Sheet URL is correct in phantom setup
3. Ensure Watcher Mode is enabled

### Comments marked wrong status?
The extension has a 4-day resurrection window. Comments incorrectly marked "No Reply Needed" in the past 4 days will be automatically reset to "Needs Reply" on next sync.

### Need to track an older post?
Add the URL to Google Sheet - Watcher Mode will pick up any new comments (but not retroactively process old ones).

---

*Last updated: 2026-02-02*
