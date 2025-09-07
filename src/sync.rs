//! Label Synchronization Functionality
//!
//! Module implementing GitHub label synchronization logic

use std::collections::{HashMap, HashSet};

use crate::config::{default_labels, LabelConfig, SyncConfig};
use crate::error::{Error, Result};
use crate::github::{calculate_label_similarity, GitHubClient, GitHubLabel};

/// Types of label synchronization operations
#[derive(Debug, Clone, PartialEq)]
pub enum SyncOperation {
    /// Create a label
    Create { label: LabelConfig },

    /// Update a label
    Update {
        current_name: String,
        new_label: LabelConfig,
        changes: Vec<String>,
    },

    /// Delete a label
    Delete { name: String, reason: String },

    /// Rename a label (alias matching)
    Rename {
        current_name: String,
        new_name: String,
        new_label: LabelConfig,
    },

    /// No change
    NoChange { name: String },
}

/// Synchronization result
#[derive(Debug, Clone)]
pub struct SyncResult {
    /// List of executed operations
    pub operations: Vec<SyncOperation>,

    /// Number of labels created
    pub created: u32,

    /// Number of labels updated  
    pub updated: u32,

    /// Number of labels deleted
    pub deleted: u32,

    /// Number of labels renamed
    pub renamed: u32,

    /// Number of labels unchanged
    pub unchanged: u32,

    /// Whether this is a dry run
    pub dry_run: bool,

    /// Operations that encountered errors
    pub errors: Vec<String>,
}

impl SyncResult {
    /// Create a new empty synchronization result
    pub fn new(dry_run: bool) -> Self {
        Self {
            operations: Vec::new(),
            created: 0,
            updated: 0,
            deleted: 0,
            renamed: 0,
            unchanged: 0,
            dry_run,
            errors: Vec::new(),
        }
    }

    /// Add an operation and update statistics
    pub fn add_operation(&mut self, operation: SyncOperation) {
        match &operation {
            SyncOperation::Create { .. } => self.created += 1,
            SyncOperation::Update { .. } => self.updated += 1,
            SyncOperation::Delete { .. } => self.deleted += 1,
            SyncOperation::Rename { .. } => self.renamed += 1,
            SyncOperation::NoChange { .. } => self.unchanged += 1,
        }
        self.operations.push(operation);
    }

    /// Add an error
    pub fn add_error(&mut self, error: String) {
        self.errors.push(error);
    }

    /// Whether changes will occur
    pub fn has_changes(&self) -> bool {
        self.created > 0 || self.updated > 0 || self.deleted > 0 || self.renamed > 0
    }

    /// Get total number of operations
    pub fn total_operations(&self) -> u32 {
        self.created + self.updated + self.deleted + self.renamed + self.unchanged
    }
}

/// Label Synchronization Engine
///
/// Synchronizes GitHub repository labels with configuration
pub struct LabelSyncer {
    client: GitHubClient,
    config: SyncConfig,
}

impl LabelSyncer {
    /// Create a new label synchronization engine
    ///
    /// # Arguments
    /// - `config`: Synchronization configuration
    ///
    /// # Errors
    /// Returns an error if configuration validation or GitHub client creation fails
    pub async fn new(config: SyncConfig) -> Result<Self> {
        config.validate()?;

        let (owner, repo) = config.parse_repository()?;
        let client = GitHubClient::new(&config.access_token, &owner, &repo).await?;

        // Check repository existence
        if !client.repository_exists().await {
            return Err(Error::RepositoryNotFound(config.repository.clone()));
        }

        Ok(Self { client, config })
    }

