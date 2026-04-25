mod cache;
mod commands;
mod github;
mod models;
mod services;
mod support;

use std::path::PathBuf;

use tauri::path::BaseDirectory;
use tauri::Manager;
use tauri_plugin_decorum::WebviewWindowExt;

use cache::{initialize_cache_database, set_cache_db_path};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_decorum::init())
        .invoke_handler(tauri::generate_handler![
            commands::repos::list_initial_repos,
            commands::repos::search_repos,
            commands::repos::validate_repo,
            commands::repos::list_saved_repos,
            commands::repos::save_repo,
            commands::preflight::get_gh_cli_status,
            commands::pull_requests::list_cached_pull_requests,
            commands::pull_requests::list_pull_requests,
            commands::pull_requests::get_pull_request_patch,
            commands::pull_requests::list_pull_request_changed_files,
            commands::tracked_pull_requests::list_tracked_pull_requests,
            commands::tracked_pull_requests::track_pull_request,
            commands::tracked_pull_requests::remove_tracked_pull_request,
            commands::tracked_pull_requests::refresh_tracked_pull_requests,
            commands::review_comments::create_pull_request_review_comment,
            commands::review_comments::reply_to_pull_request_review_comment,
            commands::review_comments::update_pull_request_review_comment,
            commands::review_comments::get_pull_request_review_threads,
            commands::review_comments::get_viewer_login
        ])
        .setup(|app| {
            let cache_db_path = match app.path().resolve("cache.sqlite", BaseDirectory::AppData) {
                Ok(path) => path,
                Err(error) => {
                    return Err(std::io::Error::new(
                        std::io::ErrorKind::Other,
                        format!("Failed to resolve cache database path: {error}"),
                    )
                    .into())
                }
            };

            if set_cache_db_path(cache_db_path.clone()).is_err() {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::Other,
                    "Cache database path was already initialized",
                )
                .into());
            }

            if let Err(error) = initialize_cache_database(&cache_db_path) {
                return Err(std::io::Error::new(std::io::ErrorKind::Other, error).into());
            }

            if let Some(main_window) = app.get_webview_window("main") {
                if let Err(e) = main_window.create_overlay_titlebar() {
                    eprintln!("Failed to create overlay titlebar: {}", e);
                }
                #[cfg(target_os = "macos")]
                {
                    if let Err(e) = main_window.set_traffic_lights_inset(12.0, 16.0) {
                        eprintln!("Failed to set traffic lights inset: {}", e);
                    }
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
