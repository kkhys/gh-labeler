//! Configuration Management
//!
//! Label configuration and application settings management

use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};

/// Label Configuration
///
/// Represents a GitHub label definition
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LabelConfig {
    /// Label name
    pub name: String,

    /// Label color (6-digit hex code without #)
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
    /// - `color`: Label color (6-digit hex code)
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

        if !is_valid_hex_color(&self.color) {
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

        if !is_valid_repository_format(&self.repository) {
            return Err(Error::InvalidRepositoryFormat(self.repository.clone()));
        }

        if let Some(labels) = &self.labels {
            for label in labels {
                label.validate()?;
            }
        }

        Ok(())
    }

    /// Get repository owner and name
    pub fn parse_repository(&self) -> Result<(String, String)> {
        let parts: Vec<&str> = self.repository.split('/').collect();
        if parts.len() != 2 {
            return Err(Error::InvalidRepositoryFormat(self.repository.clone()));
        }

        Ok((parts[0].to_string(), parts[1].to_string()))
    }
}

/// Generate default label configuration
///
/// Returns GitHub's standard label set
pub fn default_labels() -> Vec<LabelConfig> {
    vec![
        LabelConfig {
            name: "bug".to_string(),
            color: "d73a4a".to_string(),
            description: Some("Something isn't working".to_string()),
            aliases: vec!["defect".to_string()],
            delete: false,
        },
        LabelConfig {
            name: "enhancement".to_string(),
            color: "a2eeef".to_string(),
            description: Some("New feature or request".to_string()),
            aliases: vec!["feature".to_string()],
            delete: false,
        },
        LabelConfig {
            name: "documentation".to_string(),
            color: "0075ca".to_string(),
            description: Some("Improvements or additions to documentation".to_string()),
            aliases: vec!["docs".to_string()],
            delete: false,
        },
        LabelConfig {
            name: "duplicate".to_string(),
            color: "cfd3d7".to_string(),
            description: Some("This issue or pull request already exists".to_string()),
            aliases: Vec::new(),
            delete: false,
        },
        LabelConfig {
            name: "good first issue".to_string(),
            color: "7057ff".to_string(),
            description: Some("Good for newcomers".to_string()),
            aliases: vec!["beginner-friendly".to_string()],
            delete: false,
        },
        LabelConfig {
            name: "help wanted".to_string(),
            color: "008672".to_string(),
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

/// Validate repository format
///
/// # Arguments
/// - `repo`: Repository name (owner/repo format)
///
/// # Returns
/// True if valid
fn is_valid_repository_format(repo: &str) -> bool {
    let parts: Vec<&str> = repo.split('/').collect();
    parts.len() == 2 && !parts[0].is_empty() && !parts[1].is_empty()
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
    fn test_valid_repository_format() {
        assert!(is_valid_repository_format("owner/repo"));
        assert!(is_valid_repository_format("org/project"));

        assert!(!is_valid_repository_format("repo")); // No slash
        assert!(!is_valid_repository_format("/repo")); // No owner
        assert!(!is_valid_repository_format("owner/")); // No repo name
        assert!(!is_valid_repository_format("owner/repo/sub")); // Too many parts
    }

    #[test]
    fn test_label_config_validation() {
        let valid_label = LabelConfig::new("test".to_string(), "ff0000".to_string()).unwrap();
        assert_eq!(valid_label.name, "test");
        assert_eq!(valid_label.color, "ff0000");

        // Invalid color
        let invalid_color = LabelConfig::new("test".to_string(), "invalid".to_string());
        assert!(invalid_color.is_err());
    }
}
