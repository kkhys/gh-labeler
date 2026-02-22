# gh-labeler

> A fast and reliable GitHub label management tool, built with Rust.

[![Crates.io](https://img.shields.io/crates/v/gh-labeler?style=flat-square)](https://crates.io/crates/gh-labeler)
[![Crates.io](https://img.shields.io/crates/d/gh-labeler?style=flat-square&label=crate%20downloads)](https://crates.io/crates/gh-labeler)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](https://opensource.org/licenses/MIT)
[![npm version](https://img.shields.io/npm/v/gh-labeler?style=flat-square)](https://www.npmjs.com/package/gh-labeler)
[![npm downloads](https://img.shields.io/npm/d18m/gh-labeler?style=flat-square&label=npm%20downloads)](https://www.npmjs.com/package/gh-labeler)

---

## Features

- Smart sync — Renames similar labels instead of deleting them (Levenshtein-based)
- Alias support — Map old label names to new ones seamlessly
- Dry run — Preview every change before it touches your repo
- JSON / YAML — Bring your own config format
- CLI & library — Use standalone or embed in your Rust project

## Installation

### npm (recommended)

```bash
npm install -g gh-labeler

# or run directly
npx gh-labeler --help
```

### Cargo

```bash
cargo install gh-labeler
```

### Binary

Download from [GitHub Releases](https://github.com/kkhys/gh-labeler/releases).

---

## Quick Start

```bash
# 1. Generate a default config
gh-labeler init --format json > labels.json

# 2. Preview changes
gh-labeler preview -t $GITHUB_TOKEN -r owner/repo -c labels.json

# 3. Apply
gh-labeler sync -t $GITHUB_TOKEN -r owner/repo -c labels.json
```

## Usage

```
gh-labeler [COMMAND] [OPTIONS]

Commands:
  sync      Synchronize repository labels
  preview   Preview sync operations (dry-run)
  init      Generate default configuration
  list      List current repository labels
  help      Show help information

Options:
  -t, --access-token <TOKEN>   GitHub access token
  -r, --repository <REPO>      Repository (owner/repo format)
  -c, --config <FILE>          Configuration file path
      --dry-run                Preview mode (no changes applied)
      --allow-added-labels     Keep labels not in configuration
  -v, --verbose                Verbose output
  -h, --help                   Show help information
```

### Environment Variables

```bash
export GITHUB_TOKEN=your_token_here
gh-labeler sync -r owner/repo
```

---

## Configuration

### Schema

| Field         | Type     | Required | Description                             |
|---------------|----------|----------|-----------------------------------------|
| `name`        | string   | yes      | Label name                              |
| `color`       | string   | yes      | Hex color code (with `#` prefix)        |
| `description` | string   | no       | Label description                       |
| `aliases`     | string[] | no       | Alternative names for rename detection  |
| `delete`      | boolean  | no       | Mark label for deletion                 |

### JSON

```json
[
  {
    "name": "bug",
    "color": "#d73a4a",
    "description": "Something isn't working",
    "aliases": ["defect", "issue"]
  },
  {
    "name": "enhancement",
    "color": "#a2eeef",
    "description": "New feature or request",
    "aliases": ["feature"]
  },
  {
    "name": "documentation",
    "color": "#0075ca",
    "description": "Improvements or additions to documentation",
    "aliases": ["docs"]
  }
]
```

### YAML

```yaml
- name: "priority: high"
  color: "#ff0000"
  description: "High priority issue"
  aliases: ["urgent", "critical"]

- name: "type: feature"
  color: "#00ff00"
  description: "New feature request"
  aliases: ["enhancement", "feature-request"]

- name: "status: wontfix"
  color: "#cccccc"
  description: "This will not be worked on"
  delete: true
```

---

## Examples

```bash
# Sync with a custom config
gh-labeler sync \
  --access-token ghp_xxxxxxxxxxxx \
  --repository myorg/myproject \
  --config my-labels.json

# Verbose preview
gh-labeler preview \
  -t $GITHUB_TOKEN \
  -r owner/repo \
  -c labels.json \
  --verbose

# Keep unlisted labels alive
gh-labeler sync \
  -t $GITHUB_TOKEN \
  -r owner/repo \
  -c labels.json \
  --allow-added-labels
```

---

## Library Usage

```toml
[dependencies]
gh-labeler = "0.1"
tokio = { version = "1.0", features = ["full"] }
```

```rust
use gh_labeler::{SyncConfig, LabelSyncer, LabelConfig};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let config = SyncConfig {
        access_token: "your_token".to_string(),
        repository: "owner/repo".to_string(),
        dry_run: false,
        allow_added_labels: false,
        labels: Some(vec![
            LabelConfig::new("bug".to_string(), "d73a4a".to_string())?,
        ]),
    };

    let syncer = LabelSyncer::new(config).await?;
    let result = syncer.sync_labels().await?;

    println!(
        "Created: {}, Updated: {}, Deleted: {}",
        result.created, result.updated, result.deleted
    );

    Ok(())
}
```

---

## Contributing

```bash
git clone https://github.com/kkhys/gh-labeler.git
cd gh-labeler
cargo build
cargo test
```

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes
4. Push and open a Pull Request

## License

MIT — see [LICENSE.md](LICENSE.md) for details.

## Acknowledgments

- [octocrab](https://github.com/XAMPPRocky/octocrab) — GitHub API client
- [clap](https://github.com/clap-rs/clap) — CLI framework
