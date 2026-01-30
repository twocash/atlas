# Contact Enrichment Plan

## Current Notion Contacts DB Fields

**Already syncing from PB:**
- ✓ Name
- ✓ LinkedIn URL
- ✓ Headline
- ✓ LinkedIn Degree (connection level)
- ✓ Company (text field - exists!)
- ✓ Follower Count (number field - exists!)
- ✓ Notes (stores PB:memberId for dedup)

**Existing but NOT syncing:**
- Sales Navigator URL
- Email
- Location
- Connection Status

**Existing classification fields (our logic):**
- Sector
- Grove Alignment
- Priority
- Strategic Bucket
- Sales Nav List Status
- Relationship Stage
- ⭐ Top Engager

---

## PB's Enriched Data Available

### Job Information (RICH!)
- `linkedinJobTitle` → **NEW: Current Job Title** (text)
- `linkedinJobDateRange` → **NEW: Job Started** (date)
- `linkedinJobLocation` → **NEW: Job Location** (text)
- `linkedinJobDescription` → **NEW: Job Description** (text)
- `linkedinCompanyUrl` → **NEW: Company LinkedIn URL** (url)
- `salesNavigatorCompanyUrl` → **Use existing: Sales Navigator URL**
- `companyIndustry` → **NEW: Industry** (text or select)

### Previous Experience
- `previousCompanyName` → **NEW: Previous Company** (text)
- `linkedinPreviousJobTitle` → **NEW: Previous Role** (text)
- `linkedinPreviousJobDateRange` → **NEW: Previous Job Dates** (text)

### Education
- `linkedinSchoolName` → **NEW: School** (text)
- `linkedinSchoolDegree` → **NEW: Degree** (text)
- `linkedinSchoolDateRange` → **NEW: Graduation Year** (text)

### Profile Details
- `linkedinDescription` → **NEW: About / Bio** (text - VERY valuable!)
- `linkedinSkillsLabel` → **NEW: Skills** (text or multi_select)
- `location` → **Use existing or NEW: Location** (text)
- `linkedinFollowersCount` → **Use existing: Follower Count** ✓

### Signals
- `linkedinIsHiringBadge` → **NEW: Hiring Badge** (checkbox)
- `linkedinIsOpenToWorkBadge` → **NEW: Open to Work** (checkbox)

---

## Recommended Approach

### Phase 1: Map to Existing Fields (no DB changes needed)
Update sync to populate:
- Company (already exists)
- Follower Count (already exists)
- Sales Navigator URL (already exists, currently empty)

### Phase 2: Add High-Value Fields
Create these in Notion Contacts DB:
1. **Current Job Title** (text) - shows their role at a glance
2. **Industry** (select) - useful for segmentation
3. **About / Bio** (text) - rich context for reply drafting
4. **Skills** (text) - shows their expertise areas
5. **Location** (text) - geographic context
6. **Open to Work** (checkbox) - hiring signal

### Phase 3: Deep Enrichment (optional)
Add if you want full LinkedIn mirror:
- Previous Company/Role
- Education details
- Job descriptions
- Company URLs

---

## Questions for You

1. **Which fields do you actually use?** No point syncing data you never look at
2. **Keep it simple or go deep?** Just the basics (Phase 1-2) or full profile mirror (Phase 3)?
3. **Auto-sync enrichment?** Should we re-enrich existing contacts when PB provides updates?

---

## Implementation Notes

- We'll update `upsertContact()` in sync-engine.ts to map these fields
- For new Notion properties, you'll create them in the DB first
- The classification logic (Sector, Grove Alignment, etc.) stays the same
- Enrichment happens during `Sync All` automatically
