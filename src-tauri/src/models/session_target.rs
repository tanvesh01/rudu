use serde::{Deserialize, Serialize};

use super::LocalDiffSource;

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum SessionTargetRef {
    LocalCheckout {
        checkout_id: String,
        source: Option<LocalDiffSource>,
    },
    PullRequest {
        repo: String,
        number: u32,
    },
}
