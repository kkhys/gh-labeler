---
description: Run all quality gates (fmt, clippy, test)
---

Run all quality checks sequentially. Stop on first failure:

```bash
cargo fmt --all -- --check && cargo clippy --all-targets --all-features -- -D warnings && cargo test
```

Report results clearly — which checks passed and which (if any) failed.
