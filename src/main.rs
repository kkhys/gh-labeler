//! gh-labeler CLI
//!
//! Command line tool for managing GitHub repository labels

use clap::{Parser, Subcommand};
use colored::Colorize;
use std::path::PathBuf;

use gh_labeler::{
    config::{
        default_labels, find_convention_config, load_labels_from_file, parse_repository,
        CONVENTION_CONFIG_FILES,
    },
    sync::LabelSyncer,
    Error, LabelConfig, LabelService, Result, SyncConfig,
};

/// gh-labeler CLI
///
/// Fast and reliable GitHub repository label management tool
#[derive(Parser)]
#[command(
    name = "gh-labeler",
    version,
    about = "Fast and reliable GitHub repository label management tool",
    long_about = "A fast and reliable tool built with Rust for managing GitHub repository labels. \
    Features smart synchronization, alias support, and minimal destructive operations."
)]
struct Cli {
    #[command(subcommand)]
    command: Option<Commands>,

    /// GitHub access token
    #[arg(short = 't', long, global = true)]
    access_token: Option<String>,

    /// Target repository (owner/repo format)
    #[arg(short = 'r', long, global = true)]
    repository: Option<String>,

    /// Dry run mode (don't make actual changes)
    #[arg(long, global = true)]
    dry_run: bool,

    /// Preserve labels not in configuration
    #[arg(long, global = true)]
    allow_added_labels: bool,

    /// Configuration file path (JSON/YAML)
    #[arg(short = 'c', long, global = true)]
    config: Option<PathBuf>,

    /// Verbose output
    #[arg(short, long)]
    verbose: bool,
}

#[derive(Subcommand)]
enum Commands {
    /// Synchronize labels
    Sync,

    /// Preview synchronization content
    Preview,

    /// Output default configuration
    Init {
        /// Output format
        #[arg(long, default_value = "json", value_parser = ["json", "yaml"])]
        format: String,

        /// Output file path
        #[arg(short = 'o', long)]
        output: Option<PathBuf>,
    },

    /// Display current labels
    List {
        /// Output format
        #[arg(long, default_value = "table", value_parser = ["table", "json", "yaml"])]
        format: String,
    },
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();

    match cli.command {
        Some(Commands::Sync) => {
            let token = get_access_token(cli.access_token)?;
            let repository = require_repository(cli.repository)?;
            let labels = load_label_config(cli.config)?;

            let sync_config = SyncConfig {
                access_token: token,
                repository,
                dry_run: cli.dry_run,
                allow_added_labels: cli.allow_added_labels,
                labels: Some(labels),
            };

            run_sync(sync_config, cli.verbose).await
        }

        Some(Commands::Preview) => {
            let token = get_access_token(cli.access_token)?;
            let repository = require_repository(cli.repository)?;
            let labels = load_label_config(cli.config)?;

            let sync_config = SyncConfig {
                access_token: token,
                repository,
                dry_run: true,
                allow_added_labels: cli.allow_added_labels,
                labels: Some(labels),
            };

            run_sync(sync_config, cli.verbose).await
        }

        Some(Commands::Init { format, output }) => run_init(format, output).await,

        Some(Commands::List { format }) => {
            let token = get_access_token(cli.access_token)?;
            let repository = require_repository(cli.repository)?;
            run_list(token, repository, format).await
        }

        None => {
            // Default sync mode (traditional behavior)
            if let (Some(token), Some(repo)) =
                (get_access_token(cli.access_token).ok(), cli.repository)
            {
                let labels = load_label_config(cli.config)?;

                let sync_config = SyncConfig {
                    access_token: token,
                    repository: repo,
                    dry_run: cli.dry_run,
                    allow_added_labels: cli.allow_added_labels,
                    labels: Some(labels),
                };

                run_sync(sync_config, cli.verbose).await
            } else {
                eprintln!(
                    "{}",
                    "Error: Access token and repository are required".red()
                );
                eprintln!("Use {} for help", "gh-labeler --help".cyan());
                std::process::exit(1);
            }
        }
    }
}

/// Execute synchronization
async fn run_sync(config: SyncConfig, verbose: bool) -> Result<()> {
    if verbose {
        println!(
            "{} Initializing sync for repository: {}",
            "•".blue(),
            config.repository.cyan()
        );

        if config.dry_run {
            println!(
                "{} Running in dry-run mode (no changes will be made)",
                "!".yellow()
            );
        }
    }

    let syncer = LabelSyncer::new(config).await?;
    let result = syncer.sync_labels().await?;

    // Display results
    display_sync_result(&result, verbose);

    if !result.errors().is_empty() {
        eprintln!("\n{} Errors occurred:", "✗".red());
        for error in result.errors() {
            eprintln!("  {}", error.red());
        }
        std::process::exit(1);
    }

    Ok(())
}

