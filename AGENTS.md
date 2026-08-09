# gh-labeler — Agent & Developer Reference

Machine-oriented reference for AI agents and scripts driving gh-labeler, followed by the development guide for working on this repository. Humans looking for a product overview: see [README.md](./README.md).

## TL;DR

```bash
gh-labeler validate --json # offline config check; no network, no token
gh-labeler plan --json     # read-only preview; safe to run anytime
gh-labeler sync --json     # apply; JSON mode never prompts
```

- Inside a git clone you need zero flags: repository comes from the `origin` remote (or `GITHUB_REPOSITORY`), the token from `GITHUB_TOKEN` / `GH_TOKEN` / `gh auth token`.
- `--json` prints exactly one JSON envelope on stdout. Progress notes go to stderr.
- Nothing is deleted unless the config flags a label `delete: true` or prune is enabled (`--prune` flag or `prune: true` in the config). `--no-prune` overrides a config-level `prune: true` for one run.
- `sync` is idempotent: a second run reports `"status": "no_changes"`, `"idempotent": true`.

## Recommended agent workflow

1. `gh-labeler plan --json` — inspect `operations` and `summary`.
2. If the plan matches the user's intent, `gh-labeler sync --json`.
3. Check `exit_code` / `failures`. Exit code 5 means some operations failed; each failure lists the operation and the API error.

## Config file

Searched in order: `.gh-labeler.json`, `.gh-labeler.yaml`, `.gh-labeler.yml`, `.github/labels.json`, `.github/labels.yaml`, `.github/labels.yml`. Override with `-c <path>`, `-c -` (stdin), or `--from owner/repo[:path]` (another repository).

Shape (JSON Schema: `gh-labeler schema` or [schema/labels.schema.json](./schema/labels.schema.json)):

```yaml
labels:
  - name: bug # required
    color: "#d73a4a" # 6-digit hex with '#'; no 3-digit shorthand; required unless delete: true
    description: "..." # optional, max 100 characters (GitHub's cap)
    aliases: [defect] # optional: old names to rename from
    delete: false # optional: true = delete this label if present (name alone suffices then)
prune: false # optional: true = delete labels not declared above
extends: [org/label-config] # optional: base config(s) to inherit labels from
```

`extends` (object form only) accepts a string or array: each entry is a local path starting with `./`, `../`, or `/` (relative to the extending file) or `owner/repo[:path]` (fetched like `--from`). Bases merge in listed order, then the file's own `labels` apply last; an entry overrides an inherited one with the same name (case-insensitive) as a whole, and `delete: true` cancels an inherited label. `prune` is never inherited — only the directly loaded config decides it. Nesting is allowed; cycles are a config error. Paths inside a config fetched from another repository resolve within that same repository. `validate` stays offline and resolves only local paths; configs extending another repository need `plan`/`sync` (config error otherwise).

A bare top-level array of labels is also accepted. Label names must be unique within the config (case-insensitive, matching GitHub); duplicates are rejected when the config is loaded. Aliases must not repeat across entries or collide with any declared label name (also case-insensitive); such contradictions are rejected too.

## JSON envelope (`--json`)

All fields snake_case. `schema_version` is currently `2`; treat unknown fields as forward-compatible additions.

```json
{
  "schema_version": 2,
  "command": "plan | sync",
  "repository": "owner/repo",
  "status": "success | no_changes | partial_failure",
  "dry_run": false,
  "exit_code": 0,
  "summary": {
    "created": 0,
    "updated": 0,
    "renamed": 0,
    "deleted": 0,
    "kept": 0
  },
  "operations": [],
  "unmanaged": ["labels on the repo that the config does not cover (prune off)"],
  "failures": [{ "operation": {}, "error": "message" }],
  "idempotent": true
}
```

Operation variants:

| `type`   | Fields                                                       |
| -------- | ------------------------------------------------------------ |
| `create` | `label`                                                      |
| `update` | `name`, `label`, `changes: [{field, from, to}]`              |
| `rename` | `from`, `to`, `matched_by: "alias" \| "similarity"`, `label` |
| `delete` | `name`, `reason: "flagged" \| "pruned"`                      |
| `keep`   | `name`                                                       |

