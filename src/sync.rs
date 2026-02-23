//! Label Synchronization Functionality
//!
//! Module implementing GitHub label synchronization logic

use std::collections::{HashMap, HashSet};

use crate::config::{default_labels, LabelConfig, SyncConfig};
use crate::error::{Error, Result};
use crate::github::{GitHubClient, GitHubLabel, LabelService};
use crate::similarity::{calculate_label_similarity, SIMILARITY_THRESHOLD};

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
    operations: Vec<SyncOperation>,
    created: u32,
    updated: u32,
    deleted: u32,
    renamed: u32,
    unchanged: u32,
    dry_run: bool,
    errors: Vec<String>,
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

    /// Get list of executed operations
    pub fn operations(&self) -> &[SyncOperation] {
        &self.operations
    }

    /// Get number of labels created
    pub fn created(&self) -> u32 {
        self.created
    }

    /// Get number of labels updated
    pub fn updated(&self) -> u32 {
        self.updated
    }

    /// Get number of labels deleted
    pub fn deleted(&self) -> u32 {
        self.deleted
    }

    /// Get number of labels renamed
    pub fn renamed(&self) -> u32 {
        self.renamed
    }

    /// Get number of labels unchanged
    pub fn unchanged(&self) -> u32 {
        self.unchanged
    }

    /// Get whether this is a dry run
    pub fn dry_run(&self) -> bool {
        self.dry_run
    }

    /// Get operations that encountered errors
    pub fn errors(&self) -> &[String] {
        &self.errors
    }
}

/// Label Synchronization Engine
///
/// Synchronizes GitHub repository labels with configuration
pub struct LabelSyncer<S: LabelService = GitHubClient> {
    client: S,
    config: SyncConfig,
}

impl LabelSyncer<GitHubClient> {
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
}

impl<S: LabelService> LabelSyncer<S> {
    /// Create a new syncer with a pre-built service (for testing)
    ///
    /// # Arguments
    /// - `client`: Label service implementation
    /// - `config`: Synchronization configuration
    ///
    /// # Errors
    /// Returns an error if configuration validation fails
    pub fn with_service(client: S, config: SyncConfig) -> Result<Self> {
        config.validate()?;
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
        let target_labels = self.config.labels.clone().unwrap_or_else(default_labels);

        // Create synchronization plan
        let operations = self.plan_sync_operations(&current_labels_map, &target_labels);

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

    /// Plan synchronization operations
    ///
    /// # Arguments
    /// - `current_labels`: Current labels
    /// - `target_labels`: Target labels
    ///
    /// # Returns
    /// List of operations to execute
    fn plan_sync_operations(
        &self,
        current_labels: &HashMap<String, GitHubLabel>,
        target_labels: &[LabelConfig],
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
            } else if let Some(matching_label) = self.find_alias_match(current_labels, target_label)
            {
                // Check alias matching
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
            };

            operations.push(operation);
        }

