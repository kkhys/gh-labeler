# gh-labeler

## 1.0.0

### Major Changes

- [#133](https://github.com/kkhys/gh-labeler/pull/133) [`4558eff`](https://github.com/kkhys/gh-labeler/commit/4558eff5224f0743dadc0109bfc1a809f08f8345) Thanks [@kkhys](https://github.com/kkhys)! - Rewrite in TypeScript with a redesigned, agent-friendly CLI.

  Breaking changes:

  - Deleting labels not in the config is now opt-in via `--prune` (or `prune: true` in the config); `--allow-added-labels` is removed and its behavior is the new default
  - `preview` is renamed to `plan`; running `gh-labeler` without a subcommand no longer syncs
  - `-t/--access-token` is now `--token`; `-r/--repository` is now an optional positional argument (inferred from the `origin` remote or `GITHUB_REPOSITORY` when omitted)
  - `--template` and `--remote-config` are merged into `--from <repo[:path]>`
  - JSON output envelope redesigned (`schema_version: 2`): renames use `from`/`to`/`matched_by`, unchanged labels are `keep`, structured `failures` replace error strings, `unmanaged` lists uncovered labels
  - Requires Node.js >= 22; crates.io distribution is discontinued
  - The npm package is CLI-only: it exposes no programmatic entry point (`main`/`exports`)

  New features:

  - Zero-config: token also resolves via `GH_TOKEN` and `gh auth token`; repository inferred from git
  - `sync` shows the plan first and confirms deletions in interactive sessions (`--yes` to skip)
  - Atomic label updates/renames via the PATCH endpoint (no more delete+recreate label-loss window)
  - `export` command to adopt an existing repository's labels as config
  - Config object form with `prune` option and published JSON Schema for editor autocomplete (`gh-labeler schema`)
  - Structured errors with machine-readable codes and actionable hints
  - `ghl` is installed as a short alias for the `gh-labeler` command
  - `validate` command checks the config offline — no network or token needed
  - Config validation rejects duplicate label names (case-insensitive, matching GitHub) and descriptions over GitHub's 100-character cap before any network call
  - `plan --check` exits with code 6 when changes are pending, for CI drift gates
  - `--no-similarity` disables similarity-based rename detection for fully deterministic runs
  - `--no-prune` overrides a config-level `prune: true` for a single run
  - Matching resolves exact names and `delete` flags across the whole config before alias/similarity renames, so a rename for one entry can never hijack a label another entry declares exactly
  - `export --json` emits a structured envelope; `--config` and `--from` now error when combined instead of silently ignoring one
  - GitHub API calls retry transient failures and honor rate-limit windows (Octokit retry + throttling plugins)

  Config files from v0 keep working unchanged.

### Minor Changes

- [#133](https://github.com/kkhys/gh-labeler/pull/133) [`4558eff`](https://github.com/kkhys/gh-labeler/commit/4558eff5224f0743dadc0109bfc1a809f08f8345) Thanks [@kkhys](https://github.com/kkhys)! - Case-insensitive matching, delete-only entries, alias conflict validation, and 403 → auth_error

  - Exact-name and alias matching now ignore case, mirroring GitHub's case-insensitive label names. A case-only difference is applied as an atomic rename, reported as an `update` with a `name` field change — and no longer falls through to a failing create under `--no-similarity`.
  - Entries with `delete: true` no longer require `color`: `{ "name": "wontfix", "delete": true }` is now valid. Other label fields on a deletion entry are still format-checked but carry no meaning.
  - Config loading now rejects alias contradictions: an alias claimed by more than one entry, or an alias that matches a declared label name (both case-insensitive).
  - `GitHubClient` maps HTTP 403 to `auth_error` (exit 3), so agents can tell permission problems (missing scope, SAML enforcement) apart from generic API errors.
