---
"gh-labeler": minor
---

Add `extends` to the config object form: inherit labels from base configs (a local path like `./base.yml` or another repository as `owner/repo[:path]`), merged in order with the extending file's own labels overriding by name (case-insensitive). `delete: true` cancels an inherited label, nesting is supported with cycle detection, and `prune` is never inherited from a base. `validate` stays offline and resolves only local extends.
