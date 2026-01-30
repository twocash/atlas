# Heartbeat Monitor

> Monitor active task progress and activity

---

## Identity

**Purpose:** Track task activity and progress across ATLAS workspace

**Triggers:**
- `/heartbeat-monitor`
- `/monitor`
- "show active tasks"
- "watch task progress"

**Depends On:**
- `workspace/tasks/` directory
- Task dispatch tracking files

---

## Instructions

When this skill is invoked, provide monitoring of task activity:

### Step 1: Scan Active Tasks

Parse all task directories in `workspace/tasks/`:

1. Extract for each task:
   - Task name
   - Agent type
   - Dispatch timestamp
   - Last activity timestamp
   - Current status

2. Calculate activity freshness:
   - Time since dispatch
   - Time since last activity

### Step 2: Generate Dashboard

Create a dashboard showing active tasks:

```markdown
# Task Monitor
**Updated:** {current_timestamp}

## Active Tasks ({count})

┌────────────────────────────────────────────────────────────────┐
│ TASK          │ AGENT      │ STATUS    │ LAST ACTIVITY        │
├────────────────────────────────────────────────────────────────┤
│ fix-readme    │ quick-fix  │ RUNNING   │ 30s ago              │
│ research-ai   │ researcher │ RUNNING   │ 5m ago               │
│ organize      │ file-org   │ COMPLETE  │ 1h ago               │
└────────────────────────────────────────────────────────────────┘

## Activity Legend
🟢 ACTIVE   - Activity < 1 hour
🟡 SLOW     - Activity 1-6 hours
🟠 STALE    - Activity 6-24 hours
🔴 SILENT   - Activity > 24 hours

## Task Details

### 🟢 fix-readme @ quick-fix
- **Status:** RUNNING
- **Dispatched:** 1h ago
- **Last Activity:** 30s ago
- **Summary:** Fixing README typo

### 🟡 research-ai @ researcher
- **Status:** RUNNING
- **Dispatched:** 3h ago
- **Last Activity:** 5m ago
- **Summary:** Researching AI agents

### 🟢 organize @ file-organizer
- **Status:** COMPLETE
- **Dispatched:** 2h ago
- **Completed:** 1h ago
- **Summary:** Organized downloads folder

## System Statistics
- **Total Tasks:** 8
- **Active:** 3
- **Complete:** 4
- **Stale:** 1
```

### Step 3: Alert on Issues

Flag concerning patterns:
1. Tasks dispatched but never started
2. Tasks silent for >24 hours
3. Tasks stuck with regular activity

---

## Examples

### Example 1: Quick Status
```
User: /monitor

# Task Monitor
**Updated:** 2026-01-16T21:00:00Z

## Active Tasks (2)
┌─────────────────┬────────────┬─────────┬──────────────┐
│ TASK            │ AGENT      │ STATUS  │ LAST ACTIVITY│
├─────────────────┼────────────┼─────────┼──────────────┤
│ fix-header      │ quick-fix  │ RUNNING │ 5m ago       │
│ research-llms   │ researcher │ RUNNING │ 30m ago      │
└─────────────────┴────────────┴─────────┴──────────────┘

All tasks healthy!
```

---

## Notes

- Focus on practical task tracking, not complex status
- 24-hour staleness threshold is appropriate for personal use
- Archive completed tasks after 7 days

---

*Heartbeat Monitor v1.0*
