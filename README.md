# archtest

[![npm version](https://img.shields.io/npm/v/@rickheere/archtest)](https://www.npmjs.com/package/@rickheere/archtest)
[![npm downloads](https://img.shields.io/npm/dm/@rickheere/archtest)](https://www.npmjs.com/package/@rickheere/archtest)
[![license](https://img.shields.io/npm/l/@rickheere/archtest)](https://github.com/rickheere/archtest/blob/main/LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/rickheere/archtest/ci.yml?label=CI)](https://github.com/rickheere/archtest/actions/workflows/ci.yml)

Architectural drift detection through declarative rules. Any language with import statements.

Define boundaries in YAML. Enforce them with grep. Let your AI write the rules.

archtest turns implicit architectural knowledge (the stuff that lives in people's heads and PR review comments) into executable constraints. Rules are declarative YAML. Enforcement is deterministic pattern matching. AI agents write the rules because regex is what they're good at, but nothing about runtime enforcement involves AI. It's grep. Fast, predictable, CI-friendly.

## The Problem

Everyone knows architectural rules. "The orchestrator shouldn't import strategy internals." "The database layer shouldn't know about the API." But nobody writes the checks because regex and glob patterns are tedious expert-level string manipulation.

So boundaries erode. With AI coding agents it's worse: they don't smell architectural intent, and after 20 incremental changes you have spaghetti.

## The Insight

LLMs write grep patterns like humans write sentences. The LLM authors the rules, the human reviews them, the test runner executes them. The human never touches regex.

<p align="center">
  <img src="logo.png" alt="archtest logo" width="400">
</p>

## Quick Start

Tell your AI coding agent:

```
Run npx @rickheere/archtest interview to scan our codebase,
then ask me about the boundaries we should enforce.
```

The agent will:

1. Run `archtest interview`. The tool reports it needs `--ext` and `--import-pattern` flags
2. Figure out your language and provide the right flags (e.g. `--ext .go --import-pattern '^\s*"([^"]+)"'`)
3. Run the interview again, this time scanning imports and mapping your directory structure
4. Ask you questions about which boundaries matter
5. Write `.archtest.yml` rules based on your answers (using `archtest schema` and `archtest examples`)
6. Run `archtest` to verify the rules pass (or catch existing violations)

<p align="center">
  <img src="demo.gif" alt="archtest demo" width="700">
</p>

## Manual Setup

```
npx @rickheere/archtest init        # Creates a starter .archtest.yml
npx @rickheere/archtest schema      # Shows the YAML format reference
npx @rickheere/archtest examples    # Shows common rule patterns
```

Edit `.archtest.yml`, then run:

```
npx @rickheere/archtest             # Check rules, show failures
npx @rickheere/archtest --verbose   # Show all rules with per-file breakdown
```

## Example Rules

```yaml
scan:
  extensions: [.ts, .tsx]
  import-patterns:
    - 'require\s*\(\s*[''"]([^''"]+)[''"]\s*\)'
    - '(?:import|export)\s+.*?\s+from\s+[''"]([^''"]+)[''"]'
  skip-dirs: [vendor]

rules:
  - name: no-deep-imports-into-auth
    description: "Import auth/ only through its index, not internal files"
    scope:
      files: ["**/*.ts"]
      exclude: ["auth/**"]
    deny:
      patterns:
        - "from ['\"].*auth/(?!index)"

  - name: no-db-in-domain
    level: warn  # warn = shown but won't fail CI; error (default) = blocks CI
    description: "Domain layer must not import database modules"
    scope:
      files: ["domain/**/*.ts"]
    deny:
      patterns:
        - "from ['\"].*database"
        - "prisma|knex|sequelize"
```

The `scan` section tells archtest which files to scan and how to extract imports. Both `extensions` and `import-patterns` are required. Save them in config so `archtest interview` works with no flags next time.

## Any Language

archtest works on any language with greppable import syntax. You provide `--ext` and `--import-pattern` (a regex where capture group 1 is the import target), and archtest does the rest.

```bash
# Go
archtest interview --ext .go --import-pattern '^\s*"([^"]+)"'

# Python
archtest interview --ext .py \
  --import-pattern 'from\s+(\S+)\s+import' \
  --import-pattern 'import\s+(\S+)'

# Kotlin / Java
archtest interview --ext .kt --import-pattern 'import\s+([\w.]+)'

# Clojure
archtest interview --ext .clj \
  --import-pattern '\[([a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)+)' \
  --import-pattern '\(([a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)+)\s+[A-Z]'

# Rust
archtest interview --ext .rs --import-pattern 'use\s+([\w:]+)'
```

Built-in hints exist for JS/TS, Go, Python, Rust, JVM, and Clojure. The tool suggests the right `--import-pattern` when it detects these languages. For everything else, your AI agent can figure out the pattern from a sample import line.

## Monorepos

Each sub-project can have its own `.archtest.yml` with different scan settings. Config lookup cascades upward from `--base-dir` to the repo root. Nearest config wins.

```
my-monorepo/
  backend/.archtest.yml     # extensions: [.clj], import-patterns for Clojure
  mobile/.archtest.yml      # extensions: [.ts, .tsx], import-patterns for JS/TS
  .archtest.yml             # shared rules (optional)
```

```bash
archtest interview --base-dir backend/    # Uses backend/.archtest.yml
archtest interview --base-dir mobile/     # Uses mobile/.archtest.yml
```

## CI Integration

archtest exits with code 1 on failure. Add it to your test pipeline:

```json
{
  "scripts": {
    "test": "vitest && archtest"
  }
}
```

## Why This Exists Now

Enforcing architectural boundaries isn't a new idea. ArchUnit does it for Java. But it never scaled beyond single-language, class-level analysis because the hard part was always writing the rules: regex patterns, glob expressions, exclusion logic. Tedious, error-prone, expert work.

AI makes rule authoring cheap. Describe a boundary in natural language, have an agent produce the YAML with correct patterns. The bottleneck that kept this approach impractical for 20 years is gone.

archtest can be a simple grep-based runner because the complexity was never in enforcement. It was in rule authoring.

## Philosophy

Stable systems are not created by controlling how code gets written. They are created by enforcing invariants on the result.

A PR reviewer might catch an architectural violation today and miss it tomorrow. An AI agent will never notice that its 15th incremental change crossed a boundary the first 14 respected. A grep rule catches it every time.

archtest makes architectural drift as visible as a failing test. The rule file is the contract between human intent and machine enforcement. Human-readable YAML that anyone can review, with regex patterns inside that AI writes because that's what AI is good at.

No AI at runtime. No LLM calls during `archtest`. Pure pattern matching. Fast, predictable, cacheable.

## Not a Workflow Tool

archtest does not orchestrate AI agents, manage tasks, or sequence work. It does not care who wrote the code, how it was written, or what process produced it.

It checks the result against declared invariants. That's it.

If your agent wrote clean code that respects boundaries, archtest passes. If it drifted, archtest fails. The agent sees the failure, reads the rule, and fixes the violation. Same as a failing unit test.

archtest is a test tool, not a process tool.

## CLI Reference

| Command | Description |
|---|---|
| `archtest` | Run rules against the codebase |
| `archtest --verbose` | Show all rules and per-file breakdown |
| `archtest --config <path>` | Use a specific rule file |
| `archtest interview` | Scan codebase and generate an architectural interview |
| `archtest schema` | Show the YAML rule file schema |
| `archtest examples` | Show example rules for common patterns |
| `archtest init` | Generate a starter .archtest.yml |

## Install

```
npm install @rickheere/archtest
```

Or run directly without installing:

```
npx @rickheere/archtest
```

## License

MIT
