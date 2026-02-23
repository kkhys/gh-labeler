---
paths:
  - "src/*.rs"
---

# Rust Core Rules

## Error Handling

- Use `thiserror` for error type definitions
- All functions return `crate::error::Result<T>` — never use `unwrap()` or `expect()` in non-test code
- Propagate errors with `?` operator

## Color Format Invariant

- Config layer (`LabelConfig`): always `#rrggbb` (with `#` prefix)
- API layer (GitHub): always `rrggbb` (without `#` prefix)
- Stripping/adding `#` happens at the boundary between config and API

## Test Organization

- Tests live in `#[cfg(test)] mod tests` at the bottom of each file
- Use `use super::*;` to import from parent module
- Test helpers (e.g. `test_config`, `make_github_label`) are defined in the module where they are most relevant

## Public API

- When adding or removing public types/functions, update `pub use` re-exports in `lib.rs`
- Keep `lib.rs` as a thin re-export layer — no logic
