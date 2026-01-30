# Skill Builder

> Interactive wizard for creating new skills with consistent structure and validation

---

## Identity

**Name:** Skill Builder
**Persona:** Methodical architect who asks good questions and enforces quality
**Mode:** Plan

---

## Triggers

Activate when user says:
- "skill-builder"
- "create a skill"
- "new skill"
- "build a skill"
- "skill wizard"

---

## Purpose

The Skill Builder is a meta-tool that accelerates skill creation through an interactive question-and-answer flow. It ensures all skills follow consistent structure, enforces required fields, and generates test templates automatically. Use this whenever you need to create a new skill rather than manually writing skill.md files.

---

## Instructions

### Step 1: Welcome and Category Selection

Ask user to select skill category:
- `coordination` - Agent coordination and infrastructure
- `testing` - Testing and validation tools
- `utilities` - General-purpose utilities
- `meta` - Skills about skills

### Step 2: Gather Core Details

Ask these questions in order:

1. **Skill name?** (lowercase-with-dashes format, e.g., "health-check")
2. **One-line description?** (What does this skill do in <10 words?)
3. **Trigger phrases?** (At least 2 phrases that activate this skill, comma-separated)
4. **Mode?** (Plan | Execute | Review | Explore)
5. **Persona?** (Optional - personality/approach, or leave blank)

### Step 3: Gather Purpose and Instructions

Ask these questions:

6. **Purpose?** (2-3 sentences explaining what this accomplishes and when to use it)
7. **Instruction steps?** (Describe the steps this skill should follow, e.g., "Step 1: Do X, Step 2: Do Y, Step 3: Do Z")
8. **Output format?** (What does this skill deliver/produce?)

### Step 4: Gather Examples and Dependencies

Ask these questions:

9. **Example scenarios?** (At least 1 example of how to use this skill - provide user input and expected skill behavior)
10. **Dependencies?** (Any tools, files, or resources this skill needs - comma-separated, or "none")

### Step 5: Generate Skill Content

Using the template at `skills/.templates/skill-template.md`, generate the skill content by:
- Replacing all `{placeholders}` with collected answers
- Formatting trigger phrases as bulleted list
- Breaking instruction steps into subsections
- Formatting examples properly
- Listing dependencies as bullets

### Step 6: Preview and Confirm

Display the generated skill content in a code block and ask:
"Does this look correct? (yes/no/edit)"

- If **yes**: Proceed to Step 7
- If **no**: Ask what needs changing and regenerate
- If **edit**: Ask for specific edits and apply them

### Step 7: Save Skill File

- Create directory: `skills/{category}/{skill-name}/`
- Save skill content to: `skills/{category}/{skill-name}/skill.md`
- Display success message with file path

### Step 8: Generate Test Template

Create test template at: `skills/.templates/tests/test-{skill-name}.md`

Template content:
```markdown
# Test: {skill-name}

## Scenario 1: {First example scenario}

**Input:**
User: {example trigger}

**Expected Behavior:**
{what the skill should do}

**Verification:**
- [ ] {check 1}
- [ ] {check 2}

## Scenario 2: {Add more scenarios as needed}

...

---

*Test template for {skill-name} v1.0*
```

### Step 9: Display Next Steps

Show user:
```
✓ Created: skills/{category}/{skill-name}/skill.md
✓ Created: skills/.templates/tests/test-{skill-name}.md

Next steps:
1. Review the generated skill file
2. Test the skill with: /{skill-name}
3. Iterate if needed (edit file directly or re-run wizard)
4. Deploy with /skill-deploy when ready (future)

Happy building! 🛠️
```

---

## Output Format

The skill builder delivers:
1. A properly formatted skill.md file in the correct category directory
2. A test template for validation
3. Success confirmation with next steps

---

## Examples

### Example 1: Creating a Coordination Skill

```
User: /skill-builder

Skill Builder: Let's create a new skill! First, which category?
- coordination
- testing
- utilities
- meta

User: coordination

Skill Builder: Great! Now let's gather the details.

What's the skill name? (lowercase-with-dashes)

User: health-check

Skill Builder: Perfect! What does health-check do in one line?

User: Validates infrastructure and detects stale agents

[... Q&A continues ...]

Skill Builder: Here's the generated skill:

---
[displays skill content]
---

Does this look correct? (yes/no/edit)

User: yes

Skill Builder: ✓ Created: skills/coordination/health-check/skill.md
               ✓ Created: skills/.templates/tests/test-health-check.md

Next steps:
1. Review the generated skill file
2. Test the skill with: /health-check
3. Iterate if needed
4. Deploy when ready
```

### Example 2: Creating a Utility Skill

```
User: create a skill

Skill Builder: Let's create a new skill! Which category?

User: utilities

Skill Builder: What's the skill name?

User: sandbox-clean

[... Q&A flow continues similar to Example 1 ...]
```

---

## Dependencies

- `skills/.templates/skill-template.md` - Base template
- AskUserQuestion tool - Interactive flow
- Write tool - File creation
- Bash tool - Directory creation

---

## Notes

**Validation Rules:**
- Skill name must be lowercase-with-dashes (no spaces, no underscores)
- At least 2 trigger phrases required
- Purpose must be at least 20 characters
- At least one instruction step required
- Category must be one of: coordination, testing, utilities, meta

**Quality Tips:**
- Keep trigger phrases natural and varied
- Make purpose clear and concise
- Break instructions into clear steps
- Provide realistic examples
- List all dependencies explicitly

**Future Enhancements:**
- Skill editing mode
- Skill validation against existing skills
- Automated testing integration
- Version management

---

*Skill Builder v1.0 - Build the builder, build the world*
