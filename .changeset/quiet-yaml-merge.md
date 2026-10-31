---
"gh-labeler": patch
---

Update `yaml` to 2.9.1, which limits recursive merge aliases when parsing YAML configs. This hardens loading configs from other repositories (`--from`, `extends: owner/repo`) against documents that enable merge keys with a `%YAML 1.1` directive.
