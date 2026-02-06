# Atlas Autonomous Repair System

**Sprint:** Pit Stop
**Version:** 1.0.0
**Status:** Implemented (behind feature flags)

---

## Overview

Atlas can autonomously detect, classify, and repair skill-related issues through a three-zone permission model. This document is the canonical reference for the autonomous repair system.

## Three-Zone Permission Model

All pit crew operations are classified into one of three permission zones:

| Zone | Behavior | Scope | Human Involvement |
|------|----------|-------|-------------------|
| **Zone 1** | Auto-Execute | Tier 0 skills, .md edits in `data/skills/` | None |
| **Zone 2** | Auto-Notify | Tier 1 skills, bug fixes, config adjustments | Notified via Telegram |
| **Zone 3** | Approve | Tier 2 skills, core routing, auth, schemas | Must approve first |

### Zone 1: Auto-Execute

Operations deploy immediately without any human notification.

**Eligible operations:**
- Tier 0 skill creation in `data/skills/`
- Tier 0 skill edits (YAML, Markdown) in `data/skills/`
- Read-only skill configurations

**Example:**
```typescript
// Tier 0 skill creation -> Zone 1
{
  type: 'skill-create',
  tier: 0,
  targetFiles: ['data/skills/new-skill/SKILL.md'],
  // Result: auto-execute
}
```

### Zone 2: Auto-Notify

Operations deploy immediately, then send a Telegram notification with rollback instructions.

**Eligible operations:**
- Tier 1 skill creation/edits
- Bug fixes in `src/skills/`
- Skill deletions (any tier)
- Configuration changes in `data/skills/`

**Notification format:**
```
✅ Auto-deployed: skill-name

🟡 Tier 1 (Creates)
Zone: auto-notify
Rule: RULE_6_TIER1_SAFE

Safe directory operation in src/skills/

Rollback: /rollback skill-name
```

### Zone 3: Approve

Operations are queued and require human approval via Telegram before deployment.

**Always Zone 3:**
- ANY operation touching core files (`index.ts`, `bot.ts`, `handler.ts`, `supervisor.ts`)
- ANY operation touching auth/credentials (`.env`, tokens, API keys)
- ANY operation touching external API configs
- Tier 2 skills (external API access)
- Dependency additions
- Schema changes
- Files outside `data/skills/` and `src/skills/`

---

## File Permission Boundaries

### Writable Directories (Swarm can modify)

```
data/skills/**     → Full read/write
data/pit-crew/**   → Full read/write
src/skills/**      → Read/write
```

### Forbidden Files (Never modified by swarm)

```
src/index.ts       → Entry point
src/bot.ts         → Bot setup
src/handler.ts     → Message routing
src/handlers/chat.ts → Chat handler
src/supervisor/**  → Supervisor system
.env*              → Environment/credentials
package.json       → Dependencies
bun.lockb          → Lock file
```

### Read-Only (Everything else)

All other files can be read but not modified by the swarm. Changes to these files require Zone 3 approval.

---

## Safety Mechanisms

### 1. Rate Limiting

| Limit | Default | Env Variable |
|-------|---------|--------------|
| Swarm dispatches per hour | 5 | `ATLAS_SWARM_MAX_PER_HOUR` |
| Swarm session timeout | 300s | `ATLAS_SWARM_TIMEOUT_SECONDS` |

### 2. Rollback Window

Auto-deployed skills can be rolled back within the rollback window (default: 24 hours).

```bash
# List recent auto-deployments
/rollback

# Roll back a specific skill
/rollback skill-name
```

After the window expires, manual intervention is required.

### 3. Auto-Disable on Errors

Skills that fail consecutively are automatically disabled:

| Setting | Default | Env Variable |
|---------|---------|--------------|
| Consecutive failures to disable | 3 | `ATLAS_SKILL_AUTO_DISABLE_ERRORS` |

### 4. Feature Flags (All default OFF)

| Flag | Purpose | Env Variable |
|------|---------|--------------|
| Zone Classifier | Enables zone-based routing | `ATLAS_ZONE_CLASSIFIER` |
| Swarm Dispatch | Enables Claude Code sessions | `ATLAS_SWARM_DISPATCH` |
| Self-Improvement Listener | Enables Feed 2.0 polling | `ATLAS_SELF_IMPROVEMENT_LISTENER` |