`changes[].field` is `name` (casing fix — see matching below), `color`, or `description`.

Error envelope (any command):

```json
{
  "schema_version": 2,
  "command": "sync",
  "status": "error",
  "exit_code": 2,
  "error": {
    "code": "config_error",
    "message": "...",
    "hint": "actionable fix"
  }
}
```

Error codes: `config_error` (exit 2), `auth_error` (3), `repository_not_found` (4), `github_api_error` (1), `general_error` (1, unexpected non-API failure such as a filesystem error).

Lighter envelopes (same `schema_version`): `list --json` carries `labels: [{name, color, description}]`; `export --json` carries `labels` in config-spec form plus `output` when written to a file; `validate --json` carries `config_source`, `label_count`, and `prune`. With `plan --check`, `exit_code` in the envelope is `6` when changes are pending.

## Exit codes

`0` success / no changes · `1` general error · `2` config error · `3` auth error · `4` repository not found · `5` partial failure · `6` drift detected (`plan --check` only).

## Behavioral guarantees

- Matching priority: exact name (and `delete` flags) → alias → similarity (Levenshtein > 0.7) → create. Exact and alias matching ignore case, mirroring GitHub's case-insensitive label names; a case-only difference becomes an `update` with a `name` change, applied as an atomic rename. Each step runs as a global phase over the whole config, so a rename for one entry can never consume a label that another entry names exactly or flags for deletion. Renames preserve label history on issues/PRs.
- `--no-similarity` disables the similarity step for fully deterministic runs; alias matching is explicit and always applies.
- `--config` and `--from` are mutually exclusive; combining them is a config error.
- Transient API failures and GitHub rate limits are retried automatically (Octokit retry + throttling plugins); retry notes go to stderr.
- Updates and renames are atomic single PATCH requests; no delete+recreate window.
- Planning is pure and deterministic for a given repository state + config; `plan` and `sync` share it.
- `sync --json` never prompts. Interactive TTY syncs confirm before deleting (skip with `--yes`). Non-TTY syncs (CI) also proceed without prompting — deletions still require the explicit opt-in above (`delete: true` or prune).

---

# Development Guide

gh-labeler is a TypeScript CLI for declarative GitHub label management. It synchronizes labels from a JSON/YAML config file to a repository with smart rename detection (alias matching + Levenshtein similarity), a plan/apply workflow, safe-by-default deletions, and machine-readable output designed for AI agents. Distributed via npm only.

## Commands

### Build & Run

```bash
pnpm install                     # Install dependencies (registers lefthook hooks)
pnpm run build                   # Compile to dist/ (tsc -p tsconfig.build.json)
node dist/cli/index.js --help    # Run the built CLI
```

### Test

```bash
pnpm run test                                # Run all tests (vitest run)
pnpm run test:watch                          # Watch mode
pnpm exec vitest run tests/planner.test.ts   # Single test file
pnpm run test:coverage                       # Coverage report
```

### Lint, Format & Typecheck

```bash
pnpm run lint                  # oxlint
pnpm run lint:fix              # oxlint --fix
pnpm run format                # oxfmt (writes in place; default settings, no config file)
pnpm run format:check          # oxfmt --check (CI)
pnpm run typecheck             # tsc --noEmit
```

### Git Hooks (lefthook)

- pre-commit: oxlint + oxfmt on staged files (`stage_fixed` re-stages format fixes)
- pre-push: typecheck + tests

Bypass with `git commit --no-verify` only when explicitly needed.

### Nix Dev Shell

```bash
nix develop                    # node 24 + corepack (pnpm via packageManager) + gh
```

### Versioning & Release

```bash
pnpm changeset                 # Create a new changeset
pnpm run version               # Apply changesets (changeset version)
pnpm run release               # Build + changeset publish (CI does this)
```

Release flow: push changesets → the release workflow opens a version PR → merging it publishes to npm.

Dependency policy: all versions are pinned exactly (`save-exact = true` in `.npmrc`); Renovate keeps them current. Requires Node.js >= 22.

## Architecture

### Core Flow

