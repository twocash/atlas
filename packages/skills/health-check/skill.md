# Health Check

> Validate ATLAS workspace health and detect issues

---

## Identity

**Purpose:** Check that ATLAS's coordination infrastructure is healthy

**Triggers:**
- `/health-check`
- "check workspace health"
- "validate ATLAS system"
- "check for issues"

**Depends On:**
- `workspace/` directory structure
- Notion API connectivity
- Task tracking files
- Agent scripts in `agents/`

---

## Instructions

When this skill is invoked, perform a health check of the ATLAS coordination infrastructure:

### Step 1: Validate Directory Structure

Check that all required directories exist:
- `workspace/` - Main workspace directory
- `workspace/tasks/` - Task tracking directory
- `agents/` - Agent scripts directory
- `.claude/` - Configuration directory

Report any missing directories.

### Step 2: Check Task Tracking

Parse task tracking in `workspace/tasks/`:
1. Count active tasks (not complete)
2. Identify stale tasks (no activity >24h)
3. Check for orphaned task directories

### Step 3: Check Notion Connectivity

Attempt to verify Notion API access:
1. Check if Notion MCP server is configured
2. Attempt a simple query (optional - don't fail if unavailable)

### Step 4: Check Agent Scripts

Verify agent scripts are executable:
1. List files in `agents/`
2. Report any obvious issues

### Step 5: Report Findings

Present results in this format:

```markdown
# ATLAS Health Check
**Timestamp:** {current_timestamp}

## Directory Structure
✓ All required directories present
✗ Missing: {list missing dirs}

## Task Tracking
- Total tasks: {count}
- Active: {count}
- Stale (>24h): {count}
- Orphaned: {count}

## Notion Connectivity
✓ Connected
✗ Not configured
⚠️ Unable to verify

## Agent Scripts
- Available: {count}
- Status: All OK / Issues found

## Issues Detected
{list any issues}

## Recommendations
{suggestions if issues found}
```

### Step 6: Offer Cleanup

If stale or orphaned tasks are found, ask user if they want to:
- Archive old task directories
- Remove orphaned task directories
- Mark abandoned tasks as complete

---

## Examples

### Example 1: Healthy System
```
User: /health-check

# ATLAS Health Check
**Timestamp:** 2026-01-16T21:00:00Z

## Directory Structure
✓ workspace/
✓ workspace/tasks/
✓ agents/
✓ .claude/

## Task Tracking
- Total tasks: 5
- Active: 3
- Stale (>24h): 0
- Orphaned: 0

## Notion Connectivity
✓ Connected

## Agent Scripts
- Available: 4
- Status: All OK

## Issues Detected
None

## Recommendations
No action needed - ATLAS is healthy
```

### Example 2: Issues Detected
```
User: check workspace health

# ATLAS Health Check
**Timestamp:** 2026-01-16T21:00:00Z

## Directory Structure
✓ All required directories present

## Task Tracking
- Total tasks: 12
- Active: 5
- Stale (>24h): 3
- Orphaned: 2

## Issues Detected
⚠️ 3 stale tasks detected:
- fix-readme-typo (last update: 2 days ago)
- research-ai-agents (last update: 3 days ago)
- organize-downloads (last update: 1 week ago)

⚠️ 2 orphaned task directories:
- temp-research-old/
- abandoned-task/

## Recommendations
1. Review stale tasks - are they still needed?
2. Consider archiving or removing orphaned directories

Would you like me to clean these up? (yes/no)
```

---

## Implementation Notes

- Use Python's datetime for staleness calculation
- Store archived tasks in `workspace/tasks/archive/`
- Consider adding health history in `workspace/.health/`

---

## Success Criteria

- ✅ All directory structure validated
- ✅ Task tracking accurately counted
- ✅ Clear, actionable recommendations
- ✅ Optional cleanup offered

---

*ATLAS Health Check v1.0*