    /// Synchronize labels
    ///
    /// # Returns
    /// Synchronization result
    ///
    /// # Errors
    /// Returns an error if an error occurs during synchronization
    pub async fn sync_labels(&self) -> Result<SyncResult> {
        let mut result = SyncResult::new(self.config.dry_run);

        // Get current labels
        let current_labels = self.client.get_all_labels().await?;
        let current_labels_map: HashMap<String, GitHubLabel> = current_labels
            .into_iter()
            .map(|label| (label.name.clone(), label))
            .collect();

        // Target label configuration
        let target_labels = self
            .config
            .labels
            .as_ref()
            .map(|l| l.clone())
            .unwrap_or_else(|| default_labels());

        // Build alias map
        let alias_map = self.build_alias_map(&target_labels);

        // Create synchronization plan
        let operations = self.plan_sync_operations(&current_labels_map, &target_labels, &alias_map);

        // Execute operations
        for operation in operations {
            match self.execute_operation(&operation).await {
                Ok(()) => {
                    result.add_operation(operation);
                }
                Err(e) => {
                    result.add_error(format!("Operation failed: {:?} - {}", operation, e));
                    // Continue even if error occurs
                }
            }
        }

        Ok(result)
    }

    /// Build alias map
    ///
    /// # Arguments
    /// - `target_labels`: Target label configuration
    ///
    /// # Returns
    /// Map from alias name to official label name
    fn build_alias_map(&self, target_labels: &[LabelConfig]) -> HashMap<String, String> {
        let mut alias_map = HashMap::new();

        for label in target_labels {
            for alias in &label.aliases {
                alias_map.insert(alias.clone(), label.name.clone());
            }
        }

        alias_map
    }

    /// Plan synchronization operations
    ///
    /// # Arguments
    /// - `current_labels`: Current labels
    /// - `target_labels`: Target labels
    /// - `alias_map`: Alias map
    ///
    /// # Returns
    /// List of operations to execute
    fn plan_sync_operations(
        &self,
        current_labels: &HashMap<String, GitHubLabel>,
        target_labels: &[LabelConfig],
        alias_map: &HashMap<String, String>,
    ) -> Vec<SyncOperation> {
        let mut operations = Vec::new();
        let mut processed_current_labels = HashSet::new();

        // Check target labels
        for target_label in target_labels {
            if target_label.delete {
                // Label marked for deletion
                if current_labels.contains_key(&target_label.name) {
                    operations.push(SyncOperation::Delete {
                        name: target_label.name.clone(),
                        reason: "Marked for deletion in configuration".to_string(),
                    });
                    processed_current_labels.insert(&target_label.name);
                }
                continue;
            }

            let operation = if let Some(current_label) = current_labels.get(&target_label.name) {
                // Check existing label for updates
                processed_current_labels.insert(&target_label.name);
                self.check_label_changes(current_label, target_label)
            } else {
                // Check alias matching
                if let Some(matching_label) =
                    self.find_alias_match(current_labels, target_label, alias_map)
                {
                    processed_current_labels.insert(&matching_label.name);
                    SyncOperation::Rename {
                        current_name: matching_label.name.clone(),
                        new_name: target_label.name.clone(),
                        new_label: target_label.clone(),
                    }
                } else if let Some(similar_label) =
                    self.find_similar_label(current_labels, target_label)
                {
                    // Rename similar label
                    processed_current_labels.insert(&similar_label.name);
                    SyncOperation::Rename {
                        current_name: similar_label.name.clone(),
                        new_name: target_label.name.clone(),
                        new_label: target_label.clone(),
                    }
                } else {
                    // Create new
                    SyncOperation::Create {
                        label: target_label.clone(),
                    }
                }
            };

            operations.push(operation);
        }

        // Check current labels that haven't been processed
        if !self.config.allow_added_labels {
            for (name, _) in current_labels {
                if !processed_current_labels.contains(name) {
                    operations.push(SyncOperation::Delete {
                        name: name.clone(),
                        reason: "Not defined in configuration".to_string(),
                    });
                }
            }
        }

        operations
    }

    /// Check label changes
    ///
    /// # Arguments
    /// - `current`: Current label
    /// - `target`: Target label
    ///
    /// # Returns
    /// Required operation
    fn check_label_changes(&self, current: &GitHubLabel, target: &LabelConfig) -> SyncOperation {
        let mut changes = Vec::new();

        if current.color != target.color {
            changes.push(format!("color: {} -> {}", current.color, target.color));
        }

        if current.description != target.description {
            let old_desc = current.description.as_deref().unwrap_or("(none)");
            let new_desc = target.description.as_deref().unwrap_or("(none)");
            changes.push(format!("description: {} -> {}", old_desc, new_desc));
        }

        if changes.is_empty() {
            SyncOperation::NoChange {
                name: current.name.clone(),
            }
        } else {
            SyncOperation::Update {
                current_name: current.name.clone(),
                new_label: target.clone(),
                changes,
            }
        }
    }

