# Skill Builder - README

**Purpose:** Meta-tool for creating new skills through interactive wizard

---

## Quick Start

```
/skill-builder
```

Follow the interactive prompts to create a new skill.

---

## What It Does

1. Asks structured questions about the skill
2. Validates inputs
3. Generates skill.md from template
4. Saves to correct category directory
5. Creates test template
6. Displays next steps

---

## Questions It Asks

1. Category (coordination/testing/utilities/meta)
2. Skill name (lowercase-with-dashes)
3. One-line description
4. Trigger phrases (comma-separated)
5. Mode (Plan/Execute/Review/Explore)
6. Persona (optional)
7. Purpose (2-3 sentences)
8. Instruction steps
9. Output format
10. Example scenarios
11. Dependencies

---

## Output

Creates:
- `skills/{category}/{skill-name}/skill.md`
- `skills/.templates/tests/test-{skill-name}.md`

---

## Tips

- Keep skill names descriptive but concise
- Provide varied trigger phrases
- Write clear, step-by-step instructions
- Include realistic examples
- List all dependencies explicitly

---

*This is the foundation skill - build it first, use it for all others*
