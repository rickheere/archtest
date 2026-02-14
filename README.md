# archtest

Architectural drift detection through declarative rules.

Define boundaries in YAML. Enforce them with grep. Let your AI write the rules.

## The Problem

Everyone knows architectural rules. "The orchestrator shouldn't import strategy internals." "The database layer shouldn't know about the API." But nobody writes the checks because regex and glob patterns are tedious expert-level string manipulation.

So boundaries erode. With AI coding agents it's worse — they don't smell architectural intent, and after 20 incremental changes you have spaghetti.

## The Insight

LLMs write grep patterns like humans write sentences. The LLM authors the rules, the human reviews them, the test runner executes them. The human never touches regex.

## Install

```
npm install archtest
```

Or run directly:

```
npx archtest
```

## Quick Start

Tell your AI coding agent:

> "Let's set up archtest to protect our architecture. Run `npx archtest interview` to scan the codebase, then ask me about the boundaries we should enforce."

The agent will:

1. Run `archtest interview` to analyze your imports and directory structure
2. Ask you questions about which boundaries matter
3. Write `.archtest.yml` rules based on your answers (using `archtest schema` and `archtest examples`)
4. Run `archtest` to verify the rules pass (or catch existing violations)

## Manual Setup

```
npx archtest init        # Creates a starter .archtest.yml
npx archtest schema      # Shows the YAML format reference
npx archtest examples    # Shows common rule patterns
```

Edit `.archtest.yml`, then run:

```
npx archtest             # Check rules, show failures
npx archtest --verbose   # Show all rules with per-file breakdown
```

## Example Rules

```yaml
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
    description: "Domain layer must not import database modules"
    scope:
      files: ["domain/**/*.ts"]
    deny:
      patterns:
        - "from ['\"].*database"
        - "prisma|knex|sequelize"
```

## CI Integration

archtest exits with code 1 on failure — add it to your test pipeline:

```json
{
  "scripts": {
    "test": "vitest && archtest"
  }
}
```

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

## Philosophy

archtest is an **AI-first tool**. The AI coding agent is the primary interface — it writes the rules, runs the checks, and fixes violations. The human defines intent ("these modules should be independent") and reviews the generated rules.

The rule file is the contract between human intent and machine enforcement. It's human-readable YAML so anyone can review it, but the regex patterns inside are written by AI because that's what AI is good at.

Rules run deterministically with zero AI at runtime. No LLM calls during `archtest` — it's pure grep. Fast, predictable, cacheable, CI-friendly.

## License

MIT