**Important:** All flags default to `false`. The system has zero autonomous behavior until explicitly enabled.

---

## Zone Classification Rules

Classification follows strict precedence:

1. **RULE 1:** Core/Auth/External files → Zone 3 (approve)
2. **RULE 2:** Schema changes, dependency additions → Zone 3 (approve)
3. **RULE 3:** Tier 2 skills → Zone 3 (approve)
4. **RULE 4:** Files outside safe directories → Zone 3 (approve)
5. **RULE 5:** Tier 0 skill operations in `data/skills/` → Zone 1 (auto-execute)
6. **RULE 6:** Tier 1 skill operations in safe directories → Zone 2 (auto-notify)
7. **RULE 7:** Skill deletion → Zone 2 (auto-notify) minimum
8. **DEFAULT:** Unknown operations → Zone 3 (approve)

---

## Adding Operations to Zones

### Promoting Zone 3 → Zone 2

To allow an operation type to auto-notify:

1. Edit `src/skills/zone-classifier.ts`
2. Add a new rule BEFORE the default rule
3. Ensure the rule checks:
   - Operation type
   - Tier level
   - Target file paths
4. Add tests in `zone-classifier.test.ts`
5. Document the change here

### Promoting Zone 2 → Zone 1

Zone 1 is reserved for the safest operations. Requirements:

1. Operation must be Tier 0 (read-only)
2. Target files must be in `data/skills/` or `data/pit-crew/`
3. No external side effects
4. Fully reversible

---

## Self-Improvement Flow

```
┌─────────────────┐
│ Feed 2.0 Entry  │ (tagged: "self-improvement")
│ Status: Captured│
└────────┬────────┘
         │ poll
         ▼
┌─────────────────┐
│ Parse Entry     │ → Extract operation type, target files
└────────┬────────┘
         │ classify
         ▼
┌─────────────────┐
│ Zone Classifier │ → Determine permission zone
└────────┬────────┘
         │
    ┌────┴────┬─────────────┐
    ▼         ▼             ▼
┌───────┐ ┌───────┐   ┌──────────┐
│Zone 1 │ │Zone 2 │   │ Zone 3   │
│Execute│ │Execute│   │ Queue    │
│Silent │ │Notify │   │ Approve  │
└───┬───┘ └───┬───┘   └────┬─────┘
    │         │            │
    ▼         ▼            ▼
┌─────────────────┐  ┌──────────────┐
│ Swarm Dispatch  │  │ Work Queue   │
│ (if enabled)    │  │ Manual Fix   │
└────────┬────────┘  └──────────────┘
         │
         ▼
┌─────────────────┐
│ Feed Entry      │
│ Status: Resolved│
└─────────────────┘
```

---

## Code Locations

| Component | File |
|-----------|------|
| Zone Classifier | `src/skills/zone-classifier.ts` |
| Approval Queue | `src/skills/approval-queue.ts` |
| Swarm Dispatch | `src/pit-crew/swarm-dispatch.ts` |
| Self-Improvement Listener | `src/listeners/self-improvement.ts` |
| Feature Flags | `src/config/features.ts` |

---

## Testing

```bash
# Run zone classifier tests
bun test src/skills/zone-classifier.test.ts

# Run swarm dispatch tests
bun test src/pit-crew/swarm-dispatch.test.ts

# Run all tests
bun test
```

---

## Enabling the System

To enable autonomous repair (do this incrementally):

```bash
# Step 1: Enable zone classifier only (routes but doesn't auto-execute)
ATLAS_ZONE_CLASSIFIER=true

# Step 2: Enable self-improvement listener (polls but creates WQ items)
ATLAS_SELF_IMPROVEMENT_LISTENER=true

# Step 3: Enable swarm dispatch (full autonomy for Zone 1/2)
ATLAS_SWARM_DISPATCH=true
```

**Recommended:** Enable flags one at a time, monitor for issues before enabling the next.

---

*Autonomous Repair System v1.0 — Sprint: Pit Stop*
