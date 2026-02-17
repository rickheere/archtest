# Contributing to archtest

archtest is a tool for AI agents, and contributions should work the same way. Your AI agent should be able to discover how to contribute, write the code, and submit a PR that another AI agent can review.

Run `archtest contribute` to get machine-readable contribution guidelines.

## Structure

```
src/index.js   — core engine (parse, walk, check, scan, format)
src/cli.js     — CLI entry point, built-in docs (schema, examples, init, interview)
tests/         — node:test suite with fixture projects
```

Two source files. We intend to keep it that way.

## Development

```bash
git clone https://github.com/rickheere/archtest.git
cd archtest
npm test                 # run full test suite (must pass)
node src/cli.js          # run locally
```

No build step. No transpilation. Plain Node.js with zero dev dependencies.

## PR Requirements

PRs are reviewed by the maintainer's AI agent first, then by the maintainer. Structure your PR for machine review:

1. **One concern per PR** — don't mix features with refactors
2. **Tests required** — add or update tests in `tests/` for any behavior change
3. **`npm test` must pass** — CI will reject failures
4. **Commit messages** — imperative mood, explain *why* not *what* (e.g. "fix: catch multi-line Clojure imports" not "updated regex")
5. **No new dependencies** without discussion — archtest has 2 runtime deps and we want to keep it minimal

## What Makes a Good Contribution

- New language import patterns (add to `IMPORT_PATTERN_HINTS` in `index.js` and examples in `cli.js`)
- Bug fixes with a regression test
- Performance improvements to the scanner
- Better interview output formatting
- Documentation improvements

## What We Won't Merge

- Additional runtime dependencies without a very strong case
- Anything that requires a build step
- Features that involve network calls or external services
- Breaking changes to the YAML rule format without a migration path

## Testing

```bash
npm test                           # full suite
node --test tests/scan.test.js     # single file
```

Tests use `node:test` (built-in, no test framework dependency). Fixture projects live in `tests/fixtures/`.
