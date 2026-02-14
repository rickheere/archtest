# Agent Instructions for archtest

archtest enforces architectural boundaries through declarative YAML rules and grep-based pattern matching. You are the primary user — you write the rules, run the checks, and fix violations. The human defines intent and reviews your work.

## Setting Up Rules

1. Run `npx archtest interview` to scan the codebase and map cross-directory dependencies
2. Read the output — it shows import flows, mutual dependencies, and isolated modules
3. Ask the developer about each finding: which boundaries matter, which coupling is intentional
4. For each confirmed boundary, write a rule in `.archtest.yml`
5. Run `npx archtest` to verify rules pass (or catch existing violations)
6. Add `archtest` to the test script in package.json

## Writing Rules

Run `npx archtest schema` for the YAML format reference.
Run `npx archtest examples` for common rule patterns.

A rule has three parts:
- **name**: unique identifier
- **scope.files**: glob patterns for which files to check
- **scope.exclude**: glob patterns to skip
- **deny.patterns**: regex patterns that must NOT appear in matched files

The developer describes intent in plain language ("the database layer should not know about the API"). Translate that into a deny rule with the right scope and regex patterns.

## Running Checks

```
npx archtest             # Check rules, exit 1 on failure
npx archtest --verbose   # Show per-file breakdown
```

When a rule fails, the output shows the exact file, line number, and matching code. Either:
1. Fix the code (remove the violating import/reference)
2. Update the rule if the boundary was wrong (add an exclude, adjust the pattern)

## Non-JavaScript Projects

The rule engine is language-agnostic. For the interview scanner, pass language-specific flags:

```
npx archtest interview --ext .py --import-pattern "(?:from|import)\s+(\S+)" --skip __pycache__,.git,venv
npx archtest interview --ext .go --import-pattern "import\s+\"([^\"]+)\"" --skip vendor,.git
```