`cli/index.ts` (commander) → `resolveToken()` / `resolveRepository()` (`github/context.ts`: flag → env → `gh` CLI / git remote inference) → config load (`config/index.ts`: `--config` / `--from` remote / stdin / convention auto-detect) → `GitHubClient.connect()` (verifies repo access) → `listLabels()` → `planSync()` (`core/planner.ts`, pure) → human plan rendering + optional confirmation → `applyPlan()` (`core/syncer.ts`) → `buildReport()` → output (`output/render.ts` for humans, `output/report.ts` envelope for `--json`)

### Directory Layout

```
src/
├── errors.ts         # shared GhLabelerError hierarchy
├── version.ts
├── cli/index.ts      # commander wiring (bin entry)
├── core/             # pure domain logic — no I/O, no network
├── config/index.ts   # config parsing & loading
├── github/           # GitHub adapter: API client + token/repo resolution
└── output/           # human rendering + JSON envelope
```

Imports use Node subpath imports (`#core/planner.js`, `#errors.js`, …) declared in the package.json `imports` field: the `development` condition maps `#*` to `./src/*` (typecheck via tsconfig `customConditions`, vitest), the `default` condition to `./dist/*` (runtime). Only `tests/helpers.js` is imported relatively.

### Module Responsibilities

- **`core/labels.ts`** — `LabelSpec`/`LabelDeletion` config entry types, structural validation (`validateLabelSpec`), color rules (`#rrggbb` only), `defaultLabels()`
- **`core/similarity.ts`** — Levenshtein distance, `SIMILARITY_THRESHOLD` (0.7), `calculateLabelSimilarity()`
- **`core/planner.ts`** — `planSync()` pure planning producing `PlannedOperation[]` (`create`/`update`/`rename`/`delete`/`keep`) + `unmanaged` list
- **`core/syncer.ts`** — `applyPlan()` execution with per-operation failure collection, `buildReport()` → `SyncReport` (status/exit code/idempotence)
- **`config/index.ts`** — config parsing (bare array or `{labels, prune, extends}` object form), format detection, convention file search (`CONVENTION_CONFIG_FILES`), stdin loading, remote config via `RemoteFileFetcher`, `extends` resolution (`resolveConfigExtends()`: name-keyed merge, cycle detection, prune never inherited), `serializeConfigDocument()` (init/export output with `$schema`)
- **`github/context.ts`** — zero-config inference: token (`--token` → `GITHUB_TOKEN` → `GH_TOKEN` → `gh auth token`), repository (arg → `GITHUB_REPOSITORY` → origin git remote)
- **`github/client.ts`** — `GitHubClient` wrapping Octokit, `LabelService` interface (DI boundary), `GitHubLabel`, Contents API fetch for remote configs
- **`output/report.ts`** — stable snake_case JSON envelope (`reportEnvelope`, `errorEnvelope`, `REPORT_SCHEMA_VERSION`)
- **`output/render.ts`** — human terminal output (picocolors, diff-style plan)
- **`errors.ts`** — `GhLabelerError` hierarchy with `code`/`exitCode`/`hint`, `EXIT_CODES`
- **`cli/index.ts`** — commander wiring for `init`/`validate`/`plan`/`sync`/`list`/`export`/`schema`

### Key Design Decisions

1. **Plan/apply separation** — `planSync()` is pure; `plan` command and `--dry-run` share the exact same code path as `sync`
2. **Safe by default** — prune (deleting unmanaged labels) is opt-in via `--prune` or `prune: true` in config; interactive `sync` confirms deletions; unmanaged labels are reported, not silently kept
3. **Machine-first output** — every command that reports state supports `--json` with a versioned envelope (`schema_version`; `init` scaffolds files, `schema` prints JSON already); errors are structured too (`code`/`message`/`hint`); exit codes are systematic (0/1/2/3/4/5)
4. **Zero-config inference** — repository from git remote or `GITHUB_REPOSITORY`, token from env or the `gh` CLI; `gh-labeler sync` works with no flags inside a clone
5. **Atomic updates** — `updateLabel()` uses the PATCH endpoint with `new_name`; renames and updates are single requests (the old Rust version did delete+recreate)
6. **Self-describing config** — `schema/labels.schema.json` powers editor autocomplete; `init`/`export` emit `$schema` references; `gh-labeler schema` prints it
7. **Alias before similarity** — matching priority is exact → alias → similarity (>0.7) → create; never reorder

