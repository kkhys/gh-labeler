# gh-labeler

🦀 A fast and reliable GitHub repository label management tool built with Rust.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![npm version](https://badge.fury.io/js/gh-labeler.svg)](https://badge.fury.io/js/gh-labeler)

## Features

- 🔄 **Smart Synchronization**: Minimize destructive operations by intelligently renaming similar labels
- 🏷️ **Alias Support**: Define aliases for labels to prevent unnecessary deletions
- 🔍 **Dry Run Mode**: Preview changes before applying them
- ⚙️ **Flexible Configuration**: Support for JSON and YAML configuration files
- 🚀 **Fast Performance**: Built with Rust for speed and reliability
- 📊 **Detailed Reporting**: Comprehensive sync reports with operation details
- 🎯 **CLI & Library**: Use as a command-line tool or integrate as a library

## Installation

### npm (Recommended)

```bash
# Install globally
npm install -g gh-labeler

# Or run directly with npx
npx gh-labeler --help
```

### Cargo (Rust)

```bash
cargo install gh-labeler
```

### Download Binary

Download the latest binary from [GitHub Releases](https://github.com/kkhys/gh-labeler/releases).

## Quick Start

1. **Generate a GitHub Personal Access Token** with `repo` scope
2. **Create a configuration file** (optional):

```bash
gh-labeler init --format json > labels.json
```

3. **Sync your repository**:

```bash
gh-labeler sync -t YOUR_GITHUB_TOKEN -r owner/repo -c labels.json
```

## Usage

### Basic Commands

```bash
# Sync with default labels
gh-labeler sync -t TOKEN -r owner/repo

# Preview changes (dry-run)
gh-labeler preview -t TOKEN -r owner/repo

# Generate default configuration
gh-labeler init --format json

# List current repository labels
gh-labeler list -t TOKEN -r owner/repo
```

### Configuration File

Create a `labels.json` or `labels.yaml` file:

```json
[
  {
    "name": "bug",
    "color": "d73a4a",
    "description": "Something isn't working",
    "aliases": ["defect", "issue"]
  },
  {
    "name": "enhancement",
    "color": "a2eeef", 
    "description": "New feature or request",
    "aliases": ["feature"]
  },
  {
    "name": "documentation",
    "color": "0075ca",
    "description": "Improvements or additions to documentation",
    "aliases": ["docs"]
  }
]
```

### Command Line Options

```bash
gh-labeler [COMMAND] [OPTIONS]

Commands:
  sync     Synchronize repository labels
  preview  Preview sync operations (dry-run)
  init     Generate default configuration
  list     List current repository labels
  help     Show help information

Options:
  -t, --access-token <TOKEN>  GitHub access token
  -r, --repository <REPO>     Repository (owner/repo format)
  -c, --config <FILE>         Configuration file path
  --dry-run                   Preview mode (no changes)
  --allow-added-labels        Keep labels not in configuration
  -v, --verbose               Verbose output
  -h, --help                  Show help information
```

### Environment Variables

```bash
# Set GitHub token via environment variable
export GITHUB_TOKEN=your_token_here
gh-labeler sync -r owner/repo
```

## Configuration Format

### Label Configuration

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | ✅ | Label name |
| `color` | string | ✅ | Hex color code (without #) |
| `description` | string | ❌ | Label description |
| `aliases` | array | ❌ | Alternative names for the label |
| `delete` | boolean | ❌ | Mark label for deletion |

### Example YAML Configuration

```yaml
- name: "priority: high"
  color: "ff0000"
  description: "High priority issue"
  aliases: ["urgent", "critical"]

- name: "type: feature"
  color: "00ff00"
  description: "New feature request"
  aliases: ["enhancement", "feature-request"]

- name: "status: wontfix"
  color: "cccccc"
  description: "This will not be worked on"
  delete: true  # Mark for deletion
```

## Examples

### Sync with Custom Labels

```bash
# Using JSON configuration
gh-labeler sync \\
  --access-token ghp_xxxxxxxxxxxx \\
  --repository myorg/myproject \\
  --config my-labels.json

# Using YAML configuration  
gh-labeler sync \\
  --access-token ghp_xxxxxxxxxxxx \\
  --repository myorg/myproject \\
  --config labels.yaml
```

### Preview Changes

```bash
# See what changes would be made
gh-labeler preview -t $GITHUB_TOKEN -r owner/repo -c labels.json

# Verbose preview with detailed operations
gh-labeler preview -t $GITHUB_TOKEN -r owner/repo -c labels.json --verbose
```

### Preserve Additional Labels

```bash
# Keep labels that aren't in your configuration
gh-labeler sync \\
  --access-token $GITHUB_TOKEN \\
  --repository owner/repo \\
  --config labels.json \\
  --allow-added-labels
```

## Library Usage

You can also use gh-labeler as a Rust library in your projects:

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
    
    println!("Sync completed! Created: {}, Updated: {}, Deleted: {}", 
             result.created, result.updated, result.deleted);
    
    Ok(())
}
```

## Performance Benefits

| Aspect | gh-labeler (Rust) |
|---------|-------------------|
| Performance | ⚡⚡⚡ Lightning fast |
| Memory Usage | 📊📊📊 Minimal footprint |
| Binary Size | 📦 Compact single binary |
| Startup Time | 🚀 Instant startup |
| Cross-platform | ✅ Windows, macOS, Linux |
| Configuration | JSON + YAML support |
| Dry-run | ✅ Safe preview mode |
| Verbose output | Detailed operations |

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Development

```bash
# Clone the repository
git clone https://github.com/kkhys/gh-labeler.git
cd gh-labeler

# Build the project
cargo build

# Run tests
cargo test

# Install locally
cargo install --path .

# Test npm package locally
npm pack
npm install -g gh-labeler-0.1.0.tgz
```

## License

This project is licensed under the MIT License - see the [LICENSE.md](LICENSE.md) file for details.

## Acknowledgments

- GitHub API via [octocrab](https://github.com/XAMPPRocky/octocrab)
- CLI interface via [clap](https://github.com/clap-rs/clap)
- Built with love in Rust 🦀