        // Check current labels that haven't been processed
        if !self.config.allow_added_labels {
            for name in current_labels.keys() {
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

        let current_normalized = LabelConfig::normalize_color(&current.color);
        let target_normalized = LabelConfig::normalize_color(&target.color);
        if current_normalized != target_normalized {
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
    ///
    /// # Returns
    /// Matching label if found
    fn find_alias_match<'a>(
        &self,
        current_labels: &'a HashMap<String, GitHubLabel>,
        target_label: &LabelConfig,
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
    /// Most similar label (similarity > threshold)
    fn find_similar_label<'a>(
        &self,
        current_labels: &'a HashMap<String, GitHubLabel>,
        target_label: &LabelConfig,
    ) -> Option<&'a GitHubLabel> {
        let mut best_match: Option<&'a GitHubLabel> = None;
        let mut best_similarity = SIMILARITY_THRESHOLD;

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
}

#[cfg(test)]
mod tests {
    use super::*;
    use async_trait::async_trait;
    use std::sync::Mutex;

    struct MockLabelService {
        labels: Mutex<Vec<GitHubLabel>>,
    }

    impl MockLabelService {
        fn new(labels: Vec<GitHubLabel>) -> Self {
            Self {
                labels: Mutex::new(labels),
            }
        }

        fn get_labels(&self) -> Vec<GitHubLabel> {
            self.labels.lock().unwrap().clone()
        }
    }

    #[async_trait]
    impl LabelService for MockLabelService {
        async fn get_all_labels(&self) -> Result<Vec<GitHubLabel>> {
            Ok(self.labels.lock().unwrap().clone())
        }

        async fn create_label(&self, label: &LabelConfig) -> Result<GitHubLabel> {
            let github_label = GitHubLabel {
                id: 0,
                name: label.name.clone(),
                color: LabelConfig::normalize_color(&label.color),
                description: label.description.clone(),
                default: false,
                url: String::new(),
            };
            self.labels.lock().unwrap().push(github_label.clone());
            Ok(github_label)
        }

        async fn update_label(
            &self,
            current_name: &str,
            label: &LabelConfig,
        ) -> Result<GitHubLabel> {
            let mut labels = self.labels.lock().unwrap();
            labels.retain(|l| l.name != current_name);
            let github_label = GitHubLabel {
                id: 0,
                name: label.name.clone(),
                color: LabelConfig::normalize_color(&label.color),
                description: label.description.clone(),
                default: false,
                url: String::new(),
            };
            labels.push(github_label.clone());
            Ok(github_label)
        }

        async fn delete_label(&self, label_name: &str) -> Result<()> {
            self.labels.lock().unwrap().retain(|l| l.name != label_name);
            Ok(())
        }

        async fn repository_exists(&self) -> bool {
            true
        }
    }

    struct FailingLabelService {
        labels: Vec<GitHubLabel>,
    }

    impl FailingLabelService {
        fn new(labels: Vec<GitHubLabel>) -> Self {
            Self { labels }
        }
    }

    #[async_trait]
    impl LabelService for FailingLabelService {
        async fn get_all_labels(&self) -> Result<Vec<GitHubLabel>> {
            Ok(self.labels.clone())
        }

        async fn create_label(&self, _label: &LabelConfig) -> Result<GitHubLabel> {
            Err(Error::config_validation("Mock create error"))
        }

        async fn update_label(
            &self,
            _current_name: &str,
            _label: &LabelConfig,
        ) -> Result<GitHubLabel> {
            Err(Error::config_validation("Mock update error"))
        }

        async fn delete_label(&self, _label_name: &str) -> Result<()> {
            Err(Error::config_validation("Mock delete error"))
        }

        async fn repository_exists(&self) -> bool {
            true
        }
    }

    fn test_config(labels: Vec<LabelConfig>) -> SyncConfig {
        SyncConfig {
            access_token: "test-token".to_string(),
            repository: "owner/repo".to_string(),
            dry_run: false,
            allow_added_labels: false,
            labels: Some(labels),
        }
    }

    fn test_syncer(
        existing: Vec<GitHubLabel>,
        target: Vec<LabelConfig>,
    ) -> LabelSyncer<MockLabelService> {
        let service = MockLabelService::new(existing);
        let config = test_config(target);
        LabelSyncer::with_service(service, config).unwrap()
    }

    fn make_github_label(name: &str, color: &str, description: Option<&str>) -> GitHubLabel {
        GitHubLabel {
            id: 0,
            name: name.to_string(),
            color: color.to_string(),
            description: description.map(|s| s.to_string()),
            default: false,
            url: String::new(),
        }
    }

    fn make_label_config(name: &str, color: &str, description: Option<&str>) -> LabelConfig {
        LabelConfig {
            name: name.to_string(),
            color: color.to_string(),
            description: description.map(|s| s.to_string()),
            aliases: Vec::new(),
            delete: false,
        }
    }

    // --- SyncResult tests ---

    #[test]
    fn test_sync_result_operations() {
        let mut result = SyncResult::new(false);

        result.add_operation(SyncOperation::Create {
            label: make_label_config("test", "#ff0000", None),
        });

        assert_eq!(result.created(), 1);
        assert_eq!(result.total_operations(), 1);
        assert!(result.has_changes());
    }

    #[test]
    fn test_sync_result_getters() {
        let mut result = SyncResult::new(true);
        result.add_operation(SyncOperation::Create {
            label: make_label_config("a", "#ff0000", None),
        });
        result.add_operation(SyncOperation::Update {
            current_name: "b".to_string(),
            new_label: make_label_config("b", "#00ff00", None),
            changes: vec!["color".to_string()],
        });
        result.add_operation(SyncOperation::Delete {
            name: "c".to_string(),
            reason: "test".to_string(),
        });
        result.add_operation(SyncOperation::Rename {
            current_name: "d".to_string(),
            new_name: "e".to_string(),
            new_label: make_label_config("e", "#0000ff", None),
        });
        result.add_operation(SyncOperation::NoChange {
            name: "f".to_string(),
        });
        result.add_error("test error".to_string());

        assert_eq!(result.created(), 1);
        assert_eq!(result.updated(), 1);
        assert_eq!(result.deleted(), 1);
        assert_eq!(result.renamed(), 1);
        assert_eq!(result.unchanged(), 1);
        assert!(result.dry_run());
        assert_eq!(result.operations().len(), 5);
        assert_eq!(result.errors().len(), 1);
        assert_eq!(result.total_operations(), 5);
        assert!(result.has_changes());
    }

    // --- plan_sync_operations tests ---

    #[test]
    fn test_plan_empty_repo_with_config_labels() {
        let target = vec![make_label_config("bug", "#d73a4a", Some("Bug"))];
        let syncer = test_syncer(vec![], target.clone());
        let ops = syncer.plan_sync_operations(&HashMap::new(), &target);
        assert_eq!(ops.len(), 1);
        assert!(matches!(&ops[0], SyncOperation::Create { .. }));
    }

    #[test]
    fn test_plan_matching_labels_no_change() {
        let existing = vec![make_github_label("bug", "d73a4a", Some("Bug"))];
        let target = vec![make_label_config("bug", "#d73a4a", Some("Bug"))];
        let syncer = test_syncer(existing.clone(), target.clone());
        let map: HashMap<String, GitHubLabel> =
            existing.into_iter().map(|l| (l.name.clone(), l)).collect();
        let ops = syncer.plan_sync_operations(&map, &target);
        assert_eq!(ops.len(), 1);
        assert!(matches!(&ops[0], SyncOperation::NoChange { .. }));
    }

    #[test]
    fn test_plan_color_change_triggers_update() {
        let existing = vec![make_github_label("bug", "d73a4a", Some("Bug"))];
        let target = vec![make_label_config("bug", "#ff0000", Some("Bug"))];
        let syncer = test_syncer(existing.clone(), target.clone());
        let map: HashMap<String, GitHubLabel> =
            existing.into_iter().map(|l| (l.name.clone(), l)).collect();
        let ops = syncer.plan_sync_operations(&map, &target);
        assert_eq!(ops.len(), 1);
        assert!(matches!(&ops[0], SyncOperation::Update { .. }));
    }

    #[test]
    fn test_plan_description_change_triggers_update() {
        let existing = vec![make_github_label("bug", "d73a4a", Some("Old desc"))];
        let target = vec![make_label_config("bug", "#d73a4a", Some("New desc"))];
        let syncer = test_syncer(existing.clone(), target.clone());
        let map: HashMap<String, GitHubLabel> =
            existing.into_iter().map(|l| (l.name.clone(), l)).collect();
        let ops = syncer.plan_sync_operations(&map, &target);
        assert_eq!(ops.len(), 1);
        assert!(matches!(&ops[0], SyncOperation::Update { .. }));
    }

    #[test]
    fn test_plan_extra_labels_deleted_when_not_allowed() {
        let existing = vec![
            make_github_label("bug", "d73a4a", Some("Bug")),
            make_github_label("extra", "ffffff", None),
        ];
        let target = vec![make_label_config("bug", "#d73a4a", Some("Bug"))];
        let syncer = test_syncer(existing.clone(), target.clone());
        let map: HashMap<String, GitHubLabel> =
            existing.into_iter().map(|l| (l.name.clone(), l)).collect();
        let ops = syncer.plan_sync_operations(&map, &target);
        assert!(ops
            .iter()
            .any(|op| matches!(op, SyncOperation::Delete { name, .. } if name == "extra")));
    }

    #[test]
    fn test_plan_extra_labels_preserved_when_allowed() {
        let existing = vec![
            make_github_label("bug", "d73a4a", Some("Bug")),
            make_github_label("extra", "ffffff", None),
        ];
        let target = vec![make_label_config("bug", "#d73a4a", Some("Bug"))];
        let service = MockLabelService::new(existing.clone());
        let mut config = test_config(target.clone());
        config.allow_added_labels = true;
        let syncer = LabelSyncer::with_service(service, config).unwrap();
        let map: HashMap<String, GitHubLabel> =
            existing.into_iter().map(|l| (l.name.clone(), l)).collect();
        let ops = syncer.plan_sync_operations(&map, &target);
        assert!(!ops
            .iter()
            .any(|op| matches!(op, SyncOperation::Delete { .. })));
    }

    #[test]
    fn test_plan_delete_marked_label() {
        let existing = vec![make_github_label("obsolete", "d73a4a", None)];
        let target = vec![LabelConfig {
            name: "obsolete".to_string(),
            color: "#d73a4a".to_string(),
            description: None,
            aliases: Vec::new(),
            delete: true,
        }];
        let syncer = test_syncer(existing.clone(), target.clone());
        let map: HashMap<String, GitHubLabel> =
            existing.into_iter().map(|l| (l.name.clone(), l)).collect();
        let ops = syncer.plan_sync_operations(&map, &target);
        assert_eq!(ops.len(), 1);
        assert!(matches!(&ops[0], SyncOperation::Delete { .. }));
    }

    #[test]
    fn test_plan_alias_match_triggers_rename() {
        let existing = vec![make_github_label("defect", "d73a4a", None)];
        let target = vec![LabelConfig {
            name: "bug".to_string(),
            color: "#d73a4a".to_string(),
            description: None,
            aliases: vec!["defect".to_string()],
            delete: false,
        }];
        let syncer = test_syncer(existing.clone(), target.clone());
        let map: HashMap<String, GitHubLabel> =
            existing.into_iter().map(|l| (l.name.clone(), l)).collect();
        let ops = syncer.plan_sync_operations(&map, &target);
        assert_eq!(ops.len(), 1);
        assert!(
            matches!(&ops[0], SyncOperation::Rename { current_name, new_name, .. } if current_name == "defect" && new_name == "bug")
        );
    }

    #[test]
    fn test_plan_similar_label_triggers_rename() {
        // "bug-report" and "bug-reports" have similarity > 0.7
        let existing = vec![make_github_label("bug-reports", "d73a4a", None)];
        let target = vec![make_label_config("bug-report", "#d73a4a", None)];
        let syncer = test_syncer(existing.clone(), target.clone());
        let map: HashMap<String, GitHubLabel> =
            existing.into_iter().map(|l| (l.name.clone(), l)).collect();
        let ops = syncer.plan_sync_operations(&map, &target);
        assert_eq!(ops.len(), 1);
        assert!(matches!(&ops[0], SyncOperation::Rename { .. }));
    }

    #[test]
    fn test_plan_low_similarity_creates_new() {
        // "bug" and "enhancement" should not be similar
        let existing = vec![make_github_label("enhancement", "d73a4a", None)];
        let target = vec![make_label_config("bug", "#d73a4a", None)];
        let syncer = test_syncer(existing.clone(), target.clone());
        let map: HashMap<String, GitHubLabel> =
            existing.into_iter().map(|l| (l.name.clone(), l)).collect();
        let ops = syncer.plan_sync_operations(&map, &target);
        // Should create "bug" and delete "enhancement" (since allow_added_labels is false)
        assert!(ops
            .iter()
            .any(|op| matches!(op, SyncOperation::Create { label } if label.name == "bug")));
        assert!(ops
            .iter()
            .any(|op| matches!(op, SyncOperation::Delete { name, .. } if name == "enhancement")));
    }

    // --- check_label_changes tests ---

    #[test]
    fn test_check_no_changes_with_color_normalization() {
        let syncer = test_syncer(vec![], vec![]);
        // GitHubLabel has color without #, LabelConfig has color with #
        let current = make_github_label("bug", "d73a4a", Some("Bug"));
        let target = make_label_config("bug", "#d73a4a", Some("Bug"));
        let op = syncer.check_label_changes(&current, &target);
        assert!(matches!(op, SyncOperation::NoChange { .. }));
    }

    #[test]
    fn test_check_color_only_change() {
        let syncer = test_syncer(vec![], vec![]);
        let current = make_github_label("bug", "d73a4a", Some("Bug"));
        let target = make_label_config("bug", "#ff0000", Some("Bug"));
        let op = syncer.check_label_changes(&current, &target);
        assert!(
            matches!(op, SyncOperation::Update { changes, .. } if changes.len() == 1 && changes[0].contains("color"))
        );
    }

    #[test]
    fn test_check_description_only_change() {
        let syncer = test_syncer(vec![], vec![]);
        let current = make_github_label("bug", "d73a4a", Some("Old"));
        let target = make_label_config("bug", "#d73a4a", Some("New"));
        let op = syncer.check_label_changes(&current, &target);
        assert!(
            matches!(op, SyncOperation::Update { changes, .. } if changes.len() == 1 && changes[0].contains("description"))
        );
    }

    #[test]
    fn test_check_multiple_changes() {
        let syncer = test_syncer(vec![], vec![]);
        let current = make_github_label("bug", "d73a4a", Some("Old"));
        let target = make_label_config("bug", "#ff0000", Some("New"));
        let op = syncer.check_label_changes(&current, &target);
        assert!(matches!(op, SyncOperation::Update { changes, .. } if changes.len() == 2));
    }

    // --- find_alias_match / find_similar_label tests ---

    #[test]
    fn test_find_alias_match_found() {
        let syncer = test_syncer(vec![], vec![]);
        let existing = vec![make_github_label("defect", "d73a4a", None)];
        let map: HashMap<String, GitHubLabel> =
            existing.into_iter().map(|l| (l.name.clone(), l)).collect();
        let target = LabelConfig {
            name: "bug".to_string(),
            color: "#d73a4a".to_string(),
            description: None,
            aliases: vec!["defect".to_string()],
            delete: false,
        };
        assert!(syncer.find_alias_match(&map, &target).is_some());
    }

    #[test]
    fn test_find_alias_match_not_found() {
        let syncer = test_syncer(vec![], vec![]);
        let existing = vec![make_github_label("other", "d73a4a", None)];
        let map: HashMap<String, GitHubLabel> =
            existing.into_iter().map(|l| (l.name.clone(), l)).collect();
        let target = LabelConfig {
            name: "bug".to_string(),
            color: "#d73a4a".to_string(),
            description: None,
            aliases: vec!["defect".to_string()],
            delete: false,
        };
        assert!(syncer.find_alias_match(&map, &target).is_none());
    }

    #[test]
    fn test_find_similar_label_above_threshold() {
        let syncer = test_syncer(vec![], vec![]);
        let existing = vec![make_github_label("bug-reports", "d73a4a", None)];
        let map: HashMap<String, GitHubLabel> =
            existing.into_iter().map(|l| (l.name.clone(), l)).collect();
        let target = make_label_config("bug-report", "#d73a4a", None);
        assert!(syncer.find_similar_label(&map, &target).is_some());
    }

    #[test]
    fn test_find_similar_label_below_threshold() {
        let syncer = test_syncer(vec![], vec![]);
        let existing = vec![make_github_label("enhancement", "d73a4a", None)];
        let map: HashMap<String, GitHubLabel> =
            existing.into_iter().map(|l| (l.name.clone(), l)).collect();
        let target = make_label_config("bug", "#d73a4a", None);
        assert!(syncer.find_similar_label(&map, &target).is_none());
    }

    #[test]
    fn test_find_similar_label_picks_best_match() {
        let syncer = test_syncer(vec![], vec![]);
        let existing = vec![
            make_github_label("bug-tracker", "d73a4a", None),
            make_github_label("bug-report", "d73a4a", None),
        ];
        let map: HashMap<String, GitHubLabel> =
            existing.into_iter().map(|l| (l.name.clone(), l)).collect();
        // "bug-reports" vs "bug-report" (similarity ~0.91) > "bug-tracker" (similarity ~0.36)
        let target = make_label_config("bug-reports", "#d73a4a", None);
        let result = syncer.find_similar_label(&map, &target).unwrap();
        assert_eq!(result.name, "bug-report");
    }

    // --- sync_labels integration tests ---

    #[tokio::test]
    async fn test_sync_all_new_labels() {
        let syncer = test_syncer(
            vec![],
            vec![
                make_label_config("bug", "#d73a4a", Some("Bug")),
                make_label_config("feature", "#a2eeef", Some("Feature")),
            ],
        );
        let result = syncer.sync_labels().await.unwrap();
        assert_eq!(result.created(), 2);
        assert_eq!(result.deleted(), 0);
        assert_eq!(result.updated(), 0);
    }

    #[tokio::test]
    async fn test_sync_dry_run_no_state_change() {
        let service = MockLabelService::new(vec![]);
        let mut config = test_config(vec![make_label_config("bug", "#d73a4a", None)]);
        config.dry_run = true;
        let syncer = LabelSyncer::with_service(service, config).unwrap();

        let result = syncer.sync_labels().await.unwrap();
        assert!(result.dry_run());
        assert_eq!(result.created(), 1);
        // Verify the service still has no labels (dry run didn't actually create)
        assert!(syncer.client.get_labels().is_empty());
    }

    #[tokio::test]
    async fn test_sync_creates_and_deletes() {
        let syncer = test_syncer(
            vec![make_github_label("old-label", "ffffff", None)],
            vec![make_label_config("new-label", "#d73a4a", None)],
        );
        let result = syncer.sync_labels().await.unwrap();
        assert_eq!(result.created(), 1);
        assert_eq!(result.deleted(), 1);

        let final_labels = syncer.client.get_labels();
        assert_eq!(final_labels.len(), 1);
        assert_eq!(final_labels[0].name, "new-label");
    }

    #[tokio::test]
    async fn test_sync_labels_with_operation_error() {
        let service = FailingLabelService::new(vec![]);
        let config = test_config(vec![make_label_config("bug", "#d73a4a", Some("Bug"))]);
        let syncer = LabelSyncer::with_service(service, config).unwrap();
        let result = syncer.sync_labels().await.unwrap();
        // The create operation should fail, resulting in an error being recorded
        assert!(!result.errors().is_empty());
        assert!(result.errors()[0].contains("Operation failed"));
    }

    #[tokio::test]
    async fn test_sync_rename_via_alias() {
        let existing = vec![make_github_label("defect", "d73a4a", None)];
        let target = vec![LabelConfig {
            name: "bug".to_string(),
            color: "#d73a4a".to_string(),
            description: None,
            aliases: vec!["defect".to_string()],
            delete: false,
        }];
        let syncer = test_syncer(existing, target);
        let result = syncer.sync_labels().await.unwrap();
        assert_eq!(result.renamed(), 1);

        let final_labels = syncer.client.get_labels();
        assert_eq!(final_labels.len(), 1);
        assert_eq!(final_labels[0].name, "bug");
    }
}
