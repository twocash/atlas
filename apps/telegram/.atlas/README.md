# Atlas System Directory

This directory contains Atlas's local state, tasks, and memory.

**Contents are gitignored** — each machine maintains its own state.

## Files

- `state.json` — Current runtime state
- `heartbeat.json` — Health status
- `tasks.json` — Atlas task queue
- `updates.log` — Agent update log
- `memory/` — Persistent context and session history

## Usage

Atlas manages this directory automatically. You can inspect files to see what Atlas is tracking.

Check `heartbeat.json` to verify Atlas is healthy.
Check `tasks.json` to see what Atlas is planning.
Check `updates.log` for recent activity.
