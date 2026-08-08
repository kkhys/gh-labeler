---
paths:
  - "src/github/client.ts"
---

# GitHub API Module Rules

## LabelService Interface

- Any change to `LabelService` (`src/github/client.ts`) must also update `MockLabelService` and `FailingLabelService` in `tests/helpers.ts`
- The interface is the DI boundary — keep it minimal and focused on CRUD operations

## Color Format Invariant

- Config layer (`LabelSpec`): always `#rrggbb` (with `#` prefix)
- API layer (`GitHubLabel`, Octokit calls): always `rrggbb` (without `#` prefix)
- `normalizeColor()` is applied exactly at the boundary in `GitHubClient`

## Update Strategy

- `updateLabel()` uses the PATCH endpoint (`issues.updateLabel`) with `new_name` — updates and renames are atomic, single-request operations
- Never reintroduce delete + recreate for updates (the old Rust/octocrab workaround); it can lose labels mid-flight

## Error Mapping

- Map by HTTP status via `statusOf()`: 404 → `RepositoryNotFoundError` (repo check) or `null` (remote file fetch), 401 → `AuthError`, 403 → `AuthError` (valid token, missing permission/scope/SAML)
- Access verification uses `GET /repos/{owner}/{repo}` — not `/user` — so installation tokens (GitHub Actions) work

## Resilience

- `GitHubClient` composes `@octokit/plugin-retry` and `@octokit/plugin-throttling`
- Rate-limit retries cap at 2 per request; retry notes go to stderr, never stdout

## Encoding & Pagination

- Octokit handles URL encoding of label names (UTF-8, spaces, slashes) — do not pre-encode
- Label listing paginates with `octokit.paginate` and `per_page: 100`
