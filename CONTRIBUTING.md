# Contributing

## Structure

```
src/index.js   — core engine (parse, walk, check, scan, format)
src/cli.js     — CLI and built-in docs (schema, examples, init, interview)
tests/         — node:test suite with fixture project
```

## Development

```
npm test                 # run tests (must pass)
node src/cli.js          # run locally
```

## Submitting Changes

1. Fork and branch
2. Make your changes
3. Ensure `npm test` passes
4. Submit a PR

Keep it simple — archtest is two files and we'd like to keep it that way.
