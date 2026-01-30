# Sales Navigator Sync - Standard Operating Procedure

## Overview

Automated workflow to save and follow high-priority LinkedIn contacts in Sales Navigator, organized by segment (Academics, Builders, Enterprise, Amplifiers).

---

## The Full Pipeline

```
LinkedIn Post
    ↓
PhantomBuster Scrapes (Commenters + Likers)
    ↓
Atlas Sync All (Classify + Create Contacts in Notion)
    ↓
Contacts Classified by Sector/Alignment/Priority
    ↓
Export by Sales Nav Segment
    ↓
Atlas Queue (Save + Follow Automation)
    ↓
Contacts in Sales Navigator Lists
```

---

## Step-by-Step Workflow

### Phase 1: Post & Scrape (Weekly)

**1. Publish LinkedIn post**
   - Share your content on LinkedIn
   - Copy the post URL

**2. Add to Atlas monitoring**
   - Open Atlas extension → **Posts** tab
   - Click **"+ Add"**
   - Paste post URL, add title
   - Assign to **Slot A** or **Slot B**

**3. Configure PhantomBuster**
   - Click **"Setup in PB →"** (copies URL to clipboard)
   - Paste URL in phantom config
   - Save and **Launch** phantom
   - Wait ~1-2 minutes for completion

---

### Phase 2: Sync & Classify

**4. Sync to Notion**
   - In Atlas → **Posts** tab → click **"Sync All"**
   - Watch **Logs** tab for progress
   - This runs the full ETL:
     - Fetches commenters/likers from PhantomBuster S3
     - Classifies each contact:
       - **Sector**: AI/ML Specialist, Academia, Tech, Corporate, etc.
       - **Grove Alignment**: ⭐⭐⭐⭐⭐ to ⭐ (based on keywords)
       - **Priority**: High, Medium, Standard, Low
       - **Strategic Bucket**: University Pipeline, Technical Contributors, etc.
       - **Sales Nav List Status**: Saved - Academic | Technical | Enterprise | Influencer
     - Creates Contacts in Notion (deduped by LinkedIn URL)
     - Creates Engagements (comments/likes)
     - Marks substantive comments as "Needs Reply"

