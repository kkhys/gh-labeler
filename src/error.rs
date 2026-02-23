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

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Invalid repository format: {0} (expected 'owner/repo')")]
    InvalidRepositoryFormat(String),

    #[error("Invalid label color: {0} (expected 6-digit hex without #)")]
    InvalidLabelColor(String),

    #[error("No configuration file found. Searched for: {searched_files}. Run `gh-labeler init` to create one.")]
    ConfigFileNotFound { searched_files: String },

    #[error("Remote config file not found in {repo}. Searched for: {searched_files}")]
    RemoteConfigNotFound {
        repo: String,
        searched_files: String,
    },
}

/// Exit code constants for CLI process termination
pub mod exit_codes {
    /// Successful execution
    pub const SUCCESS: i32 = 0;

    /// General / unclassified error
    pub const GENERAL_ERROR: i32 = 1;

    /// Configuration or validation error
    pub const CONFIG_ERROR: i32 = 2;

    /// Authentication failure (invalid or missing token)
    pub const AUTH_ERROR: i32 = 3;

    /// Target repository not found
    pub const REPO_NOT_FOUND: i32 = 4;

    /// Sync completed but some operations failed
    pub const PARTIAL_SUCCESS: i32 = 5;
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

    /// Return the appropriate CLI exit code for this error
    pub fn exit_code(&self) -> i32 {
        match self {
            Error::ConfigValidation(_)
            | Error::LabelValidation(_)
            | Error::InvalidRepositoryFormat(_)
            | Error::InvalidLabelColor(_)
            | Error::ConfigFileNotFound { .. }
            | Error::RemoteConfigNotFound { .. }
            | Error::Json(_)
            | Error::Yaml(_) => exit_codes::CONFIG_ERROR,

            Error::AuthenticationFailed => exit_codes::AUTH_ERROR,

            Error::RepositoryNotFound(_) => exit_codes::REPO_NOT_FOUND,

            Error::GitHubApi(_) | Error::Io(_) => exit_codes::GENERAL_ERROR,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_exit_code_config_errors() {
        assert_eq!(
            Error::ConfigValidation("bad".into()).exit_code(),
            exit_codes::CONFIG_ERROR
        );
        assert_eq!(
            Error::LabelValidation("bad".into()).exit_code(),
            exit_codes::CONFIG_ERROR
        );
        assert_eq!(
            Error::InvalidRepositoryFormat("x".into()).exit_code(),
            exit_codes::CONFIG_ERROR
        );
        assert_eq!(
            Error::InvalidLabelColor("x".into()).exit_code(),
            exit_codes::CONFIG_ERROR
        );
        assert_eq!(
            Error::ConfigFileNotFound {
                searched_files: "a".into()
            }
            .exit_code(),
            exit_codes::CONFIG_ERROR
        );
        assert_eq!(
            Error::RemoteConfigNotFound {
                repo: "o/r".into(),
                searched_files: "a".into()
            }
            .exit_code(),
            exit_codes::CONFIG_ERROR
        );
    }

    #[test]
    fn test_exit_code_auth_error() {
        assert_eq!(
            Error::AuthenticationFailed.exit_code(),
            exit_codes::AUTH_ERROR
        );
    }

    #[test]
    fn test_exit_code_repo_not_found() {
        assert_eq!(
            Error::RepositoryNotFound("o/r".into()).exit_code(),
            exit_codes::REPO_NOT_FOUND
        );
    }

    #[test]
    fn test_exit_code_io_error() {
        let io_err = std::io::Error::other("test");
        assert_eq!(Error::Io(io_err).exit_code(), exit_codes::GENERAL_ERROR);
    }

    #[test]
    fn test_exit_code_constants_are_distinct() {
        let codes = [
            exit_codes::SUCCESS,
            exit_codes::GENERAL_ERROR,
            exit_codes::CONFIG_ERROR,
            exit_codes::AUTH_ERROR,
            exit_codes::REPO_NOT_FOUND,
            exit_codes::PARTIAL_SUCCESS,
        ];
        for (i, a) in codes.iter().enumerate() {
            for (j, b) in codes.iter().enumerate() {
                if i != j {
                    assert_ne!(a, b, "exit codes at index {i} and {j} must differ");
                }
            }
        }
    }
}
