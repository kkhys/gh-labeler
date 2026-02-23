# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Is

gh-labeler is a CLI tool and Rust library for managing GitHub repository labels. It synchronizes labels from a JSON/YAML configuration file to a GitHub repository, with smart rename detection (alias matching + Levenshtein similarity), dry-run previews, and minimal destructive operations. Distributed via both crates.io and npm.

## Commands

### Build & Run

```bash
cargo build --release          # Build Rust binary
cargo run -- --help            # Run CLI directly
cargo run -- sync -t TOKEN -r owner/repo  # Run sync
```

### Test

```bash
cargo test                     # Run all tests
cargo test --verbose           # Verbose output
cargo test test_name           # Run a single test by name
cargo test config::tests       # Run tests in a specific module
```

### Lint & Format

```bash
cargo fmt --all -- --check     # Check Rust formatting
cargo clippy --all-targets --all-features -- -D warnings  # Rust linting
pnpm run lint                  # Biome lint for TypeScript
pnpm run lint:fix              # Biome lint with auto-fix
```

### npm Package

```bash
pnpm install --ignore-scripts  # Install Node.js deps without building
pnpm run build:ts              # Compile TypeScript (post-install script)
pnpm run copy-binary           # Copy Rust binary to bin/
pnpm run sync-versions         # Sync version from package.json → Cargo.toml
```

### Versioning & Release

```bash
pnpm changeset                 # Create a new changeset
pnpm version                   # Apply changesets and sync versions
pnpm run release:dry-run       # Preview release (no publish)
```

## Architecture

### Core Flow

`main.rs` (CLI via clap) → `SyncConfig` → `LabelSyncer::new()` (validates config, creates `GitHubClient`, checks repo existence) → `sync_labels()` → plan operations → execute operations → `SyncResult`

### Module Responsibilities

- **`config.rs`** — `LabelConfig` and `SyncConfig` structs, JSON/YAML loading, validation (color must have `#` prefix, stored as `#rrggbb`), default label set
- **`github.rs`** — `GitHubClient` wrapping octocrab, all GitHub API calls (CRUD labels, rate limit), `GitHubLabel` struct, Levenshtein similarity calculation, URL path encoding for UTF-8 label names
- **`sync.rs`** — `LabelSyncer` orchestrates sync: builds alias map, plans operations (create/update/delete/rename/no-change), executes them. `SyncResult` tracks statistics
- **`error.rs`** — `Error` enum with `thiserror`, covers API/HTTP/JSON/YAML/IO/validation errors

### Key Design Decisions

- **Label update = delete + recreate**: `GitHubClient::update_label()` deletes then recreates because octocrab lacks a direct PATCH endpoint
- **Sync planning is separated from execution**: `plan_sync_operations()` produces a `Vec<SyncOperation>`, then each operation is executed individually. Dry-run skips execution
- **Similarity threshold 0.7**: `find_similar_label()` uses Levenshtein distance to rename instead of delete+create when labels are sufficiently similar
- **Alias matching takes priority over similarity**: alias match is checked first, then similar label search, then create new

### Dual Distribution (Rust + npm)

The TypeScript in `scripts/` exists solely for npm packaging — it is not application logic:
- `post-install.ts` — copies Rust binary to `bin/` after npm install
- `copy-binary.js` — cross-platform binary copy during prepare
- `sync-versions.js` — keeps `Cargo.toml` version in sync with `package.json`

Versions must stay synchronized: Changesets manages `package.json`, then `sync-versions.js` propagates to `Cargo.toml`.

## Code Style

- Rust: standard `rustfmt` + clippy with `-D warnings`
- TypeScript: Biome with recommended rules, space indentation
- TOML: taplo with `align_entries` and `reorder_keys`
- Code comments in English

## Common Pitfalls

- **Color format mismatch**: Config uses `#rrggbb`, API uses `rrggbb` — strip/add `#` at the boundary
- **Non-atomic update**: `update_label()` does delete + recreate; if create fails after delete, the label is lost
- **Alias vs similarity order**: Alias matching must be checked before Levenshtein similarity — never reverse this
- **SyncOperation additions**: Adding a new variant requires updating 5 locations (enum, plan, execute, SyncResult::add_operation, display_sync_result)

## Test Strategy

### Mock Infrastructure

- `MockLabelService` — configurable success responses for happy-path tests
- `FailingLabelService` — returns errors for error-path tests

### Test Helpers

- `test_config()` — creates a minimal `SyncConfig` for testing
- `test_syncer()` — creates a `LabelSyncer` with mock service
- `make_github_label(name, color, description)` — creates a `GitHubLabel` instance
- `make_label_config(name, color, description)` — creates a `LabelConfig` instance

### Test Categories

- **Unit tests**: individual function behavior (color validation, similarity calculation)
- **Planning tests**: `plan_sync_operations()` output without side effects
- **Integration tests**: full `sync_labels()` flow with mock services
- **Error path tests**: failure handling with `FailingLabelService`
- **CLI helper tests**: argument parsing and config construction

## Key ADRs

1. **delete + recreate for updates** — octocrab lacks a direct PATCH endpoint for labels
2. **Similarity threshold 0.7** — balances rename detection accuracy vs false positives
3. **Plan/execute separation** — enables dry-run mode without code duplication
4. **Trait-based DI** — `LabelService` trait allows mock injection for testing
5. **Dual distribution (crates.io + npm)** — Rust binary with npm wrapper for broader accessibility