/// Execute init command
async fn run_init(format: String, output: Option<PathBuf>) -> Result<()> {
    let labels = default_labels();

    let content = match format.as_str() {
        "json" => serde_json::to_string_pretty(&labels)?,
        "yaml" => serde_yaml::to_string(&labels)?,
        _ => return Err(Error::config_validation("Unsupported format")),
    };

    let output_path = output.unwrap_or_else(|| {
        PathBuf::from(format!(
            ".gh-labeler.{}",
            if format == "yaml" { "yaml" } else { &format }
        ))
    });

    if output_path.exists() {
        return Err(Error::config_validation(format!(
            "File already exists: {}. Remove it first or use -o to specify a different path.",
            output_path.display()
        )));
    }

    std::fs::write(&output_path, &content)?;
    println!(
        "{} Default configuration written to: {}",
        "✓".green(),
        output_path.display().to_string().cyan()
    );

    Ok(())
}

/// Execute list command
async fn run_list(access_token: String, repository: String, format: String) -> Result<()> {
    let (owner, repo) = parse_repository(&repository)?;
    let client = gh_labeler::GitHubClient::new(&access_token, &owner, &repo).await?;
    let labels = client.get_all_labels().await?;

    match format.as_str() {
        "table" => {
            println!(
                "{:<30} {:<8} {:<50}",
                "Name".cyan(),
                "Color".cyan(),
                "Description".cyan()
            );
            println!("{}", "─".repeat(90));

            for label in labels {
                let description = label.description.as_deref().unwrap_or("(none)");
                println!(
                    "{:<30} {:<8} {:<50}",
                    label.name,
                    format!("#{}", label.color),
                    description
                );
            }
        }
        "json" => {
            let json = serde_json::to_string_pretty(&labels)?;
            println!("{}", json);
        }
        "yaml" => {
            let yaml = serde_yaml::to_string(&labels)?;
            println!("{}", yaml);
        }
        _ => return Err(Error::config_validation("Unsupported format")),
    }

    Ok(())
}

/// Display synchronization results
fn display_sync_result(result: &gh_labeler::sync::SyncResult, verbose: bool) {
    if result.dry_run() && result.has_changes() {
        println!("\n{} Sync preview (dry-run mode):", "📋".to_string().blue());
    } else if result.has_changes() {
        println!("\n{} Sync completed:", "✓".green());
    } else {
        println!("\n{} No changes required", "✓".green());
    }

    // Display statistics
    println!("  📝 Created: {}", result.created().to_string().green());
    println!("  🔄 Updated: {}", result.updated().to_string().yellow());
    println!("  🗑️ Deleted: {}", result.deleted().to_string().red());
    println!("  📛 Renamed: {}", result.renamed().to_string().blue());
    println!("  ➖ Unchanged: {}", result.unchanged().to_string().white());

    if verbose {
        println!("\n{} Detailed operations:", "📋".blue());
        for (i, operation) in result.operations().iter().enumerate() {
            let prefix = format!("  {}.", i + 1);
            match operation {
                gh_labeler::sync::SyncOperation::Create { label } => {
                    println!(
                        "{} {} Create label: {} (#{})",
                        prefix,
                        "📝".green(),
                        label.name.cyan(),
                        label.color
                    );
                }
                gh_labeler::sync::SyncOperation::Update {
                    current_name,
                    new_label,
                    changes,
                } => {
                    println!(
                        "{} {} Update label: {} -> {}",
                        prefix,
                        "🔄".yellow(),
                        current_name.cyan(),
                        new_label.name.cyan()
                    );
                    for change in changes {
                        println!("      {}", change.dimmed());
                    }
                }
                gh_labeler::sync::SyncOperation::Delete { name, reason } => {
                    println!(
                        "{} {} Delete label: {} ({})",
                        prefix,
                        "🗑️".red(),
                        name.red(),
                        reason.dimmed()
                    );
                }
                gh_labeler::sync::SyncOperation::Rename {
                    current_name,
                    new_name,
                    ..
                } => {
                    println!(
                        "{} {} Rename label: {} -> {}",
                        prefix,
                        "📛".blue(),
                        current_name.cyan(),
                        new_name.cyan()
                    );
                }
                gh_labeler::sync::SyncOperation::NoChange { name } => {
                    if verbose {
                        println!("{} {} No change: {}", prefix, "➖".white(), name.white());
                    }
                }
            }
        }
    }
}

