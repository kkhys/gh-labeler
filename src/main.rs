//! gh-labeler CLI
//!
//! Command line tool for managing GitHub repository labels

use clap::{Parser, Subcommand};
use colored::Colorize;
use std::path::PathBuf;

use gh_labeler::{
    config::{default_labels, load_labels_from_json, load_labels_from_yaml, SyncConfig},
    sync::LabelSyncer,
    Error, Result,
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
    #[arg(short = 't', long)]
    access_token: Option<String>,

    /// Target repository (owner/repo format)
    #[arg(short = 'r', long)]
    repository: Option<String>,

    /// Dry run mode (don't make actual changes)
    #[arg(long)]
    dry_run: bool,

    /// Preserve labels not in configuration
    #[arg(long)]
    allow_added_labels: bool,

    /// Configuration file path (JSON/YAML)
    #[arg(short = 'c', long)]
    config: Option<PathBuf>,

    /// Verbose output
    #[arg(short, long)]
    verbose: bool,
}

#[derive(Subcommand)]
enum Commands {
    /// Synchronize labels
    Sync {
        /// GitHub access token
        #[arg(short = 't', long)]
        access_token: Option<String>,

        /// Target repository (owner/repo format)
        #[arg(short = 'r', long)]
        repository: String,

        /// Configuration file path (JSON/YAML)
        #[arg(short = 'c', long)]
        config: Option<PathBuf>,

        /// Dry run mode (don't make actual changes)
        #[arg(long)]
        dry_run: bool,

        /// Preserve labels not in configuration
        #[arg(long)]
        allow_added_labels: bool,
    },

    /// Preview synchronization content
    Preview {
        /// GitHub access token
        #[arg(short = 't', long)]
        access_token: Option<String>,

        /// Target repository (owner/repo format)
        #[arg(short = 'r', long)]
        repository: String,

        /// Configuration file path (JSON/YAML)
        #[arg(short = 'c', long)]
        config: Option<PathBuf>,

        /// Preserve labels not in configuration
        #[arg(long)]
        allow_added_labels: bool,
    },

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
        /// GitHub access token
        #[arg(short = 't', long)]
        access_token: Option<String>,

        /// Target repository (owner/repo format)
        #[arg(short = 'r', long)]
        repository: String,

        /// Output format
        #[arg(long, default_value = "table", value_parser = ["table", "json", "yaml"])]
        format: String,
    },
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();

    match cli.command {
        Some(Commands::Sync {
            access_token,
            repository,
            config,
            dry_run,
            allow_added_labels,
        }) => {
            let token = get_access_token(access_token, cli.access_token)?;
            let labels = load_label_config(config.or(cli.config)).await?;

            let sync_config = SyncConfig {
                access_token: token,
                repository,
                dry_run,
                allow_added_labels,
                labels: Some(labels),
            };

            run_sync(sync_config, cli.verbose).await
        }

        Some(Commands::Preview {
            access_token,
            repository,
            config,
            allow_added_labels,
        }) => {
            let token = get_access_token(access_token, cli.access_token)?;
            let labels = load_label_config(config.or(cli.config)).await?;

            let sync_config = SyncConfig {
                access_token: token,
                repository,
                dry_run: true,
                allow_added_labels,
                labels: Some(labels),
            };

            run_sync(sync_config, cli.verbose).await
        }

        Some(Commands::Init { format, output }) => run_init(format, output).await,

        Some(Commands::List {
            access_token,
            repository,
            format,
        }) => {
            let token = get_access_token(access_token, cli.access_token)?;
            run_list(token, repository, format).await
        }

        None => {
            // Default sync mode (traditional behavior)
            if let (Some(token), Some(repo)) = (
                get_access_token(cli.access_token.clone(), None).ok(),
                cli.repository,
            ) {
                let labels = load_label_config(cli.config).await?;

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

    if !result.errors.is_empty() {
        eprintln!("\n{} Errors occurred:", "✗".red());
        for error in &result.errors {
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
        "json" => serde_json::to_string_pretty(&labels)
            .map_err(|e| Error::generic(format!("JSON serialization failed: {}", e)))?,
        "yaml" => serde_yaml::to_string(&labels)
            .map_err(|e| Error::generic(format!("YAML serialization failed: {}", e)))?,
        _ => return Err(Error::generic("Unsupported format")),
    };

    if let Some(output_path) = output {
        std::fs::write(&output_path, content)?;
        println!(
            "{} Default configuration written to: {}",
            "✓".green(),
            output_path.display().to_string().cyan()
        );
    } else {
        println!("{}", content);
    }

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
        _ => return Err(Error::generic("Unsupported format")),
    }

    Ok(())
}

/// Display synchronization results
fn display_sync_result(result: &gh_labeler::sync::SyncResult, verbose: bool) {
    if result.dry_run && result.has_changes() {
        println!("\n{} Sync preview (dry-run mode):", "📋".to_string().blue());
    } else if result.has_changes() {
        println!("\n{} Sync completed:", "✓".green());
    } else {
        println!("\n{} No changes required", "✓".green());
    }

    // Display statistics
    println!("  📝 Created: {}", result.created.to_string().green());
    println!("  🔄 Updated: {}", result.updated.to_string().yellow());
    println!("  🗑️ Deleted: {}", result.deleted.to_string().red());
    println!("  📛 Renamed: {}", result.renamed.to_string().blue());
    println!("  ➖ Unchanged: {}", result.unchanged.to_string().white());

    if verbose {
        println!("\n{} Detailed operations:", "📋".blue());
        for (i, operation) in result.operations.iter().enumerate() {
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

/// Get access token
fn get_access_token(arg_token: Option<String>, cli_token: Option<String>) -> Result<String> {
    arg_token
        .or(cli_token)
        .or_else(|| std::env::var("GITHUB_TOKEN").ok())
        .ok_or_else(|| Error::config_validation(
            "GitHub access token is required. Set via --access-token, GITHUB_TOKEN env var, or -t flag"
        ))
}

/// Load label configuration
async fn load_label_config(config_path: Option<PathBuf>) -> Result<Vec<gh_labeler::LabelConfig>> {
    match config_path {
        Some(path) => {
            if !path.exists() {
                return Err(Error::generic(format!(
                    "Configuration file not found: {}",
                    path.display()
                )));
            }

            match path.extension().and_then(|ext| ext.to_str()) {
                Some("json") => load_labels_from_json(&path),
                Some("yaml") | Some("yml") => load_labels_from_yaml(&path),
                _ => Err(Error::generic(
                    "Configuration file must be .json, .yaml, or .yml",
                )),
            }
        }
        None => Ok(default_labels()),
    }
}

/// Parse repository format
fn parse_repository(repo: &str) -> Result<(String, String)> {
    let parts: Vec<&str> = repo.split('/').collect();
    if parts.len() != 2 {
        return Err(Error::InvalidRepositoryFormat(repo.to_string()));
    }
    Ok((parts[0].to_string(), parts[1].to_string()))
}
