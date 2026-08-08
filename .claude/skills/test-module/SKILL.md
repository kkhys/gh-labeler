---
name: test-module
description: Run tests for a single module of this repository (e.g. planner, config, syncer, errors, report, context, labels, similarity). Use when the user wants to test one module instead of the whole suite.
---

Run the test file for the module given in the arguments:

```bash
pnpm exec vitest run tests/$ARGUMENTS.test.ts
```

If no argument was provided, list the available test files under `tests/` and ask which one to run. Show the test output and summarize pass/fail results.
