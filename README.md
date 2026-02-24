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
- Convention-based config — Auto-detects `.gh-labeler.json` or `.github/labels.yaml` without `-c`
- Remote config — Pull label definitions from a template repository
- JSON output — Machine-readable output for AI agents and scripts (`--json`)
- stdin support — Pipe configuration from another command (`--config -`)
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
# 1. Generate a default config (creates .gh-labeler.json)
gh-labeler init

# 2. Preview changes (convention config auto-detected)
gh-labeler preview -t $GITHUB_TOKEN -r owner/repo

# 3. Apply
gh-labeler sync -t $GITHUB_TOKEN -r owner/repo
```

If a convention config file exists in the current directory, the `-c` flag is not needed.

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
  -t, --access-token <TOKEN>       GitHub access token
  -r, --repository <REPO>          Repository (owner/repo format)
  -c, --config <FILE>              Configuration file path (use "-" for stdin)
      --template <REPO>            Template repository (owner/repo) — auto-detect convention config
      --remote-config <SPEC>       Remote config file (owner/repo:path/to/file.yaml)
      --dry-run                    Preview mode (no changes applied)
      --allow-added-labels         Keep labels not in configuration
      --json                       Output results as JSON (for sync/preview)
  -v, --verbose                    Verbose output
  -h, --help                       Show help information
  -V, --version                    Print version
```

### Environment Variables

```bash
export GITHUB_TOKEN=your_token_here
gh-labeler sync -r owner/repo
```

---

## Configuration

### Convention-Based Auto-Detection

When no `-c`, `--template`, or `--remote-config` flag is provided, gh-labeler searches the current directory for config files in the following order:

1. `.gh-labeler.json`
2. `.gh-labeler.yaml`
3. `.gh-labeler.yml`
4. `.github/labels.json`
5. `.github/labels.yaml`
6. `.github/labels.yml`

The first file found is used. If none exist, an error is returned suggesting `gh-labeler init`.

### Remote Config

Pull label definitions directly from a GitHub repository:

```bash
# Auto-detect convention config from a template repository
gh-labeler sync -t $GITHUB_TOKEN -r owner/repo --template org/label-templates

# Fetch a specific file from a remote repository
gh-labeler sync -t $GITHUB_TOKEN -r owner/repo --remote-config org/label-templates:config/labels.yaml
```

The `--template` flag searches the remote repository for convention config files (same search order as local auto-detection). The `--remote-config` flag fetches a specific file path.

Note: `--config`, `--template`, and `--remote-config` are mutually exclusive.

### Config Loading Priority

1. `--remote-config` — Fetch a specific file from a remote repository
2. `--template` — Auto-detect convention config from a template repository
3. `--config -` — Read from stdin (auto-detect JSON/YAML)
4. `--config <path>` — Load from a local file
5. Convention auto-detection in the current directory

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
# Convention config (auto-detected, no -c needed)
gh-labeler sync -t $GITHUB_TOKEN -r owner/repo

# Explicit config file
gh-labeler sync -t $GITHUB_TOKEN -r owner/repo -c my-labels.json

# Use a template repository's labels
gh-labeler sync -t $GITHUB_TOKEN -r owner/repo --template org/label-standards

# Fetch a specific remote config file
gh-labeler sync -t $GITHUB_TOKEN -r owner/repo \
  --remote-config org/configs:.github/labels.yaml

# Pipe config via stdin
cat labels.json | gh-labeler sync -t $GITHUB_TOKEN -r owner/repo --config -

# Generate config and pipe directly
gh-labeler init --format yaml | gh-labeler sync -t $GITHUB_TOKEN -r owner/repo --config -

# JSON output for scripting / AI agents
gh-labeler sync -t $GITHUB_TOKEN -r owner/repo --json

# Verbose preview
gh-labeler preview -t $GITHUB_TOKEN -r owner/repo --verbose

# Keep unlisted labels alive
gh-labeler sync -t $GITHUB_TOKEN -r owner/repo --allow-added-labels
```

### JSON Output

With `--json`, sync and preview commands produce structured output:

```json
{
  "status": "success",
  "dry_run": false,
  "exit_code": 0,
  "summary": {
    "created": 2,
    "updated": 1,
    "deleted": 0,
    "renamed": 1,
    "unchanged": 3
  },
  "operations": [
    { "type": "create", "label": { "name": "bug", "color": "#d73a4a" } },
    { "type": "rename", "current_name": "defect", "new_name": "bug" }
  ],
  "errors": [],
  "idempotent": false
}
```

The `status` field is one of `success`, `no_changes`, or `error`.

---

## Exit Codes

| Code | Meaning                                   |
|------|-------------------------------------------|
| 0    | Success                                   |
| 1    | General / unclassified error              |
| 2    | Configuration or validation error         |
| 3    | Authentication failure (invalid token)    |
| 4    | Target repository not found               |
| 5    | Partial success (some operations failed)  |

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
            LabelConfig::new("bug".to_string(), "#d73a4a".to_string())?,
        ]),
    };

    let syncer = LabelSyncer::new(config).await?;
    let result = syncer.sync_labels().await?;

    println!(
        "Created: {}, Updated: {}, Deleted: {}",
        result.created(), result.updated(), result.deleted()
    );

    Ok(())
}
```

### Additional Public APIs

The library also exposes utilities for loading and parsing label configs:

```rust
use gh_labeler::{
    load_labels_from_reader,   // Read labels from any std::io::Read (stdin, files, buffers)
    parse_labels_auto_detect,  // Parse a string, auto-detecting JSON or YAML
    load_labels_from_file,     // Load from a local file (format by extension)
    find_convention_config,    // Find a convention config file in the current directory
    fetch_remote_config,       // Fetch a config file from a GitHub repository
    exit_codes,                // Exit code constants (SUCCESS, CONFIG_ERROR, etc.)
    SyncOutput,                // Structured output envelope for JSON mode
    SyncStatus,                // High-level sync outcome (Success, NoChanges, Error)
    SyncSummary,               // Numeric summary of sync operations
};
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
