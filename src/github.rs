//! GitHub API Client
//!
//! Module for managing interactions with the GitHub API

use octocrab::Octocrab;
use serde::{Deserialize, Serialize};

use crate::config::LabelConfig;
use crate::error::{Error, Result};

/// Encode a string for use in URL path segments (RFC 3986 with UTF-8 support)
///
/// This function properly encodes UTF-8 characters including Japanese text.
/// Only unreserved characters (A-Z, a-z, 0-9, -, ., _, ~) are left unencoded.
///
/// # Arguments
/// - `input`: The string to encode
///
/// # Returns
/// URL-encoded string safe for use in path segments
fn encode_path_segment(input: &str) -> String {
    input
        .chars()
        .map(|c| match c {
            // RFC 3986 unreserved characters
            'A'..='Z' | 'a'..='z' | '0'..='9' | '-' | '.' | '_' | '~' => c.to_string(),
            // Everything else gets percent-encoded as UTF-8 bytes
            _ => c
                .to_string()
                .bytes()
                .map(|b| format!("%{:02X}", b))
                .collect::<String>(),
        })
        .collect()
}

/// GitHub Label Information
///
/// Represents label information retrieved from the GitHub API
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct GitHubLabel {
    /// Label ID
    pub id: u64,

    /// Label name
    pub name: String,

    /// Label color (6-digit hexadecimal, without #)
    pub color: String,

    /// Label description
    pub description: Option<String>,

    /// Whether this is a default label
    pub default: bool,

    /// Label URL
    pub url: String,
}

impl From<GitHubLabel> for LabelConfig {
    fn from(github_label: GitHubLabel) -> Self {
        LabelConfig {
            name: github_label.name,
            color: github_label.color,
            description: github_label.description,
            aliases: Vec::new(),
            delete: false,
        }
    }
}

/// GitHub API Client
///
/// Client responsible for interactions with the GitHub API
pub struct GitHubClient {
    octocrab: Octocrab,
    owner: String,
    repo: String,
}

impl GitHubClient {
    /// Create a new GitHub client
    ///
    /// # Arguments
    /// - `access_token`: GitHub access token
    /// - `owner`: Repository owner
    /// - `repo`: Repository name
    ///
    /// # Errors
    /// Returns an error if client initialization fails
    pub async fn new(access_token: &str, owner: &str, repo: &str) -> Result<Self> {
        let octocrab = Octocrab::builder()
            .personal_token(access_token.to_string())
            .build()
            .map_err(|e| Error::generic(format!("Failed to create GitHub client: {}", e)))?;

        // Authentication test
        let _user = octocrab
            .current()
            .user()
            .await
            .map_err(|_| Error::AuthenticationFailed)?;

        Ok(Self {
            octocrab,
            owner: owner.to_string(),
            repo: repo.to_string(),
        })
    }

    /// Get all labels from the repository
    ///
    /// # Returns
    /// List of all labels in the repository
    ///
    /// # Errors
    /// Returns an error if GitHub API fails or repository is not found
    pub async fn get_all_labels(&self) -> Result<Vec<GitHubLabel>> {
        let mut labels = Vec::new();
        let mut page = 1u32;

        loop {
            let response = self
                .octocrab
                .issues(&self.owner, &self.repo)
                .list_labels_for_repo()
                .page(page)
                .per_page(100)
                .send()
                .await
                .map_err(|e| {
                    if e.to_string().contains("Not Found") {
                        Error::RepositoryNotFound(format!("{}/{}", self.owner, self.repo))
                    } else {
                        Error::GitHubApi(e)
                    }
                })?;

            if response.items.is_empty() {
                break;
            }

            for label in response.items {
                labels.push(GitHubLabel {
                    id: label.id.0,
                    name: label.name,
                    color: label.color,
                    description: label.description,
                    default: label.default,
                    url: label.url.to_string(),
                });
            }

            page += 1;
        }

        Ok(labels)
    }

