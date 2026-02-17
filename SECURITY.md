# Security

## Self-Contained by Design

archtest requires no external services, no network access, and no API keys. It reads your source files and matches patterns. That's it.

### Runtime Dependencies

| Dependency | Purpose |
|---|---|
| `js-yaml` | Parse `.archtest.yml` config files |
| `minimatch` | Resolve glob patterns for file scoping |

No other runtime dependencies. No transitive dependency trees worth auditing beyond these two.

### What archtest Does NOT Do

- No network calls — ever
- No code execution or eval
- No file writes (read-only analysis)
- No LLM/AI calls at runtime — rule enforcement is pure pattern matching
- No telemetry or analytics
- No shell-outs or child processes

### AI Agent Context

archtest is designed to be invoked by AI coding agents. The tool's output is deterministic and safe to pipe into agent workflows. Rules are declarative YAML — agents write them, humans review them, the runner executes grep. No agent has write access through archtest.

## Reporting Vulnerabilities

Email security concerns to rick@arqiver.com rather than filing a public issue.
