use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

pub(super) fn review_chat_debug_log_path(repo_dir: &Path) -> Option<PathBuf> {
    repo_dir
        .parent()
        .map(|workspace_dir| workspace_dir.join(".rudu").join("review-chat-acp.log"))
}

pub(super) fn log_review_chat_debug(path: Option<&Path>, message: impl AsRef<str>) {
    let Some(path) = path else {
        return;
    };

    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    let timestamp_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();

    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "{timestamp_ms} {}", message.as_ref());
    }
}
