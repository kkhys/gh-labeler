//! Error Handling
//!
//! Error type definitions used in gh-labeler

use thiserror::Error;

pub type Result<T> = std::result::Result<T, Error>;

/// Error types for gh-labeler
#[derive(Error, Debug)]
pub enum Error {
    #[error("GitHub API error: {0}")]
    GitHubApi(#[from] octocrab::Error),

    #[error("HTTP request error: {0}")]
    Http(#[from] reqwest::Error),

    #[error("JSON serialization error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("YAML parsing error: {0}")]
    Yaml(#[from] serde_yaml::Error),

    #[error("Configuration validation error: {0}")]
    ConfigValidation(String),

    #[error("Label validation error: {0}")]
    LabelValidation(String),

    #[error("Repository not found: {0}")]
    RepositoryNotFound(String),

    #[error("Authentication failed: invalid token")]
    AuthenticationFailed,

    #[error("Rate limit exceeded. Please wait and try again")]
    RateLimitExceeded,

    #[error("Network error: {0}")]
    Network(String),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Invalid repository format: {0} (expected 'owner/repo')")]
    InvalidRepositoryFormat(String),

    #[error("Invalid label color: {0} (expected 6-digit hex without #)")]
    InvalidLabelColor(String),

    #[error("Generic error: {0}")]
    Generic(String),
}

impl Error {
    /// Create a new configuration validation error
    pub fn config_validation<S: Into<String>>(message: S) -> Self {
        Error::ConfigValidation(message.into())
    }

    /// Create a new label validation error  
    pub fn label_validation<S: Into<String>>(message: S) -> Self {
        Error::LabelValidation(message.into())
    }

    /// Create a new network error
    pub fn network<S: Into<String>>(message: S) -> Self {
        Error::Network(message.into())
    }

    /// Create a new generic error
    pub fn generic<S: Into<String>>(message: S) -> Self {
        Error::Generic(message.into())
    }
}
