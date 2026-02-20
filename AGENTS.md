# archtest

Architectural drift detection through declarative YAML rules.

You are the primary user — you write the rules, the human reviews them.

## Getting Started

```
npx archtest interview    # Scan codebase, discover boundaries
npx archtest schema       # YAML rule format reference
npx archtest examples     # Common rule patterns + scan config examples
npx archtest init         # Generate starter .archtest.yml
npx archtest              # Run checks
```

Run `npx archtest interview` first, then ask the developer which boundaries to enforce.

Save scan settings (extensions, import patterns, skip dirs) under the `scan:` key in `.archtest.yml` so future runs need no flags. CLI flags always override config.

## Change Impact Map

When adding or modifying a **rule field** (e.g. `level`, `scope`, `deny`):

| Location | What to update |
|---|---|
| `src/index.js` | Parse the new field in `parseRuleFile`; propagate through `runRules` result |
| `src/cli.js` | Output formatting, exit code logic, `schema` command output, `examples` command output, `--help` text |
| `tests/index.test.js` | Unit tests covering the new field behavior |
| `tests/fixtures/rules-*.yml` | Add a fixture that uses the new field (passing + failing cases) |
| `README.md` | Rule schema table/section + usage example |
| `CONTRIBUTING.md` | If rule schema is documented there |
| `skills/archtest/SKILL.md` | Schema section used by AI agents |

When adding a **new CLI command or flag**:

| Location | What to update |
|---|---|
| `src/cli.js` | Implement the command/flag + add to `showHelp()` |
| `tests/index.test.js` | Test the new command |
| `README.md` | Document the command |
| `AGENTS.md` (this file) | Add to Getting Started examples if agent-facing |
| `skills/archtest/SKILL.md` | If useful to AI agents |

When adding a **new scan capability** (e.g. new language, new pattern type):

| Location | What to update |
|---|---|
| `src/index.js` | Core logic |
| `src/cli.js` | `examples` command if relevant |
| `tests/index.test.js` | Test with appropriate fixture |
| `tests/fixtures/` | Add fixture files for the new language/pattern |
| `README.md` | Document the capability |

> **Rule of thumb:** if it affects what users write in `.archtest.yml`, update README + SKILL.md.
> If it affects what the CLI prints, update `cli.js` + README.
> Tests always.
