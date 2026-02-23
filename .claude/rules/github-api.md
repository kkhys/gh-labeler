---
paths:
  - "src/github.rs"
---

# GitHub API Module Rules

## LabelService Trait

- Any change to `LabelService` must also update mock implementations in `src/sync.rs` tests (`MockLabelService`, `FailingLabelService`)
- The trait is the DI boundary — keep it minimal and focused on CRUD operations

## URL Encoding

- Use `encode_path_segment()` for label names in API paths
- Label names can contain UTF-8 characters, spaces, and special characters
- Follows RFC 3986 percent-encoding

## Update Strategy

- `update_label()` = delete old + create new (non-atomic)
- This is an octocrab limitation — there is no direct PATCH endpoint wrapper
- Be aware: if delete succeeds but create fails, the label is lost
- Document this risk in any code that calls `update_label()`

## Similarity Calculation

- `find_similar_label()` uses Levenshtein distance
- Threshold: 0.7 (similarity ratio, not raw distance)
- Operates on lowercased label names for comparison
