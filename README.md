# gh-labeler

> Declarative GitHub label management for humans and AI agents.

[![npm version](https://img.shields.io/npm/v/gh-labeler?style=flat-square)](https://www.npmjs.com/package/gh-labeler)
[![npm downloads](https://img.shields.io/npm/d18m/gh-labeler?style=flat-square&label=npm%20downloads)](https://www.npmjs.com/package/gh-labeler)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](https://opensource.org/licenses/MIT)

Declare your labels once in a JSON/YAML file, then `plan` and `sync` them to any repository. gh-labeler figures out the minimal set of changes — creating, updating, and renaming instead of blindly deleting and recreating — and never deletes anything you didn't ask it to.

```console
$ gh-labeler plan
Plan for kkhys/example:

  + create  bug  #d73a4a  Something isn't working
  ~ update  enhancement  (color #84b6eb → #a2eeef)
  → rename  defect → bug  (matched by alias)

Summary: 1 to create, 1 to update, 1 to rename, 8 unchanged
```

## Highlights

- Plan / apply workflow — `plan` previews, `sync` applies. Both share the same pure planning engine, so what you see is exactly what happens
- Zero-config — repository inferred from the `origin` remote (or `GITHUB_REPOSITORY` in Actions), token from `GITHUB_TOKEN` / `GH_TOKEN` / the `gh` CLI. Inside a clone, `gh-labeler sync` just works
- Safe by default — labels are deleted only when flagged `delete: true` or when you opt into `--prune`; interactive syncs confirm deletions first
- Smart renames — alias matching plus Levenshtein similarity turn would-be delete+create pairs into renames that preserve label history on issues and PRs
- Built for AI agents — `--json` gives every state-reporting command a versioned, structured envelope; errors carry machine-readable codes and actionable hints; exit codes are systematic
- Self-describing config — a published JSON Schema powers editor autocomplete in both JSON and YAML

## Installation

```bash
npm install -g gh-labeler   # or: pnpm add -g gh-labeler / npx gh-labeler
```

Requires Node.js >= 22. The install provides two commands: `gh-labeler` and its short alias `ghl`.

## Quick Start

```bash
cd your-repo

gh-labeler init      # 1. create .github/labels.yml with a starter set
gh-labeler plan      # 2. preview what would change
gh-labeler sync      # 3. apply
```

Adopting a repository that already has good labels? Export them as your starting config:

```bash
gh-labeler export -o .github/labels.yml
```

## Configuration

`gh-labeler` looks for the first of: `.gh-labeler.json`, `.gh-labeler.yaml`, `.gh-labeler.yml`, `.github/labels.json`, `.github/labels.yaml`, `.github/labels.yml`.

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/kkhys/gh-labeler/main/schema/labels.schema.json
labels:
  - name: bug
    color: "#d73a4a"
    description: Something isn't working
    aliases: [defect] # existing "defect" label gets renamed to "bug"
  - name: enhancement
    color: "#a2eeef"
    description: New feature or request
  - name: wontfix
    color: "#ffffff"
    delete: true # remove this label if it exists
prune: false # true = delete labels not declared here
```

A bare array of labels (without the `labels:` key) is also accepted. Colors are 6-digit hex with a `#` prefix.

## Commands

| Command                    | Description                                                   |
| -------------------------- | ------------------------------------------------------------- |
| `gh-labeler init`          | Create a starter config (`.github/labels.yml`)                |
| `gh-labeler validate`      | Validate the config offline (no network, no token)            |
| `gh-labeler plan [repo]`   | Preview changes (read-only)                                   |
| `gh-labeler sync [repo]`   | Apply the config; shows the plan first and confirms deletions |
| `gh-labeler list [repo]`   | Show current labels                                           |
| `gh-labeler export [repo]` | Print current labels as a config document                     |
| `gh-labeler schema`        | Print the config JSON Schema                                  |

Common options:

```
[repo]                target as owner/repo; inferred when omitted
-c, --config <path>   config file; "-" reads stdin
--from <repo[:path]>  load the config from another repository
--prune               delete labels not declared in the config
--no-prune            keep undeclared labels even when the config sets prune: true
--no-similarity       disable similarity-based rename detection (aliases still match)
--json                machine-readable JSON output
--token <token>       GitHub token (default: GITHUB_TOKEN → GH_TOKEN → gh auth token)
-y, --yes             skip the deletion confirmation (sync)
--dry-run             plan only (sync)
--check               exit 6 when changes are pending (plan)
```

### Recipes

```bash
# CI: full sync, no prompts, fail on partial errors (exit code 5)
gh-labeler sync --prune --yes

# CI: fail the build when repository labels drift from the config (exit code 6)
gh-labeler plan --check

# Share one label set across an organization
gh-labeler sync --from my-org/label-config

# Pipe a generated config
generate-labels | gh-labeler sync -c - --json
```

### GitHub Actions

The official action, [kkhys/gh-labeler-actions](https://github.com/kkhys/gh-labeler-actions), wraps the CLI and republishes the JSON envelope as step outputs and a job summary:

```yaml
name: Sync labels
on:
  push:
    branches: [main]
    paths: [.github/labels.yml]
jobs:
  labels:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      issues: write
    steps:
      - uses: actions/checkout@v6
      - uses: kkhys/gh-labeler-actions@v1
        with:
          prune: true
```

Set `command: plan` with `check: true` to fail the build on label drift instead of syncing. Running the CLI directly also works — `GITHUB_REPOSITORY` and `GITHUB_TOKEN` are picked up automatically:

```yaml
- run: npx gh-labeler sync --prune --yes
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

## For AI Agents

See [AGENTS.md](./AGENTS.md) for the full machine-oriented reference (JSON envelope schema, exit codes).

### Structured output

Every command except `init` and `schema` accepts `--json` and emits exactly one envelope on stdout:

```json
{
  "schema_version": 2,
  "command": "sync",
  "repository": "kkhys/example",
  "status": "success",
  "dry_run": false,
  "exit_code": 0,
  "summary": {
    "created": 1,
    "updated": 0,
    "renamed": 1,
    "deleted": 0,
    "kept": 8
  },
  "operations": [
    { "type": "create", "label": { "name": "bug", "color": "#d73a4a" } },
    {
      "type": "rename",
      "from": "defect",
      "to": "bug",
      "matched_by": "alias",
      "label": { "name": "bug", "color": "#d73a4a" }
    }
  ],
  "unmanaged": [],
  "failures": [],
  "idempotent": false
}
```

Errors are structured too: `{ "status": "error", "exit_code": 2, "error": { "code": "config_error", "message": "...", "hint": "..." } }`.

### Exit codes

| Code | Meaning                                  |
| ---- | ---------------------------------------- |
| 0    | Success (including "no changes")         |
| 1    | General error                            |
| 2    | Config error                             |
| 3    | Authentication error                     |
| 4    | Repository not found                     |
| 5    | Partial failure (some operations failed) |
| 6    | Drift detected (`plan --check` only)     |

## Migrating from v0 (Rust)

v1 is a TypeScript rewrite with breaking CLI changes:

- Deleting unmanaged labels is now opt-in: add `--prune` (previously the default; `--allow-added-labels` is gone)
- `preview` is now `plan`; the bare `gh-labeler` invocation without a subcommand was removed
- `-t/--access-token` is now `--token` (or just use env vars / the `gh` CLI); `-r/--repository` is now a positional argument
- `--template` and `--remote-config` merged into `--from <repo[:path]>`
- The JSON envelope changed (`schema_version: 2`): renames use `from`/`to`/`matched_by`, unchanged labels are `keep`, structured `failures` replace error strings
- crates.io distribution is discontinued; install from npm

Config files from v0 keep working unchanged.

## Development

```bash
nix develop     # optional: Node 24 + corepack + gh via the flake
pnpm install    # installs deps and registers git hooks (lefthook)
pnpm run lint && pnpm run format:check && pnpm run typecheck && pnpm run test
```

Linting is oxlint, formatting is oxfmt; both also run on staged files via the pre-commit hook, and typecheck + tests run on pre-push.

## License

[MIT](./LICENSE.md) © [Keisuke Hayashi](https://kkhys.me)
