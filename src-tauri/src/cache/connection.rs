use std::fs;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use rusqlite::Connection;

static CACHE_DB_PATH: OnceLock<PathBuf> = OnceLock::new();

pub fn cache_db_path() -> Result<&'static PathBuf, String> {
    CACHE_DB_PATH
        .get()
        .ok_or_else(|| "Cache database path is not initialized".to_string())
}

pub fn set_cache_db_path(path: PathBuf) -> Result<(), PathBuf> {
    CACHE_DB_PATH.set(path)
}

pub fn open_cache_connection() -> Result<Connection, String> {
    let path = cache_db_path()?;

    ensure_cache_parent(path)?;
    let conn = Connection::open(path).map_err(|error| {
        format!(
            "Failed to open cache database at {}: {error}",
            path.display()
        )
    })?;
    super::schema::ensure_cache_schema(&conn)?;
    Ok(conn)
}

fn ensure_cache_parent(path: &Path) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "Failed to create cache directory {}: {error}",
                parent.display()
            )
        })?;
    }

    Ok(())
}

pub fn initialize_cache_database(path: &Path) -> Result<(), String> {
    ensure_cache_parent(path)?;

    let conn = Connection::open(path).map_err(|error| {
        format!(
            "Failed to initialize cache database at {}: {error}",
            path.display()
        )
    })?;

    super::schema::ensure_cache_schema(&conn)
}