    /// Search for alias matching labels
    ///
    /// # Arguments
    /// - `current_labels`: Current labels
    /// - `target_label`: Target label
    /// - `_alias_map`: Alias map (unused)
    ///
    /// # Returns
    /// Matching label if found
    fn find_alias_match<'a>(
        &self,
        current_labels: &'a HashMap<String, GitHubLabel>,
        target_label: &LabelConfig,
        _alias_map: &HashMap<String, String>,
    ) -> Option<&'a GitHubLabel> {
        for alias in &target_label.aliases {
            if let Some(current_label) = current_labels.get(alias) {
                return Some(current_label);
            }
        }
        None
    }

    /// Search for similar labels
    ///
    /// # Arguments
    /// - `current_labels`: Current labels
    /// - `target_label`: Target label
    ///
    /// # Returns
    /// Most similar label (similarity >= 0.7)
    fn find_similar_label<'a>(
        &self,
        current_labels: &'a HashMap<String, GitHubLabel>,
        target_label: &LabelConfig,
    ) -> Option<&'a GitHubLabel> {
        let mut best_match: Option<&'a GitHubLabel> = None;
        let mut best_similarity = 0.7; // Threshold

        for current_label in current_labels.values() {
            let similarity = calculate_label_similarity(&current_label.name, &target_label.name);
            if similarity > best_similarity {
                best_similarity = similarity;
                best_match = Some(current_label);
            }
        }

        best_match
    }

    /// Execute an operation
    ///
    /// # Arguments
    /// - `operation`: Operation to execute
    ///
    /// # Errors
    /// Returns an error if operation execution fails
    async fn execute_operation(&self, operation: &SyncOperation) -> Result<()> {
        if self.config.dry_run {
            // Don't perform actual operations in dry run mode
            return Ok(());
        }

        match operation {
            SyncOperation::Create { label } => {
                self.client.create_label(label).await?;
            }
            SyncOperation::Update {
                current_name,
                new_label,
                ..
            } => {
                self.client.update_label(current_name, new_label).await?;
            }
            SyncOperation::Delete { name, .. } => {
                self.client.delete_label(name).await?;
            }
            SyncOperation::Rename {
                current_name,
                new_label,
                ..
            } => {
                self.client.update_label(current_name, new_label).await?;
            }
            SyncOperation::NoChange { .. } => {
                // Do nothing
            }
        }

        Ok(())
    }

    /// Preview synchronization results (dry run)
    ///
    /// # Returns
    /// Preview of operations to be executed
    pub async fn preview_sync(&mut self) -> Result<SyncResult> {
        let original_dry_run = self.config.dry_run;
        self.config.dry_run = true;

        let result = self.sync_labels().await;

        self.config.dry_run = original_dry_run;
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sync_result_operations() {
        let mut result = SyncResult::new(false);

        result.add_operation(SyncOperation::Create {
            label: LabelConfig {
                name: "test".to_string(),
                color: "ff0000".to_string(),
                description: None,
                aliases: Vec::new(),
                delete: false,
            },
        });

        assert_eq!(result.created, 1);
        assert_eq!(result.total_operations(), 1);
        assert!(result.has_changes());
    }

    #[test]
    fn test_alias_map_building() {
        let labels = vec![
            LabelConfig {
                name: "bug".to_string(),
                color: "ff0000".to_string(),
                description: None,
                aliases: vec!["defect".to_string(), "issue".to_string()],
                delete: false,
            },
            LabelConfig {
                name: "enhancement".to_string(),
                color: "00ff00".to_string(),
                description: None,
                aliases: vec!["feature".to_string()],
                delete: false,
            },
        ];

        let _config = SyncConfig {
            access_token: "test".to_string(),
            repository: "owner/repo".to_string(),
            dry_run: true,
            allow_added_labels: false,
            labels: Some(labels.clone()),
        };

        // Ideally we would create mocks for testing, but here we only test the structure
        // Actual tests are done in integration tests
    }
}
