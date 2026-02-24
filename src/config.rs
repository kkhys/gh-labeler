//! Configuration Management
//!
//! Label configuration and application settings management

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};

/// Convention-based configuration file names searched in order
pub const CONVENTION_CONFIG_FILES: &[&str] = &[
    ".gh-labeler.json",
    ".gh-labeler.yaml",
    ".gh-labeler.yml",
    ".github/labels.json",
    ".github/labels.yaml",
    ".github/labels.yml",
];

/// Label Configuration
///
/// Represents a GitHub label definition
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LabelConfig {
    /// Label name
    pub name: String,

    /// Label color (6-digit hex code with # prefix required)
    pub color: String,

    /// Label description (optional)
    pub description: Option<String>,

    /// Aliases for this label
    #[serde(default)]
    pub aliases: Vec<String>,

    /// Deletion flag (if true, delete this label)
    #[serde(default)]
    pub delete: bool,
}

impl LabelConfig {
    /// Create a new label configuration
    ///
    /// # Arguments
    /// - `name`: Label name
    /// - `color`: Label color (6-digit hex code with # prefix required)
    ///
    /// # Errors
    /// Returns an error if the color format is invalid
    pub fn new(name: String, color: String) -> Result<Self> {
        let label = Self {
            name,
            color,
            description: None,
            aliases: Vec::new(),
            delete: false,
        };

        label.validate()?;
        Ok(label)
    }

    /// Validate label configuration
    ///
    /// # Errors
    /// - If the name is empty
    /// - If the color format is invalid
    pub fn validate(&self) -> Result<()> {
        if self.name.trim().is_empty() {
            return Err(Error::label_validation("Label name cannot be empty"));
        }

        if !self.color.starts_with('#') {
            return Err(Error::InvalidLabelColor(format!(
                "Color must start with #: {}",
                self.color
            )));
        }

        let normalized_color = Self::normalize_color(&self.color);
        if !is_valid_hex_color(&normalized_color) {
            return Err(Error::InvalidLabelColor(self.color.clone()));
        }

        Ok(())
    }

    /// Normalize color (remove # and convert to lowercase)
    pub fn normalize_color(color: &str) -> String {
        color.trim_start_matches('#').to_lowercase()
    }
}

/// Sync Configuration
///
/// gh-labeler execution configuration
#[derive(Debug, Clone)]
pub struct SyncConfig {
    /// GitHub access token
    pub access_token: String,

    /// Target repository (owner/repo format)
    pub repository: String,

    /// Dry-run mode (don't make actual changes)
    pub dry_run: bool,

    /// Allow additional labels (preserve labels not in configuration)
    pub allow_added_labels: bool,

    /// Label configuration (use default labels if None)
    pub labels: Option<Vec<LabelConfig>>,
}

impl SyncConfig {
    /// Validate configuration
    ///
    /// # Errors
    /// - If repository format is invalid
    /// - If access token is empty
    /// - If there are issues with label configuration
    pub fn validate(&self) -> Result<()> {
        if self.access_token.trim().is_empty() {
            return Err(Error::config_validation("Access token is required"));
        }

        parse_repository(&self.repository)?;

        if let Some(labels) = &self.labels {
            for label in labels {
                label.validate()?;
            }
        }

        Ok(())
    }

    /// Get repository owner and name
    pub fn parse_repository(&self) -> Result<(String, String)> {
        parse_repository(&self.repository)
    }
}

/// Parse repository string into owner and name
///
/// # Arguments
/// - `repo`: Repository string in "owner/repo" format
///
/// # Errors
/// Returns an error if the format is invalid
pub fn parse_repository(repo: &str) -> Result<(String, String)> {
    let parts: Vec<&str> = repo.split('/').collect();
    if parts.len() != 2 || parts[0].is_empty() || parts[1].is_empty() {
        return Err(Error::InvalidRepositoryFormat(repo.to_string()));
    }
    Ok((parts[0].to_string(), parts[1].to_string()))
}

