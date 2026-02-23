---
paths:
  - "src/sync.rs"
---

# Sync Module Rules

## Plan/Execute Separation

- `plan_sync_operations()` must be **pure** — no side effects, no API calls
- Execution happens in `sync_labels()` after planning
- Dry-run mode skips execution entirely, relying on the plan output

## Label Matching Priority (strict order)

1. Exact name match → `NoChange` or `Update`
2. Alias match → `Rename`
3. Similarity match (threshold >= 0.7) → `Rename`
4. No match → `Create`

Never reorder these steps. Alias matching always takes priority over similarity.

## Adding a New `SyncOperation` Variant

Update all 5 locations:

1. `SyncOperation` enum definition
2. `plan_sync_operations()` — emit the new variant
3. `sync_labels()` execution match arm
4. `SyncResult::add_operation()` — update statistics
5. `display_sync_result()` — display the new operation type

## Test Infrastructure

- `MockLabelService` — returns configurable success responses; use for happy-path tests
- `FailingLabelService` — returns errors; use for error-path tests
- Helper functions: `test_config()`, `test_syncer()`, `make_github_label()`, `make_label_config()`