    /// Create a new label
    ///
    /// # Arguments
    /// - `label`: Label configuration to create
    ///
    /// # Returns
    /// Information about the created label
    ///
    /// # Errors
    /// Returns an error if GitHub API fails or label creation fails
    pub async fn create_label(&self, label: &LabelConfig) -> Result<GitHubLabel> {
        let normalized_color = crate::config::LabelConfig::normalize_color(&label.color);
        let response = self
            .octocrab
            .issues(&self.owner, &self.repo)
            .create_label(
                &label.name,
                &normalized_color,
                label.description.as_deref().unwrap_or(""),
            )
            .await
            .map_err(Error::GitHubApi)?;

        Ok(GitHubLabel {
            id: response.id.0,
            name: response.name,
            color: response.color,
            description: response.description,
            default: response.default,
            url: response.url.to_string(),
        })
    }

    /// Update an existing label
    ///
    /// # Arguments
    /// - `current_name`: Current label name
    /// - `label`: Updated label configuration
    ///
    /// # Returns  
    /// Information about the updated label
    ///
    /// # Errors
    /// Returns an error if GitHub API fails or label update fails
    pub async fn update_label(
        &self,
        current_name: &str,
        label: &LabelConfig,
    ) -> Result<GitHubLabel> {
        // Since octocrab v0.38 doesn't have a direct update_label method,
        // we use the approach of deleting and recreating
        self.delete_label(current_name).await?;
        self.create_label(label).await
    }

    /// Delete a label
    ///
    /// # Arguments
    /// - `label_name`: Name of the label to delete
    ///
    /// # Errors
    /// Returns an error if GitHub API fails or label deletion fails
    pub async fn delete_label(&self, label_name: &str) -> Result<()> {
        // URL encode the label name to handle spaces, special characters, and UTF-8 (Japanese, etc.)
        let encoded_name = encode_path_segment(label_name);
        self.octocrab
            .issues(&self.owner, &self.repo)
            .delete_label(&encoded_name)
            .await
            .map_err(Error::GitHubApi)?;

        Ok(())
    }

    /// Check if the repository exists
    ///
    /// # Returns
    /// True if the repository exists
    pub async fn repository_exists(&self) -> bool {
        self.octocrab
            .repos(&self.owner, &self.repo)
            .get()
            .await
            .is_ok()
    }

    /// Get rate limit information
    ///
    /// # Returns
    /// Rate limit status
    pub async fn get_rate_limit(&self) -> Result<RateLimitInfo> {
        let rate_limit = self
            .octocrab
            .ratelimit()
            .get()
            .await
            .map_err(Error::GitHubApi)?;

        Ok(RateLimitInfo {
            limit: rate_limit.resources.core.limit as u32,
            remaining: rate_limit.resources.core.remaining as u32,
            reset_at: chrono::DateTime::from_timestamp(rate_limit.resources.core.reset as i64, 0)
                .unwrap_or_else(chrono::Utc::now),
        })
    }
}

/// Rate Limit Information
///
/// Represents GitHub API rate limit status
#[derive(Debug, Clone)]
pub struct RateLimitInfo {
    /// Hourly limit
    pub limit: u32,

    /// Remaining usage count
    pub remaining: u32,

    /// Reset time
    pub reset_at: chrono::DateTime<chrono::Utc>,
}

/// Calculate label similarity
///
/// Calculate the similarity between two label names using Levenshtein distance
///
/// # Arguments
/// - `a`: First label name for comparison
/// - `b`: Second label name for comparison
///
/// # Returns
/// Similarity score (0.0-1.0, where 1.0 is perfect match)
pub fn calculate_label_similarity(a: &str, b: &str) -> f64 {
    let a = a.to_lowercase();
    let b = b.to_lowercase();

    if a == b {
        return 1.0;
    }

    let distance = levenshtein_distance(&a, &b);
    let max_len = a.len().max(b.len()) as f64;

    if max_len == 0.0 {
        1.0
    } else {
        1.0 - (distance as f64 / max_len)
    }
}