/// Require a repository argument
fn require_repository(repo: Option<String>) -> Result<String> {
    repo.ok_or_else(|| {
        Error::config_validation("Repository is required. Use -r or --repository flag")
    })
}

/// Get access token
fn get_access_token(arg_token: Option<String>) -> Result<String> {
    arg_token
        .or_else(|| std::env::var("GITHUB_TOKEN").ok())
        .ok_or_else(|| Error::config_validation(
            "GitHub access token is required. Set via --access-token, GITHUB_TOKEN env var, or -t flag"
        ))
}

/// Load label configuration
///
/// When a path is given explicitly via `-c`, load from that file.
/// Otherwise, search for a convention-based config file and error if none is found.
fn load_label_config(config_path: Option<PathBuf>) -> Result<Vec<LabelConfig>> {
    match config_path {
        Some(path) => load_labels_from_file(&path),
        None => {
            let path = find_convention_config().ok_or_else(|| Error::ConfigFileNotFound {
                searched_files: CONVENTION_CONFIG_FILES.join(", "),
            })?;
            println!(
                "{} Using config file: {}",
                "•".blue(),
                path.display().to_string().cyan()
            );
            load_labels_from_file(&path)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- get_access_token tests ---
    // Environment variable tests must run serially to avoid race conditions.
    // Combining them into a single test ensures sequential execution.

    #[test]
    fn test_get_access_token_from_arg() {
        let result = get_access_token(Some("my-token".to_string()));
        assert_eq!(result.unwrap(), "my-token");
    }

    #[test]
    fn test_get_access_token_env_variants() {
        // Save original value to restore later
        let original = std::env::var("GITHUB_TOKEN").ok();

        // Test: env var is used when no arg provided
        std::env::set_var("GITHUB_TOKEN", "env-token");
        let result = get_access_token(None);
        assert_eq!(result.unwrap(), "env-token");

        // Test: arg takes precedence over env var
        let result = get_access_token(Some("arg-token".to_string()));
        assert_eq!(result.unwrap(), "arg-token");

        // Test: error when neither arg nor env var is set
        std::env::remove_var("GITHUB_TOKEN");
        let result = get_access_token(None);
        assert!(result.is_err());

        // Restore original value
        if let Some(val) = original {
            std::env::set_var("GITHUB_TOKEN", val);
        }
    }

    // --- require_repository tests ---

    #[test]
    fn test_require_repository_some() {
        let result = require_repository(Some("owner/repo".to_string()));
        assert_eq!(result.unwrap(), "owner/repo");
    }

    #[test]
    fn test_require_repository_none() {
        let result = require_repository(None);
        assert!(result.is_err());
    }

    // --- load_label_config tests ---

    #[test]
    fn test_load_label_config_json() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("labels.json");
        std::fs::write(&path, r##"[{"name":"bug","color":"#ff0000"}]"##).unwrap();
        let labels = load_label_config(Some(path)).unwrap();
        assert_eq!(labels.len(), 1);
        assert_eq!(labels[0].name, "bug");
    }

    #[test]
    fn test_load_label_config_yaml() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("labels.yaml");
        std::fs::write(&path, "- name: bug\n  color: \"#ff0000\"\n").unwrap();
        let labels = load_label_config(Some(path)).unwrap();
        assert_eq!(labels.len(), 1);
        assert_eq!(labels[0].name, "bug");
    }

    #[test]
    fn test_load_label_config_yml() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("labels.yml");
        std::fs::write(&path, "- name: bug\n  color: \"#ff0000\"\n").unwrap();
        let labels = load_label_config(Some(path)).unwrap();
        assert_eq!(labels.len(), 1);
        assert_eq!(labels[0].name, "bug");
    }

    #[test]
    fn test_load_label_config_invalid_extension() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("labels.toml");
        std::fs::write(&path, "").unwrap();
        let result = load_label_config(Some(path));
        assert!(result.is_err());
    }

    #[test]
    fn test_load_label_config_file_not_found() {
        let path = PathBuf::from("/nonexistent/labels.json");
        let result = load_label_config(Some(path));
        assert!(result.is_err());
    }

    // CWD-dependent tests must run in a single test to avoid race conditions
    // (set_current_dir is process-global). Same pattern as test_get_access_token_env_variants.
    #[tokio::test]
    async fn test_cwd_dependent_operations() {
        let original_dir = std::env::current_dir().unwrap();

        // --- load_label_config: no convention file → error ---
        {
            let dir = tempfile::tempdir().unwrap();
            std::env::set_current_dir(dir.path()).unwrap();

            let result = load_label_config(None);
            assert!(result.is_err());
            let err_msg = result.unwrap_err().to_string();
            assert!(err_msg.contains("No configuration file found"));
        }

        // --- load_label_config: convention file found ---
        {
            let dir = tempfile::tempdir().unwrap();
            std::fs::write(
                dir.path().join(".gh-labeler.json"),
                r##"[{"name":"bug","color":"#ff0000"}]"##,
            )
            .unwrap();
            std::env::set_current_dir(dir.path()).unwrap();

            let labels = load_label_config(None).unwrap();
            assert_eq!(labels.len(), 1);
            assert_eq!(labels[0].name, "bug");
        }

        // --- run_init: default output (json) ---
        {
            let dir = tempfile::tempdir().unwrap();
            std::env::set_current_dir(dir.path()).unwrap();

            run_init("json".to_string(), None).await.unwrap();
            let expected = dir.path().join(".gh-labeler.json");
            assert!(expected.exists());
        }

        // --- run_init: default output (yaml) ---
        {
            let dir = tempfile::tempdir().unwrap();
            std::env::set_current_dir(dir.path()).unwrap();

            run_init("yaml".to_string(), None).await.unwrap();
            let expected = dir.path().join(".gh-labeler.yaml");
            assert!(expected.exists());
        }

        // --- run_init: existing file → error ---
        {
            let dir = tempfile::tempdir().unwrap();
            std::fs::write(dir.path().join(".gh-labeler.json"), "[]").unwrap();
            std::env::set_current_dir(dir.path()).unwrap();

            let result = run_init("json".to_string(), None).await;
            assert!(result.is_err());
            let err_msg = result.unwrap_err().to_string();
            assert!(err_msg.contains("File already exists"));
        }

        // Restore original directory
        std::env::set_current_dir(original_dir).unwrap();
    }

    #[tokio::test]
    async fn test_run_init_explicit_output_path() {
        let dir = tempfile::tempdir().unwrap();
        let output = dir.path().join("custom.json");
        run_init("json".to_string(), Some(output.clone()))
            .await
            .unwrap();
        assert!(output.exists());
    }

    // --- display_sync_result tests ---

    #[test]
    fn test_display_sync_result_with_changes() {
        use gh_labeler::sync::{SyncOperation, SyncResult};

        let mut result = SyncResult::new(false);
        result.add_operation(SyncOperation::Create {
            label: LabelConfig {
                name: "bug".to_string(),
                color: "#ff0000".to_string(),
                description: None,
                aliases: Vec::new(),
                delete: false,
            },
        });
        // Should not panic
        display_sync_result(&result, false);
    }

    #[test]
    fn test_display_sync_result_no_changes() {
        use gh_labeler::sync::SyncResult;

        let result = SyncResult::new(false);
        // Should not panic
        display_sync_result(&result, false);
    }

    #[test]
    fn test_display_sync_result_dry_run() {
        use gh_labeler::sync::{SyncOperation, SyncResult};

        let mut result = SyncResult::new(true);
        result.add_operation(SyncOperation::Create {
            label: LabelConfig {
                name: "bug".to_string(),
                color: "#ff0000".to_string(),
                description: None,
                aliases: Vec::new(),
                delete: false,
            },
        });
        // Should not panic
        display_sync_result(&result, false);
    }

    #[test]
    fn test_display_sync_result_verbose() {
        use gh_labeler::sync::{SyncOperation, SyncResult};

        let mut result = SyncResult::new(false);
        result.add_operation(SyncOperation::Create {
            label: LabelConfig {
                name: "new-label".to_string(),
                color: "#ff0000".to_string(),
                description: None,
                aliases: Vec::new(),
                delete: false,
            },
        });
        result.add_operation(SyncOperation::Update {
            current_name: "old".to_string(),
            new_label: LabelConfig {
                name: "old".to_string(),
                color: "#00ff00".to_string(),
                description: None,
                aliases: Vec::new(),
                delete: false,
            },
            changes: vec!["color: #ff0000 -> #00ff00".to_string()],
        });
        result.add_operation(SyncOperation::Delete {
            name: "removed".to_string(),
            reason: "Not in config".to_string(),
        });
        result.add_operation(SyncOperation::Rename {
            current_name: "defect".to_string(),
            new_name: "bug".to_string(),
            new_label: LabelConfig {
                name: "bug".to_string(),
                color: "#d73a4a".to_string(),
                description: None,
                aliases: Vec::new(),
                delete: false,
            },
        });
        result.add_operation(SyncOperation::NoChange {
            name: "unchanged".to_string(),
        });
        // Should not panic
        display_sync_result(&result, true);
    }
}
