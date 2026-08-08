use tauri::{AppHandle, State};

use crate::services::cli_launcher::{self, CliLaunch, PendingCliLaunch};

#[tauri::command]
pub fn take_cli_launch_request(state: State<'_, PendingCliLaunch>) -> Option<CliLaunch> {
    state.take()
}

#[tauri::command]
pub fn install_cli_launcher(app: AppHandle) -> Result<String, String> {
    cli_launcher::install_cli_launcher(&app)
}