/// Calculate Levenshtein distance
///
/// # Arguments
/// - `a`: First string
/// - `b`: Second string
///
/// # Returns
/// Levenshtein distance
fn levenshtein_distance(a: &str, b: &str) -> usize {
    let a_chars: Vec<char> = a.chars().collect();
    let b_chars: Vec<char> = b.chars().collect();
    let a_len = a_chars.len();
    let b_len = b_chars.len();

    if a_len == 0 {
        return b_len;
    }
    if b_len == 0 {
        return a_len;
    }

    let mut matrix = vec![vec![0; b_len + 1]; a_len + 1];

    // Initialize
    for (i, row) in matrix.iter_mut().enumerate().take(a_len + 1) {
        row[0] = i;
    }
    for (j, cell) in matrix[0].iter_mut().enumerate().take(b_len + 1) {
        *cell = j;
    }

    // Calculate
    for i in 1..=a_len {
        for j in 1..=b_len {
            let cost = if a_chars[i - 1] == b_chars[j - 1] {
                0
            } else {
                1
            };

            matrix[i][j] = (matrix[i - 1][j] + 1)
                .min(matrix[i][j - 1] + 1)
                .min(matrix[i - 1][j - 1] + cost);
        }
    }

    matrix[a_len][b_len]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_label_similarity() {
        assert_eq!(calculate_label_similarity("bug", "bug"), 1.0);

        // Different labels should have low similarity
        let similarity = calculate_label_similarity("enhancement", "feature");
        assert!(similarity < 0.5);

        // Partial similarity
        let similarity = calculate_label_similarity("bug-report", "bug");
        assert!(similarity > 0.0 && similarity < 1.0);
    }

    #[test]
    fn test_levenshtein_distance() {
        assert_eq!(levenshtein_distance("", ""), 0);
        assert_eq!(levenshtein_distance("abc", ""), 3);
        assert_eq!(levenshtein_distance("", "abc"), 3);
        assert_eq!(levenshtein_distance("abc", "abc"), 0);
        assert_eq!(levenshtein_distance("abc", "ab"), 1);
        assert_eq!(levenshtein_distance("abc", "axc"), 1);
    }

    #[test]
    fn test_encode_path_segment() {
        // Basic ASCII characters
        assert_eq!(encode_path_segment("bug"), "bug");
        assert_eq!(encode_path_segment("feature-request"), "feature-request");

        // Spaces and special characters
        assert_eq!(
            encode_path_segment("good first issue"),
            "good%20first%20issue"
        );
        assert_eq!(encode_path_segment("help wanted"), "help%20wanted");

        // Japanese characters (UTF-8)
        assert_eq!(encode_path_segment("バグ"), "%E3%83%90%E3%82%B0");
        assert_eq!(
            encode_path_segment("機能追加"),
            "%E6%A9%9F%E8%83%BD%E8%BF%BD%E5%8A%A0"
        );

        // Mixed ASCII and Japanese
        assert_eq!(encode_path_segment("bug バグ"), "bug%20%E3%83%90%E3%82%B0");

        // RFC 3986 unreserved characters should remain unchanged
        assert_eq!(
            encode_path_segment("test-label_v1.2~alpha"),
            "test-label_v1.2~alpha"
        );

        // Special characters that need encoding
        assert_eq!(encode_path_segment("test/label"), "test%2Flabel");
        assert_eq!(encode_path_segment("test@label"), "test%40label");
    }

    #[test]
    fn test_github_label_conversion() {
        let github_label = GitHubLabel {
            id: 1,
            name: "bug".to_string(),
            color: "d73a4a".to_string(),
            description: Some("Something isn't working".to_string()),
            default: true,
            url: "https://api.github.com/repos/owner/repo/labels/bug".to_string(),
        };

        let label_config: LabelConfig = github_label.into();
        assert_eq!(label_config.name, "bug");
        assert_eq!(label_config.color, "d73a4a");
        assert_eq!(
            label_config.description,
            Some("Something isn't working".to_string())
        );
    }
}
