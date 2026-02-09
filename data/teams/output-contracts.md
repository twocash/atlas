# Output Contract Pattern

When a squad (Feature Factory, Pit Crew, etc.) writes files that other squads
or runtime code consume, the **writing squad owns a contract module** that
defines the canonical schema, parser, validator, and generator.

## Why

Without a contract, each consumer writes its own parser. Drift accumulates
silently: field names rename, formats diverge, and the self-healing swarm
worsens the problem because its prompt has no authoritative schema to follow.

## Structure

```
src/<domain>/
  contract.ts        ← schema types, parser, validator, generator, prompt
  registry.ts        ← runtime consumer (imports from contract.ts)
  ...

src/<other-domain>/
  consumer.ts        ← another consumer (imports from contract.ts)
```

### Contract module exports

| Export | Purpose |
|--------|---------|
| `interface Schema` | TypeScript type for the canonical shape |
| `REQUIRED_FIELDS` | Array of field names that must be present |
| `NORMALIZATION_MAP` | Known drift patterns → canonical field name |
| `SCHEMA_PROMPT` | Injectable prompt text for agent/swarm contexts |
| `parse(content)` | Shared parser (handles platform line endings) |
| `validate(content)` | Write-gate — rejects drift before it reaches disk |
| `generate(data)` | Produces canonical output from structured data |

## Rules

1. **One contract per file format.** SKILL.md frontmatter, YAML skill
   definitions, and MEMORY.md each get their own contract module.

2. **All consumers import from the contract.** No inline regex parsers.
   If you copy a regex from the contract into your file, you are creating
   drift.

3. **The swarm prompt includes the schema.** Every agent prompt that may
   write the contracted format must embed `SCHEMA_PROMPT` so the agent
   can self-correct without guessing.

4. **The write-gate validates before disk write.** Any code path that
   writes the contracted format calls `validate()` first. Invalid output
   is rejected with an error that includes the full schema for
   self-correction.

5. **The parser normalizes known drift.** When a known-bad field name
   appears (e.g. `triggers:` instead of `trigger:`), the parser silently
   maps it to the canonical name. The validator still rejects the drift
   pattern on write — normalization is read-side tolerance only.

6. **Regression tests validate all live files.** The test suite reads
   every file on disk that should match the contract and asserts it
   passes both parsing and validation.

## Example: SKILL.md Frontmatter

Reference implementation: `apps/telegram/src/skills/frontmatter.ts`

| Component | Location |
|-----------|----------|
| Schema | `SkillFrontmatter` interface |
| Parser | `parseSkillFrontmatter()` |
| Validator | `validateSkillFrontmatter()` |
| Generator | `generateFrontmatter()` |
| Prompt | `SKILL_SCHEMA_PROMPT` |
| Normalization | `NORMALIZATION_MAP` |
| Tests | `apps/telegram/test/frontmatter-schema.test.ts` |

### Consumers

- `src/skills/registry.ts` — runtime skill loading
- `src/conversation/tools/self-mod.ts` — `list_skills`, `create_skill`
- `src/pit-crew/swarm-dispatch.ts` — autonomous repair prompts

## Checklist for new contracts

- [ ] Create contract module with all 6 exports
- [ ] Wire all existing consumers to import from contract
- [ ] Remove all inline parsers/regex that duplicate the contract
- [ ] Inject `SCHEMA_PROMPT` into any agent prompts that write the format
- [ ] Add write-gate `validate()` call before every disk write
- [ ] Add regression test that validates all live files on disk
- [ ] Update this document with the new contract reference
