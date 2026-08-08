---
name: check
description: Run all quality gates (oxlint, oxfmt check, typecheck, vitest) for this repository. Use when the user asks to run checks or verify the build, and before committing or pushing changes.
---

Run all quality checks sequentially. Stop on first failure:

```bash
pnpm run lint && pnpm run format:check && pnpm run typecheck && pnpm run test
```

Report results clearly — which checks passed and which (if any) failed. If a check fails, show the relevant error output and fix the issues before re-running.
