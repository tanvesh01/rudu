use tauri::{AppHandle, State};

use crate::services::terminal::{self, TerminalState};

#[tauri::command]
pub fn start_terminal(
    app: AppHandle,
    state: State<'_, TerminalState>,
    checkout_id: String,
    cols: u16,
    rows: u16,
) -> Result<u64, String> {
    terminal::start(&state, app, &checkout_id, cols, rows)
}

#[tauri::command]
pub fn write_terminal(
    state: State<'_, TerminalState>,
    checkout_id: String,
    data: String,
) -> Result<(), String> {
    terminal::write(&state, &checkout_id, &data)
}

#[tauri::command]
pub fn resize_terminal(
    state: State<'_, TerminalState>,
    checkout_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    terminal::resize(&state, &checkout_id, cols, rows)
}

#[tauri::command]
pub fn stop_terminal(state: State<'_, TerminalState>, checkout_id: String) -> Result<(), String> {
    terminal::stop(&state, &checkout_id)
}
