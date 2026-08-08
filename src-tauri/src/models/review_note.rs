use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReviewNote {
    pub id: String,
    pub checkout_id: String,
    pub file_path: String,
    pub line: u32,
    /// Pierre diff side: `additions` or `deletions`.
    pub side: String,
    pub start_line: Option<u32>,
    pub start_side: Option<String>,
    pub body: String,
    /// `user` = typed by the human in the app, `agent` = written via `rudu session comment add`.
    pub author: String,
    pub created_at: i64,
}
