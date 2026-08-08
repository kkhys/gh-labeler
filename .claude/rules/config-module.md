---
paths:
  - "src/config/index.ts"
  - "src/core/labels.ts"
  - "schema/labels.schema.json"
---

# Config Module Rules

## Color Validation

- Only 6-digit hex with `#` prefix is accepted: `#rrggbb`
- 3-digit shorthand (`#abc`) is **not** supported — reject it
- `color` is required except on `delete: true` entries (`LabelDeletion`), which need only `name`; label fields present on a deletion entry are still format-checked but dropped
- Validation happens in `validateLabelSpec()` (`src/core/labels.ts`) with a location string (e.g. `labels[2]`) for precise errors

## Label Validation

- Label names must be unique case-insensitively (GitHub semantics) — `validateLabels()` in `src/config/index.ts` rejects duplicates at load time, naming both locations
- Aliases must be unique case-insensitively across the whole config and must not collide with any declared label name (including the entry's own) — `validateLabels()` rejects both contradictions, naming both locations
- Descriptions are capped at 100 characters (`MAX_DESCRIPTION_LENGTH`), counted in code points to match GitHub — enforced in `validateLabelSpec()` and mirrored as `maxLength` in the schema

## Config Document Forms

- Two accepted shapes: a bare array of labels, or an object `{ "$schema"?, "prune"?, "labels": [...] }`
- `serializeConfigDocument()` always emits the object form with editor schema support (`$schema` for JSON, `yaml-language-server` directive for YAML)
- `schema/labels.schema.json` is the source of truth for the config shape — keep it in sync with `validateLabelSpec()` and `normalizeConfigDocument()`

## File Format Support

- JSON and YAML, detected by extension (`.json`, `.yaml`, `.yml`)
- stdin and remote content auto-detect: try JSON first, then YAML — never reverse this order
- Convention file search order (first match wins): `.gh-labeler.json` → `.gh-labeler.yaml` → `.gh-labeler.yml` → `.github/labels.json` → `.github/labels.yaml` → `.github/labels.yml`

## Default Labels

- `defaultLabels()` provides the starter set used by `gh-labeler init`
- Changes to default labels affect new users — consider backwards compatibility
- Existing users with their own configs are not affected
