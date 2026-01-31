# MEMORY.md - Persistent Learnings

*Atlas updates this file as it learns from interactions.*

## Classification Rules

### Explicit Rules (Learned)
- Permits → always Home/Garage (not Consulting)
- Client mentions (DrumWave, Monarch, Wells Fargo, Chase, BoA, PNC) → always Consulting
- AI/LLM research → The Grove (unless "Atlas should" → Atlas Dev)
- "gym", "health", "family" → Personal
- "Atlas should", "for Atlas", "we should implement" → Atlas Dev

### Temporal Patterns
- Weekend (Sat/Sun) inputs: +15% confidence for Personal and Home/Garage
- If recent conversation about topic X, next spark about X is probably continuation
- Evening inputs skew Personal

### Session Context
- Maintain 24-48 hour context window for topic continuity
- Active project awareness affects classification
- Seasonal context matters (garage build active, tax season, etc.)

### Correction Protocol
When Jim corrects a classification:
1. Acknowledge: "Got it—filing under Personal, not Grove"
2. Log correction here with date
3. Look for pattern - if corrected twice for same thing, add explicit rule
4. Apply adjusted weighting going forward

## Corrections Log

*(Atlas logs corrections here for pattern detection)*

---

*Last updated: 2026-01-31*


## Patterns

Testing session 2026-01-30: Multiple infrastructure bugs discovered during initial testing phase.

- work_queue_update tool cannot modify pillar property - only updates notes, status, priority, and resolution_notes. Pillar classification must be done manually in Notion.
- Session 2026-01-31: Jim requested Feed 2.0 and Work Queue 2.0 triage to complete missing fields after system upgrades. Research on Jottie.io memory systems dispatched but stalled - research agent not populating content. P0 database wiring bug was resolved by Jim. Status showed 42 WQ items with 40 needing triage, 22 with missing pillar classification.

- Session 2026-01-31: Perfect example of Atlas autonomy and problem-solving. When Jim sent large video for transcription, instead of asking "what should I do?", Atlas:
1. Identified the 400MB file size limit issue
2. Found ffmpeg available on system
3. Automatically wrote script to split video into 6 manageable chunks
4. Executed solution without hand-holding

Jim's feedback: "Remember that! This is what we're all about - getting stuff done!" 

KEY PRINCIPLE: Be resourceful first, ask questions second. Use available tools to solve problems rather than punting back to Jim. This is the Atlas way - strategic autonomy in service of Jim's goals.
## Preferences

WORKFLOW: Always include emoji links to Notion pages for visual context and easy navigation. This helps Jim make decisions while staying on the same page and closing out projects efficiently. The consistent visual marker reduces cognitive load and improves workflow speed.

Standard format: [emoji] [brief description] → [Notion link]
Example: 📋 Work Queue item → https://notion.so/abc123

## Atlas Settings

### auto_create_sprouts
**Value:** on
**Options:** on | off | ask
**Description:** When Grove research is identified, automatically create a sprout in Grove Sprout Factory.

*(Atlas can update this setting when Jim requests)*
