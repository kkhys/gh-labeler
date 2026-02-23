---
description: Run test coverage report with cargo-tarpaulin
---

Run test coverage analysis:

```bash
cargo tarpaulin --verbose --all-features --workspace --timeout 120 --out stdout
```

Summarize the coverage percentage and highlight any uncovered areas.
Note: Requires `cargo-tarpaulin` to be installed (`cargo install cargo-tarpaulin`).
