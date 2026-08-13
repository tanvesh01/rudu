mod cache;
mod commands;
mod github;
mod models;
mod services;
mod session_cli;
mod support;

use tauri::path::BaseDirectory;
use tauri::Manager;
use tauri_plugin_decorum::WebviewWindowExt;

use cache::{initialize_cache_database, set_cache_db_path};
use services::cli_launcher::CliLaunchQueue;
use services::session_server::SessionNavigationQueue;
use services::session_target::ActiveSessionTarget;

pub use services::cli_launcher::{
    parse_cli_launch, usage as cli_usage, validate_cli_launch, CliLaunch,
};

/// Run `rudu session <action> ...`: returns the JSON response or an error message.
pub fn run_session_cli(args: &[String]) -> Result<String, String> {
    session_cli::run_session_command(args)
}

/// Run `rudu skill path`: writes the embedded review skill to a stable temp path and prints it.
pub fn run_skill_path() -> Result<String, String> {
    session_cli::run_skill_path()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run(launch: CliLaunch) {
    let mut builder = tauri::Builder::default()
        .manage(CliLaunchQueue::new(launch))
        .manage(SessionNavigationQueue::default())
        .manage(ActiveSessionTarget::default());
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            services::cli_launcher::handle_cli_launch(app, &args, std::path::Path::new(&cwd));
        }));
    }

    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_decorum::init())
        .invoke_handler(tauri::generate_handler![
            commands::cli_launcher::take_cli_launch_request,
            commands::cli_launcher::install_cli_launcher,
            commands::repos::list_initial_repos,
            commands::repos::search_repos,
            commands::repos::validate_repo,
            commands::repos::list_saved_repos,
            commands::repos::save_repo,
            commands::local_checkouts::add_local_checkout,
            commands::local_checkouts::list_local_checkouts,
            commands::local_checkouts::get_local_checkout_status,
            commands::local_checkouts::get_local_checkout_patch,
            commands::local_checkouts::remove_local_checkout,
            commands::local_checkouts::take_session_navigation,
            commands::local_checkouts::complete_session_navigation,
            commands::sessions::set_active_session_target,
            commands::review_notes::list_review_notes,
            commands::review_notes::add_user_review_note,
            commands::review_notes::add_user_review_comment_draft,
            commands::review_notes::promote_review_note,
            commands::review_notes::publish_review_notes,
            commands::preflight::get_gh_cli_status,
            commands::initial_cache::get_initial_cache,
            commands::pull_requests::list_cached_pull_requests,
            commands::pull_requests::list_pull_requests,
            commands::pull_requests::get_pull_request_summary,
            commands::pull_request_details::get_pull_request_overview,
            commands::pull_request_details::get_pull_request_checks,
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
                    return Err(std::io::Error::other(format!(
                        "Failed to resolve cache database path: {error}"
                    ))
                    .into())
                }
            };

            if set_cache_db_path(cache_db_path.clone()).is_err() {
                return Err(
                    std::io::Error::other("Cache database path was already initialized").into(),
                );
            }

            if let Err(error) = initialize_cache_database(&cache_db_path) {
                return Err(std::io::Error::other(error).into());
            }

            #[cfg(all(target_os = "macos", not(debug_assertions)))]
            if let Err(error) = services::cli_launcher::install_cli_launcher(app.handle()) {
                eprintln!("Failed to install the Rudu CLI launcher: {error}");
            }

            if let Err(error) = services::session_server::start_session_server(app.handle().clone())
            {
                eprintln!("Failed to start the Rudu session server: {error}");
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