### Matching & Color Invariants

- Config layer uses `#rrggbb`; API layer uses `rrggbb`. `normalizeColor()` converts exactly at the `GitHubClient` boundary
- 3-digit color shorthand is rejected by design
- Exact and alias matching are case-insensitive (GitHub label names are case-insensitively unique); a case-only difference surfaces as an `update` with a `name` field change
- A current label consumed by one match is never matched again
- Each matching step is a global phase across the whole config (all exact matches and `delete` flags consume first, then aliases, then similarity), so an earlier entry's rename can never steal a label a later entry matches more strongly

## Code Style

- TypeScript 7 (native compiler), target ES2024, NodeNext ESM; import specifiers need `.js` extensions
- tsconfig is maximal-strict: `strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `noPropertyAccessFromIndexSignature`, `noImplicitOverride`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, `noUnusedLocals`/`Parameters`, `verbatimModuleSyntax`, `erasableSyntaxOnly` — handle `undefined` from index access explicitly; use bracket access for index-signature properties (including `process.env`); use inline `type` specifiers in imports
- oxlint runs every stable category as errors (`correctness`, `suspicious`, `pedantic`, `perf`, `style`); `restriction`/`nursery` stay off, and a small set of counterproductive rules is disabled in `.oxlintrc.json` (contradictory pairs, Node-CLI-impossible rules, assertion-weakening test rules, size caps)
- oxfmt formats with default settings — no config file on purpose
- Code comments in English, only for what the code cannot express

## Common Pitfalls

- **PlannedOperation additions** require updating 5 locations: the union (`core/planner.ts`), `planSync()`, `executeOperation()`/`summarizePlan()` (`core/syncer.ts`), `serializeOperation()` (`output/report.ts`), `formatOperation()`/`describeOperation()` (`output/render.ts`)
- **stdout vs stderr**: stdout is for primary output only (plans, JSON, exports); progress and prompts go to stderr — `--json` must emit exactly one envelope
- **`LabelService` changes** must update `MockLabelService`/`FailingLabelService` in `tests/helpers.ts`
- **Schema drift**: `schema/labels.schema.json` must stay in sync with `validateLabelSpec()`

## Test Strategy

- Tests live in `tests/*.test.ts`, discovered by vitest's default include pattern (no vitest config file); helpers in `tests/helpers.ts`
- **Planning tests** (`planner.test.ts`) — pure `planSync()` output, matching priority, prune semantics
- **Sync tests** (`syncer.test.ts`) — `applyPlan()` against `MockLabelService`/`FailingLabelService`, dry-run, failure collection, report statuses
- **Config tests** (`config.test.ts`) — both document forms, format auto-detect, convention priority, remote fetch with a fake fetcher, extends resolution (merge order, overrides, cycles, offline failure), serialization round-trips
- **Context tests** (`context.test.ts`) — repo/token resolution priority, git URL parsing (env vars saved/restored per test)
- **Report tests** (`report.test.ts`) — envelope shape stability (snake_case, `schema_version`)
- Environment-dependent behavior (`gh auth token` fallback) must not make tests fail on developer machines

## Key ADRs

1. **TypeScript single implementation** — replaced the Rust + npm dual distribution; the tool is I/O-bound so Rust bought nothing but release complexity
2. **PATCH-based updates** — Octokit exposes `issues.updateLabel`; atomic rename+update replaces delete+recreate
3. **Prune opt-in** — breaking change from the Rust version (which deleted extras by default); safety wins
4. **Versioned JSON envelope** — `schema_version` lets agents detect shape changes
5. **Convention-based config auto-detection** — zero-config experience preserved from v0
6. **Trait-style DI via `LabelService`** — mock injection for tests without network
7. **Subpath imports over relative paths** — `#` imports via the package.json `imports` field work natively in Node, tsc, and vitest; no bundler or path rewriting needed
8. **Single source for AI guidance** — AGENTS.md holds both the agent reference and the development guide; CLAUDE.md only references it