/// Generate default label configuration
///
/// Returns GitHub's standard label set
pub fn default_labels() -> Vec<LabelConfig> {
    vec![
        LabelConfig {
            name: "bug".to_string(),
            color: "#d73a4a".to_string(),
            description: Some("Something isn't working".to_string()),
            aliases: vec!["defect".to_string()],
            delete: false,
        },
        LabelConfig {
            name: "enhancement".to_string(),
            color: "#a2eeef".to_string(),
            description: Some("New feature or request".to_string()),
            aliases: vec!["feature".to_string()],
            delete: false,
        },
        LabelConfig {
            name: "documentation".to_string(),
            color: "#0075ca".to_string(),
            description: Some("Improvements or additions to documentation".to_string()),
            aliases: vec!["docs".to_string()],
            delete: false,
        },
        LabelConfig {
            name: "duplicate".to_string(),
            color: "#cfd3d7".to_string(),
            description: Some("This issue or pull request already exists".to_string()),
            aliases: Vec::new(),
            delete: false,
        },
        LabelConfig {
            name: "good first issue".to_string(),
            color: "#7057ff".to_string(),
            description: Some("Good for newcomers".to_string()),
            aliases: vec!["beginner-friendly".to_string()],
            delete: false,
        },
        LabelConfig {
            name: "help wanted".to_string(),
            color: "#008672".to_string(),
            description: Some("Extra attention is needed".to_string()),
            aliases: Vec::new(),
            delete: false,
        },
    ]
}

/// Load label configuration from JSON file
///
/// # Arguments
/// - `path`: Path to the configuration file
///
/// # Errors
/// If file reading or parsing fails
pub fn load_labels_from_json<P: AsRef<std::path::Path>>(path: P) -> Result<Vec<LabelConfig>> {
    let content = std::fs::read_to_string(path)?;
    let labels: Vec<LabelConfig> = serde_json::from_str(&content)?;

    // Validate all labels
    for label in &labels {
        label.validate()?;
    }

    Ok(labels)
}

/// Load label configuration from YAML file
///
/// # Arguments
/// - `path`: Path to the configuration file
///
/// # Errors
/// If file reading or parsing fails
pub fn load_labels_from_yaml<P: AsRef<std::path::Path>>(path: P) -> Result<Vec<LabelConfig>> {
    let content = std::fs::read_to_string(path)?;
    let labels: Vec<LabelConfig> = serde_yaml::from_str(&content)?;

    // Validate all labels
    for label in &labels {
        label.validate()?;
    }

    Ok(labels)
}

/// Load label configuration from a file, detecting format by extension
///
/// # Arguments
/// - `path`: Path to the configuration file (.json, .yaml, or .yml)
///
/// # Errors
/// If file reading, parsing, or validation fails, or if the extension is unsupported
pub fn load_labels_from_file<P: AsRef<Path>>(path: P) -> Result<Vec<LabelConfig>> {
    let path = path.as_ref();

    if !path.exists() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            format!("Configuration file not found: {}", path.display()),
        )
        .into());
    }

    match path.extension().and_then(|ext| ext.to_str()) {
        Some("json") => load_labels_from_json(path),
        Some("yaml") | Some("yml") => load_labels_from_yaml(path),
        _ => Err(Error::config_validation(
            "Configuration file must be .json, .yaml, or .yml",
        )),
    }
}

/// Search for a convention-based configuration file in the current directory
///
/// Searches for files in [`CONVENTION_CONFIG_FILES`] order and returns
/// the first one found.
///
/// # Returns
/// The path to the first matching file, or `None` if no file is found
pub fn find_convention_config() -> Option<PathBuf> {
    let cwd = std::env::current_dir().ok()?;
    find_convention_config_in(&cwd)
}

/// Search for a convention-based configuration file in the given directory
///
/// # Arguments
/// - `dir`: Directory to search in
///
/// # Returns
/// The path to the first matching file, or `None` if no file is found
pub fn find_convention_config_in(dir: &Path) -> Option<PathBuf> {
    for filename in CONVENTION_CONFIG_FILES {
        let path = dir.join(filename);
        if path.exists() {
            return Some(path);
        }
    }
    None
}

/// Parse label configuration from a content string, detecting format by file path extension
///
/// # Arguments
/// - `content`: Raw file content (JSON or YAML)
/// - `path`: File path used to determine format by extension
///
/// # Errors
/// If parsing or validation fails, or if the extension is unsupported
pub fn parse_labels_from_content(content: &str, path: &str) -> Result<Vec<LabelConfig>> {
    let ext = path.rsplit('.').next().unwrap_or("");

    let labels: Vec<LabelConfig> = match ext {
        "json" => serde_json::from_str(content)?,
        "yaml" | "yml" => serde_yaml::from_str(content)?,
        _ => {
            return Err(Error::config_validation(format!(
                "Unsupported file extension for remote config: {path}"
            )));
        }
    };

    for label in &labels {
        label.validate()?;
    }

    Ok(labels)
}

