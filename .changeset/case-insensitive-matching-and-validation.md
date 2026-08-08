---
"gh-labeler": minor
---

Case-insensitive matching, delete-only entries, alias conflict validation, and 403 → auth_error

- Exact-name and alias matching now ignore case, mirroring GitHub's case-insensitive label names. A case-only difference is applied as an atomic rename, reported as an `update` with a `name` field change — and no longer falls through to a failing create under `--no-similarity`.
- Entries with `delete: true` no longer require `color`: `{ "name": "wontfix", "delete": true }` is now valid. Other label fields on a deletion entry are still format-checked but carry no meaning.
- Config loading now rejects alias contradictions: an alias claimed by more than one entry, or an alias that matches a declared label name (both case-insensitive).
- `GitHubClient` maps HTTP 403 to `auth_error` (exit 3), so agents can tell permission problems (missing scope, SAML enforcement) apart from generic API errors.