**5. Verify in Notion**
   - Check [Contacts DB](https://www.notion.so/08b9f73264b24e4b82d4c842f5a11cc8)
   - New contacts should have:
     - Sector classification
     - Grove Alignment rating
     - Sales Nav List Status assigned

---

### Phase 3: Export by Segment

**6. Export using Python ETL** (optional - for bulk operations)
   ```bash
   python phantombuster_etl.py --export-sales-nav
   ```
   - Generates CSVs in `sales_nav_exports/`:
     - `sales_nav_academic.csv` (Saved - Academic contacts)
     - `sales_nav_technical.csv` (Saved - Technical contacts)
     - `sales_nav_enterprise.csv` (Saved - Enterprise contacts)
     - `sales_nav_influencer.csv` (Saved - Influencer contacts)
     - `sales_nav_all.csv` (combined)

**Or query Notion directly:**
   - Filter Contacts by "Sales Nav List Status"
   - Export desired segment as CSV

---

### Phase 4: Save + Follow Automation

**7. Import to Atlas Queue**
   - Atlas → **Import** tab
   - Upload segment CSV (or combined CSV)
   - Verify leads appear in **Queue** tab

**8. Run automation**
   - Switch to **Queue** tab
   - Click **"Start"**
   - Atlas will:
     - Navigate to each profile (singleton tab)
     - Execute human-emulated Save+Follow
     - Random delays (5-12s between leads, 30-60s every 10 leads)
     - Log results to **Logs** tab

**9. Monitor progress**
   - Keep Atlas side panel open (maintains heartbeat)
   - Watch **Logs** for any errors
   - Use **Pause** or **Skip** as needed

**10. Export results**
   - Click **"Export"** in Queue tab to download completion log

---

## Segment Mapping

| Notion Classification | Sales Navigator List | Atlas CSV segment |
|-----------------------|----------------------|-------------------|
| Saved - Academic | Academics | `academic` |
| Saved - Technical | Builders | `technical` |
| Saved - Enterprise | Enterprise | `enterprise` |
| Saved - Influencer | Amplifiers | `influencer` |

---

## Classification Logic

### Sector (based on headline keywords)
- **AI/ML Specialist**: ai, machine learning, llm, data scientist, etc.
- **Academia**: professor, phd, researcher, university, faculty
- **Tech**: software, developer, engineer, devops, startup
- **Corporate**: vp, ceo, director, head of, chief
- **Investor**: venture capital, angel investor, partner
- **Influencer**: thought leader, speaker, content creator

### Grove Alignment (scored from keywords + engagement)
- **⭐⭐⭐⭐⭐ Strong**: distributed, edge computing, p2p, local-first, knowledge graph
- **⭐⭐⭐⭐ Good**: ai agent, open source, privacy, federated
- **⭐⭐⭐ Moderate**: llm, ai infrastructure, knowledge management
- **⭐⭐ Peripheral**: tangential keywords
- **⭐ Minimal**: no alignment signals

### Priority (combines alignment + engagement depth)
- **High**: Strong alignment + substantive comment (50+ chars)
- **Medium**: Strong alignment OR substantive comment
- **Standard**: Moderate alignment
- **Low**: Minimal alignment

### Sales Nav List Assignment
- **Saved - Academic**: Sector = Academia
- **Saved - Enterprise**: Corporate sector + senior titles
- **Saved - Technical**: AI/ML or Tech sectors
- **Saved - Influencer**: Influencer sector or senior thought leaders

---

## Error Handling

**Selector failures** (LinkedIn DOM changes):
- Check **Logs** for `SELECTOR_FAILURE` errors
- Update selectors in `src/lib/constants.ts`
- Rebuild extension

**Rate limiting** (LinkedIn throttles):
- Extension has built-in delays
- If you see errors, increase delays in `constants.ts`
- Take a break, resume later

**Phantom fails**:
- Check PB dashboard for errors
- Session cookie might have expired (reconfigure in PB)
- Phantom might be paused (check billing)

---

## Maintenance

**Weekly:**
- Monitor new posts
- Run Sync All after phantoms complete
- Reply to substantive comments

**Monthly:**
- Review classification accuracy (adjust keywords if needed)
- Check for LinkedIn selector changes
- Update Sales Nav lists if segmentation changes

**As needed:**
- Re-run deduplication: `node cleanup-dupes.js`
- Bulk-mark old engagements: `node mark-all-replied.js`
- Export enriched profiles from PB, import via Atlas Settings

---

## Files & Locations

**Chrome Extension:**
- Source: `C:\github\claude-assist\atlas-chrome-ext\`
- Build: `atlas-chrome-ext/build/chrome-mv3-prod/`
- Load in Chrome: `chrome://extensions/` → Load unpacked

**Python ETL:**
- Script: `C:\github\claude-assist\phantombuster_etl.py`
- Sync state: `.pb_sync_state.json`
- Export dir: `sales_nav_exports/`

**Notion Databases:**
- Contacts: `08b9f73264b24e4b82d4c842f5a11cc8`
- Engagements: `25e138b54d1645a3a78b266451585de9`
- Posts: `46448a0166ce42d1bdadc69cad0c7576`

**PhantomBuster:**
- Account: `2316148405398457`
- Slot A: `5464281464072346` (Post Scraper A)
- Slot B: `2175964471330352` (Post Scraper B)
- S3 Base: `https://phantombuster.s3.amazonaws.com/fPnqqqrVtDA`

---

*Atlas v1.0 - LinkedIn automation powered by PhantomBuster, Notion, and Claude*
