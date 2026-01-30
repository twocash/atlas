# Status Inspector

> Analyze individual task details and history

---

## Identity

**Purpose:** Parse and analyze task tracking entries

**Triggers:**
- `/status-inspector <task-id>`
- `/inspect <task-name>`
- "task details"
- "show task history"

**Depends On:**
- `workspace/tasks/` directory
- Task dispatch.json files

---

## Instructions

### Step 1: Parse Input

Determine what to inspect:
1. **Task ID**: If user provides task ID, find that task
2. **Task Name**: Fuzzy match to find task
3. **Latest**: Show most recent task if no parameter

### Step 2: Extract Task Details

From `workspace/tasks/{task-id}/dispatch.json`:
- Task name
- Agent type
- Dispatch timestamp
- Status (RUNNING, COMPLETE, STALE)
- Success criteria
- Output requirements

From any output files:
- Results delivered
- Files created/modified
- Summary

### Step 3: Generate Report

```markdown
# Task Analysis: {task-id}
**Task:** {task name}

## Metadata
- **Agent:** {agent type}
- **Status:** {status}
- **Dispatched:** {timestamp} ({age} ago)
- **Last Activity:** {timestamp} ({freshness})

## Success Criteria
{copied from dispatch}

## Output Requirements
{copied from dispatch}

## Results
{extracted from output files or "Pending"}

## Files
{list of files created/modified}

## Health Assessment
🟢 Healthy - Active with recent activity
🟡 Slow - Activity slowing down
🔴 Stale - No recent activity
✅ Complete - Task finished successfully
```

### Step 4: Offer Actions

Based on status:
- **RUNNING**: Check if progressing normally
- **COMPLETE**: Verify results meet criteria
- **STALE**: Ask if task should be archived or revived

---

## Examples

### Example 1: Inspect Active Task
```
User: /inspect fix-header

# Task Analysis: fix-header
**Task:** Fix README header typo

## Metadata
- **Agent:** quick-fix
- **Status:** RUNNING
- **Dispatched:** 2026-01-16T20:00:00Z (1h ago)
- **Last Activity:** 2026-01-16T20:45:00Z (15m ago)

## Success Criteria
- Typo corrected
- File saves successfully

## Output Requirements
Report: "Fixed {file}: {change made}"

## Results
Pending - Agent still working

## Health Assessment
🟢 Healthy - Active with recent activity

Continue monitoring...
```

### Example 2: Inspect Complete Task
```
User: /inspect research-llms

# Task Analysis: research-llms
**Task:** Research latest LLMs

## Metadata
- **Agent:** researcher
- **Status:** ✅ COMPLETE
- **Dispatched:** 2026-01-16T18:00:00Z (3h ago)
- **Completed:** 2026-01-16T18:45:00Z (2h 15m ago)

## Success Criteria
- Summary of key developments
- List of important links

## Results
✅ Delivered: 3-page summary in workspace/tasks/research-llms/summary.md

## Files
- workspace/tasks/research-llms/summary.md
- workspace/tasks/research-llms/links.md

## Health Assessment
✅ Complete - All criteria met

Task completed successfully!
```

---

## Notes

- Keep task tracking simple - dispatch.json + results
- Archive old completed tasks monthly
- Delete stalled tasks after 7 days

---

*Status Inspector v1.0*
