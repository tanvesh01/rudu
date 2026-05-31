use std::path::{Path, PathBuf};

pub fn env_binary(env_vars: &[&str]) -> Option<String> {
    for env_var in env_vars {
        if let Ok(value) = std::env::var(env_var) {
            let value = value.trim();
            if !value.is_empty() {
                return Some(value.to_string());
            }
        }
    }

    None
}

pub fn resolve_binary(env_vars: &[&str], bin_name: &str) -> String {
    if let Some(value) = env_binary(env_vars) {
        return value;
    }

    binary_candidates(bin_name)
        .into_iter()
        .find(|path| path.is_file())
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_else(|| bin_name.to_string())
}

pub fn binary_candidates(bin_name: &str) -> Vec<PathBuf> {
    let mut candidates = project_dev_binary_candidates(bin_name);

    #[cfg(target_os = "macos")]
    {
        candidates.push(PathBuf::from(format!("/opt/homebrew/bin/{bin_name}")));
        candidates.push(PathBuf::from(format!("/usr/local/bin/{bin_name}")));
    }

    if let Some(home_dir) = std::env::var_os("HOME").map(PathBuf::from) {
        candidates.push(home_dir.join(".opencode").join("bin").join(bin_name));
        candidates.push(home_dir.join(".bun").join("bin").join(bin_name));
        candidates.push(home_dir.join(".local").join("bin").join(bin_name));
    }

    candidates
}

pub fn project_dev_binary_candidates(bin_name: &str) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Some(root) = option_env!("CARGO_MANIFEST_DIR")
        .map(PathBuf::from)
        .and_then(|path| path.parent().map(Path::to_path_buf))
    {
        roots.push(root);
    }
    if let Ok(current_dir) = std::env::current_dir() {
        roots.push(current_dir.clone());
        if let Some(parent) = current_dir.parent() {
            roots.push(parent.to_path_buf());
        }
    }

    roots
        .into_iter()
        .map(|root| root.join("node_modules").join(".bin").join(bin_name))
        .collect()
}
