---
name: archtest
description: Set up and manage architectural boundary rules for a codebase using archtest. Use when the user wants to enforce architectural rules, prevent import violations, lock down module boundaries, detect architectural drift, or mentions "archtest". Also use when discussing code organization problems like spaghetti imports, leaky abstractions, or boundary violations.
---

# archtest

Architectural drift detection. Define boundaries in YAML, enforce with grep.

## Workflow

### New Project Setup

1. Install: `npm install --save-dev archtest`
2. Run `npx archtest interview` to scan the codebase and identify dependency structure
3. Read the interview output — it shows cross-directory imports, mutual dependencies, and isolated modules
4. Ask the developer about each finding: which boundaries matter, which coupling is intentional
5. For each confirmed boundary, write a rule in `.archtest.yml`
6. Save scan settings (extensions, import patterns, skip dirs) under the `scan:` key in `.archtest.yml` so future interview runs need no flags
7. Run `npx archtest` to verify rules pass (or catch existing violations)
8. Add `archtest` to the test script in package.json

### Writing Rules

Run `npx archtest schema` for the full YAML format reference.
Run `npx archtest examples` for copy-pasteable rule patterns.

A rule has three parts:
- **name**: unique identifier
- **scope**: which files to check (glob patterns) and which to exclude
- **deny.patterns**: regex patterns that must NOT appear in those files

The developer describes intent in plain language ("the database layer should not know about the API"). Translate that into a deny rule with the right scope and regex patterns.

### Common Rule Patterns

**Barrel-only imports** — outsiders must use index file:
```yaml
scope:
  files: ["**/*.ts"]
  exclude: ["auth/**"]
deny:
  patterns:
    - "from ['\"].*auth/(?!index)"
```

**No cross-module imports** — modules must be independent:
```yaml
scope:
  files: ["module-a/**/*.ts"]
deny:
  patterns:
    - "from ['\"].*module-b"
```

**Package isolation** — restrict a dependency to one directory:
```yaml
scope:
  files: ["**/*.ts"]
  exclude: ["database/**"]
deny:
  patterns:
    - "from ['\"]knex"
    - "require\\(['\"]knex"
```

### Non-JavaScript Projects

archtest works with any language. The rule engine (deny patterns + glob scopes) is language-agnostic.

For the interview scanner, pass language-specific flags or persist them in `.archtest.yml`:

**CLI flags (one-off):**
```
npx archtest interview --ext .py --import-pattern "(?:from|import)\s+(\S+)" --skip __pycache__,.git,venv
npx archtest interview --ext .go --import-pattern "import\s+\"([^\"]+)\"" --skip vendor,.git
```

**Persisted config (recommended — future runs need no flags):**
```yaml
scan:
  extensions: [.go]
  import-patterns: ['^\s*"([^"]+)"']
  skip-dirs: [vendor]
```

Run `npx archtest examples` to see scan config examples for Go, Python, Rust, Java, Clojure, and JS/TS.

CLI flags always override config. The `--ext` flag sets file extensions, `--import-pattern` sets regex where capture group 1 is the import target (can be repeated), and `--skip` sets directories to ignore.

For rule checking, use `--skip` to override the default skip list:
```
npx archtest --skip __pycache__,.git,venv
```

### CI Integration

```json
{
  "scripts": {
    "test": "vitest && npx archtest"
  }
}
```

Exit code 0 = all rules pass. Exit code 1 = violations found.

### When Rules Fail

Read the violation output: it shows the exact file, line number, and matching code. Either:
1. Fix the code (remove the violating import/reference)
2. Update the rule if the boundary was wrong (add an exclude, adjust the pattern)
3. Create a new version of the module if the change is intentional but the old code must stay

### Maintaining Rules

When the codebase grows, re-run `npx archtest interview` to discover new cross-directory dependencies that may need rules. If scan settings are saved in `.archtest.yml`, the interview runs with no extra flags. Run `npx archtest --verbose` to see which files each rule checks.
