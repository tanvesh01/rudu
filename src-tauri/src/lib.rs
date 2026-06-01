mod cache;
mod commands;
mod github;
mod linear;
mod linear_mcp;
mod models;
mod services;
mod support;

use tauri::path::BaseDirectory;
use tauri::Manager;
use tauri_plugin_decorum::WebviewWindowExt;

use cache::{initialize_cache_database, set_cache_db_path};

pub fn run_linear_mcp_stdio() {
    linear_mcp::run_stdio_server();
}

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
            commands::issues::get_issue_dashboard,
            commands::issues::count_issue_buckets,
            commands::issues::get_linear_integration_status,
            commands::issues::save_linear_api_key,
            commands::issues::delete_linear_api_key,
            commands::issues::count_open_issue_roles,
            commands::initial_cache::get_initial_cache,
            commands::issues::list_open_issue_buckets,
            commands::pull_requests::list_cached_pull_requests,
            commands::pull_requests::list_pull_requests,
            commands::pull_requests::get_pull_request_summary,
            commands::pull_request_details::get_pull_request_overview,
            commands::pull_request_details::get_pull_request_checks,
            commands::review_session::get_review_chat_readiness,
            commands::review_session::get_review_chat_readiness_for_runtime,
            commands::review_session::list_opencode_models,
            commands::review_session::prepare_review_workspace,
            commands::review_session::load_review_session,
            commands::review_session::refresh_review_session,
            commands::review_session::list_review_workspace_files,
            commands::review_session::generate_review_walkthrough,
            commands::review_session::load_review_chat_transcript,
            commands::review_session::ensure_review_chat_session,
            commands::review_session::switch_review_chat_runtime,
            commands::review_session::reset_review_chat_session,
            commands::review_session::set_runtime_model_choice,
            commands::review_session::set_review_chat_effort_mode,
            commands::review_session::set_pending_review_chat_effort_mode,
            commands::review_session::save_review_chat_transcript,
            commands::review_session::send_review_chat_message,
            commands::review_session::cancel_review_chat_turn,
            commands::pull_requests::get_pull_request_patch,
            commands::pull_requests::get_pull_request_diff_bundle,
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

            let codex_acp_cache_root = match app.path().resolve("codex-acp", BaseDirectory::AppData)
            {
                Ok(path) => path,
                Err(error) => {
                    return Err(std::io::Error::new(
                        std::io::ErrorKind::Other,
                        format!("Failed to resolve Codex ACP cache directory: {error}"),
                    )
                    .into())
                }
            };

            if services::review_session::set_codex_acp_cache_root(codex_acp_cache_root).is_err() {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::Other,
                    "Codex ACP cache path was already initialized",
                )
                .into());
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
