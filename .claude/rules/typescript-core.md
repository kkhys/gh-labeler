# TypeScript Core Rules

## Error Handling

- All failure modes use the `GhLabelerError` hierarchy in `src/errors.ts` (`ConfigError`, `AuthError`, `RepositoryNotFoundError`, `ApiError`, `GeneralError`)
- `toGhLabelerError()` maps errors carrying a numeric HTTP `status` (Octokit) to `ApiError` (`github_api_error`); everything else unknown becomes `GeneralError` (`general_error`) — never label non-API failures as API errors
- Every error carries a stable machine-readable `code`, an `exitCode`, and optionally an actionable `hint`
- Wrap unknown thrown values with `toGhLabelerError()` at boundaries — never let raw errors reach the CLI output layer
- User-facing errors must be actionable: prefer adding a `hint` over a longer message

## Module Layout

- `src/` is layered by concern: `core/` (pure domain logic: `labels`, `similarity`, `planner`, `syncer`), `config/` (config loading), `github/` (`client`, `context` — API adapter and token/repo resolution), `output/` (`render`, `report`), `cli/` (bin entry), plus shared root modules `errors.ts` and `version.ts`
- The package is CLI-only: no library entry point (`package.json` `exports` is empty, no `main`/`types`, no declaration emit). Do not add public API surface without an explicit decision
- Pure logic in `core/` (and config parsing) must stay free of I/O and network so it is trivially testable; only `github/` and `cli/` may touch the network or process environment

## ESM / TypeScript

- The package is ESM-only (`"type": "module"`); import specifiers must use `.js` extensions
- Cross-module imports use `#` subpath imports (`#core/planner.js`, `#errors.js`) declared in package.json `imports` — `development` condition resolves to `src/`, `default` to `dist/`. Never use `../`-style cross-module paths; only `tests/helpers.js` is imported relatively
- `verbatimModuleSyntax` is on: use inline `type` specifiers (`import { type Foo, bar }`)
- `noUncheckedIndexedAccess` and `noPropertyAccessFromIndexSignature` are on: handle `undefined` from index access explicitly, use bracket access for index-signature properties (including `process.env`), avoid non-null assertions
- `erasableSyntaxOnly` is on: no enums, namespaces, or constructor parameter properties

## Output Discipline

- stdout carries the primary output (plan, result, JSON envelope, exported config) — always pipeable
- Progress notes, confirmation prompts, and human error messages go to stderr
- `--json` mode must emit exactly one JSON envelope on stdout and nothing else