/// Check if an octocrab error is a 404 Not Found
fn is_not_found_error(err: &octocrab::Error) -> bool {
    err.to_string().contains("Not Found")
}

/// Fetch a label configuration file from a remote GitHub repository
///
/// # Arguments
/// - `token`: GitHub personal access token
/// - `owner`: Repository owner
/// - `repo`: Repository name
/// - `path`: File path within the repository
///
/// # Errors
/// If the API call fails or the content cannot be parsed
pub async fn fetch_remote_config(
    token: &str,
    owner: &str,
    repo: &str,
    path: &str,
) -> Result<Vec<LabelConfig>> {
    let octocrab = octocrab::Octocrab::builder()
        .personal_token(token.to_string())
        .build()
        .map_err(Error::GitHubApi)?;

    let content_items = octocrab
        .repos(owner, repo)
        .get_content()
        .path(path)
        .send()
        .await
        .map_err(Error::GitHubApi)?;

    let file = content_items
        .items
        .first()
        .ok_or_else(|| Error::config_validation("Remote file returned empty content"))?;

    let decoded = file
        .decoded_content()
        .ok_or_else(|| Error::config_validation("Failed to decode remote file content"))?;

    parse_labels_from_content(&decoded, path)
}

/// Fetch a convention-based config file from a remote GitHub repository
///
/// Searches [`CONVENTION_CONFIG_FILES`] in order and returns the first match.
///
/// # Arguments
/// - `token`: GitHub personal access token
/// - `owner`: Repository owner
/// - `repo`: Repository name
///
/// # Errors
/// Returns `RemoteConfigNotFound` if none of the convention files exist
pub async fn fetch_remote_convention_config(
    token: &str,
    owner: &str,
    repo: &str,
) -> Result<Vec<LabelConfig>> {
    for path in CONVENTION_CONFIG_FILES {
        match fetch_remote_config(token, owner, repo, path).await {
            Ok(labels) => return Ok(labels),
            Err(Error::GitHubApi(ref e)) if is_not_found_error(e) => continue,
            Err(e) => return Err(e),
        }
    }

    Err(Error::RemoteConfigNotFound {
        repo: format!("{owner}/{repo}"),
        searched_files: CONVENTION_CONFIG_FILES.join(", "),
    })
}

/// Load label configuration from stdin
///
/// Reads all content from stdin and auto-detects the format (JSON or YAML).
///
/// # Errors
/// If stdin is empty, or parsing/validation fails
pub fn load_labels_from_stdin() -> Result<Vec<LabelConfig>> {
    load_labels_from_reader(std::io::stdin())
}

/// Load label configuration from any reader, auto-detecting JSON or YAML format
///
/// # Errors
/// If the reader is empty, or parsing/validation fails
pub fn load_labels_from_reader<R: std::io::Read>(mut reader: R) -> Result<Vec<LabelConfig>> {
    let mut content = String::new();
    reader.read_to_string(&mut content).map_err(Error::Io)?;

    if content.trim().is_empty() {
        return Err(Error::config_validation("Empty input from stdin"));
    }

    parse_labels_auto_detect(&content)
}

/// Parse label configuration from a string, auto-detecting JSON or YAML format
///
/// Tries JSON first, then YAML.
///
/// # Errors
/// If neither JSON nor YAML parsing succeeds, or validation fails
pub fn parse_labels_auto_detect(content: &str) -> Result<Vec<LabelConfig>> {
    // Try JSON first
    if let Ok(labels) = serde_json::from_str::<Vec<LabelConfig>>(content) {
        for label in &labels {
            label.validate()?;
        }
        return Ok(labels);
    }

    // Fall back to YAML
    let labels: Vec<LabelConfig> = serde_yaml::from_str(content)?;
    for label in &labels {
        label.validate()?;
    }
    Ok(labels)
}

