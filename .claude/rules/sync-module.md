---
paths:
  - "src/core/planner.ts"
  - "src/core/syncer.ts"
---

# Planner / Syncer Module Rules

## Plan/Execute Separation

- `planSync()` (`src/core/planner.ts`) must be **pure** — no side effects, no API calls
- Execution happens in `applyPlan()` (`src/core/syncer.ts`) after planning
- Dry-run mode skips execution entirely, relying on the plan output

## Label Matching Priority (strict order)

1. Exact name match (and `delete: true` flags) → `keep`, `update`, or `delete`
2. Alias match → `rename` (`matchedBy: "alias"`)
3. Similarity match (threshold > 0.7) → `rename` (`matchedBy: "similarity"`)
4. No match → `create`

Never reorder these steps. Alias matching always takes priority over similarity.
Steps 1–2 match names **case-insensitively** (GitHub label names are unique
ignoring case); a case-only difference becomes an `update` with a `name`
field change, applied as an atomic PATCH rename.
Each step runs as a **global phase** over the whole config, not per label in
config order: an earlier entry's alias/similarity rename must never consume a
label that a later entry names exactly or flags for deletion. Operations are
still emitted in config order.
A current label consumed by one match is never matched again (`consumed` set,
keyed by lowercased name).
Step 3 is skippable per run (`PlanOptions.similarity: false`, CLI `--no-similarity`); steps 1–2 always apply.

## Deletion Safety

- Deletions happen only when explicitly requested: `delete: true` on a label, or prune enabled (`--prune` flag / `prune: true` in config)
- Prune defaults to **off**; unmatched repository labels surface in `unmanaged` instead
- `--no-prune` overrides a config-level `prune: true` for a single run (CLI flag beats config)
- Never make deletion the default behavior

## Adding a New `PlannedOperation` Variant

Update all of these locations:

1. The `PlannedOperation` union (`src/core/planner.ts`)
2. `planSync()` — emit the new variant
3. `executeOperation()` and `summarizePlan()` (`src/core/syncer.ts`)
4. `serializeOperation()` (`src/output/report.ts`)
5. `formatOperation()` and `describeOperation()` (`src/output/render.ts`)

## Test Infrastructure

- `MockLabelService` (in-memory store) — happy-path tests
- `FailingLabelService` — error-path tests
- Helpers in `tests/helpers.ts`: `makeGitHubLabel()`, `makeLabelSpec()`
