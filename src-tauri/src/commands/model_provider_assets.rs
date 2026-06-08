use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Serialize;
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelProviderAssetCacheEntry {
    pub body: String,
    pub cached_at_ms: u64,
}

fn model_provider_assets_root(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .resolve("model-provider-assets/v1", BaseDirectory::AppCache)
        .map_err(|error| format!("Failed to resolve model provider asset cache path: {error}"))
}

fn catalog_cache_path(root: &Path) -> PathBuf {
    root.join("catalog.json")
}

fn logo_cache_path(root: &Path, provider_id: &str) -> Result<PathBuf, String> {
    validate_provider_id(provider_id)?;
    Ok(root.join("logos").join(format!("{provider_id}.svg")))
}

fn validate_provider_id(provider_id: &str) -> Result<(), String> {
    if provider_id.is_empty() {
        return Err("Model provider id is required.".to_string());
    }

    if provider_id
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
    {
        return Ok(());
    }

    Err(format!("Invalid model provider id: {provider_id}"))
}

fn read_cache_file(path: &Path) -> Result<Option<ModelProviderAssetCacheEntry>, String> {
    let body = match fs::read_to_string(path) {
        Ok(body) => body,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(format!(
                "Failed to read model provider asset cache {}: {error}",
                path.display()
            ))
        }
    };

    let cached_at_ms = fs::metadata(path)
        .and_then(|metadata| metadata.modified())
        .ok()
        .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis().min(u128::from(u64::MAX)) as u64)
        .unwrap_or(0);

    Ok(Some(ModelProviderAssetCacheEntry { body, cached_at_ms }))
}

fn write_cache_file(path: &Path, body: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "Failed to create model provider asset cache directory {}: {error}",
                parent.display()
            )
        })?;
    }

    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| {
            format!(
                "Invalid model provider asset cache path: {}",
                path.display()
            )
        })?;
    let temp_path = path.with_file_name(format!(".{file_name}.{}.tmp", std::process::id()));

    fs::write(&temp_path, body).map_err(|error| {
        format!(
            "Failed to write model provider asset cache temp file {}: {error}",
            temp_path.display()
        )
    })?;

    fs::rename(&temp_path, path).map_err(|error| {
        let _ = fs::remove_file(&temp_path);
        format!(
            "Failed to replace model provider asset cache file {}: {error}",
            path.display()
        )
    })
}

fn read_catalog_cache_from_root(
    root: &Path,
) -> Result<Option<ModelProviderAssetCacheEntry>, String> {
    read_cache_file(&catalog_cache_path(root))
}

fn write_catalog_cache_to_root(root: &Path, body: &str) -> Result<(), String> {
    write_cache_file(&catalog_cache_path(root), body)
}

fn read_logo_cache_from_root(
    root: &Path,
    provider_id: &str,
) -> Result<Option<ModelProviderAssetCacheEntry>, String> {
    read_cache_file(&logo_cache_path(root, provider_id)?)
}

fn write_logo_cache_to_root(root: &Path, provider_id: &str, body: &str) -> Result<(), String> {
    write_cache_file(&logo_cache_path(root, provider_id)?, body)
}

#[tauri::command]
pub fn read_model_provider_catalog_cache(
    app: AppHandle,
) -> Result<Option<ModelProviderAssetCacheEntry>, String> {
    let root = model_provider_assets_root(&app)?;
    read_catalog_cache_from_root(&root)
}

#[tauri::command]
pub fn write_model_provider_catalog_cache(app: AppHandle, body: String) -> Result<(), String> {
    let root = model_provider_assets_root(&app)?;
    write_catalog_cache_to_root(&root, &body)
}

#[tauri::command]
pub fn read_model_provider_logo_cache(
    app: AppHandle,
    provider_id: String,
) -> Result<Option<ModelProviderAssetCacheEntry>, String> {
    let root = model_provider_assets_root(&app)?;
    read_logo_cache_from_root(&root, &provider_id)
}

#[tauri::command]
pub fn write_model_provider_logo_cache(
    app: AppHandle,
    provider_id: String,
    body: String,
) -> Result<(), String> {
    let root = model_provider_assets_root(&app)?;
    write_logo_cache_to_root(&root, &provider_id, &body)
}

#[cfg(test)]
mod tests {
    use super::*;

    use std::fs;
    use std::path::PathBuf;

    fn temp_test_dir(name: &str) -> PathBuf {
        let mut path = std::env::temp_dir();
        path.push(format!(
            "rudu-model-provider-assets-{name}-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&path);
        fs::create_dir_all(&path).expect("temp dir is created");
        path
    }

    #[test]
    fn catalog_cache_miss_returns_none() {
        let root = temp_test_dir("catalog-miss");

        let entry = read_catalog_cache_from_root(&root).expect("cache read succeeds");

        assert!(entry.is_none());
        fs::remove_dir_all(root).expect("temp dir is removed");
    }

    #[test]
    fn catalog_cache_round_trips_body_and_timestamp() {
        let root = temp_test_dir("catalog-round-trip");

        write_catalog_cache_to_root(&root, "{\"openai\":{}}").expect("cache write succeeds");
        let entry = read_catalog_cache_from_root(&root)
            .expect("cache read succeeds")
            .expect("cache entry exists");

        assert_eq!(entry.body, "{\"openai\":{}}");
        assert!(entry.cached_at_ms > 0);
        fs::remove_dir_all(root).expect("temp dir is removed");
    }

    #[test]
    fn logo_cache_rejects_provider_path_traversal() {
        let root = temp_test_dir("logo-validation");

        let result = write_logo_cache_to_root(&root, "../openai", "<svg />");

        assert!(result.is_err());
        assert!(!root.join("logos").exists());
        fs::remove_dir_all(root).expect("temp dir is removed");
    }

    #[test]
    fn logo_cache_replaces_existing_body() {
        let root = temp_test_dir("logo-replace");

        write_logo_cache_to_root(&root, "openai", "<svg>old</svg>").expect("first write succeeds");
        write_logo_cache_to_root(&root, "openai", "<svg>new</svg>").expect("second write succeeds");
        let entry = read_logo_cache_from_root(&root, "openai")
            .expect("cache read succeeds")
            .expect("cache entry exists");

        assert_eq!(entry.body, "<svg>new</svg>");
        assert!(fs::read_dir(root.join("logos"))
            .expect("logos dir exists")
            .all(|entry| entry
                .expect("dir entry reads")
                .path()
                .extension()
                .is_some_and(|ext| ext == "svg")));
        fs::remove_dir_all(root).expect("temp dir is removed");
    }
}