/// Validate hex color code
///
/// # Arguments
/// - `color`: Color code (6-digit hex without #)
///
/// # Returns
/// True if valid
fn is_valid_hex_color(color: &str) -> bool {
    if color.len() != 6 {
        return false;
    }

    color.chars().all(|c| c.is_ascii_hexdigit())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_valid_hex_color() {
        assert!(is_valid_hex_color("ff0000"));
        assert!(is_valid_hex_color("00FF00"));
        assert!(is_valid_hex_color("123abc"));

        assert!(!is_valid_hex_color("ff00")); // Too short
        assert!(!is_valid_hex_color("ff0000x")); // Invalid character
        assert!(!is_valid_hex_color("#ff0000")); // With #
    }

    #[test]
    fn test_parse_repository() {
        assert!(parse_repository("owner/repo").is_ok());
        assert!(parse_repository("org/project").is_ok());

        assert!(parse_repository("repo").is_err()); // No slash
        assert!(parse_repository("/repo").is_err()); // No owner
        assert!(parse_repository("owner/").is_err()); // No repo name
        assert!(parse_repository("owner/repo/sub").is_err()); // Too many parts
    }

    #[test]
    fn test_label_config_validation() {
        // # prefix is now required
        let valid_with_hash = LabelConfig::new("test".to_string(), "#ff0000".to_string()).unwrap();
        assert_eq!(valid_with_hash.name, "test");
        assert_eq!(valid_with_hash.color, "#ff0000");

        // Without # should fail
        let invalid_no_hash = LabelConfig::new("test".to_string(), "ff0000".to_string());
        assert!(invalid_no_hash.is_err());

        // Invalid color
        let invalid_color = LabelConfig::new("test".to_string(), "invalid".to_string());
        assert!(invalid_color.is_err());

        // Invalid hex with # should also fail
        let invalid_hex_with_hash = LabelConfig::new("test".to_string(), "#invalid".to_string());
        assert!(invalid_hex_with_hash.is_err());
    }

    #[test]
    fn test_sync_config_empty_token_error() {
        let config = SyncConfig {
            access_token: "".to_string(),
            repository: "owner/repo".to_string(),
            dry_run: false,
            allow_added_labels: false,
            labels: None,
        };
        assert!(config.validate().is_err());
    }

    #[test]
    fn test_sync_config_invalid_repo_format_error() {
        let config = SyncConfig {
            access_token: "token".to_string(),
            repository: "invalid".to_string(),
            dry_run: false,
            allow_added_labels: false,
            labels: None,
        };
        assert!(config.validate().is_err());
    }

    #[test]
    fn test_sync_config_invalid_label_color_error() {
        let config = SyncConfig {
            access_token: "token".to_string(),
            repository: "owner/repo".to_string(),
            dry_run: false,
            allow_added_labels: false,
            labels: Some(vec![LabelConfig {
                name: "test".to_string(),
                color: "invalid".to_string(),
                description: None,
                aliases: Vec::new(),
                delete: false,
            }]),
        };
        assert!(config.validate().is_err());
    }

    #[test]
    fn test_sync_config_valid() {
        let config = SyncConfig {
            access_token: "token".to_string(),
            repository: "owner/repo".to_string(),
            dry_run: false,
            allow_added_labels: false,
            labels: Some(vec![LabelConfig {
                name: "bug".to_string(),
                color: "#ff0000".to_string(),
                description: None,
                aliases: Vec::new(),
                delete: false,
            }]),
        };
        assert!(config.validate().is_ok());
    }

    #[test]
    fn test_sync_config_parse_repository() {
        let config = SyncConfig {
            access_token: "token".to_string(),
            repository: "owner/repo".to_string(),
            dry_run: false,
            allow_added_labels: false,
            labels: None,
        };
        let (owner, repo) = config.parse_repository().unwrap();
        assert_eq!(owner, "owner");
        assert_eq!(repo, "repo");
    }

    #[test]
    fn test_load_valid_json() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("labels.json");
        std::fs::write(&path, r##"[{"name":"bug","color":"#ff0000"}]"##).unwrap();
        let labels = load_labels_from_json(&path).unwrap();
        assert_eq!(labels.len(), 1);
        assert_eq!(labels[0].name, "bug");
    }

    #[test]
    fn test_load_valid_yaml() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("labels.yaml");
        std::fs::write(&path, "- name: bug\n  color: \"#ff0000\"\n").unwrap();
        let labels = load_labels_from_yaml(&path).unwrap();
        assert_eq!(labels.len(), 1);
        assert_eq!(labels[0].name, "bug");
    }

    #[test]
    fn test_load_invalid_json() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("labels.json");
        std::fs::write(&path, "not json").unwrap();
        assert!(load_labels_from_json(&path).is_err());
    }

    #[test]
    fn test_load_json_with_invalid_color() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("labels.json");
        std::fs::write(&path, r##"[{"name":"bug","color":"invalid"}]"##).unwrap();
        assert!(load_labels_from_json(&path).is_err());
    }

    // --- find_convention_config_in tests ---

    #[test]
    fn test_find_convention_config_priority_order() {
        let dir = tempfile::tempdir().unwrap();
        // Create multiple convention files
        std::fs::write(
            dir.path().join(".gh-labeler.yaml"),
            "- name: a\n  color: \"#ff0000\"\n",
        )
        .unwrap();
        std::fs::write(
            dir.path().join(".gh-labeler.json"),
            r##"[{"name":"b","color":"#ff0000"}]"##,
        )
        .unwrap();
        // .gh-labeler.json should be found first (highest priority)
        let found = find_convention_config_in(dir.path()).unwrap();
        assert_eq!(found.file_name().unwrap(), ".gh-labeler.json");
    }

    #[test]
    fn test_find_convention_config_github_dir() {
        let dir = tempfile::tempdir().unwrap();
        let github_dir = dir.path().join(".github");
        std::fs::create_dir(&github_dir).unwrap();
        std::fs::write(
            github_dir.join("labels.yaml"),
            "- name: a\n  color: \"#ff0000\"\n",
        )
        .unwrap();
        let found = find_convention_config_in(dir.path()).unwrap();
        assert!(found.ends_with(".github/labels.yaml"));
    }

    #[test]
    fn test_find_convention_config_none_found() {
        let dir = tempfile::tempdir().unwrap();
        assert!(find_convention_config_in(dir.path()).is_none());
    }

    // --- load_labels_from_file tests ---

    #[test]
    fn test_load_labels_from_file_json() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("labels.json");
        std::fs::write(&path, r##"[{"name":"bug","color":"#ff0000"}]"##).unwrap();
        let labels = load_labels_from_file(&path).unwrap();
        assert_eq!(labels.len(), 1);
        assert_eq!(labels[0].name, "bug");
    }

    #[test]
    fn test_load_labels_from_file_yaml() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("labels.yaml");
        std::fs::write(&path, "- name: bug\n  color: \"#ff0000\"\n").unwrap();
        let labels = load_labels_from_file(&path).unwrap();
        assert_eq!(labels.len(), 1);
        assert_eq!(labels[0].name, "bug");
    }

    #[test]
    fn test_load_labels_from_file_yml() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("labels.yml");
        std::fs::write(&path, "- name: bug\n  color: \"#ff0000\"\n").unwrap();
        let labels = load_labels_from_file(&path).unwrap();
        assert_eq!(labels.len(), 1);
    }

    #[test]
    fn test_load_labels_from_file_unsupported_extension() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("labels.toml");
        std::fs::write(&path, "").unwrap();
        assert!(load_labels_from_file(&path).is_err());
    }

    #[test]
    fn test_load_labels_from_file_not_found() {
        let path = PathBuf::from("/nonexistent/labels.json");
        assert!(load_labels_from_file(&path).is_err());
    }

    // --- parse_labels_from_content tests ---

    #[test]
    fn test_parse_labels_from_content_json() {
        let content = r##"[{"name":"bug","color":"#ff0000","description":"A bug"}]"##;
        let labels = parse_labels_from_content(content, "labels.json").unwrap();
        assert_eq!(labels.len(), 1);
        assert_eq!(labels[0].name, "bug");
        assert_eq!(labels[0].color, "#ff0000");
        assert_eq!(labels[0].description.as_deref(), Some("A bug"));
    }

    #[test]
    fn test_parse_labels_from_content_yaml() {
        let content = "- name: bug\n  color: \"#ff0000\"\n";
        let labels = parse_labels_from_content(content, "labels.yaml").unwrap();
        assert_eq!(labels.len(), 1);
        assert_eq!(labels[0].name, "bug");
    }

    #[test]
    fn test_parse_labels_from_content_yml() {
        let content = "- name: bug\n  color: \"#ff0000\"\n";
        let labels = parse_labels_from_content(content, ".github/labels.yml").unwrap();
        assert_eq!(labels.len(), 1);
        assert_eq!(labels[0].name, "bug");
    }

    #[test]
    fn test_parse_labels_from_content_invalid_json() {
        let result = parse_labels_from_content("not json", "file.json");
        assert!(result.is_err());
    }

    #[test]
    fn test_parse_labels_from_content_invalid_color() {
        let content = r##"[{"name":"bug","color":"invalid"}]"##;
        let result = parse_labels_from_content(content, "file.json");
        assert!(result.is_err());
    }

    #[test]
    fn test_parse_labels_from_content_unsupported_extension() {
        let result = parse_labels_from_content("", "file.toml");
        assert!(result.is_err());
        let err_msg = result.unwrap_err().to_string();
        assert!(err_msg.contains("Unsupported file extension"));
    }

    #[test]
    fn test_parse_labels_from_content_no_extension() {
        let result = parse_labels_from_content("", "Makefile");
        assert!(result.is_err());
    }

    #[test]
    fn test_parse_labels_from_content_multiple_labels() {
        let content = r##"[
            {"name":"bug","color":"#ff0000"},
            {"name":"feature","color":"#00ff00","description":"New feature"}
        ]"##;
        let labels = parse_labels_from_content(content, "labels.json").unwrap();
        assert_eq!(labels.len(), 2);
        assert_eq!(labels[0].name, "bug");
        assert_eq!(labels[1].name, "feature");
    }

    // --- parse_labels_auto_detect tests ---

    #[test]
    fn test_auto_detect_json() {
        let content = r##"[{"name":"bug","color":"#ff0000"}]"##;
        let labels = parse_labels_auto_detect(content).unwrap();
        assert_eq!(labels.len(), 1);
        assert_eq!(labels[0].name, "bug");
    }

    #[test]
    fn test_auto_detect_yaml() {
        let content = "- name: bug\n  color: \"#ff0000\"\n";
        let labels = parse_labels_auto_detect(content).unwrap();
        assert_eq!(labels.len(), 1);
        assert_eq!(labels[0].name, "bug");
    }

    #[test]
    fn test_auto_detect_invalid_content() {
        let result = parse_labels_auto_detect("not valid json or yaml }{][");
        assert!(result.is_err());
    }

    #[test]
    fn test_auto_detect_json_with_invalid_color() {
        let content = r##"[{"name":"bug","color":"invalid"}]"##;
        let result = parse_labels_auto_detect(content);
        assert!(result.is_err());
    }

    #[test]
    fn test_auto_detect_yaml_with_invalid_color() {
        let content = "- name: bug\n  color: invalid\n";
        let result = parse_labels_auto_detect(content);
        assert!(result.is_err());
    }

    // --- load_labels_from_reader tests ---

    #[test]
    fn test_load_labels_from_reader_json() {
        let input = r##"[{"name":"bug","color":"#ff0000"}]"##.as_bytes();
        let labels = load_labels_from_reader(input).unwrap();
        assert_eq!(labels.len(), 1);
        assert_eq!(labels[0].name, "bug");
    }

    #[test]
    fn test_load_labels_from_reader_yaml() {
        let input = "- name: bug\n  color: \"#ff0000\"\n".as_bytes();
        let labels = load_labels_from_reader(input).unwrap();
        assert_eq!(labels.len(), 1);
        assert_eq!(labels[0].name, "bug");
    }

    #[test]
    fn test_load_labels_from_reader_empty() {
        let input = "".as_bytes();
        let result = load_labels_from_reader(input);
        assert!(result.is_err());
        let err_msg = result.unwrap_err().to_string();
        assert!(err_msg.contains("Empty input"));
    }

    #[test]
    fn test_load_labels_from_reader_whitespace_only() {
        let input = "   \n  \t  ".as_bytes();
        let result = load_labels_from_reader(input);
        assert!(result.is_err());
    }

    #[test]
    fn test_load_labels_from_reader_invalid() {
        let input = "not valid content }{".as_bytes();
        let result = load_labels_from_reader(input);
        assert!(result.is_err());
    }
}
