use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocalCheckout {
    pub id: String,
    pub path: String,
    pub repository_key: String,
    pub folder_name: String,
    pub branch: String,
    pub github_repo: Option<String>,
    pub available: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocalFileChange {
    pub path: String,
    pub staged: bool,
    pub unstaged: bool,
    pub untracked: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocalCheckoutStatus {
    pub checkout_id: String,
    pub branch: String,
    pub head_sha: String,
    pub revision: String,
    pub changed_files: Vec<String>,
    pub changes: Vec<LocalFileChange>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocalCheckoutPatch {
    pub checkout_id: String,
    pub revision: String,
    pub patch: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum LocalDiffSource {
    GitDiff {
        target: Option<String>,
        staged: bool,
        include_untracked: bool,
        paths: Vec<String>,
    },
    GitShow {
        target: Option<String>,
        paths: Vec<String>,
    },
    Patch {
        path: String,
    },
    Files {
        old_path: String,
        new_path: String,
    },
}
