use tauri::State;

use crate::models::SessionTargetRef;
use crate::services::session_target::ActiveSessionTarget;

#[tauri::command]
pub fn set_active_session_target(
    target: Option<SessionTargetRef>,
    state: State<'_, ActiveSessionTarget>,
) -> Result<(), String> {
    state.set(target)
}
