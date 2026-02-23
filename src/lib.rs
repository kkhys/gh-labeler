//! # gh-labeler
//!
//! A fast and reliable GitHub repository label management library built with Rust
//!
//! ## Features
//! - GitHub label synchronization
//! - Label configuration validation
//! - Dry-run mode
//! - Label alias support

pub mod config;
pub mod error;
pub mod github;
pub mod similarity;
pub mod sync;

pub use config::{
    fetch_remote_config, fetch_remote_convention_config, find_convention_config,
    load_labels_from_file, LabelConfig, SyncConfig,
};
pub use error::{Error, Result};
pub use github::{GitHubClient, LabelService};
pub use sync::LabelSyncer;

/// Main functionality of gh-labeler
///
/// Provides the core label management functionality of this library.
///
/// # Examples
///
/// ```rust,no_run
/// use gh_labeler::{SyncConfig, LabelConfig, LabelSyncer};
///
/// #[tokio::main]
/// async fn main() -> gh_labeler::Result<()> {
///     let config = SyncConfig {
///         access_token: "your_github_token".to_string(),
///         repository: "owner/repo".to_string(),
///         dry_run: false,
///         allow_added_labels: true,
///         labels: Some(vec![LabelConfig {
///             name: "bug".to_string(),
///             color: "#d73a4a".to_string(),
///             description: Some("Something isn't working".to_string()),
///             aliases: vec![],
///             delete: false,
///         }]),
///     };
///
///     let syncer = LabelSyncer::new(config).await?;
///     let result = syncer.sync_labels().await?;
///
///     println!("Sync completed: {:?}", result);
///     Ok(())
/// }
/// ```
pub async fn sync_repository_labels(
    access_token: &str,
    repository: &str,
    labels: Vec<LabelConfig>,
    dry_run: bool,
) -> Result<sync::SyncResult> {
    let config = SyncConfig {
        access_token: access_token.to_string(),
        repository: repository.to_string(),
        dry_run,
        allow_added_labels: false,
        labels: Some(labels),
    };

    let syncer = LabelSyncer::new(config).await?;
    syncer.sync_labels().await
}
