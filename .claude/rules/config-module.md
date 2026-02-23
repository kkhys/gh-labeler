---
paths:
  - "src/config.rs"
---

# Config Module Rules

## Color Validation

- Only 6-digit hex with `#` prefix is accepted: `#rrggbb`
- 3-digit shorthand (`#abc`) is **not** supported — reject it
- Validation happens in `LabelConfig` construction/deserialization

## SyncConfig

- `SyncConfig` is runtime-only — it is **not** Serialize
- It holds transient state (token, repo info, flags) that should never be persisted
- Constructed in `main.rs` from CLI arguments

## Default Labels

- `default_labels()` provides a starter set of labels
- Changes to default labels affect new users — consider backwards compatibility
- Existing users with custom configs are not affected (they supply their own labels)

## File Format Support

- JSON and YAML are both supported for label config files
- Format is detected by file extension (`.json`, `.yml`, `.yaml`)
- Both formats deserialize into the same `Vec<LabelConfig>`
