//! gh-labeler CLI
//!
//! Command line tool for managing GitHub repository labels

use clap::{Parser, Subcommand};
use colored::Colorize;
use std::path::PathBuf;

use gh_labeler::{
    config::{
        default_labels, fetch_remote_config, fetch_remote_convention_config,
        find_convention_config, load_labels_from_file, load_labels_from_stdin, parse_repository,
        CONVENTION_CONFIG_FILES,
    },
    exit_codes,
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
    #[arg(short = 'c', long, global = true, conflicts_with_all = ["template", "remote_config"])]
    config: Option<PathBuf>,

    /// Template repository (owner/repo) — auto-detect convention config
    #[arg(long, global = true, conflicts_with_all = ["config", "remote_config"])]
    template: Option<String>,

    /// Remote config file (owner/repo:path/to/file.yaml)
    #[arg(long, global = true, conflicts_with_all = ["config", "template"])]
    remote_config: Option<String>,

    /// Verbose output
    #[arg(short, long)]
    verbose: bool,

    /// Output results as JSON (for sync/preview commands)
    #[arg(long, global = true)]
    json: bool,
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
async fn main() {
    let code = match run_cli().await {
        Ok(code) => code,
        Err(e) => {
            let cli = Cli::try_parse();
            let json_mode = cli.map(|c| c.json).unwrap_or(false);
            let code = e.exit_code();
            if json_mode {
                let output = serde_json::json!({
                    "status": "error",
                    "exit_code": code,
                    "errors": [e.to_string()],
                });
                println!("{}", serde_json::to_string_pretty(&output).unwrap());
            } else {
                eprintln!("{} {}", "Error:".red(), e);
            }
            code
        }
    };

    std::process::exit(code);
}

/// Main CLI entry point returning an exit code
async fn run_cli() -> Result<i32> {
    let cli = Cli::parse();
    let json_mode = cli.json;

    match cli.command {
        Some(Commands::Sync) => {
            let token = get_access_token(cli.access_token)?;
            let repository = require_repository(cli.repository)?;
            let labels = load_label_config(
                cli.config,
                cli.template,
                cli.remote_config,
                &token,
                json_mode,
            )
            .await?;

            let sync_config = SyncConfig {
                access_token: token,
                repository,
                dry_run: cli.dry_run,
                allow_added_labels: cli.allow_added_labels,
                labels: Some(labels),
            };

            run_sync(sync_config, cli.verbose, json_mode).await
        }

        Some(Commands::Preview) => {
            let token = get_access_token(cli.access_token)?;
            let repository = require_repository(cli.repository)?;
            let labels = load_label_config(
                cli.config,
                cli.template,
                cli.remote_config,
                &token,
                json_mode,
            )
            .await?;

            let sync_config = SyncConfig {
                access_token: token,
                repository,
                dry_run: true,
                allow_added_labels: cli.allow_added_labels,
                labels: Some(labels),
            };

            run_sync(sync_config, cli.verbose, json_mode).await
        }

        Some(Commands::Init { format, output }) => {
            run_init(format, output).await?;
            Ok(exit_codes::SUCCESS)
        }

        Some(Commands::List { format }) => {
            let token = get_access_token(cli.access_token)?;
            let repository = require_repository(cli.repository)?;
            run_list(token, repository, format).await?;
            Ok(exit_codes::SUCCESS)
        }

        None => {
            // Default sync mode (traditional behavior)
            if let (Some(token), Some(repo)) =
                (get_access_token(cli.access_token).ok(), cli.repository)
            {
                let labels = load_label_config(
                    cli.config,
                    cli.template,
                    cli.remote_config,
                    &token,
                    json_mode,
                )
                .await?;

                let sync_config = SyncConfig {
                    access_token: token,
                    repository: repo,
                    dry_run: cli.dry_run,
                    allow_added_labels: cli.allow_added_labels,
                    labels: Some(labels),
                };

                run_sync(sync_config, cli.verbose, json_mode).await
            } else {
                if json_mode {
                    let output = serde_json::json!({
                        "status": "error",
                        "exit_code": exit_codes::CONFIG_ERROR,
                        "errors": ["Access token and repository are required"],
                    });
                    println!("{}", serde_json::to_string_pretty(&output).unwrap());
                } else {
                    eprintln!(
                        "{}",
                        "Error: Access token and repository are required".red()
                    );
                    eprintln!("Use {} for help", "gh-labeler --help".cyan());
                }
                Ok(exit_codes::CONFIG_ERROR)
            }
        }
    }
}

/// Execute synchronization and return an exit code
async fn run_sync(config: SyncConfig, verbose: bool, json_mode: bool) -> Result<i32> {
    if !json_mode && verbose {
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

    if json_mode {
        let output = result.to_output();
        let code = output.exit_code;
        println!("{}", serde_json::to_string_pretty(&output)?);
        return Ok(code);
    }

    // Human-readable output
    display_sync_result(&result, verbose);

    if !result.errors().is_empty() {
        eprintln!("\n{} Errors occurred:", "✗".red());
        for error in result.errors() {
            eprintln!("  {}", error.red());
        }
        return Ok(exit_codes::PARTIAL_SUCCESS);
    }

    Ok(exit_codes::SUCCESS)
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

/// Parse a remote config spec in the format "owner/repo:path/to/file"
///
/// # Returns
/// A tuple of (owner, repo, path)
fn parse_remote_config_spec(spec: &str) -> Result<(String, String, String)> {
    let (repo_part, path) = spec.split_once(':').ok_or_else(|| {
        Error::config_validation(format!(
            "Invalid remote config format: {spec} (expected 'owner/repo:path/to/file')"
        ))
    })?;

    if path.is_empty() {
        return Err(Error::config_validation(format!(
            "Empty file path in remote config: {spec}"
        )));
    }

    let (owner, repo) = parse_repository(repo_part)?;
    Ok((owner, repo, path.to_string()))
}

/// Load label configuration from local file, remote file, stdin, or template repository
///
/// Priority:
/// 1. `--remote-config` — fetch a specific file from a remote repository
/// 2. `--template` — auto-detect convention config from a template repository
/// 3. `--config -` — read from stdin (auto-detect JSON/YAML)
/// 4. `--config <path>` — load from local file
/// 5. None — search for a convention-based config in the current directory
async fn load_label_config(
    config_path: Option<PathBuf>,
    template: Option<String>,
    remote_config: Option<String>,
    token: &str,
    json_mode: bool,
) -> Result<Vec<LabelConfig>> {
    if let Some(spec) = remote_config {
        let (owner, repo, path) = parse_remote_config_spec(&spec)?;
        if !json_mode {
            println!(
                "{} Fetching remote config: {}",
                "•".blue(),
                format!("{owner}/{repo}:{path}").cyan()
            );
        }
        return fetch_remote_config(token, &owner, &repo, &path).await;
    }

    if let Some(template_repo) = template {
        let (owner, repo) = parse_repository(&template_repo)?;
        if !json_mode {
            println!(
                "{} Fetching template config from: {}",
                "•".blue(),
                format!("{owner}/{repo}").cyan()
            );
        }
        return fetch_remote_convention_config(token, &owner, &repo).await;
    }

    match config_path {
        Some(path) if path.as_os_str() == "-" => load_labels_from_stdin(),
        Some(path) => load_labels_from_file(&path),
        None => {
            let path = find_convention_config().ok_or_else(|| Error::ConfigFileNotFound {
                searched_files: CONVENTION_CONFIG_FILES.join(", "),
            })?;
            if !json_mode {
                println!(
                    "{} Using config file: {}",
                    "•".blue(),
                    path.display().to_string().cyan()
                );
            }
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

    #[tokio::test]
    async fn test_load_label_config_json() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("labels.json");
        std::fs::write(&path, r##"[{"name":"bug","color":"#ff0000"}]"##).unwrap();
        let labels = load_label_config(Some(path), None, None, "unused", false)
            .await
            .unwrap();
        assert_eq!(labels.len(), 1);
        assert_eq!(labels[0].name, "bug");
    }

    #[tokio::test]
    async fn test_load_label_config_yaml() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("labels.yaml");
        std::fs::write(&path, "- name: bug\n  color: \"#ff0000\"\n").unwrap();
        let labels = load_label_config(Some(path), None, None, "unused", false)
            .await
            .unwrap();
        assert_eq!(labels.len(), 1);
        assert_eq!(labels[0].name, "bug");
    }

    #[tokio::test]
    async fn test_load_label_config_yml() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("labels.yml");
        std::fs::write(&path, "- name: bug\n  color: \"#ff0000\"\n").unwrap();
        let labels = load_label_config(Some(path), None, None, "unused", false)
            .await
            .unwrap();
        assert_eq!(labels.len(), 1);
        assert_eq!(labels[0].name, "bug");
    }

    #[tokio::test]
    async fn test_load_label_config_invalid_extension() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("labels.toml");
        std::fs::write(&path, "").unwrap();
        let result = load_label_config(Some(path), None, None, "unused", false).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_load_label_config_file_not_found() {
        let path = PathBuf::from("/nonexistent/labels.json");
        let result = load_label_config(Some(path), None, None, "unused", false).await;
        assert!(result.is_err());
    }

    // --- parse_remote_config_spec tests ---

    #[test]
    fn test_parse_remote_config_spec_valid() {
        let (owner, repo, path) = parse_remote_config_spec("org/repo:path/to/labels.json").unwrap();
        assert_eq!(owner, "org");
        assert_eq!(repo, "repo");
        assert_eq!(path, "path/to/labels.json");
    }

    #[test]
    fn test_parse_remote_config_spec_root_file() {
        let (owner, repo, path) = parse_remote_config_spec("org/repo:.gh-labeler.yaml").unwrap();
        assert_eq!(owner, "org");
        assert_eq!(repo, "repo");
        assert_eq!(path, ".gh-labeler.yaml");
    }

    #[test]
    fn test_parse_remote_config_spec_no_colon() {
        let result = parse_remote_config_spec("org/repo");
        assert!(result.is_err());
        let err_msg = result.unwrap_err().to_string();
        assert!(err_msg.contains("Invalid remote config format"));
    }

    #[test]
    fn test_parse_remote_config_spec_empty_path() {
        let result = parse_remote_config_spec("org/repo:");
        assert!(result.is_err());
        let err_msg = result.unwrap_err().to_string();
        assert!(err_msg.contains("Empty file path"));
    }

    #[test]
    fn test_parse_remote_config_spec_invalid_repo() {
        let result = parse_remote_config_spec("invalid:file.json");
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

            let result = load_label_config(None, None, None, "unused", false).await;
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

            let labels = load_label_config(None, None, None, "unused", false)
                .await
                .unwrap();
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
