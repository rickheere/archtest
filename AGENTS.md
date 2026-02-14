# archtest

Architectural drift detection through declarative YAML rules.

You are the primary user — you write the rules, the human reviews them.

## Getting Started

```
npx archtest interview    # Scan codebase, discover boundaries
npx archtest schema       # YAML rule format reference
npx archtest examples     # Common rule patterns
npx archtest init         # Generate starter .archtest.yml
npx archtest              # Run checks
```

Run `npx archtest interview` first, then ask the developer which boundaries to enforce.
